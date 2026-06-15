/**
 * Timestamp-to-block resolution via RPC binary search.
 * No subgraph dependency — uses only eth_getBlockByNumber.
 * @module v2/clients/blocksByTimestamp
 */

import type { PublicClient } from 'viem'

/**
 * Parameters for resolveBlockNumbers.
 */
export interface ResolveBlockNumbersParams {
  /** viem PublicClient */
  client: PublicClient
  /** Array of Unix timestamps (seconds) to resolve to block numbers */
  timestamps: number[]
}

/**
 * Resolve an array of Unix timestamps to the closest block numbers via RPC binary search.
 *
 * All binary searches run in parallel, sharing an in-flight-deduped block cache
 * so concurrent searches for nearby timestamps avoid redundant RPC calls.
 *
 * @param params - The parameters
 * @returns Array of block numbers in the same order as the input timestamps
 *
 * @example
 * ```typescript
 * const blocks = await resolveBlockNumbers({
 *   client,
 *   timestamps: [1700000000, 1700003600, 1700007200],
 * })
 * // blocks: [18500000n, 18500300n, 18500600n]
 * ```
 */
export async function resolveBlockNumbers(params: ResolveBlockNumbersParams): Promise<bigint[]> {
  const { client, timestamps } = params

  if (timestamps.length === 0) return []

  const latestBlock = await client.getBlock({ blockTag: 'latest', includeTransactions: false })
  const latestNumber = latestBlock.number
  const latestTimestamp = Number(latestBlock.timestamp)

  // Cache + in-flight dedup: avoids redundant RPC calls across parallel searches
  const cache = new Map<bigint, number>()
  cache.set(latestNumber, latestTimestamp)
  cache.set(0n, 0) // genesis is always timestamp 0 (close enough)

  const inflight = new Map<bigint, Promise<number>>()

  function getTimestamp(blockNumber: bigint): Promise<number> {
    const cached = cache.get(blockNumber)
    if (cached !== undefined) return Promise.resolve(cached)

    const existing = inflight.get(blockNumber)
    if (existing) return existing

    const promise = client.getBlock({ blockNumber, includeTransactions: false }).then((block) => {
      const ts = Number(block.timestamp)
      cache.set(blockNumber, ts)
      inflight.delete(blockNumber)
      return ts
    })
    inflight.set(blockNumber, promise)
    return promise
  }

  /**
   * Binary search for the last block whose timestamp <= targetTimestamp.
   */
  async function searchBlock(targetTimestamp: number, low: bigint, high: bigint): Promise<bigint> {
    // Clamp: if target is beyond latest, return latest
    if (targetTimestamp >= latestTimestamp) return latestNumber

    while (high - low > 1n) {
      const mid = (low + high) / 2n
      const midTs = await getTimestamp(mid)

      if (midTs <= targetTimestamp) {
        low = mid
      } else {
        high = mid
      }
    }

    return low
  }

  // Run all binary searches in parallel — shared cache deduplicates common midpoints
  const results = await Promise.all(timestamps.map((ts) => searchBlock(ts, 0n, latestNumber)))

  return results
}

/**
 * Parameters for estimateBlockNumbers.
 */
export interface EstimateBlockNumbersParams {
  /** viem PublicClient */
  client: PublicClient
  /** Array of Unix timestamps (seconds) to resolve to block numbers */
  timestamps: number[]
  /**
   * Bootstrap block-time used only to pick the anchor block (seconds).
   * The final estimate uses the *measured* rate between latest and anchor,
   * so this only affects which sample point we draw — not accuracy on the
   * sampled window. Default 12 (Ethereum L1).
   */
  fallbackBlockTimeSec?: number
}

/**
 * Estimate block numbers for the given Unix timestamps using a 2-RPC linear
 * extrapolation. Trades binary-search accuracy (~25 RPCs) for ~2 RPCs.
 *
 * Suitable for chart-style use cases where the consumer plots tens-to-hundreds
 * of evenly-spaced points and a ±N-block error is invisible. Not suitable when
 * exact block correspondence is required (e.g. event log ranges).
 *
 * Algorithm:
 * 1. Fetch `latest` block.
 * 2. Use `fallbackBlockTimeSec` to estimate an anchor block roughly co-temporal
 *    with the *earliest* requested timestamp.
 * 3. Fetch the anchor block.
 * 4. Compute the measured average block time over [anchor, latest].
 * 5. Linearly extrapolate every requested timestamp from `latest`.
 *
 * If the sampled window is degenerate (e.g. anchor too close to latest, or
 * timestamps near genesis), falls back to {@link resolveBlockNumbers}.
 */
export async function estimateBlockNumbers(params: EstimateBlockNumbersParams): Promise<bigint[]> {
  const { client, timestamps, fallbackBlockTimeSec = 12 } = params

  if (timestamps.length === 0) return []

  const latest = await client.getBlock({ blockTag: 'latest', includeTransactions: false })
  const latestNum = latest.number
  const latestTs = Number(latest.timestamp)

  const earliest = Math.min(...timestamps)
  const secAgoMax = Math.max(0, latestTs - earliest)

  // All requested timestamps are now-or-future
  if (secAgoMax === 0) return timestamps.map(() => latestNum)

  const blocksBackEst = BigInt(Math.floor(secAgoMax / fallbackBlockTimeSec))
  const anchorNum = blocksBackEst >= latestNum ? 1n : latestNum - blocksBackEst
  const anchor = await client.getBlock({
    blockNumber: anchorNum,
    includeTransactions: false,
  })

  const numDelta = latestNum - anchor.number
  const tsDelta = latestTs - Number(anchor.timestamp)

  // Degenerate sample window — fall back to exact resolution.
  if (numDelta <= 0n || tsDelta <= 0) {
    return resolveBlockNumbers({ client, timestamps })
  }

  const avgBlockTimeSec = tsDelta / Number(numDelta)

  return timestamps.map((ts) => {
    const secAgo = latestTs - ts
    if (secAgo <= 0) return latestNum
    const blocksAgo = BigInt(Math.round(secAgo / avgBlockTimeSec))
    return blocksAgo >= latestNum ? 1n : latestNum - blocksAgo
  })
}
