import { describe, expect, it } from 'vitest'

import { type LpFeeCandle, estimateLpFees } from './estimateLpFees'

const candle: LpFeeCandle = {
  t: 1,
  o: 0,
  l: -100,
  h: 100,
  c: 50,
  v0: '1000000000000',
  v1: '1000000000000',
  liq: '100000000000000',
}
const range = { tickLower: -200, tickUpper: 200, liquidity: 1000000000000n }
const estimate = (candles = [candle], ranges = [range]) =>
  estimateLpFees({ candles, ranges, feePips: 3000n })
const totals = (result: ReturnType<typeof estimateLpFees>) =>
  result.points[result.points.length - 1]

describe('estimateLpFees', () => {
  it('earns in both tokens on a round trip even when open equals close', () => {
    const result = totals(estimate([{ ...candle, c: 0 }]))
    expect(result?.fees0).toBeGreaterThan(0n)
    expect(result?.fees1).toBeGreaterThan(0n)
  })
  it('charges token1 for upward moves and token0 for downward moves', () => {
    const up = totals(estimate([{ ...candle, o: -100, c: 100 }]))
    const down = totals(estimate([{ ...candle, o: 100, c: -100 }]))
    expect(up?.fees0).toBe(0n)
    expect(up?.fees1).toBeGreaterThan(0n)
    expect(down?.fees1).toBe(0n)
    expect(down?.fees0).toBeGreaterThan(0n)
  })
  it('clips crossing moves to the range and remains flat outside it', () => {
    const narrow = { ...range, tickLower: -20, tickUpper: 20 }
    const first = totals(estimate([candle], [narrow]))
    expect(first?.fees0).toBeGreaterThan(0n)
    expect(first?.fees0).toBeLessThan(totals(estimate())?.fees0 ?? 0n)
    const result = estimate([candle, { ...candle, t: 2, o: 200, l: 200, h: 300, c: 300 }], [narrow])
    expect(result.points[1]?.fees0).toBe(result.points[0]?.fees0)
    expect(result.points[1]?.fees1).toBe(result.points[0]?.fees1)
  })
  it('handles overlapping multi-leg liquidity without double counting fee budgets', () => {
    expect(totals(estimate([candle], [range, range]))).toEqual(
      totals(estimate([candle], [{ ...range, liquidity: range.liquidity * 2n }])),
    )
    const huge = totals(estimate([candle], [{ ...range, liquidity: 10n ** 40n }]))
    expect(huge?.fees0).toBeLessThanOrEqual(3000000000n)
    expect(huge?.fees1).toBeLessThanOrEqual(3000000000n)
  })
  it('is symmetric under token inversion, including mixed decimal raw amounts', () => {
    const original = {
      ...candle,
      o: -200000,
      l: -200100,
      h: -199900,
      c: -199950,
      v0: '1000000000000000000',
      v1: '2061250000',
    }
    const position = { ...range, tickLower: -200200, tickUpper: -199800 }
    const inverse = {
      ...original,
      o: -original.o,
      l: -original.h,
      h: -original.l,
      c: -original.c,
      v0: original.v1,
      v1: original.v0,
    }
    const a = totals(estimate([original], [position]))
    const b = totals(
      estimate(
        [inverse],
        [{ ...position, tickLower: -position.tickUpper, tickUpper: -position.tickLower }],
      ),
    )
    expect(a?.fees0).toBe(b?.fees1)
    expect(a?.fees1).toBe(b?.fees0)
  })
  it('returns zero for zero volume, no position or no fee', () => {
    expect(totals(estimate([{ ...candle, v0: '0', v1: '0' }]))?.fees0).toBe(0n)
    expect(totals(estimate([candle], []))?.fees1).toBe(0n)
    expect(totals(estimateLpFees({ candles: [candle], ranges: [range], feePips: 0n }))?.fees0).toBe(
      0n,
    )
  })
  it('uses historical liquidity for flat candles and reports unresolvable ones', () => {
    const flat = { ...candle, o: 0, h: 0, l: 0, c: 0 }
    expect(totals(estimate([flat]))?.fees0).toBeGreaterThan(0n)
    expect(estimate([{ ...flat, liq: '0' }]).skippedCandles).toBe(1)
    expect(totals(estimate([flat], [{ ...range, tickUpper: 0 }]))?.fees0).toBe(0n)
  })
  it('infers missing liquidity from non-flat OHLC and volume', () => {
    const result = estimate([{ ...candle, liq: '0' }])
    expect(result.inferredCandles).toBe(1)
    expect(totals(result)?.fees0).toBeGreaterThan(0n)
  })
  it('rejects malformed OHLC, amounts, ranges, dynamic fees and duplicate times', () => {
    expect(() => estimate([{ ...candle, v0: '-1' }])).toThrow()
    expect(() => estimate([{ ...candle, h: -1 }])).toThrow()
    expect(() => estimate([candle, candle])).toThrow()
    expect(() => estimate([candle], [{ ...range, tickUpper: range.tickLower }])).toThrow()
    expect(() => estimateLpFees({ candles: [], ranges: [], feePips: 8388608n })).toThrow()
  })
})
