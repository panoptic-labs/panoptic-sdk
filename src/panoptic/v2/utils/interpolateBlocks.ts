/**
 * Evenly-spaced block number interpolation utility.
 * @module v2/utils/interpolateBlocks
 */

import { InvalidHistoryRangeError } from '../errors/sdk'

/**
 * Generate evenly-spaced block numbers between start and end (pure math, no RPC).
 *
 * @param startBlock - First block in the range
 * @param endBlock - Last block in the range
 * @param points - Number of evenly-spaced data points to generate
 * @returns Array of interpolated block numbers
 *
 * @throws {InvalidHistoryRangeError} if startBlock > endBlock or points < 0
 */
export function interpolateBlocks(startBlock: bigint, endBlock: bigint, points: number): bigint[] {
  if (!Number.isFinite(points) || !Number.isSafeInteger(points)) {
    throw new InvalidHistoryRangeError(`points must be a finite safe integer, got ${points}`)
  }
  if (points < 0) {
    throw new InvalidHistoryRangeError(`points must be >= 0, got ${points}`)
  }
  if (startBlock > endBlock) {
    throw new InvalidHistoryRangeError(
      `startBlock (${startBlock}) must be <= endBlock (${endBlock})`,
    )
  }
  if (points === 0) return []
  if (points === 1) return [endBlock]
  const range = endBlock - startBlock
  return Array.from(
    { length: points },
    (_, i) => startBlock + (range * BigInt(i)) / BigInt(points - 1),
  )
}
