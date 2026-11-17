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
}

export interface SfpmLpPosition {
  tokenId: bigint
  /** The account's ERC-1155 balance of {@link tokenId}, in contracts. */
  positionSize: bigint
  currentTick: bigint
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
  const livePremia = await client.multicall({
    allowFailure: false,
    blockNumber,
    contracts: premiumCalls(currentTick),
  })

  return {
    tokenId,
    positionSize,
    currentTick: BigInt(currentTick),
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

      return {
        ...leg,
        liquidity,
        chunk: { netLiquidity, removedLiquidity, pendingFees0, pendingFees1 },
        attributedFees0: attribute(pendingFees0),
        attributedFees1: attribute(pendingFees1),
      }
    }),
    _meta,
  }
}
