/**
 * Historical streamia (streaming premia) reads for the Panoptic v2 SDK.
 *
 * Fetches Panoptic premia and optionally Uniswap fee accrual across a series
 * of historical block numbers for a single position. Composes
 * getUniswapFeeHistory internally for the Uniswap fee component.
 *
 * @module v2/reads/streamiaHistory
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import { InvalidHistoryRangeError } from '../errors/sdk'
import type { BlockMeta } from '../types'
import type { PoolVersionConfig } from '../types/poolConfig'
import type { StreamiaLeg } from '../types/streamia'
import { computeUniswapFeesForBlock, fetchUniswapFeeData } from './uniswapFeeHistory'

// Re-export types that were originally defined here for backward compatibility
export type { PoolVersionConfig, V3PoolConfig, V4PoolConfig } from '../types/poolConfig'
export type { StreamiaLeg } from '../types/streamia'

// ── Types ──────────────────────────────────────────────────────────────

/** A signed settled-premia event used to reconstruct cumulative premia. */
export interface SettledEvent {
  /** Block at which settlement occurred */
  blockNumber: bigint
  /** Amount settled for token 0 */
  settled0: bigint
  /** Amount settled for token 1 */
  settled1: bigint
}

/** Parameters for getStreamiaHistory. */
export interface GetStreamiaHistoryParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool contract address */
  panopticPoolAddress: Address
  /** Account whose position to query */
  account: Address
  /** The encoded tokenId */
  tokenId: bigint
  /** Block numbers to query; undefined entries resolve to latest */
  blockNumbers: (bigint | undefined)[]
  /** Decoded legs with pre-computed liquidity */
  legs: StreamiaLeg[]
  /** Pool version config (carries pool address / StateView + poolId) */
  poolConfig: PoolVersionConfig
  /** Whether to include Uniswap fee data (default: true) */
  includeUniswapFees?: boolean
  /** Signed settled-premia events to include in cumulative premia (optional) */
  settledEvents?: SettledEvent[]
  /** Pre-fetched block metadata (skips an extra eth_getBlockByNumber if provided) */
  _meta?: BlockMeta
}

/** A single snapshot of streamia data at a particular block. */
export interface StreamiaSnapshot {
  /** Block number (undefined if queried as latest) */
  blockNumber: bigint | undefined
  /** Currently unsettled Panoptic premia (short - long) */
  panopticPremia: { token0: bigint; token1: bigint }
  /** Lifetime Panoptic premia, including signed settled amounts */
  cumulativePanopticPremia: { token0: bigint; token1: bigint }
  /** Uniswap fee delta from the first block in the series */
  uniswapFees: { token0: bigint; token1: bigint }
}

/** Result from getStreamiaHistory. */
export interface StreamiaHistoryResult {
  /** Snapshots in the same order as input blockNumbers */
  snapshots: StreamiaSnapshot[]
  /** Block metadata for the latest block used */
  _meta: BlockMeta
}

// 128-bit mask for LeftRight decoding
const MASK_128 = (1n << 128n) - 1n

// ── Main function ──────────────────────────────────────────────────────

/**
 * Get historical streamia data for a position across multiple blocks.
 *
 * @param params - The parameters
 * @returns Snapshots of Panoptic premia and Uniswap fee deltas at each block
 */
