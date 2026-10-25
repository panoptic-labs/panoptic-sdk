import { describe, expect, it } from 'vitest'

import {
  buildWeeklyVaultReturnHistogram,
  calculateMaxSignedPriceChanges,
  calculateMeanMaxAbsolutePriceChange,
  calculateWeeklyVaultReturns,
} from './weeklyReturns'

const WEEK = 7 * 86400

describe('weekly vault performance', () => {
  it('uses disjoint full weeks and annualizes each period return rather than inception return', () => {
    const weeks = calculateWeeklyVaultReturns([
      { timestampSec: 0, sharePrice: '1' },
      { timestampSec: WEEK, sharePrice: '0.999' },
      { timestampSec: WEEK * 2, sharePrice: '1.02' },
      { timestampSec: WEEK * 2 + 86400, sharePrice: '1.03' },
    ])
    expect(weeks).toHaveLength(2)
    expect(Number(weeks[0].returnPct)).toBeCloseTo(-0.1, 10)
    expect(Number(weeks[1].returnPct)).toBeCloseTo((1.02 / 0.999 - 1) * 100, 10)
    expect(Number(weeks[0].apyPct)).toBeCloseTo((0.999 ** (365 / 7) - 1) * 100, 8)
    expect(weeks[0].endTimestampSec).toBe(weeks[1].startTimestampSec)
  })
  it('sorts snapshots and rejects missing boundaries rather than bridging long gaps', () => {
    const weeks = calculateWeeklyVaultReturns([
      { timestampSec: WEEK * 2, sharePrice: '1.01' },
      { timestampSec: 0, sharePrice: '1' },
    ])
    expect(weeks).toEqual([])
    expect(calculateWeeklyVaultReturns([])).toEqual([])
    expect(calculateWeeklyVaultReturns([{ timestampSec: 0, sharePrice: '0' }])).toEqual([])
  })
  it('interpolates a short boundary gap without extrapolating a partial week', () => {
    const weeks = calculateWeeklyVaultReturns([
      { timestampSec: 0, sharePrice: '1' },
      { timestampSec: WEEK - 3600, sharePrice: '0.99' },
      { timestampSec: WEEK + 3600, sharePrice: '1.01' },
    ])
    expect(weeks).toHaveLength(1)
    expect(weeks[0].returnPct).toBe('0')
  })
  it('counts each observation exactly once, keeping loss and gain buckets separate', () => {
    const history = ['1', '0.999', '0.998', '1.05', '1.05'].map((sharePrice, index) => ({
      timestampSec: index * WEEK,
      sharePrice,
    }))
    const weeks = calculateWeeklyVaultReturns(history)
    const bins = buildWeeklyVaultReturnHistogram(weeks)
    expect(bins.reduce((total, bin) => total + bin.count, 0)).toBe(4)
    expect(bins.length).toBeGreaterThan(20)
    expect(
      bins
        .flatMap((bin) => bin.weeks)
        .map((week) => week.startTimestampSec)
        .sort(),
    ).toEqual(weeks.map((week) => week.startTimestampSec).sort())
    for (const bin of bins) {
      expect(
        bin.weeks.every(
          (week) =>
            Number(week.apyPct) >= Number(bin.lowerApyPct) &&
            Number(week.apyPct) < Number(bin.upperApyPct),
        ),
      ).toBe(true)
    }
    expect(buildWeeklyVaultReturnHistogram([])).toEqual([])
  })
})

