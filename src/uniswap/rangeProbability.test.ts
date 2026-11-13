import { describe, expect, it } from 'vitest'

import {
  expectedPremium,
  expectedTimeInRange,
  expectedTimeInTickRange,
  normalCdf,
  pInRangeAt,
  pStayBelow,
  pStayInRange,
  rangeStats,
} from './rangeProbability'

const base = { spot: 100, lower: 80, upper: 125, sigmaAnnual: 0.6 }

describe('pStayInRange', () => {
  const interval = { spot: 1, lower: Math.exp(-1), upper: Math.exp(1), sigmaAnnual: 1 }
  it('matches the symmetric Brownian two-barrier survival probabilities', () => {
    expect(pStayInRange({ ...interval, tYears: 1 })).toBeCloseTo(0.37077743, 7)
    expect(pStayInRange({ ...interval, tYears: 0.25 })).toBeCloseTo(0.90899948, 6)
    expect(pStayInRange({ ...interval, tYears: 1e-12 })).toBeCloseTo(1, 6)
    expect(pStayInRange({ ...interval, tYears: 100 })).toBeCloseTo(0, 10)
  })
  it('is bounded by either single barrier and the terminal in-range probability', () => {
    for (const tYears of [1 / 365, 7 / 365, 1, 5]) {
      const input = { ...base, tYears }
      const survival = pStayInRange(input)
      expect(survival).toBeGreaterThanOrEqual(0)
      expect(survival).toBeLessThanOrEqual(pInRangeAt(input) + 1e-6)
      expect(survival).toBeLessThanOrEqual(
        (pStayBelow({ ...input, strike: input.upper }) ?? 0) + 1e-6,
      )
    }
  })
  it('is invariant to denomination and token ordering, including near a boundary', () => {
    for (const spot of [80.00001, 90, 100, 110, 124.99999]) {
      for (const tYears of [1e-8, 0.01, 0.1, 1]) {
        const input = { ...base, spot, tYears }
        const probability = pStayInRange(input)
        expect(
          pStayInRange({ ...input, spot: 1 / spot, lower: 1 / 125, upper: 1 / 80 }),
        ).toBeCloseTo(probability ?? 0, 6)
        expect(
          pStayInRange({ ...input, spot: spot * 1e12, lower: 80e12, upper: 125e12 }),
        ).toBeCloseTo(probability ?? 0, 6)
      }
    }
  })
  it('decreases with volatility and horizon and increases with a wider range', () => {
    const input = { ...base, tYears: 0.05 }
    const probability = pStayInRange(input) ?? 0
    expect(pStayInRange({ ...input, tYears: 0.1 })).toBeLessThan(probability)
    expect(pStayInRange({ ...input, sigmaAnnual: 0.8 })).toBeLessThan(probability)
    expect(pStayInRange({ ...input, lower: 70, upper: 140 })).toBeGreaterThan(probability)
  })
  it('handles zero movement, touched boundaries, unbounded ranges and invalid data', () => {
    expect(pStayInRange({ ...base, tYears: 0 })).toBe(1)
    expect(pStayInRange({ ...base, sigmaAnnual: 0, tYears: 1 })).toBe(1)
    for (const spot of [0, 79, 80, 125, 126])
      expect(pStayInRange({ ...base, spot, tYears: 1 })).toBe(spot === 0 ? undefined : 0)
    const input = { ...base, tYears: 1 }
    expect(pStayInRange({ ...input, lower: 0, upper: Infinity })).toBe(1)
    expect(pStayInRange({ ...input, lower: 0 })).toBeCloseTo(
      pStayBelow({ ...input, strike: input.upper }) ?? 0,
      7,
    )
    expect(pStayInRange({ ...input, upper: Infinity })).toBeGreaterThan(0)
    for (const patch of [
      { sigmaAnnual: NaN },
      { sigmaAnnual: -1 },
      { tYears: -1 },
      { lower: -1 },
      { upper: NaN },
      { upper: 80 },
      { spot: Infinity },
    ])
      expect(pStayInRange({ ...input, ...patch })).toBeUndefined()
  })
})

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

describe('expectedTimeInRange closed form', () => {
  const integrate = (input: Parameters<typeof pInRangeAt>[0]) => {
    const n = 2_000_000
    const dt = input.tYears / n
    let sum = 0
    const probe = { ...input }
    for (let i = 0; i < n; i++) {
      probe.tYears = (i + 0.5) * dt
      sum += pInRangeAt(probe)
    }
    return (sum * dt) / input.tYears
  }

  it.each([
    { spot: 100, lower: 95, upper: 105, sigmaAnnual: 0.76, tYears: 7 / 365 },
    { spot: 100, lower: 99.9, upper: 100.1, sigmaAnnual: 0.76, tYears: 30 / 365 },
    { spot: 100, lower: 70, upper: 75, sigmaAnnual: 0.76, tYears: 30 / 365 },
    { spot: 100, lower: 110, upper: 130, sigmaAnnual: 1.2, tYears: 1 },
    { spot: 100, lower: 0, upper: 110, sigmaAnnual: 0.8, tYears: 0.25 },
    { spot: 100, lower: 90, upper: Infinity, sigmaAnnual: 0.8, tYears: 0.25 },
  ])('matches midpoint integration of pInRangeAt for %j', (input) => {
    expect(expectedTimeInRange(input)).toBeCloseTo(integrate(input), 3)
  })

  it('falls back to current membership with no vol or horizon', () => {
    expect(expectedTimeInRange({ ...base, sigmaAnnual: 0, tYears: 1 })).toBe(1)
    expect(expectedTimeInRange({ ...base, spot: 200, tYears: 0 })).toBe(0)
  })
})

describe('expectedPremium', () => {
  const forecast = { tickLower: -500, tickUpper: 500, currentTick: 0, sigmaAnnual: 0.76 }

  it('earns the full rate when price cannot leave the range', () => {
    expect(expectedPremium({ ...forecast, sigmaAnnual: 0, fullDailyRate: 2, horizonDays: 7 })).toBe(
      14,
    )
  })

  it('grows with √T, not T, for a narrow ATM range', () => {
    const narrow = { ...forecast, tickLower: -10, tickUpper: 10, fullDailyRate: 1 }
    const week = expectedPremium({ ...narrow, horizonDays: 7 })
    const month = expectedPremium({ ...narrow, horizonDays: 28 })
    expect(month / week).toBeCloseTo(2, 1)
  })

  it('ranks ATM above an equal-width OTM range', () => {
    const atm = expectedPremium({ ...forecast, fullDailyRate: 1, horizonDays: 30 })
    const otm = expectedPremium({
      ...forecast,
      tickLower: 2000,
      tickUpper: 3000,
      fullDailyRate: 1,
      horizonDays: 30,
    })
    expect(atm).toBeGreaterThan(otm)
    expect(otm).toBeGreaterThan(0)
  })

  it('is invariant to token ordering, which negates ticks', () => {
    const a = {
      tickLower: 100,
      tickUpper: 900,
      currentTick: 300,
      sigmaAnnual: 0.8,
      horizonDays: 30,
    }
    const b = { ...a, tickLower: -900, tickUpper: -100, currentTick: -300 }
    expect(expectedTimeInTickRange(a)).toBeCloseTo(expectedTimeInTickRange(b), 10)
  })

  it('carries the sign of a long leg', () => {
    expect(expectedPremium({ ...forecast, fullDailyRate: -1, horizonDays: 7 })).toBeLessThan(0)
  })
})
