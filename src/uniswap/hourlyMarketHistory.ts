import Decimal from 'decimal.js'

const HOUR = 3600
const WINDOW_HOURS = 720
const LOG_TICK = Math.log(1.0001)

/** Analyze recorded hourly ticks without inventing observations for missing hours. */
export function hourlyMarketHistory({
  samples,
  endTime,
  currentTick,
  baseIsToken0,
}: {
  samples: readonly { timestamp: number; tick: number }[]
  endTime: number
  currentTick: number
  baseIsToken0: boolean
}) {
  const end = Math.floor(endTime / HOUR) * HOUR
  const start = end - WINDOW_HOURS * HOUR
  const hours = new Map<number, number>()
  for (const { timestamp, tick } of samples) {
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp % HOUR !== 0 ||
      timestamp < start ||
      timestamp >= end ||
      !Number.isInteger(tick) ||
      Math.abs(tick) > 887272
    )
      continue
    hours.set(timestamp, tick)
  }
  const observations = [...hours].sort(([a], [b]) => a - b)
  const first = observations[0]
  const last = observations.at(-1)
  const fresh = last !== undefined && last[0] >= end - 3 * HOUR
  const spansWindow = first !== undefined && first[0] <= start + 3 * HOUR
  const sufficient = hours.size >= WINDOW_HOURS * 0.9 && spansWindow && fresh
  let sumSquares = 0
  for (let i = 1; i < observations.length; i++) {
    const previous = observations[i - 1]
    const point = observations[i]
    if (previous && point) sumSquares += ((point[1] - previous[1]) * LOG_TICK) ** 2
  }
  const elapsed = first && last ? last[0] - first[0] : 0
  const sigmaAnnual =
    sufficient && elapsed > 0 ? Math.sqrt((sumSquares * 365 * 86400) / elapsed) : undefined
  const priorTick = hours.get(end - 25 * HOUR)
  const direction = baseIsToken0 ? 1 : -1
  const change24h =
    priorTick !== undefined &&
    fresh &&
    Number.isInteger(currentTick) &&
    Math.abs(currentTick) <= 887272
      ? Math.expm1(direction * (currentTick - priorTick) * LOG_TICK) * 100
      : undefined
  const chart = observations
    .filter(([timestamp]) => timestamp >= end - 24 * HOUR)
    .map(([timestamp, tick]) => ({
      timestamp,
      value: Math.exp(direction * (tick - (first?.[1] ?? tick)) * LOG_TICK),
    }))
  return {
    sigmaAnnual,
    change24h,
    chart,
    sampleCount: hours.size,
    expectedCount: WINDOW_HOURS,
    coveragePercent: new Decimal(hours.size).div(WINDOW_HOURS).mul(100).toFixed(1),
  }
}
