import Decimal from 'decimal.js'

const Precision = Decimal.clone({ precision: 60 })
const WEEK = 7 * 86400
const MAX_BOUNDARY_GAP = 12 * 3600

function preparePriceHistory(history: readonly { timestampSec: number; price: string }[]) {
  const points = [
    ...new Map(
      history.flatMap((point) => {
        const price = new Precision(point.price)
        return Number.isSafeInteger(point.timestampSec) &&
          point.timestampSec >= 0 &&
          price.isFinite() &&
          price.gt(0)
          ? [[point.timestampSec, { timestampSec: point.timestampSec, price }] as const]
          : []
      }),
    ).values(),
  ].sort((a, b) => a.timestampSec - b.timestampSec)
  const priceAt = (timestamp: number) => {
    const rightIndex = points.findIndex((point) => point.timestampSec >= timestamp)
    const right = points[rightIndex]
    if (right === undefined) return null
    if (right.timestampSec === timestamp) return right.price
    const left = points[rightIndex - 1]
    if (left === undefined || right.timestampSec - left.timestampSec > MAX_BOUNDARY_GAP) return null
    return left.price.plus(
      right.price
        .minus(left.price)
        .mul(timestamp - left.timestampSec)
        .div(right.timestampSec - left.timestampSec),
    )
  }
  return {
    first: points[0]?.timestampSec,
    last: points[points.length - 1]?.timestampSec,
    priceAt,
    points,
  }
}

/** Largest sampled move from each eligible interval opening; equal extremes use the first. */
export function calculateMaxSignedPriceChanges<
  T extends {
    startTimestampSec: number
    endTimestampSec: number
    activeIntervals?: readonly { startTimestampSec: number; endTimestampSec: number }[]
  },
>(periods: readonly T[], history: readonly { timestampSec: number; price: string }[]) {
  const { priceAt, points } = preparePriceHistory(history)
  return periods.flatMap((period) => {
    let maximum = new Precision(0)
    const intervals = period.activeIntervals ?? [period]
    if (intervals.length === 0) return []
    for (const interval of intervals) {
      const start = priceAt(interval.startTimestampSec)
      const end = priceAt(interval.endTimestampSec)
      if (start === null || end === null) return []
      let intervalMaximum = new Precision(0)
      for (const point of points) {
        if (
          point.timestampSec <= interval.startTimestampSec ||
          point.timestampSec >= interval.endTimestampSec
        )
          continue
        const change = point.price.div(start).minus(1)
        if (change.abs().gt(intervalMaximum.abs())) intervalMaximum = change
      }
      const closingChange = end.div(start).minus(1)
      if (closingChange.abs().gt(intervalMaximum.abs())) intervalMaximum = closingChange
      if (intervalMaximum.abs().gt(maximum.abs())) maximum = intervalMaximum
    }
    return [{ ...period, maxChangePct: maximum.mul(100).toString() }]
  })
}

/** Mean of period maxima across eligible intervals, excluding periods with missing boundaries. */
export function calculateMeanMaxAbsolutePriceChange(
  periods: readonly {
    startTimestampSec: number
    endTimestampSec: number
    activeIntervals?: readonly { startTimestampSec: number; endTimestampSec: number }[]
  }[],
  history: readonly { timestampSec: number; price: string }[],
) {
  const changes = calculateMaxSignedPriceChanges(periods, history)
  const total = changes.reduce(
    (sum, period) => sum.plus(new Precision(period.maxChangePct).abs()),
    new Precision(0),
  )
  return {
    meanMaxAbsoluteChangePct: changes.length === 0 ? null : total.div(changes.length).toString(),
    observedPeriods: changes.length,
    totalPeriods: periods.length,
  }
}

/** Non-overlapping seven-day observations, anchored to the first available share-price snapshot. */
export function calculateWeeklyVaultReturns(
  history: readonly { timestampSec: number; sharePrice: string }[],
) {
  const { first, last, priceAt } = preparePriceHistory(
    history.map((point) => ({ timestampSec: point.timestampSec, price: point.sharePrice })),
  )
  if (first === undefined || last === undefined) return []
  const weeks: {
    startTimestampSec: number
    endTimestampSec: number
    returnPct: string
    apyPct: string
  }[] = []
  for (let start = first; start + WEEK <= last; start += WEEK) {
    const end = start + WEEK
    const startPrice = priceAt(start)
    const endPrice = priceAt(end)
    if (startPrice === null || endPrice === null) continue
    const factor = endPrice.div(startPrice)
    weeks.push({
      startTimestampSec: start,
      endTimestampSec: end,
      returnPct: factor.minus(1).mul(100).toString(),
      apyPct: factor.pow(new Precision(365).div(7)).minus(1).mul(100).toString(),
    })
  }
  return weeks
}

/** Equal-width APY buckets with zero as a boundary, retaining every underlying week for inspection. */
export function buildWeeklyVaultReturnHistogram<
  T extends ReturnType<typeof calculateWeeklyVaultReturns>[number],
>(weeks: readonly T[]) {
  if (weeks.length === 0) return []
  const values = weeks.map((week) => new Precision(week.apyPct))
  const minimum = Precision.min(0, ...values)
  const maximum = Precision.max(0, ...values)
  const desiredWidth = Precision.max(maximum.minus(minimum).div(60), '0.1')
  const magnitude = new Precision(10).pow(desiredWidth.log(10).floor())
  const width = new Precision(
    [1, 2, 5, 10].find((step) => magnitude.mul(step).gte(desiredWidth)) ?? 10,
  ).mul(magnitude)
  const lower = minimum.div(width).floor().mul(width)
  const count = Math.max(1, maximum.minus(lower).div(width).floor().toNumber() + 1)
  return Array.from({ length: count }, (_, index) => {
    const start = lower.plus(width.mul(index))
    const end = start.plus(width)
    const observations = weeks.filter((week) => {
      const value = new Precision(week.apyPct)
      return value.gte(start) && value.lt(end)
    })
    return {
      lowerApyPct: start.toString(),
      upperApyPct: end.toString(),
      count: observations.length,
      weeks: observations,
    }
  })
}
