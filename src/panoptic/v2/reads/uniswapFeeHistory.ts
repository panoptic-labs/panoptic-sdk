/**
 * Historical Uniswap fee reads for the Panoptic v2 SDK.
 *
 * Standalone function for fetching Uniswap fee accrual across historical blocks.
 * Works with any Uniswap V3/V4 pool — no Panoptic pool required.
 *
 * Also used internally by getStreamiaHistory for the Uniswap fee component.
 *
 * @module v2/reads/uniswapFeeHistory
 */

import type { Address, PublicClient } from 'viem'

import { stateViewAbi } from '../abis/stateView'
import { uniswapV3PoolAbi } from '../abis/uniswapV3Pool'
import { getBlockMeta } from '../clients/blockMeta'
import { InvalidHistoryRangeError } from '../errors/sdk'
import type { BlockMeta } from '../types'
import type { PoolVersionConfig } from '../types/poolConfig'
import type { StreamiaLeg } from '../types/streamia'

// ── Types ──────────────────────────────────────────────────────────────

/** A single snapshot of Uniswap fee data at a particular block. */
export interface UniswapFeeSnapshot {
  /** Block number (undefined if queried as latest) */
  blockNumber: bigint | undefined
  /** Uniswap fee delta from the first block in the series */
  fees: { token0: bigint; token1: bigint }
}

/** Result from getUniswapFeeHistory. */
export interface UniswapFeeHistoryResult {
  /** Snapshots in the same order as input blockNumbers */
  snapshots: UniswapFeeSnapshot[]
  /** Block metadata for the latest block used */
  _meta: BlockMeta
}

/** Parameters for getUniswapFeeHistory. */
export interface GetUniswapFeeHistoryParams {
  /** viem PublicClient */
  client: PublicClient
  /** Block numbers to query; undefined entries resolve to latest */
  blockNumbers: (bigint | undefined)[]
  /** Decoded legs with pre-computed liquidity */
  legs: StreamiaLeg[]
  /** Pool version config (carries pool address / StateView + poolId) */
  poolConfig: PoolVersionConfig
  /** Pre-fetched block metadata (skips an extra eth_getBlockByNumber if provided) */
  _meta?: BlockMeta
}

// ── Public function ────────────────────────────────────────────────────

/**
 * Get historical Uniswap fee accrual for a set of liquidity legs across multiple blocks.
 *
 * Works with any Uniswap V3/V4 pool — no Panoptic pool required.
 * Returns fee deltas relative to the first block in the series.
 *
 * @param params - The parameters
 * @returns Fee snapshots at each block
 */
export async function getUniswapFeeHistory(
  params: GetUniswapFeeHistoryParams,
): Promise<UniswapFeeHistoryResult> {
  const { client, blockNumbers, legs, poolConfig } = params

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

  if (blockNumbers.length === 0 || legs.length === 0) {
    const _meta = params._meta ?? (await getBlockMeta({ client }))
    return { snapshots: [], _meta }
  }

  const [blockData, _meta] = await Promise.all([
    fetchUniswapFeeData(client, blockNumbers, legs, poolConfig),
    params._meta ? Promise.resolve(params._meta) : getBlockMeta({ client }),
  ])

  let initialFees0: bigint | null = null
  let initialFees1: bigint | null = null

  const snapshots: UniswapFeeSnapshot[] = blockData.map((bd, i) => {
    const { total0, total1 } = computeUniswapFeesForBlock(bd, legs)

    if (initialFees0 === null) {
      initialFees0 = total0
      initialFees1 = total1
    }

    return {
      blockNumber: blockNumbers[i],
      fees: {
        token0: total0 - initialFees0,
        token1: total1 - (initialFees1 as bigint),
      },
    }
  })

  return { snapshots, _meta }
}

// ── Internals (also used by streamiaHistory) ─────────────────────────

/** Raw Uniswap data fetched for a single block. */
export interface UniswapBlockData {
  currentTick: number
  feeGrowthGlobal0: bigint
  feeGrowthGlobal1: bigint
  /** Map from tick number → { feeGrowthOutside0, feeGrowthOutside1 } */
  tickData: Map<number, { feeGrowthOutside0: bigint; feeGrowthOutside1: bigint }>
}

/**
 * Fetch Uniswap pool data for all blocks in parallel.
 * Globals (slot0, feeGrowthGlobal) are fetched ONCE per block, not per-leg.
 * Tick data is fetched for each unique tick across all legs.
 */
export async function fetchUniswapFeeData(
  client: PublicClient,
  blockNumbers: (bigint | undefined)[],
  legs: StreamiaLeg[],
  poolConfig: PoolVersionConfig,
): Promise<UniswapBlockData[]> {
  const uniqueTickSet = new Set<number>()
  for (const leg of legs) {
    uniqueTickSet.add(leg.lowerTick)
    uniqueTickSet.add(leg.upperTick)
  }
  const uniqueTicks = [...uniqueTickSet].sort((a, b) => a - b)

  const blockPromises = blockNumbers.map((bn) =>
    fetchUniswapBlockSnapshot(client, bn, uniqueTicks, poolConfig),
  )

  return Promise.all(blockPromises)
}

/**
 * Compute total Uniswap fees for all legs at a single block, using the
 * standard Uniswap V3 fee accumulation formula.
 */