export async function getStreamiaHistory(
  params: GetStreamiaHistoryParams,
): Promise<StreamiaHistoryResult> {
  const {
    client,
    panopticPoolAddress,
    account,
    tokenId,
    blockNumbers,
    legs,
    poolConfig,
    includeUniswapFees = true,
    settledEvents,
  } = params

  // Validate legs
  for (const leg of legs) {
    if (leg.lowerTick >= leg.upperTick) {
      throw new InvalidHistoryRangeError(
        `Leg lowerTick (${leg.lowerTick}) must be < upperTick (${leg.upperTick})`,
      )
    }
    if (leg.liquidity <= 0n) {
      throw new InvalidHistoryRangeError(`Leg liquidity must be > 0, got ${leg.liquidity}`)
    }
  }

  if (blockNumbers.length === 0) {
    const _meta = params._meta ?? (await getBlockMeta({ client }))
    return { snapshots: [], _meta }
  }

  // Resolve "latest" once so reads and settlement ordering use the same block.
  const _meta = params._meta ?? (await getBlockMeta({ client }))
  const resolvedBlockNumbers = blockNumbers.map((blockNumber) => blockNumber ?? _meta.blockNumber)

  // ── 1. Panoptic premia: one readContract per block ─────────────────
  const premiaRequests = resolvedBlockNumbers.map((blockNumber) =>
    client.readContract({
      address: panopticPoolAddress,
      abi: panopticPoolV2Abi,
      functionName: 'getFullPositionsData',
      args: [account, true, [tokenId]],
      blockNumber,
    }),
  )

  // ── 2. Uniswap fees (delegated to uniswapFeeHistory internals) ────
  const uniswapDataPromise =
    includeUniswapFees && legs.length > 0
      ? fetchUniswapFeeData(client, resolvedBlockNumbers, legs, poolConfig)
      : undefined

  // ── 3. Fire all in parallel ────────────────────────────────────────
  const [premiaResults, uniswapData] = await Promise.all([
    Promise.all(premiaRequests),
    uniswapDataPromise ?? Promise.resolve(undefined),
  ])

  // ── 4. Pre-sort settled events for O(n+m) accumulation ─────────────
  const sortedSettled = settledEvents
    ? [...settledEvents].sort((a, b) =>
        a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1,
      )
    : []

  // ── 5. Accumulate settlements chronologically, independently of input order ──
  let settledIdx = 0
  let accSettled0 = 0n
  let accSettled1 = 0n
  const cumulativePremiaByInputIndex: StreamiaSnapshot['cumulativePanopticPremia'][] = Array.from(
    { length: blockNumbers.length },
    () => ({ token0: 0n, token1: 0n }),
  )

  const chronologicalInputs = resolvedBlockNumbers
    .map((blockNumber, inputIndex) => ({ blockNumber, inputIndex }))
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.inputIndex - b.inputIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    )

  for (const { blockNumber, inputIndex } of chronologicalInputs) {
    while (
      settledIdx < sortedSettled.length &&
      sortedSettled[settledIdx].blockNumber <= blockNumber
    ) {
      accSettled0 += sortedSettled[settledIdx].settled0
      accSettled1 += sortedSettled[settledIdx].settled1
      settledIdx++
    }

    const result = premiaResults[inputIndex]
    const premia0 = (result[0] & MASK_128) - (result[1] & MASK_128)
    const premia1 = (result[0] >> 128n) - (result[1] >> 128n)
    cumulativePremiaByInputIndex[inputIndex] = {
      token0: premia0 + accSettled0,
      token1: premia1 + accSettled1,
    }
  }

  // ── 6. Build snapshots in the caller's original input order ───────

  let initialUniswapFees0: bigint | null = null
  let initialUniswapFees1: bigint | null = null

  const snapshots: StreamiaSnapshot[] = premiaResults.map((result, i) => {
    const bn = blockNumbers[i]

    const shortPacked = result[0]
    const longPacked = result[1]

    const short0 = shortPacked & MASK_128
    const short1 = shortPacked >> 128n
    const long0 = longPacked & MASK_128
    const long1 = longPacked >> 128n

    const premia0 = short0 - long0
    const premia1 = short1 - long1

    let uniswapFees0 = 0n
    let uniswapFees1 = 0n

    if (uniswapData) {
      const blockData = uniswapData[i]
      const { total0, total1 } = computeUniswapFeesForBlock(blockData, legs)

      if (initialUniswapFees0 === null) {
        initialUniswapFees0 = total0
        initialUniswapFees1 = total1
      }
      uniswapFees0 = total0 - initialUniswapFees0
      uniswapFees1 = total1 - (initialUniswapFees1 as bigint)
    }

    return {
      blockNumber: bn,
      panopticPremia: { token0: premia0, token1: premia1 },
      cumulativePanopticPremia: cumulativePremiaByInputIndex[i],
      uniswapFees: { token0: uniswapFees0, token1: uniswapFees1 },
    }
  })

  return { snapshots, _meta }
}
