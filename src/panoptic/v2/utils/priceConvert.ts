/**
 * Price conversion between the two pool tokens at a given sqrtPriceX96.
 *
 * Mirrors the on-chain `PanopticMath.convert0to1` / `convert1to0` truncation,
 * with an overflow-safe branch for when `sqrtPriceX96^2` would not fit in a
 * uint256.
 *
 * @module v2/utils/priceConvert
 */

import { PanopticError } from '../errors'

const Q128 = 1n << 128n

/**
 * A non-positive price has no meaningful conversion, and `convert1to0` would
 * divide by zero — surface that as a typed SDK error rather than a RangeError
 * thrown from inside the arithmetic.
 */
function assertPositivePrice(sqrtPriceX96: bigint): void {
  if (sqrtPriceX96 <= 0n) {
    throw new PanopticError(`sqrtPriceX96 must be positive, got ${sqrtPriceX96}`)
  }
}

/** Convert a token0 amount to its token1-equivalent at the given sqrtPriceX96. */
export function convert0to1(amount: bigint, sqrtPriceX96: bigint): bigint {
  assertPositivePrice(sqrtPriceX96)
  if (sqrtPriceX96 < Q128) {
    return (amount * sqrtPriceX96 * sqrtPriceX96) >> 192n
  }
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * sp2Hi) >> 128n
}

/** Convert a token1 amount to its token0-equivalent at the given sqrtPriceX96. */
export function convert1to0(amount: bigint, sqrtPriceX96: bigint): bigint {
  assertPositivePrice(sqrtPriceX96)
  if (sqrtPriceX96 < Q128) {
    const denom = sqrtPriceX96 * sqrtPriceX96
    return (amount * (1n << 192n)) / denom
  }
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * (1n << 128n)) / sp2Hi
}

/**
 * Convert an amount denominated in `fromTokenIndex` into the other token's
 * terms, so the two sides of a pool flow can be compared on one scale.
 */
export function convertToTokenIndex(
  amount: bigint,
  fromTokenIndex: bigint,
  toTokenIndex: bigint,
  sqrtPriceX96: bigint,
): bigint {
  if (fromTokenIndex === toTokenIndex) return amount
  return fromTokenIndex === 0n
    ? convert0to1(amount, sqrtPriceX96)
    : convert1to0(amount, sqrtPriceX96)
}
