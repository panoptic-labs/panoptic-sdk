/**
 * Account-scoped reads for direct-LP positions on the v3 SFPM.
 * @module v2/sfpmLp/reads
 */
import type { Address, PublicClient } from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import { encodeV3PoolKeyBytes } from '../simulations/sfpm'
import { decodeVegoid } from '../tokenId'
import type { BlockMeta } from '../types'
import { decodeLeftRightUnsigned } from '../writes/utils'
import { type SfpmLpLeg, decodeSfpmLpLegs, sfpmLpLegLiquidity } from './position'

/** `type(int24).max`: tells `getAccountPremium` to return the stored accumulator untouched. */
const STORED_PREMIUM_TICK = 8388607
const Q64 = 1n << 64n

/**
 * The account's state in one SFPM chunk (pool, account, token type, tick range).
 * Every token ID the account holds over this chunk shares it.
 */
export interface SfpmLpChunk {
  /** Liquidity the account has deployed in Uniswap for this chunk. */
  netLiquidity: bigint
  /** Liquidity the account has removed through long legs; zero for LP-only accounts. */
  removedLiquidity: bigint
  /** Uncollected Uniswap fees of the whole chunk, rounded down. */
  pendingFees0: bigint
  pendingFees1: bigint
}

export interface SfpmLpPositionLeg extends SfpmLpLeg {
  /**
   * Liquidity this token ID's balance accounts for in the chunk. Liquidity is
   * floored per mint, so after several increases this can exceed what the
   * balance actually deposited by a few units.
   */
  liquidity: bigint
  chunk: SfpmLpChunk
  /**
   * This token ID's pro-rata share of the chunk's pending fees. An estimate:
   * the SFPM does not attribute fees per token ID, and the next mint or burn
   * touching the chunk pays out all of {@link SfpmLpChunk.pendingFees0}.
   */
  attributedFees0: bigint
  attributedFees1: bigint
  /**
   * Fees this token ID earned since it was opened, collected or not, from the
   * chunk's gross-premium accumulator (which collects never reset). Each span
   * between two size changes is priced at that span's liquidity. Set only when
   * `sizeChanges` or `openedAtBlock` is passed. Assumes the account holds no other
   * token ID on the same range.
   */
  lifetimeFees0?: bigint
  lifetimeFees1?: bigint
}

export interface SfpmLpPosition {
  tokenId: bigint
  /** The account's ERC-1155 balance of {@link tokenId}, in contracts. */
  positionSize: bigint
  currentTick: bigint
  /** Pool tick at the first size change; set only when the history is read. */
  openingTick?: bigint
  /** Each size change with the pool tick at the end of its block, oldest first. */
  history?: SfpmLpSizeChangeAtTick[]
  legs: SfpmLpPositionLeg[]
  _meta: BlockMeta
}

export interface GetSfpmLpPositionParams {
  client: PublicClient
  /** SemiFungiblePositionManagerV3 address */
  sfpmAddress: Address
  /** Underlying Uniswap v3 pool */
  poolAddress: Address
  account: Address
  tokenId: bigint
  blockNumber?: bigint
  /**
   * Every mint and burn of the token ID by the account (e.g. from the subgraph's
   * TokenizedPositionMinted / Burnt events). When set, also reads the tick and the
   * premium accumulator at each of those blocks (archival reads) to return
   * {@link SfpmLpPosition.history} and lifetime fees.
   */
  sizeChanges?: readonly SfpmLpSizeChange[]
  /** Shorthand for a single mint at this block of the whole current balance. */
  openedAtBlock?: bigint
}

export interface SfpmLpSizeChange {
  blockNumber: bigint
  /** Contracts minted (positive) or burned (negative). */
  sizeDelta: bigint
  /**
   * Transaction of the mint or burn. Tells a collect (mint and burn of the same size in one
   * transaction) from separate touches in one block; without it, a block with several
   * changes cannot be priced and lifetime fees are omitted.
   */
  transactionHash?: string
}

/** One block of the size history, oldest first. */
export interface SfpmLpSizeChangeAtTick {
  blockNumber: bigint
  /** Net contracts minted (positive) or burned (negative) in the block. */
  sizeDelta: bigint
  /** Contracts minted in the block, excluding collects. */
  minted: bigint
  /** Contracts burned in the block, excluding collects. */
  burned: bigint
  /** Pool tick at the end of the block. */
  tick: bigint
}

/** Archival snapshot reads in flight at once for one position's size history. */
const ARCHIVAL_READ_CONCURRENCY = 4

