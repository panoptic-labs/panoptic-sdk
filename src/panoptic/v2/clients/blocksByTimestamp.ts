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