export function computeUniswapFeesForBlock(
  blockData: UniswapBlockData,
  legs: StreamiaLeg[],
): { total0: bigint; total1: bigint } {
  let total0 = 0n
  let total1 = 0n

  for (const leg of legs) {
    const lower = blockData.tickData.get(leg.lowerTick)
    const upper = blockData.tickData.get(leg.upperTick)
    if (!lower || !upper) continue

    const { feeGrowthGlobal0, feeGrowthGlobal1, currentTick } = blockData

    const feesBelow0 =
      currentTick >= leg.lowerTick
        ? lower.feeGrowthOutside0
        : feeGrowthGlobal0 - lower.feeGrowthOutside0
    const feesBelow1 =
      currentTick >= leg.lowerTick
        ? lower.feeGrowthOutside1
        : feeGrowthGlobal1 - lower.feeGrowthOutside1

    const feesAbove0 =
      currentTick < leg.upperTick
        ? upper.feeGrowthOutside0
        : feeGrowthGlobal0 - upper.feeGrowthOutside0
    const feesAbove1 =
      currentTick < leg.upperTick
        ? upper.feeGrowthOutside1
        : feeGrowthGlobal1 - upper.feeGrowthOutside1

    const fees0 = ((feeGrowthGlobal0 - feesBelow0 - feesAbove0) * leg.liquidity) / (1n << 128n)
    const fees1 = ((feeGrowthGlobal1 - feesBelow1 - feesAbove1) * leg.liquidity) / (1n << 128n)

    total0 += fees0
    total1 += fees1
  }

  return { total0, total1 }
}

// ── Block snapshot fetchers ──────────────────────────────────────────

async function fetchUniswapBlockSnapshot(
  client: PublicClient,
  blockNumber: bigint | undefined,
  uniqueTicks: number[],
  poolConfig: PoolVersionConfig,
): Promise<UniswapBlockData> {
  if (poolConfig.version === 'v3') {
    return fetchV3BlockSnapshot(client, poolConfig.poolAddress, blockNumber, uniqueTicks)
  } else {
    return fetchV4BlockSnapshot(
      client,
      poolConfig.stateViewAddress,
      poolConfig.poolId,
      blockNumber,
      uniqueTicks,
    )
  }
}

async function fetchV3BlockSnapshot(
  client: PublicClient,
  poolAddress: Address,
  blockNumber: bigint | undefined,
  uniqueTicks: number[],
): Promise<UniswapBlockData> {
  const contracts = [
    { address: poolAddress, abi: uniswapV3PoolAbi, functionName: 'slot0' as const },
    { address: poolAddress, abi: uniswapV3PoolAbi, functionName: 'feeGrowthGlobal0X128' as const },
    { address: poolAddress, abi: uniswapV3PoolAbi, functionName: 'feeGrowthGlobal1X128' as const },
    ...uniqueTicks.map((tick) => ({
      address: poolAddress,
      abi: uniswapV3PoolAbi,
      functionName: 'ticks' as const,
      args: [tick] as const,
    })),
  ]

  const results = await client.multicall({ contracts, blockNumber, allowFailure: false })

  const slot0Result = results[0] as readonly [
    bigint,
    number,
    number,
    number,
    number,
    number,
    boolean,
  ]
  const feeGrowthGlobal0 = results[1] as bigint
  const feeGrowthGlobal1 = results[2] as bigint

  const tickData = new Map<number, { feeGrowthOutside0: bigint; feeGrowthOutside1: bigint }>()
  for (let i = 0; i < uniqueTicks.length; i++) {
    const tickResult = results[3 + i] as readonly [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
      boolean,
    ]
    tickData.set(uniqueTicks[i], {
      feeGrowthOutside0: tickResult[2],
      feeGrowthOutside1: tickResult[3],
    })
  }

  return { currentTick: slot0Result[1], feeGrowthGlobal0, feeGrowthGlobal1, tickData }
}

async function fetchV4BlockSnapshot(
  client: PublicClient,
  stateViewAddress: Address,
  poolId: `0x${string}`,
  blockNumber: bigint | undefined,
  uniqueTicks: number[],
): Promise<UniswapBlockData> {
  const contracts = [
    {
      address: stateViewAddress,
      abi: stateViewAbi,
      functionName: 'getSlot0' as const,
      args: [poolId] as const,
    },
    {
      address: stateViewAddress,
      abi: stateViewAbi,
      functionName: 'getFeeGrowthGlobals' as const,
      args: [poolId] as const,
    },
    ...uniqueTicks.map((tick) => ({
      address: stateViewAddress,
      abi: stateViewAbi,
      functionName: 'getTickInfo' as const,
      args: [poolId, tick] as const,
    })),
  ]

  const results = await client.multicall({ contracts, blockNumber, allowFailure: false })

  const slot0Result = results[0] as readonly [bigint, number, number, number]
  const feeGrowthResult = results[1] as readonly [bigint, bigint]

  const tickData = new Map<number, { feeGrowthOutside0: bigint; feeGrowthOutside1: bigint }>()
  for (let i = 0; i < uniqueTicks.length; i++) {
    const tickResult = results[2 + i] as readonly [bigint, bigint, bigint, bigint]
    tickData.set(uniqueTicks[i], {
      feeGrowthOutside0: tickResult[2],
      feeGrowthOutside1: tickResult[3],
    })
  }

  return {
    currentTick: slot0Result[1],
    feeGrowthGlobal0: feeGrowthResult[0],
    feeGrowthGlobal1: feeGrowthResult[1],
    tickData,
  }
}
