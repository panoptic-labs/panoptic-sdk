import Decimal from 'decimal.js'

// Keep precision local: do not change the caller's Decimal configuration.
const D = Decimal.clone({ precision: 60 })

export interface LpFeeCandle {
  t: number
  o: number
  h: number
  l: number
  c: number
  /** Absolute swap volume (inputs + outputs), in raw token units. */
  v0: string
  v1: string
  /** Historical active liquidity at the candle close, when available. */
  liq?: string
}

export interface LpFeeRange {
  tickLower: number
  tickUpper: number
  liquidity: bigint
}

const validTick = (tick: number) => Number.isInteger(tick) && Math.abs(tick) <= 887272

/**
 * Hypothetical added LP liquidity, with no compounding or price impact. Fees are raw
 * token units. Bullish candles follow O→L→H→C; bearish candles O→H→L→C.
 * Uniswap v3 deltas distribute absolute volume between inputs and outputs; only
 * inputs pay fees. Split moves at every LP boundary, so overlapping ranges share
 * the same denominator and out-of-range portions earn nothing.
 *
 * Closing historical liquidity approximates liquidity throughout a candle. If
 * absent, infer it from volume / path deltas. Flat candles with volume use equal
 * buy/sell flow and require historical liquidity; otherwise report them skipped.
 * OHLC cannot recover unseen oscillations, exact swap ordering or liquidity changes.
 */
export function estimateLpFees({
  candles,
  ranges,
  feePips,
}: {
  candles: readonly LpFeeCandle[]
  ranges: readonly LpFeeRange[]
  feePips: bigint
}) {
  if (feePips < 0n || feePips >= 1_000_000n) throw new Error('Invalid swap fee')
  for (const range of ranges) {
    if (
      !validTick(range.tickLower) ||
      !validTick(range.tickUpper) ||
      range.tickLower >= range.tickUpper ||
      range.liquidity < 0n
    ) {
      throw new Error('Invalid LP range')
    }
  }
  const fee = new D(feePips.toString()).div(1_000_000)
  const net = new D(1).minus(fee)
  const sqrtCache = new Map<number, Decimal>()
  const sqrtAt = (tick: number) => {
    const cached = sqrtCache.get(tick)
    if (cached) return cached
    const sqrt = new D('1.0001').pow(new D(tick).div(2))
    sqrtCache.set(tick, sqrt)
    return sqrt
  }
  const positions = ranges.map((r) => ({ ...r, liquidity: new D(r.liquidity.toString()) }))
  let fees0 = new D(0)
  let fees1 = new D(0)
  let skippedCandles = 0
  let inferredCandles = 0
  let previousTime = -Infinity
  const points = candles.map((candle) => {
    const { o, h, l, c, t } = candle
    if (
      !Number.isSafeInteger(t) ||
      t <= previousTime ||
      ![o, h, l, c].every(validTick) ||
      l > Math.min(o, c) ||
      h < Math.max(o, c) ||
      l > h
    ) {
      throw new Error('Invalid or unordered OHLC candles')
    }
    previousTime = t
    const v0 = new D(candle.v0)
    const v1 = new D(candle.v1)
    const historical = new D(candle.liq ?? '0')
    if (![v0, v1, historical].every((v) => v.isFinite() && v.isInteger() && v.gte(0))) {
      throw new Error('Invalid candle volume or liquidity')
    }
    const path = c >= o ? [o, l, h, c] : [o, h, l, c]
    const steps: { lower: number; upper: number; up: boolean; d0: Decimal; d1: Decimal }[] = []
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1]
      const to = path[i]
      if (from === undefined || to === undefined || from === to) continue
      const lower = Math.min(from, to)
      const upper = Math.max(from, to)
      const cuts = [
        ...new Set([lower, upper, ...positions.flatMap((p) => [p.tickLower, p.tickUpper])]),
      ]
        .filter((tick) => tick >= lower && tick <= upper)
        .sort((a, b) => a - b)
      for (let j = 1; j < cuts.length; j++) {
        const a = cuts[j - 1]
        const b = cuts[j]
        if (a === undefined || b === undefined) continue
        const sa = sqrtAt(a)
        const sb = sqrtAt(b)
        steps.push({
          lower: a,
          upper: b,
          up: to > from,
          d0: new D(1).div(sa).minus(new D(1).div(sb)),
          d1: sb.minus(sa),
        })
      }
    }
    const total0 = steps.reduce((sum, s) => sum.plus(s.up ? s.d0 : s.d0.div(net)), new D(0))
    const total1 = steps.reduce((sum, s) => sum.plus(s.up ? s.d1.div(net) : s.d1), new D(0))
    const hasVolume = v0.gt(0) || v1.gt(0)
    const inferred =
      total0.gt(0) && total1.gt(0) ? v0.div(total0).plus(v1.div(total1)).div(2) : new D(0)
    const poolLiquidity = historical.gt(0) ? historical : inferred
    if (hasVolume && poolLiquidity.eq(0)) skippedCandles++
    else if (hasVolume && fee.gt(0)) {
      if (historical.eq(0)) inferredCandles++
      if (steps.length === 0) {
        const active = positions
          .filter((p) => p.tickLower <= c && c < p.tickUpper)
          .reduce((sum, p) => sum.plus(p.liquidity), new D(0))
        const share = active.div(poolLiquidity.plus(active))
        // Absolute volume counts both sides; equal directional flow implies
        // input fraction 1 / (2 - fee), including fees in gross inputs.
        fees0 = fees0.plus(v0.div(new D(2).minus(fee)).mul(fee).mul(share))
        fees1 = fees1.plus(v1.div(new D(2).minus(fee)).mul(fee).mul(share))
      } else {
        for (const step of steps) {
          const active = positions
            .filter((p) => p.tickLower <= step.lower && p.tickUpper >= step.upper)
            .reduce((sum, p) => sum.plus(p.liquidity), new D(0))
          const share = active.div(poolLiquidity.plus(active))
          if (step.up) fees1 = fees1.plus(v1.mul(step.d1.div(net)).div(total1).mul(fee).mul(share))
          else fees0 = fees0.plus(v0.mul(step.d0.div(net)).div(total0).mul(fee).mul(share))
        }
      }
    }
    return {
      time: t,
      fees0: BigInt(fees0.floor().toFixed(0)),
      fees1: BigInt(fees1.floor().toFixed(0)),
    }
  })
  return { points, skippedCandles, inferredCandles }
}
