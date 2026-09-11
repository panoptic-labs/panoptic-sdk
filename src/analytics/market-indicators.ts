import Decimal from 'decimal.js'

const D = Decimal.clone({ precision: 40 })
const TICK_LOG = new D('1.0001').ln()

export type MarketIndicator = 'atr' | 'efficiency' | 'moments' | 'rsi' | 'variance-ratio'

export interface IndicatorCandle {
  time: bigint
  openTick: bigint
  highTick: bigint
  lowTick: bigint
  closeTick: bigint
}

export interface IndicatorPoint {
  time: bigint
  value: Decimal | null
  secondaryValue?: Decimal | null
}

export const MARKET_INDICATOR_PERIODS = {
  atr: 14,
  efficiency: 10,
  moments: 96,
  rsi: 14,
  'variance-ratio': 96,
} as const

export const VARIANCE_RATIO_LAG = 4

/** Sorts and fills only internal no-swap gaps; never invents leading/trailing history. */
export function prepareIndicatorCandles(candles: readonly IndicatorCandle[], interval: bigint) {
  if (interval <= 0n) throw new RangeError('Candle interval must be positive')
  const sorted = [...candles].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  const result: IndicatorCandle[] = []
  for (const candle of sorted) {
    if (
      candle.time < 0n ||
      candle.time % interval !== 0n ||
      candle.lowTick < -887272n ||
      candle.highTick > 887272n ||
      candle.lowTick > candle.highTick ||
      candle.openTick < candle.lowTick ||
      candle.openTick > candle.highTick ||
      candle.closeTick < candle.lowTick ||
      candle.closeTick > candle.highTick
    )
      throw new RangeError('Invalid candle timestamp or OHLC ticks')
    const previous = result[result.length - 1]
    if (previous && previous.time === candle.time)
      throw new RangeError('Duplicate candle timestamp')
    if (previous) {
      if ((candle.time - result[0].time) / interval >= 4096n) {
        throw new RangeError('Indicator history exceeds 4096 candles')
      }
      for (let time = previous.time + interval; time < candle.time; time += interval) {
        result.push({
          time,
          openTick: previous.closeTick,
          highTick: previous.closeTick,
          lowTick: previous.closeTick,
          closeTick: previous.closeTick,
        })
      }
    }
    result.push(candle)
  }
  return result
}

function sum(values: readonly Decimal[]) {
  return values.reduce((total, value) => total.plus(value), new D(0))
}

function tickChanges(candles: readonly IndicatorCandle[], isAssetToken0: boolean) {
  return candles.slice(1).map((candle, index) => ({
    time: candle.time,
    value: (candle.closeTick - candles[index].closeTick) * (isAssetToken0 ? 1n : -1n),
  }))
}

function wilder(values: readonly Decimal[], period: number) {
  let average = new D(0)
  return values.map((value, index) => {
    if (index < period) {
      average = average.plus(value.div(period))
      return index === period - 1 ? average : null
    }
    average = average
      .mul(period - 1)
      .plus(value)
      .div(period)
    return average
  })
}

function centeredTickChanges(values: readonly bigint[]) {
  const count = BigInt(values.length)
  const total = values.reduce((sum, value) => sum + value, 0n)
  const deviations = values.map((value) => count * value - total)
  const squares = deviations.reduce((sum, value) => sum + value ** 2n, 0n)
  return { count, total, deviations, squares }
}

/** Central population moments: skewness and excess kurtosis (normal = 0). */
function returnMoments(values: readonly bigint[]) {
  const { count, deviations, squares } = centeredTickChanges(values)
  if (squares === 0n) return { value: null, secondaryValue: null }
  const cubes = deviations.reduce((sum, value) => sum + value ** 3n, 0n)
  const fourths = deviations.reduce((sum, value) => sum + value ** 4n, 0n)
  const secondMoment = new D(squares.toString())
  return {
    value: new D((cubes * cubes * count).toString())
      .div(secondMoment.pow(3))
      .sqrt()
      .mul(cubes < 0n ? -1 : 1),
    secondaryValue: new D((count * fourths).toString())
      .div((squares * squares).toString())
      .minus(3),
  }
}

/** Lo–MacKinlay overlapping, finite-sample-corrected ratio; no significance test. */
function varianceRatio(values: readonly bigint[]) {
  const { count, total, squares } = centeredTickChanges(values)
  if (squares === 0n) return null
  const lag = VARIANCE_RATIO_LAG
  const q = BigInt(lag)
  let overlappingSquares = 0n
  for (let index = lag; index <= values.length; index++) {
    const change = values.slice(index - lag, index).reduce((sum, value) => sum + value, 0n)
    overlappingSquares += (count * change - q * total) ** 2n
  }
  const numerator = overlappingSquares * (count - 1n) * count
  const denominator = q * (count - q + 1n) * (count - q) * squares
  return new D(numerator.toString()).div(denominator.toString())
}