/** `Promise.all(items.map(fn))` with at most `limit` calls in flight; results keep input order. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      const item = items[index]
      if (item !== undefined) results[index] = await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

type SizeBlock = Omit<SfpmLpSizeChangeAtTick, 'tick'>

/**
 * Merge changes per block, oldest first. Blocks netting to zero stay: they are snapshot
 * boundaries. A transaction minting and burning the same size is a collect and adds no
 * cash flow. `ambiguous` is set when a block holds touches from more than one transaction:
 * the stored accumulator snapshot at its end cannot tell what liquidity earned between them.
 */
function normalizeSizeChanges(changes: readonly SfpmLpSizeChange[]): {
  blocks: SizeBlock[]
  ambiguous: boolean
} {
  const byBlock = new Map<bigint, Map<string, { minted: bigint; burned: bigint }>>()
  changes.forEach(({ blockNumber, sizeDelta, transactionHash }, index) => {
    const txs = byBlock.get(blockNumber) ?? new Map<string, { minted: bigint; burned: bigint }>()
    // Without a hash, each change is its own transaction.
    const key = transactionHash?.toLowerCase() ?? `#${index}`
    const tx = txs.get(key) ?? { minted: 0n, burned: 0n }
    if (sizeDelta > 0n) tx.minted += sizeDelta
    else tx.burned -= sizeDelta
    txs.set(key, tx)
    byBlock.set(blockNumber, txs)
  })
  let ambiguous = false
  const blocks = [...byBlock].map(([blockNumber, txs]): SizeBlock => {
    if (txs.size > 1) ambiguous = true
    let minted = 0n
    let burned = 0n
    let sizeDelta = 0n
    for (const tx of txs.values()) {
      sizeDelta += tx.minted - tx.burned
      if (tx.minted === tx.burned) continue
      minted += tx.minted
      burned += tx.burned
    }
    return { blockNumber, sizeDelta, minted, burned }
  })
  blocks.sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0,
  )
  return { blocks, ambiguous }
}

/** Invert the SFPM's gross-premium accumulator delta back into collected fees. */
function feesFromGrossPremium(
  premiumDelta: bigint,
  netLiquidity: bigint,
  removedLiquidity: bigint,
  vegoid: bigint,
): bigint {
  if (netLiquidity === 0n) return 0n
  const totalLiquidity = netLiquidity + removedLiquidity
  const grossNumerator =
    totalLiquidity ** 2n - totalLiquidity * removedLiquidity + removedLiquidity ** 2n / vegoid
  return (premiumDelta * totalLiquidity * netLiquidity ** 2n) / (grossNumerator * Q64)
}

/**
 * Read an account's direct-LP position: balance, per-range liquidity, and
 * pending fees at both chunk level and token-ID level, all at one block.
 */
