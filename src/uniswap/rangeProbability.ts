/**
 * Forward-looking "will this LP range stay in range?" statistics.
 *
 * Model: driftless geometric Brownian motion of the pool price. In log space the
 * position is inside its range while `ln(lower) < ln(S_t) < ln(upper)`; with
 * `x_t = ln(S_t) ∼ N(x0, σ²·t)` the probability of being in range at horizon `t`
 * is a difference of two standard-normal CDFs. Expected fraction of time in range
 * over `[0, T]` is the time-average of that same probability (exact by Fubini):
 * `(1/T)·∫₀ᵀ P(in range at t) dt`, computed by numeric integration.
 *
 * Both column values in the portfolio LP rows (P(in range) and E[time in range])
 * fall out of the single {@link pInRangeAt} kernel, so they can never disagree in
 * sign: a position that starts in range always has E ≥ P at every horizon, and one
 * that starts out of range always has E ≤ P.
 *
 * Drift is assumed zero — this is a pure volatility read, not a directional
 * forecast. Vol estimation lives with the caller (the UI already has realized-vol
 * estimators); pass the annualized σ in.
 *
 * @module uniswap/rangeProbability
 */

/**
 * Standard-normal CDF Φ(x). Uses a rational erf approximation
 * (Abramowitz & Stegun 7.1.26), max abs error ≈ 1.5e-7 — ample for a
 * percentage read.
 */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0
  const z = x / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * Math.abs(z))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z)
  const erf = z >= 0 ? y : -y
  return 0.5 * (1 + erf)
}

export interface RangeProbabilityInput {
  /** Current pool price in the display frame (quote per asset). */
  spot: number
  /** Lower range bound in the same frame. `0` or non-finite means unbounded below. */
  lower: number
  /** Upper range bound in the same frame. `Infinity` or non-finite means unbounded above. */
  upper: number
  /** Annualized volatility as a fraction (e.g. 0.8 = 80%). */
  sigmaAnnual: number
  /** Horizon in years. */
  tYears: number
}

/**
 * Probability the price is inside `[lower, upper]` at horizon `tYears`.
 * Returns 1 for a full-range position (both bounds unbounded) and is well-defined
 * for an out-of-range spot (then it reads as "chance of being back in range by t").
 */
export function pInRangeAt(input: RangeProbabilityInput): number {
  const { spot, lower, upper, sigmaAnnual, tYears } = input
  const boundedBelow = lower > 0 && Number.isFinite(lower)
  const boundedAbove = Number.isFinite(upper) && upper > 0
  // Fully unbounded range is always "in range".
  if (!boundedBelow && !boundedAbove) return 1
  if (!(spot > 0)) return 0

  const s = sigmaAnnual * Math.sqrt(Math.max(0, tYears))
  // Degenerate horizon/vol: the price cannot move, so it is in range iff it is now.
  if (!(s > 0)) {
    const above = boundedBelow ? spot > lower : true
    const below = boundedAbove ? spot < upper : true
    return above && below ? 1 : 0
  }

  const x0 = Math.log(spot)
  const hi = boundedAbove ? normalCdf((Math.log(upper) - x0) / s) : 1
  const lo = boundedBelow ? normalCdf((Math.log(lower) - x0) / s) : 0
  return Math.min(1, Math.max(0, hi - lo))
}

/** `(1/T)·∫₀ᵀ Φ(ln(bound/spot) / (σ√t)) dt`, as a function of `d = ln(bound/spot) / (σ√T)`. */
function averageCdfOverHorizon(d: number): number {
  const density = Math.exp((-d * d) / 2) / Math.sqrt(2 * Math.PI)
  return normalCdf(d) + d * density - d * Math.abs(d) * normalCdf(-Math.abs(d))
}

/**
 * Expected fraction of `[0, tYears]` spent in range — the time-average of
 * {@link pInRangeAt}, in closed form because the integrand is singular at t=0
 * for narrow ranges and numeric integration underestimates it there.
 */
export function expectedTimeInRange(input: RangeProbabilityInput): number {
  const { spot, lower, upper, sigmaAnnual, tYears } = input
  const boundedBelow = lower > 0 && Number.isFinite(lower)
  const boundedAbove = Number.isFinite(upper) && upper > 0
  const s = sigmaAnnual * Math.sqrt(Math.max(0, tYears))
  if (!(s > 0) || !(spot > 0) || (!boundedBelow && !boundedAbove)) {
    return pInRangeAt({ ...input, tYears: 0 })
  }
  const hi = boundedAbove ? averageCdfOverHorizon(Math.log(upper / spot) / s) : 1
  const lo = boundedBelow ? averageCdfOverHorizon(Math.log(lower / spot) / s) : 0
  return Math.min(1, Math.max(0, hi - lo))
}

const LOG_TICK_BASE = Math.log(1.0001)

/** Assumed annualized volatility for forecasts on pools without a usable realized vol. */
export const DEFAULT_SIGMA_ANNUAL = 0.4

