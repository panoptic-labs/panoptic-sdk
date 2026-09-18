/**
 * Realized market beta of a token against a reference asset (ETH), from
 * time-aligned return series.
 *
 * `β = cov(r_token, r_ref) / var(r_ref)` — the OLS slope of the token's returns
 * regressed on the reference's. Callers pass log-return arrays already aligned by
 * timestamp (same length, same buckets); alignment and numeraire conversion are
 * the caller's job (see the UI's per-token USD series). ETH itself has β = 1 and a
 * stablecoin has β ≈ 0 by construction, so those need no regression.
 *
 * @module analytics/beta
 */

export interface BetaResult {
  beta: number
  /** R² of the regression, 0–1; low values mean the beta is a weak fit. */
  rSquared: number
  /** Number of paired observations used. */
  samples: number
}

/**
 * Realized beta of `tokenReturns` on `refReturns`. Both must be index-aligned and
 * the same length. Returns `null` when there are too few points or the reference
 * has no variance (a flat series has no defined slope).
 */
export function realizedBeta(
  tokenReturns: readonly number[],
  refReturns: readonly number[],
  { minSamples = 8 }: { minSamples?: number } = {},
): BetaResult | null {
  const n = Math.min(tokenReturns.length, refReturns.length)
  if (n < minSamples) return null

  let sumT = 0
  let sumR = 0
  let count = 0
  for (let i = 0; i < n; i++) {
    const t = tokenReturns[i]
    const r = refReturns[i]
    if (!Number.isFinite(t) || !Number.isFinite(r)) continue
    sumT += t
    sumR += r
    count++
  }
  if (count < minSamples) return null
  const meanT = sumT / count
  const meanR = sumR / count

  let cov = 0
  let varR = 0
  let varT = 0
  for (let i = 0; i < n; i++) {
    const t = tokenReturns[i]
    const r = refReturns[i]
    if (!Number.isFinite(t) || !Number.isFinite(r)) continue
    const dt = t - meanT
    const dr = r - meanR
    cov += dt * dr
    varR += dr * dr
    varT += dt * dt
  }
  if (!(varR > 0)) return null

  const beta = cov / varR
  const rSquared = varT > 0 ? (cov * cov) / (varR * varT) : 0
  return { beta, rSquared: Math.min(1, Math.max(0, rSquared)), samples: count }
}

/**
 * Log returns of a price series (`ln(p_i / p_{i-1})`), skipping non-positive or
 * non-finite prices by emitting `NaN` at that step so downstream alignment stays
 * index-consistent. The output is one shorter than the input.
 */
export function logReturns(prices: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1]
    const b = prices[i]
    out.push(
      Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? Math.log(b / a) : Number.NaN,
    )
  }
  return out
}