export async function getSfpmLpPosition(params: GetSfpmLpPositionParams): Promise<SfpmLpPosition> {
  const { client, sfpmAddress, poolAddress, account, tokenId } = params
  const legs = decodeSfpmLpLegs(tokenId)
  const vegoid = decodeVegoid(tokenId)
  const poolKey = encodeV3PoolKeyBytes(poolAddress)
  const _meta = await getBlockMeta({ client, blockNumber: params.blockNumber })
  const blockNumber = _meta.blockNumber

  const sfpm = { address: sfpmAddress, abi: sfpmV3Abi } as const
  const premiumCalls = (atTick: number) =>
    legs.map(
      (leg) =>
        ({
          ...sfpm,
          functionName: 'getAccountPremium',
          args: [
            poolKey,
            account,
            leg.tokenType,
            Number(leg.tickLower),
            Number(leg.tickUpper),
            atTick,
            0n,
            vegoid,
          ],
        }) as const,
    )

  const [[positionSize, currentTick], liquidities, storedPremia] = await Promise.all([
    client.multicall({
      allowFailure: false,
      blockNumber,
      contracts: [
        { ...sfpm, functionName: 'balanceOf', args: [account, tokenId] },
        { ...sfpm, functionName: 'getCurrentTick', args: [poolKey] },
      ],
    }),
    client.multicall({
      allowFailure: false,
      blockNumber,
      contracts: legs.map(
        (leg) =>
          ({
            ...sfpm,
            functionName: 'getAccountLiquidity',
            args: [poolKey, account, leg.tokenType, Number(leg.tickLower), Number(leg.tickUpper)],
          }) as const,
      ),
    }),
    client.multicall({
      allowFailure: false,
      blockNumber,
      contracts: premiumCalls(STORED_PREMIUM_TICK),
    }),
  ])
  // A collect (mint + burn of the same size in one block) nets to zero but still
  // resets the stored accumulator, so it stays a snapshot boundary: keep the block,
  // only merge its deltas.
  const normalized =
    params.sizeChanges !== undefined
      ? // Changes after the read block are not part of this point-in-time view.
        normalizeSizeChanges(
          params.sizeChanges.filter((change) => change.blockNumber <= blockNumber),
        )
      : params.openedAtBlock !== undefined && params.openedAtBlock <= blockNumber
        ? {
            blocks: [
              {
                blockNumber: params.openedAtBlock,
                sizeDelta: positionSize,
                minted: positionSize,
                burned: 0n,
              },
            ],
            ambiguous: false,
          }
        : undefined
  // A history that does not add up to the balance is missing changes: leave it out
  // rather than price fees and PnL from part of it.
  const complete =
    normalized !== undefined &&
    normalized.blocks.reduce((sum, block) => sum + block.sizeDelta, 0n) === positionSize
  const changes = complete ? normalized.blocks : undefined
  const [livePremia, snapshots] = await Promise.all([
    client.multicall({
      allowFailure: false,
      blockNumber,
      contracts: premiumCalls(currentTick),
    }),
    changes === undefined || changes.length === 0
      ? undefined
      : mapBounded(changes, ARCHIVAL_READ_CONCURRENCY, ({ blockNumber: at }) =>
          Promise.all([
            client.readContract({
              ...sfpm,
              functionName: 'getCurrentTick',
              args: [poolKey],
              blockNumber: at,
            }),
            client.multicall({
              allowFailure: false,
              blockNumber: at,
              contracts: premiumCalls(STORED_PREMIUM_TICK),
            }),
          ]),
        ),
  ])
  const history =
    changes && snapshots
      ? changes.map((change, k) => ({ ...change, tick: BigInt(snapshots[k]?.[0] ?? 0) }))
      : undefined
  // Balance held through each span: after change k, until change k + 1.
  const spanSizes: bigint[] = []
  for (const change of changes ?? []) spanSizes.push((spanSizes.at(-1) ?? 0n) + change.sizeDelta)

  return {
    tokenId,
    positionSize,
    currentTick: BigInt(currentTick),
    ...(history ? { openingTick: history[0]?.tick, history } : {}),
    legs: legs.map((leg, i) => {
      const { right: netLiquidity, left: removedLiquidity } = decodeLeftRightUnsigned(
        liquidities[i] ?? 0n,
      )
      const [stored0, stored1] = storedPremia[i] ?? [0n, 0n]
      const [live0, live1] = livePremia[i] ?? [0n, 0n]
      const pendingFees0 = feesFromGrossPremium(
        live0 - stored0,
        netLiquidity,
        removedLiquidity,
        vegoid,
      )
      const pendingFees1 = feesFromGrossPremium(
        live1 - stored1,
        netLiquidity,
        removedLiquidity,
        vegoid,
      )

      const legLiquidity = sfpmLpLegLiquidity(leg, positionSize)
      const liquidity = legLiquidity < netLiquidity ? legLiquidity : netLiquidity
      const attribute = (fees: bigint) =>
        netLiquidity === 0n ? 0n : (fees * liquidity) / netLiquidity

      // The accumulator only grows, so each span's delta is every fee earned in it: closed
      // spans at the liquidity they held, the open one like the pending fees above.
      let lifetime = {}
      if (snapshots && !normalized?.ambiguous) {
        let fees0 = 0n
        let fees1 = 0n
        for (let k = 0; k + 1 < snapshots.length; k++) {
          const [from0, from1] = snapshots[k]?.[1][i] ?? [0n, 0n]
          const [to0, to1] = snapshots[k + 1]?.[1][i] ?? [0n, 0n]
          const spanLiquidity = sfpmLpLegLiquidity(leg, spanSizes[k] ?? 0n)
          fees0 += feesFromGrossPremium(to0 - from0, spanLiquidity, 0n, vegoid)
          fees1 += feesFromGrossPremium(to1 - from1, spanLiquidity, 0n, vegoid)
        }
        const [last0, last1] = snapshots.at(-1)?.[1][i] ?? [0n, 0n]
        fees0 += attribute(
          feesFromGrossPremium(live0 - last0, netLiquidity, removedLiquidity, vegoid),
        )
        fees1 += attribute(
          feesFromGrossPremium(live1 - last1, netLiquidity, removedLiquidity, vegoid),
        )
        lifetime = { lifetimeFees0: fees0, lifetimeFees1: fees1 }
      }

      return {
        ...leg,
        liquidity,
        chunk: { netLiquidity, removedLiquidity, pendingFees0, pendingFees1 },
        attributedFees0: attribute(pendingFees0),
        attributedFees1: attribute(pendingFees1),
        ...lifetime,
      }
    }),
    _meta,
  }
}
