import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

import {
  type IndicatorCandle,
  calculateMarketIndicator,
  calculateVarianceProfile,
  prepareIndicatorCandles,
} from './market-indicators'

const options = {
  intervalSeconds: 3600n,
  token0Decimals: 18n,
  token1Decimals: 6n,
  isAssetToken0: true,
}
function candle(
  time: bigint,
  closeTick: bigint,
  lowTick = closeTick,
  highTick = closeTick,
): IndicatorCandle {
  return { time, openTick: closeTick, highTick, lowTick, closeTick }
}
function closes(ticks: bigint[]) {
  return ticks.map((tick, index) => candle(BigInt(index) * 3600n, tick))
}
function fromReturns(changes: number[]) {
  let tick = 0n
  return closes([
    tick,
    ...changes.map((change) => {
      tick += BigInt(change)
      return tick
    }),
  ])
}
const lastValue = (
  indicator: Parameters<typeof calculateMarketIndicator>[0],
  candles: IndicatorCandle[],
  overrides = {},
) =>
  calculateMarketIndicator(indicator, candles, { ...options, ...overrides })
    .at(-1)
    ?.value?.toNumber()

describe('market indicators', () => {
  it('sorts and fills internal gaps without creating leading or trailing observations', () => {
    const data = prepareIndicatorCandles([candle(10800n, 20n), candle(3600n, 10n)], 3600n)
    expect(data.map((point) => point.time)).toEqual([3600n, 7200n, 10800n])
    expect(data[1]).toEqual(candle(7200n, 10n))
  })

  it('rejects malformed OHLC, duplicate times, unaligned times and unbounded gaps', () => {
    expect(() => prepareIndicatorCandles([candle(0n, 10n, 11n, 12n)], 3600n)).toThrow(RangeError)
    expect(() => prepareIndicatorCandles([candle(0n, 0n), candle(0n, 1n)], 3600n)).toThrow(
      RangeError,
    )
    expect(() => prepareIndicatorCandles([candle(1n, 0n)], 3600n)).toThrow(RangeError)
    expect(() =>
      prepareIndicatorCandles([candle(0n, 0n), candle(4096n * 3600n, 0n)], 3600n),
    ).toThrow(RangeError)
    expect(() => prepareIndicatorCandles([], 0n)).toThrow(RangeError)
  })

  it.each([true, false])(
    'computes true range across price gaps and seeds Wilder ATR, asset token0=%s',
    (isAssetToken0) => {
      const data = Array.from({ length: 15 }, (_, index) =>
        candle(
          BigInt(index) * 3600n,
          index < 13 ? 0n : 100n,
          index < 13 ? -2n : 99n,
          index < 13 ? 2n : 101n,
        ),
      )
      const direct = (tick: number) => new Decimal('1.0001').pow(tick).mul('1e12')
      const price = (tick: number) =>
        isAssetToken0 ? direct(tick) : new Decimal(1).div(direct(tick))
      const range = price(2).minus(price(-2)).abs()
      const gap = isAssetToken0 ? price(101).minus(price(0)) : price(0).minus(price(101))
      const seed = range.mul(13).plus(gap).div(14)
      const next = seed
        .mul(13)
        .plus(price(101).minus(price(99)).abs())
        .div(14)
      const points = calculateMarketIndicator('atr', data, { ...options, isAssetToken0 })
      expect(points.slice(0, 13).every((point) => point.value === null)).toBe(true)
      expect(points[13].value?.div(seed).toNumber()).toBeCloseTo(1, 10)
      expect(points[14].value?.div(next).toNumber()).toBeCloseTo(1, 10)
    },
  )

  it.each([true, false])(
    'handles monotone, oscillating and flat prices for ER and RSI, asset token0=%s',
    (isAssetToken0) => {
      const trend = closes(Array.from({ length: 25 }, (_, index) => BigInt(index)))
      const flat = closes(Array.from({ length: 25 }, () => 0n))
      const oscillating = closes(Array.from({ length: 25 }, (_, index) => BigInt(index % 2)))
      expect(lastValue('efficiency', trend, { isAssetToken0 })).toBeCloseTo(1)
      expect(lastValue('efficiency', oscillating, { isAssetToken0 })).toBeCloseTo(0)
      expect(lastValue('efficiency', flat, { isAssetToken0 })).toBe(0)
      expect(lastValue('rsi', trend, { isAssetToken0 })).toBe(isAssetToken0 ? 100 : 0)
      expect(lastValue('rsi', flat, { isAssetToken0 })).toBe(50)
      expect(lastValue('atr', flat, { isAssetToken0 })).toBe(0)
      expect(
        calculateMarketIndicator('rsi', trend.slice(0, 14), options).every(
          (point) => point.value === null,
        ),
      ).toBe(true)
    },
  )

  it('matches a Wilder RSI reference sequence after tick quantization', () => {
    const prices = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28, 46.0,
    ]
    const data = closes(
      prices.map((price) => BigInt(Math.round(Math.log(price) / Math.log(1.0001)))),
    )
    const points = calculateMarketIndicator('rsi', data, { ...options, token0Decimals: 6n })
    expect(Math.abs((points[13].value?.toNumber() ?? NaN) - 70.46)).toBeLessThan(0.1)
    expect(Math.abs((points[14].value?.toNumber() ?? NaN) - 66.25)).toBeLessThan(0.1)
  })

  it('matches known central moments and flips only skew under inverse denomination', () => {
    const data = fromReturns(Array.from({ length: 96 }, (_, index) => [-2, -1, -1, 4][index % 4]))
    const direct = calculateMarketIndicator('moments', data, options).at(-1)
    const inverse = calculateMarketIndicator('moments', data, {
      ...options,
      isAssetToken0: false,
      token0Decimals: 6n,
      token1Decimals: 18n,
    }).at(-1)
    expect(direct?.value?.toNumber()).toBeCloseTo(13.5 / Math.pow(5.5, 1.5), 10)
    expect(direct?.secondaryValue?.toNumber()).toBeCloseTo(68.5 / (5.5 * 5.5) - 3, 10)
    expect(inverse?.value?.toNumber()).toBeCloseTo(-13.5 / Math.pow(5.5, 1.5), 10)
    expect(inverse?.secondaryValue?.toNumber()).toBeCloseTo(
      direct?.secondaryValue?.toNumber() ?? NaN,
      10,
    )
  })

  it('uses overlapping returns and the Lo–MacKinlay finite-sample correction', () => {
    const data = fromReturns(
      Array.from({ length: 96 }, (_, index) => [2, -1, 3, -2, 0, 1][index % 6]),
    )
    expect(lastValue('variance-ratio', data)).toBeCloseTo(2033 / 9982, 10)
    expect(lastValue('variance-ratio', data, { isAssetToken0: false })).toBeCloseTo(
      lastValue('variance-ratio', data) ?? NaN,
      10,
    )
  })

  it('does not assign moments or variance ratios to constant log returns', () => {
    for (const change of [0, 10]) {
      const data = fromReturns(Array.from({ length: 100 }, () => change))
      expect(calculateMarketIndicator('moments', data, options).at(-1)?.value).toBeNull()
      expect(calculateMarketIndicator('variance-ratio', data, options).at(-1)?.value).toBeNull()
    }
  })

  it('keeps dimensionless indicators unchanged when token decimals change', () => {
    const data = fromReturns(
      Array.from({ length: 110 }, (_, index) => [2, -1, 3, -2, 0, 1][index % 6]),
    )
    for (const indicator of ['efficiency', 'rsi', 'moments', 'variance-ratio'] as const) {
      expect(lastValue(indicator, data, { token0Decimals: 6n, token1Decimals: 18n })).toBeCloseTo(
        lastValue(indicator, data) ?? NaN,
        10,
      )
    }
    const direct = lastValue('atr', data) ?? NaN
    const scaled = lastValue('atr', data, { token0Decimals: 6n, token1Decimals: 18n }) ?? NaN
    expect(scaled / direct).toBeCloseTo(1e-24, 30)
  })

  it('groups hourly variance by UTC calendar buckets, with counts and no invented samples', () => {
    let tick = 0n
    const start = 342000n // Sunday 1970-01-04 23:00 UTC.
    const data = Array.from({ length: 3 * 168 + 1 }, (_, index) => {
      if (index === 1) tick -= 10n
      if (index === 169) tick += 10n
      if (index === 337) tick += 30n
      return candle(start + BigInt(index) * 3600n, tick)
    })
    const profile = calculateVarianceProfile(data, true)
    expect(profile.hours[0].count).toBe(21)
    const expectedVariance = new Decimal('1.0001')
      .ln()
      .pow(2)
      .mul(new Decimal(1100).minus(new Decimal(900).div(21)))
      .div(20)
    expect(profile.hours[0].variance?.div(expectedVariance).toNumber()).toBeCloseTo(1, 10)
    expect(profile.hours[1].variance?.isZero()).toBe(true)
    expect(profile.weekdays[0].count).toBe(72)
    expect(profile.weekdays[0].variance?.gt(0)).toBe(true)
    expect(profile.weekdays[1].variance?.isZero()).toBe(true)
    expect(calculateVarianceProfile(data, false).hours[0].variance?.toString()).toBe(
      profile.hours[0].variance?.toString(),
    )
    expect(calculateVarianceProfile(data.slice(0, 2), true).hours[0].variance).toBeNull()
    expect(calculateVarianceProfile(data.slice(0, 2), true).hours[1].count).toBe(0)
  })
  it('calculates calendar profiles from the selected candle interval', () => {
    const data = Array.from({ length: 9 }, (_, index) =>
      candle(BigInt(index) * 900n, BigInt((index * (index + 1)) / 2)),
    )
    const profile = calculateVarianceProfile(data, true, 900n)
    expect(profile.hours[0].count).toBe(3)
    const tickVariance = new Decimal('1.0001').ln().pow(2)
    expect(profile.hours[0].variance?.div(tickVariance).toNumber()).toBeCloseTo(1, 10)
    expect(profile.hours[1].count).toBe(4)
    expect(profile.hours[1].variance?.div(tickVariance).toNumber()).toBeCloseTo(5 / 3, 10)
    expect(profile.hours[2].variance).toBeNull()
    expect(() => calculateVarianceProfile([], true, 604800n)).toThrow(RangeError)
  })
})
