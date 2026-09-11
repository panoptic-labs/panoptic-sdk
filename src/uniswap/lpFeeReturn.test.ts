import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { annualizeLpFeeReturn, getLpFeeReturnSeries } from './lpFeeReturn'

const D = Decimal.clone({ precision: 60 })
const position = { tickLower: -100, tickUpper: 100, liquidity: 10n ** 18n }
const points = [{ time: 1, fees0: 1000n, fees1: 2000n }]
const calculate = (ranges = [position], startTick = 0, fees = points) =>
  getLpFeeReturnSeries({ points: fees, ranges, startTick })

describe('LP fee return', () => {
  it('annualizes by the full viewport duration without compounding', () => {
    expect(annualizeLpFeeReturn(new Decimal(2), 7n * 86400n).toNumber()).toBeCloseTo(104.2857142857)
    expect(annualizeLpFeeReturn(new Decimal(2), 14n * 86400n).toNumber()).toBeCloseTo(52.1428571429)
    expect(annualizeLpFeeReturn(new Decimal(2), 31536000n).toNumber()).toBe(2)
    expect(annualizeLpFeeReturn(new Decimal(0), 86400n).toNumber()).toBe(0)
    expect(() => annualizeLpFeeReturn(new Decimal(2), 0n)).toThrow('positive window')
    expect(() => annualizeLpFeeReturn(new Decimal(2), -1n)).toThrow('positive window')
  })
  it('combines both tokens over all deployed capital', () => {
    const amount = new D('1.0001').pow(-50).neg().plus(1).mul(position.liquidity.toString()).floor()
    const expected = new D(3000).div(amount.mul(2)).mul(100)
    expect(calculate()?.[0]?.feeReturnPercent.toNumber()).toBeCloseTo(expected.toNumber(), 12)
  })
  it('values single-sided ETH capital against USDC fees with mixed decimals', () => {
    const startTick = -200000
    const range = { ...position, tickLower: -199000, tickUpper: -198000 }
    const amount0 = new D(range.liquidity.toString())
      .mul(new D('1.0001').pow(99500).minus(new D('1.0001').pow(99000)))
      .floor()
    const price = new D('1.0001').pow(startTick)
    const expected = new D('85000000').div(amount0.mul(price)).mul(100)
    const result = calculate([range], startTick, [{ time: 1, fees0: 0n, fees1: 85000000n }])
    expect(result?.[0]?.feeReturnPercent.toNumber()).toBeCloseTo(expected.toNumber(), 12)
  })
  it('is invariant when both token ordering and raw amounts are reversed', () => {
    const range = { ...position, tickLower: -200200, tickUpper: -199800 }
    const a = calculate([range], -200000, [{ time: 1, fees0: 10n ** 15n, fees1: 85000000n }])
    const b = calculate(
      [{ ...range, tickLower: -range.tickUpper, tickUpper: -range.tickLower }],
      200000,
      [{ time: 1, fees0: 85000000n, fees1: 10n ** 15n }],
    )
    expect(a?.[0]?.feeReturnPercent.toNumber()).toBeCloseTo(
      b?.[0]?.feeReturnPercent.toNumber() ?? 0,
      10,
    )
  })
  it('sums multi-leg capital even when one leg is entirely token0 and another token1', () => {
    const token0 = { ...position, tickLower: 100, tickUpper: 200 }
    const token1 = { ...position, tickLower: -200, tickUpper: -100 }
    const single = calculate([token0])?.[0]?.feeReturnPercent
    const combined = calculate([token0, token1])?.[0]?.feeReturnPercent
    expect(combined?.mul(2).toNumber()).toBeCloseTo(single?.toNumber() ?? 0, 12)
  })
  it('keeps equal fee totals flat and starts zero fees at zero return', () => {
    const result = calculate([position], 0, [
      { time: 0, fees0: 0n, fees1: 0n },
      ...points,
      { ...points[0], time: 2, fees0: 1000n, fees1: 2000n },
    ])
    expect(result?.[0]?.feeReturnPercent.isZero()).toBe(true)
    expect(result?.[1]?.feeReturnPercent.eq(result[2]?.feeReturnPercent ?? -1)).toBe(true)
  })
  it('handles empty or dust capital and rejects invalid inputs', () => {
    expect(calculate([])).toBeUndefined()
    expect(calculate([{ ...position, liquidity: 0n }])).toBeUndefined()
    expect(() => calculate([position], 900000)).toThrow()
    expect(() => calculate([{ ...position, tickUpper: -100 }])).toThrow()
  })
})
