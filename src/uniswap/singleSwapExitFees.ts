import Decimal from 'decimal.js'

import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'

/** Signed quote-token fees for one swap to either range edge, valued at the exit price. */
export function singleSwapExitFees(
  leg: { tickLower: number; tickUpper: number; liquidity: bigint; isLong: boolean },
  currentTick: number,
  feeOnSwapInput: number,
  quoteIsToken0: boolean,
  quoteDecimals: number,
): { up: number; down: number } {
  const lo = Math.min(leg.tickLower, leg.tickUpper)
  const hi = Math.max(leg.tickLower, leg.tickUpper)
  if (leg.liquidity <= 0n || currentTick < lo || currentTick > hi) return { up: 0, down: 0 }
  const q96 = new Decimal((1n << 96n).toString())
  const lower = new Decimal(tickToSqrtPriceX96(BigInt(lo)).toString()).div(q96)
  const upper = new Decimal(tickToSqrtPriceX96(BigInt(hi)).toString()).div(q96)
  const current = new Decimal(tickToSqrtPriceX96(BigInt(currentTick)).toString()).div(q96)
  const liquidity = new Decimal(leg.liquidity.toString())
  // Upward swaps pay token1; downward swaps pay token0.
  const token1In = liquidity.mul(upper.sub(current))
  const token0In = liquidity.mul(new Decimal(1).div(lower).sub(new Decimal(1).div(current)))
  const up = quoteIsToken0 ? token1In.div(upper.pow(2)) : token1In
  const down = quoteIsToken0 ? token0In : token0In.mul(lower.pow(2))
  const scale = new Decimal(feeOnSwapInput)
    .mul(leg.isLong ? -1 : 1)
    .div(new Decimal(10).pow(quoteDecimals))
  return { up: up.mul(scale).toNumber(), down: down.mul(scale).toNumber() }
}
