import Decimal from 'decimal.js'

import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import type { LpFeeRange } from './estimateLpFees'
import { getAmountsForLiquidity } from './lpGreeks'

const D = Decimal.clone({ precision: 60 })

/** Simple fee APR over the full selected viewport, without compounding. */
export function annualizeLpFeeReturn(feeReturnPercent: Decimal, durationSeconds: bigint) {
  if (durationSeconds <= 0n) throw new Error('APR requires a positive window duration')
  return new D(feeReturnPercent).mul(31_536_000).div(durationSeconds.toString())
}

/**
 * Combine both fee tokens into a fee-only return on deployed LP capital.
 * Value both capital and fees at the window's opening price: this keeps fee
 * return flat when accrual stops and makes the ratio independent of quote
 * orientation. Raw token amounts already account for differing decimals.
 * Excludes principal price changes, impermanent loss and costs; not annualized.
 * Returns undefined when the position has no representable deployed capital.
 */
export function getLpFeeReturnSeries<T extends { fees0: bigint; fees1: bigint }>({
  points,
  ranges,
  startTick,
}: {
  points: readonly T[]
  ranges: readonly LpFeeRange[]
  startTick: number
}) {
  const validTick = (tick: number) => Number.isInteger(tick) && Math.abs(tick) <= 887272
  if (!validTick(startTick)) throw new Error('Invalid valuation tick')
  const sqrtP = tickToSqrtPriceX96(BigInt(startTick))
  const price = new D(sqrtP.toString()).pow(2).div(new D((1n << 192n).toString()))
  let capital0 = 0n
  let capital1 = 0n
  for (const range of ranges) {
    if (
      !validTick(range.tickLower) ||
      !validTick(range.tickUpper) ||
      range.tickLower >= range.tickUpper ||
      range.liquidity < 0n
    )
      throw new Error('Invalid LP range')
    const amounts = getAmountsForLiquidity(
      sqrtP,
      tickToSqrtPriceX96(BigInt(range.tickLower)),
      tickToSqrtPriceX96(BigInt(range.tickUpper)),
      range.liquidity,
    )
    capital0 += amounts.amount0
    capital1 += amounts.amount1
  }
  const capital = new D(capital0.toString()).mul(price).plus(capital1.toString())
  if (capital.isZero()) return undefined
  return points.map((point) => {
    if (point.fees0 < 0n || point.fees1 < 0n) throw new Error('Invalid fee amount')
    const fees = new D(point.fees0.toString()).mul(price).plus(point.fees1.toString())
    return { ...point, feeReturnPercent: fees.div(capital).mul(100) }
  })
}
