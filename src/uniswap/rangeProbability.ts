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

export interface ExpectedTimeInRangeInput extends RangeProbabilityInput {
  /** Integration steps over [0, T]. Default 64 — smooth to <0.1% for these curves. */
  steps?: number
}

/**
 * Expected fraction of `[0, tYears]` spent in range — the time-average of
 * {@link pInRangeAt}. Trapezoidal integration; the integrand starts at exactly
 * 1 (in-range now) or 0 (out-of-range now) at t=0, which the trapezoid endpoint
 * captures.
 */
export function expectedTimeInRange(input: ExpectedTimeInRangeInput): number {
  const { tYears, steps = 64 } = input
  if (!(tYears > 0)) return pInRangeAt({ ...input, tYears: 0 })
  const n = Math.max(2, Math.floor(steps))
  const dt = tYears / n
  let acc = 0
  for (let i = 0; i <= n; i++) {
    const p = pInRangeAt({ ...input, tYears: i * dt })
    acc += i === 0 || i === n ? p / 2 : p
  }
  return Math.min(1, Math.max(0, (acc * dt) / tYears))
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
