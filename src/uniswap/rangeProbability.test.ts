import { describe, expect, it } from 'vitest'

import { expectedTimeInRange, normalCdf, pInRangeAt, rangeStats } from './rangeProbability'

const base = { spot: 100, lower: 80, upper: 125, sigmaAnnual: 0.6 }

describe('normalCdf', () => {
  it('matches known standard-normal values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 5)
    expect(normalCdf(-1)).toBeCloseTo(0.1586553, 5)
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 5)
  })
  it('saturates at infinities', () => {
    expect(normalCdf(Infinity)).toBe(1)
    expect(normalCdf(-Infinity)).toBe(0)
  })
})

describe('pInRangeAt', () => {
  it('is 1 for a full-range position regardless of horizon', () => {
    expect(pInRangeAt({ spot: 100, lower: 0, upper: Infinity, sigmaAnnual: 0.6, tYears: 1 })).toBe(
      1,
    )
  })
  it('decays from 1 as the horizon grows for an in-range position', () => {
    const short = pInRangeAt({ ...base, tYears: 7 / 365 })
    const long = pInRangeAt({ ...base, tYears: 365 / 365 })
    expect(short).toBeGreaterThan(long)
    expect(short).toBeLessThanOrEqual(1)
    expect(long).toBeGreaterThan(0)
  })
  it('at a near-zero horizon equals current in/out-of-range membership', () => {
    expect(pInRangeAt({ ...base, tYears: 0 })).toBe(1)
    expect(pInRangeAt({ ...base, spot: 200, tYears: 0 })).toBe(0)
  })
  it('rises with horizon for an out-of-range position (chance of returning)', () => {
    const oor = { spot: 60, lower: 80, upper: 125, sigmaAnnual: 0.6 }
    const short = pInRangeAt({ ...oor, tYears: 7 / 365 })
    const long = pInRangeAt({ ...oor, tYears: 90 / 365 })
    expect(short).toBeLessThan(long)
    expect(short).toBeGreaterThanOrEqual(0)
  })
  it('stays within [0, 1]', () => {
    for (const tYears of [0.01, 0.1, 1, 5]) {
      const v = pInRangeAt({ ...base, tYears })
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('expectedTimeInRange', () => {
  it('has E >= P at every horizon for an in-range position', () => {
    for (const tYears of [7 / 365, 30 / 365, 365 / 365]) {
      const p = pInRangeAt({ ...base, tYears })
      const e = expectedTimeInRange({ ...base, tYears })
      expect(e).toBeGreaterThanOrEqual(p - 1e-9)
    }
  })
  it('has E <= P at every horizon for an out-of-range position', () => {
    const oor = { spot: 60, lower: 80, upper: 125, sigmaAnnual: 0.6 }
    for (const tYears of [7 / 365, 30 / 365, 365 / 365]) {
      const p = pInRangeAt({ ...oor, tYears })
      const e = expectedTimeInRange({ ...oor, tYears })
      expect(e).toBeLessThanOrEqual(p + 1e-9)
    }
  })
  it('stays within [0, 1] and is 1 for a full range', () => {
    expect(
      expectedTimeInRange({ spot: 100, lower: 0, upper: Infinity, sigmaAnnual: 0.6, tYears: 1 }),
    ).toBe(1)
    const e = expectedTimeInRange({ ...base, tYears: 2 })
    expect(e).toBeGreaterThan(0)
    expect(e).toBeLessThanOrEqual(1)
  })
})

describe('rangeStats', () => {
  it('returns index-aligned P and E for each horizon', () => {
    const horizons = [7 / 365, 30 / 365, 365 / 365]
    const { p, e } = rangeStats(base, horizons)
    expect(p).toHaveLength(3)
    expect(e).toHaveLength(3)
    // In-range: both columns decay top-to-bottom.
    expect(p[0]).toBeGreaterThan(p[2])
    expect(e[0]).toBeGreaterThan(e[2])
  })
})
