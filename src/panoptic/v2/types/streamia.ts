/**
 * Shared streamia types used by both streamiaHistory and uniswapFeeHistory reads.
 * @module v2/types/streamia
 */

/** Leg descriptor for Uniswap fee / streamia calculation. */
export interface StreamiaLeg {
  /** Lower tick of the leg's range */
  lowerTick: number
  /** Upper tick of the leg's range */
  upperTick: number
  /** Liquidity for this leg (from sizeToLiquidity) */
  liquidity: bigint
}