describe('mean weekly maximum absolute price change', () => {
  const periods = [
    { startTimestampSec: 0, endTimestampSec: WEEK },
    { startTimestampSec: WEEK, endTimestampSec: WEEK * 2 },
  ]
  it('captures intraperiod moves that reverse and averages the maxima, not the closes', () => {
    expect(
      calculateMeanMaxAbsolutePriceChange(periods, [
        { timestampSec: 0, price: '100' },
        { timestampSec: WEEK / 2, price: '110' },
        { timestampSec: WEEK / 2 + 3600, price: '95' },
        { timestampSec: WEEK, price: '100' },
        { timestampSec: WEEK * 1.5, price: '80' },
        { timestampSec: WEEK * 2, price: '100' },
        { timestampSec: WEEK * 2 + 3600, price: '1000' },
      ]),
    ).toEqual({ meanMaxAbsoluteChangePct: '15', observedPeriods: 2, totalPeriods: 2 })
  })
  it('takes the absolute value of each weekly change before averaging', () => {
    expect(
      calculateMeanMaxAbsolutePriceChange(periods, [
        { timestampSec: 0, price: '100' },
        { timestampSec: WEEK, price: '110' },
        { timestampSec: WEEK * 2, price: '99' },
      ]),
    ).toEqual({ meanMaxAbsoluteChangePct: '10', observedPeriods: 2, totalPeriods: 2 })
  })
  it('reports coverage rather than treating missing history as zero movement', () => {
    expect(
      calculateMeanMaxAbsolutePriceChange(periods, [
        { timestampSec: 0, price: '100' },
        { timestampSec: WEEK, price: '110' },
      ]),
    ).toEqual({ meanMaxAbsoluteChangePct: '10', observedPeriods: 1, totalPeriods: 2 })
    expect(calculateMeanMaxAbsolutePriceChange(periods, [])).toEqual({
      meanMaxAbsoluteChangePct: null,
      observedPeriods: 0,
      totalPeriods: 2,
    })
  })
})

describe('signed weekly peak moves', () => {
  it('preserves the direction of the largest excursion rather than the closing move', () => {
    const periods = [0, 1, 2].map((index) => ({
      startTimestampSec: index * WEEK,
      endTimestampSec: (index + 1) * WEEK,
    }))
    const result = calculateMaxSignedPriceChanges(periods, [
      { timestampSec: 0, price: '100' },
      { timestampSec: WEEK / 3, price: '115' },
      { timestampSec: (WEEK * 2) / 3, price: '80' },
      { timestampSec: WEEK, price: '105' },
      { timestampSec: WEEK * 1.5, price: '126' },
      { timestampSec: WEEK * 2, price: '105' },
      { timestampSec: WEEK * 3, price: '94.5' },
    ])
    expect(result.map((period) => period.maxChangePct)).toEqual(['-20', '20', '-10'])
  })
  it('chooses the earliest equal-sized move and excludes incomplete price coverage', () => {
    const result = calculateMaxSignedPriceChanges(
      [
        { startTimestampSec: 0, endTimestampSec: WEEK },
        { startTimestampSec: WEEK, endTimestampSec: WEEK * 2 },
      ],
      [
        { timestampSec: 0, price: '100' },
        { timestampSec: WEEK / 3, price: '90' },
        { timestampSec: (WEEK * 2) / 3, price: '110' },
        { timestampSec: WEEK, price: '110' },
      ],
    )
    expect(result.map((period) => period.maxChangePct)).toEqual(['-10'])
  })
})

it('measures moves only within eligible intervals and resets the opening price across idle gaps', () => {
  const periods = [
    {
      startTimestampSec: 0,
      endTimestampSec: 400,
      activeIntervals: [
        { startTimestampSec: 0, endTimestampSec: 100 },
        { startTimestampSec: 300, endTimestampSec: 400 },
      ],
    },
  ]
  const history = [
    { timestampSec: 0, price: '100' },
    { timestampSec: 100, price: '105' },
    { timestampSec: 200, price: '200' },
    { timestampSec: 300, price: '200' },
    { timestampSec: 400, price: '180' },
  ]
  expect(calculateMaxSignedPriceChanges(periods, history)[0]?.maxChangePct).toBe('-10')
  expect(calculateMeanMaxAbsolutePriceChange(periods, history).meanMaxAbsoluteChangePct).toBe('10')
})
