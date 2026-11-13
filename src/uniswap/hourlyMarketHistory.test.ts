import { expect, it } from 'vitest'

import { hourlyMarketHistory } from './hourlyMarketHistory'
import { pInRangeAt, pStayBelow } from './rangeProbability'

const endTime = 3600 * 1000
const samples = Array.from({ length: 720 }, (_, i) => ({
  timestamp: endTime - (720 - i) * 3600,
  tick: i % 2 === 0 ? 10 : 20,
}))
const input = { samples, endTime, currentTick: 30, baseIsToken0: true }
it('annualizes squared log returns by actual elapsed time', () => {
  const result = hourlyMarketHistory(input)
  expect(result.sigmaAnnual).toBeCloseTo(10 * Math.log(1.0001) * Math.sqrt(365 * 24), 10)
  expect(result.coveragePercent).toBe('100.0')
})
it('is independent of token decimals and handles both token orderings', () => {
  const direct = hourlyMarketHistory(input)
  const inverse = hourlyMarketHistory({ ...input, baseIsToken0: false })
  expect(inverse.sigmaAnnual).toBe(direct.sigmaAnnual)
  expect((1 + (direct.change24h ?? 0) / 100) * (1 + (inverse.change24h ?? 0) / 100)).toBeCloseTo(1)
})
it('deduplicates, excludes partial hours and invalid ticks, and retains gaps in time', () => {
  expect(
    hourlyMarketHistory({
      ...input,
      samples: [
        ...samples,
        ...samples,
        { timestamp: endTime, tick: 100 },
        { timestamp: endTime - 1, tick: NaN },
      ],
    }),
  ).toEqual(hourlyMarketHistory(input))
  const sparse = hourlyMarketHistory({ ...input, samples: samples.filter((_, i) => i !== 1) })
  expect(sparse.sampleCount).toBe(719)
  expect(sparse.sigmaAnnual).toBeLessThan(hourlyMarketHistory(input).sigmaAnnual ?? 0)
})
it('suppresses volatility for sparse, short or stale history', () => {
  for (const subset of [
    samples.slice(4),
    samples.slice(0, -3),
    samples.filter((_, i) => i % 4 === 0),
    [],
  ]) {
    expect(hourlyMarketHistory({ ...input, samples: subset }).sigmaAnnual).toBeUndefined()
  }
})
it('omits 24h change when the reference close is missing', () => {
  expect(
    hourlyMarketHistory({
      ...input,
      samples: samples.filter((point) => point.timestamp !== endTime - 25 * 3600),
    }).change24h,
  ).toBeUndefined()
})
it('distinguishes staying below throughout from ending below', () => {
  const args = { spot: 100, strike: Math.exp(0.2) * 100, sigmaAnnual: 0.2, tYears: 1 }
  expect(pStayBelow(args)).toBeCloseTo(0.68268949, 6)
  expect(pStayBelow(args)).toBeLessThan(pInRangeAt({ ...args, lower: 0, upper: args.strike }))
})
it('handles crossed barriers, zero volatility, short horizons and invalid inputs', () => {
  const args = { spot: 100, strike: 110, sigmaAnnual: 0.5, tYears: 1 }
  expect(pStayBelow({ ...args, strike: 100 })).toBe(0)
  expect(pStayBelow({ ...args, strike: 90 })).toBe(0)
  expect(pStayBelow({ ...args, sigmaAnnual: 0 })).toBe(1)
  expect(pStayBelow({ ...args, tYears: 0 })).toBe(1)
  expect(pStayBelow({ ...args, sigmaAnnual: NaN })).toBeUndefined()
  expect(pStayBelow({ ...args, tYears: -1 })).toBeUndefined()
  expect(pStayBelow({ ...args, sigmaAnnual: 1 })).toBeLessThan(pStayBelow(args) ?? 0)
  expect(pStayBelow({ ...args, tYears: 2 })).toBeLessThan(pStayBelow(args) ?? 0)
})

it('allows small edge gaps without discarding otherwise sufficient history', () => {
  for (const subset of [samples.slice(1), samples.slice(0, -1)]) {
    const result = hourlyMarketHistory({ ...input, samples: subset })
    expect(result.sigmaAnnual).toBeDefined()
    expect(result.change24h).toBeDefined()
  }
})