/** Prices use quote units per asset; return statistics use equally spaced log closes. */
export function calculateMarketIndicator(
  indicator: MarketIndicator,
  candles: readonly IndicatorCandle[],
  {
    intervalSeconds,
    token0Decimals,
    token1Decimals,
    isAssetToken0,
  }: {
    intervalSeconds: bigint
    token0Decimals: bigint
    token1Decimals: bigint
    isAssetToken0: boolean
  },
): IndicatorPoint[] {
  if (
    token0Decimals < 0n ||
    token0Decimals > 255n ||
    token1Decimals < 0n ||
    token1Decimals > 255n
  ) {
    throw new RangeError('Token decimals must be between 0 and 255')
  }
  const prepared = prepareIndicatorCandles(candles, intervalSeconds)
  const period = MARKET_INDICATOR_PERIODS[indicator]
  if (indicator === 'moments' || indicator === 'variance-ratio') {
    // The common log(1.0001) scale cancels in these dimensionless statistics.
    const returns = tickChanges(prepared, isAssetToken0)
    return returns.map((point, index) => {
      if (index < period - 1) return { time: point.time, value: null }
      const window = returns.slice(index - period + 1, index + 1).map((value) => value.value)
      return {
        time: point.time,
        ...(indicator === 'moments' ? returnMoments(window) : { value: varianceRatio(window) }),
      }
    })
  }

  const decimalScale = new D(10).pow((token0Decimals - token1Decimals).toString())
  const prices = new Map<bigint, Decimal>()
  const price = (tick: bigint) => {
    const cached = prices.get(tick)
    if (cached) return cached
    const direct = new D('1.0001').pow(tick.toString()).mul(decimalScale)
    const value = isAssetToken0 ? direct : new D(1).div(direct)
    prices.set(tick, value)
    return value
  }
  const closes = prepared.map((candle) => price(candle.closeTick))
  if (indicator === 'atr') {
    const ranges = prepared.map((candle, index) => {
      const high = price(isAssetToken0 ? candle.highTick : candle.lowTick)
      const low = price(isAssetToken0 ? candle.lowTick : candle.highTick)
      const previous = closes[index - 1]
      return previous
        ? D.max(high.minus(low), high.minus(previous).abs(), low.minus(previous).abs())
        : high.minus(low)
    })
    return wilder(ranges, period).map((value, index) => ({ time: prepared[index].time, value }))
  }
  const changes = closes.slice(1).map((close, index) => close.minus(closes[index]))
  if (indicator === 'rsi') {
    const gains = wilder(
      changes.map((value) => D.max(value, 0)),
      period,
    )
    const losses = wilder(
      changes.map((value) => D.max(value.neg(), 0)),
      period,
    )
    return gains.map((gain, index) => {
      const loss = losses[index]
      const value =
        gain === null || loss === null
          ? null
          : gain.isZero() && loss.isZero()
            ? new D(50)
            : loss.isZero()
              ? new D(100)
              : new D(100).minus(new D(100).div(new D(1).plus(gain.div(loss))))
      return { time: prepared[index + 1].time, value }
    })
  }
  return closes.map((close, index) => {
    if (index < period) return { time: prepared[index].time, value: null }
    const distance = close.minus(closes[index - period]).abs()
    const path = sum(changes.slice(index - period, index).map((value) => value.abs()))
    return { time: prepared[index].time, value: path.isZero() ? new D(0) : distance.div(path) }
  })
}

/** Sample variance of equal-interval log returns, grouped by UTC candle-start hour/day. */
export function calculateVarianceProfile(
  candles: readonly IndicatorCandle[],
  isAssetToken0: boolean,
  intervalSeconds = 3600n,
) {
  if (intervalSeconds <= 0n || intervalSeconds > 86400n || 86400n % intervalSeconds !== 0n) {
    throw new RangeError('Profile candle interval must divide a UTC day')
  }
  const prepared = prepareIndicatorCandles(candles, intervalSeconds)
  const returns = tickChanges(prepared, isAssetToken0)
  const hours: bigint[][] = Array.from({ length: 24 }, () => [])
  const weekdays: bigint[][] = Array.from({ length: 7 }, () => [])
  for (const point of returns) {
    const hour = Number((point.time / 3600n) % 24n)
    // UTC weekday buckets 0–6 represent Monday through Sunday.
    const weekday = Number((point.time / 86400n + 3n) % 7n)
    hours[hour].push(point.value)
    weekdays[weekday].push(point.value)
  }
  const summarize = (buckets: bigint[][]) =>
    buckets.map((values, bucket) => {
      const { count, squares } = centeredTickChanges(values)
      return {
        bucket,
        count: values.length,
        variance:
          count < 2n
            ? null
            : new D(squares.toString())
                .mul(TICK_LOG.pow(2))
                .div((count * count * (count - 1n)).toString()),
      }
    })
  return { hours: summarize(hours), weekdays: summarize(weekdays) }
}