export interface TickRangeForecast {
  tickLower: number
  tickUpper: number
  currentTick: number
  /** Annualized volatility as a fraction (e.g. 0.8 = 80%). */
  sigmaAnnual: number
  horizonDays: number
}

/** {@link expectedTimeInRange} for a tick range; invariant to token0/token1 orientation. */
export function expectedTimeInTickRange({
  tickLower,
  tickUpper,
  currentTick,
  sigmaAnnual,
  horizonDays,
}: TickRangeForecast): number {
  return expectedTimeInRange({
    spot: 1,
    lower: Math.exp((Math.min(tickLower, tickUpper) - currentTick) * LOG_TICK_BASE),
    upper: Math.exp((Math.max(tickLower, tickUpper) - currentTick) * LOG_TICK_BASE),
    sigmaAnnual,
    tYears: horizonDays / 365,
  })
}

/**
 * Expected premium accrued over the horizon by a leg earning `fullDailyRate` while in range.
 * Grows like √T rather than T once the horizon outlasts the time price stays in the range.
 */
export function expectedPremium({
  fullDailyRate,
  ...forecast
}: TickRangeForecast & { fullDailyRate: number }): number {
  return fullDailyRate * forecast.horizonDays * expectedTimeInTickRange(forecast)
}

export interface RangeStatsInput {
  spot: number
  lower: number
  upper: number
  sigmaAnnual: number
}

export interface RangeStats {
  /** P(in range at each horizon), index-aligned to `horizonsYears`. */
  p: number[]
  /** E[fraction of time in range up to each horizon], index-aligned. */
  e: number[]
}

/**
 * Compute both statistics for a set of horizons in one call — the shape the LP
 * row (7d / 30d / 365d) and the portfolio KPI aggregation consume.
 */
export function rangeStats(input: RangeStatsInput, horizonsYears: readonly number[]): RangeStats {
  const p: number[] = []
  const e: number[] = []
  for (const tYears of horizonsYears) {
    p.push(pInRangeAt({ ...input, tYears }))
    e.push(expectedTimeInRange({ ...input, tYears }))
  }
  return { p, e }
}

/** Horizons used by the LP portfolio display, in years. */
export const LP_RANGE_HORIZONS_DAYS = [7, 30, 365] as const
export const LP_RANGE_HORIZONS_YEARS = LP_RANGE_HORIZONS_DAYS.map((d) => d / 365)

/** Probability of never touching an upper strike under zero-drift log Brownian motion. */
export function pStayBelow({
  spot,
  strike,
  sigmaAnnual,
  tYears,
}: {
  spot: number
  strike: number
  sigmaAnnual: number
  tYears: number
}): number | undefined {
  if (
    ![spot, strike, sigmaAnnual, tYears].every(Number.isFinite) ||
    spot <= 0 ||
    strike <= 0 ||
    sigmaAnnual < 0 ||
    tYears < 0
  )
    return undefined
  if (spot >= strike) return 0
  if (tYears === 0 || sigmaAnnual === 0) return 1
  return Math.max(
    0,
    Math.min(1, 2 * normalCdf(Math.log(strike / spot) / (sigmaAnnual * Math.sqrt(tYears))) - 1),
  )
}

/** Probability of never touching either range boundary under zero-drift log Brownian motion. */
export function pStayInRange({
  spot,
  lower,
  upper,
  sigmaAnnual,
  tYears,
}: RangeProbabilityInput): number | undefined {
  if (
    ![spot, lower, sigmaAnnual, tYears].every(Number.isFinite) ||
    Number.isNaN(upper) ||
    spot <= 0 ||
    lower < 0 ||
    upper <= lower ||
    sigmaAnnual < 0 ||
    tYears < 0
  )
    return undefined
  if (spot <= lower || spot >= upper) return 0
  const deviation = sigmaAnnual * Math.sqrt(tYears)
  if (deviation === 0 || (lower === 0 && upper === Infinity)) return 1
  const below = Math.log(spot) - Math.log(lower)
  const above = Math.log(upper) - Math.log(spot)
  if (lower === 0 || upper === Infinity)
    return Math.max(0, Math.min(1, 2 * normalCdf(Math.min(below, above) / deviation) - 1))
  const width = below + above
  const position = Math.min(below, above) / width
  const scaledDeviation = deviation / width
  let probability = 0
  // Images converge at short horizons; the absorbing-boundary sine series converges at long ones.
  if (scaledDeviation < 0.5) {
    for (let image = -2; image <= 2; image++) {
      const shift = 2 * image
      probability +=
        normalCdf((1 - position + shift) / scaledDeviation) -
        normalCdf((-position + shift) / scaledDeviation) -
        normalCdf((1 + position + shift) / scaledDeviation) +
        normalCdf((position + shift) / scaledDeviation)
    }
  } else {
    for (let harmonic = 1; harmonic < 32; harmonic += 2) {
      probability +=
        ((4 * Math.sin(harmonic * Math.PI * position)) / (harmonic * Math.PI)) *
        Math.exp(-0.5 * (harmonic * Math.PI * scaledDeviation) ** 2)
    }
  }
  return Math.max(0, Math.min(1, probability))
}
