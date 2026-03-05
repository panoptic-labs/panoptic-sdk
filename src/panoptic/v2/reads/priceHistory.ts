/**
 * Historical price reads for the Panoptic v2 SDK.
 *
 * Fetches slot0 (tick + sqrtPriceX96) across a series of historical blocks
 * for price-over-time charting. All block reads are parallelized via
 * Promise.all (viem auto-batches into multicall).
 *
 * @module v2/reads/priceHistory
 */

import type { PublicClient } from 'viem'

import { stateViewAbi } from '../abis/stateView'
import { uniswapV3PoolAbi } from '../abis/uniswapV3Pool'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta } from '../types'
import type { PoolVersionConfig } from '../types/poolConfig'

// ── Types ──────────────────────────────────────────────────────────────

/** A single price snapshot at a particular block. */
export interface PriceSnapshot {
  /** Block number (undefined if queried as latest) */
  blockNumber: bigint | undefined
  /** Current tick of the pool at this block */
  tick: number
  /** sqrtPriceX96 at this block */
  sqrtPriceX96: bigint
}

/** Result from getPriceHistory. */
export interface PriceHistoryResult {
  /** Snapshots in the same order as input blockNumbers */
  snapshots: PriceSnapshot[]
  /** Block metadata for the latest block used */
  _meta: BlockMeta
}

/** Parameters for getPriceHistory. */
export interface GetPriceHistoryParams {
  /** viem PublicClient */
  client: PublicClient
  /** Block numbers to query; undefined entries resolve to latest */
  blockNumbers: (bigint | undefined)[]
  /** Pool version config (carries pool address / StateView + poolId) */
  poolConfig: PoolVersionConfig
  /** Pre-fetched block metadata (skips an extra eth_getBlockByNumber if provided) */
  _meta?: BlockMeta
}

// ── Main function ──────────────────────────────────────────────────────

/**
 * Get historical price data (tick + sqrtPriceX96) for a pool across multiple blocks.
 *
 * @param params - The parameters
 * @returns Price snapshots at each block
 *
 * @example
 * ```typescript
 * const { snapshots } = await getPriceHistory({
 *   client,
 *   blockNumbers: [18000000n, 18000100n, 18000200n],
 *   poolConfig: { version: 'v3', poolAddress: '0x...' },
 * })
 *
 * for (const snap of snapshots) {
 *   console.log(`Block ${snap.blockNumber}: tick=${snap.tick}`)
 * }
 * ```
 */
export async function getPriceHistory(params: GetPriceHistoryParams): Promise<PriceHistoryResult> {
  const { client, blockNumbers, poolConfig } = params

  if (blockNumbers.length === 0) {
    const _meta = params._meta ?? (await getBlockMeta({ client }))
    return { snapshots: [], _meta }
  }

  // Fire one slot0 read per block — viem auto-batches into multicall
  const slot0Requests = blockNumbers.map((bn) => fetchSlot0(client, bn, poolConfig))

  const [slot0Results, _meta] = await Promise.all([
    Promise.all(slot0Requests),
    params._meta ? Promise.resolve(params._meta) : getBlockMeta({ client }),
  ])

  const snapshots: PriceSnapshot[] = slot0Results.map((result, i) => ({
    blockNumber: blockNumbers[i],
    tick: result.tick,
    sqrtPriceX96: result.sqrtPriceX96,
  }))

  return { snapshots, _meta }
}

// ── Internals ──────────────────────────────────────────────────────────

interface Slot0Data {
  tick: number
  sqrtPriceX96: bigint
}

async function fetchSlot0(
  client: PublicClient,
  blockNumber: bigint | undefined,
  poolConfig: PoolVersionConfig,
): Promise<Slot0Data> {
  if (poolConfig.version === 'v3') {
    const result = await client.readContract({
      address: poolConfig.poolAddress,
      abi: uniswapV3PoolAbi,
      functionName: 'slot0',
      blockNumber,
    })
    return {
      sqrtPriceX96: result[0],
      tick: result[1],
    }
  } else {
    const result = await client.readContract({
      address: poolConfig.stateViewAddress,
      abi: stateViewAbi,
      functionName: 'getSlot0',
      args: [poolConfig.poolId],
      blockNumber,
    })
    return {
      sqrtPriceX96: result[0],
      tick: result[1],
    }
  }
}
