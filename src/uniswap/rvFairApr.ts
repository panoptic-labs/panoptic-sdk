import { normalCdf } from './rangeProbability'

/**
 * Liquidity that one base token buys over [low, high], sized at the lower bound like a Panoptic
 * covered call's `positionSize` (the full range's base amount), whatever the spot price. Prices
 * are quote per base; multiply by the base token's unit (e.g. 1e18) for raw pool liquidity when
 * both tokens share decimals.
 */
export function rvFairAprLiquidity(low: number, high: number) {
  return 1 / (1 / Math.sqrt(low) - 1 / Math.sqrt(high))
}

/**
 * Volatility-fair APR for a covered-call range: the fees a Uniswap LP in [low, high] must earn to
 * break even against arbitrage (LVR, Milionis et al.) at volatility `sigmaAnnual`.
 *
 * While in range, a position of liquidity L loses ½σ²P²|V''(P)| = σ²L√P/4 per year to
 * rebalancing; those are the fees a fairly priced pool pays it. Under driftless GBM,
 * E[√P_t·1{low<P_t<high}] has a closed form, so expected fees over `days` are a short sum.
 * L is sized for one base token at the lower bound (see {@link rvFairAprLiquidity}), matching
 * the covered call's `positionSize`; the result is annualized against one token at spot, so it
 * depends only on the range, the spot price and volatility (not on pool volume or size).
 * Returns `undefined` for invalid inputs or when spot is at or above the range (fully converted).
 */
export function rvFairApr({
  spot,
  low,
  high,
  sigmaAnnual,
  days,
  steps = 96,
}: {
  spot: number
  low: number
  high: number
  sigmaAnnual: number
  days: number
  steps?: number
}) {
  if (!(spot > 0 && low > 0 && high > low && sigmaAnnual > 0 && days > 0)) return undefined
  if (spot >= high) return undefined
  const liquidity = rvFairAprLiquidity(low, high)
  const tYears = days / 365
  const lnLow = Math.log(low)
  const lnHigh = Math.log(high)
  let weighted = 0
  for (let i = 0; i < steps; i++) {
    const t = ((i + 0.5) / steps) * tYears
    const s = sigmaAnnual * Math.sqrt(t)
    // ln P_t ~ N(m, s²), driftless in price.
    const m = Math.log(spot) - (s * s) / 2
    const shift = m + (s * s) / 2
    const mass = normalCdf((lnHigh - shift) / s) - normalCdf((lnLow - shift) / s)
    weighted += Math.exp(m / 2 + (s * s) / 8) * mass
  }
  const fees = ((sigmaAnnual * sigmaAnnual * liquidity) / 4) * (weighted / steps) * tYears
  return (fees / spot / tYears) * 100
}
