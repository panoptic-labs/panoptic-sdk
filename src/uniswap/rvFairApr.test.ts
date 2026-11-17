import { describe, expect, it } from 'vitest'

import { getCoveredCallOutcome } from '../panoptic/v2/tokenId/coveredCall'
import { rvFairApr, rvFairAprLiquidity } from './rvFairApr'

describe('rvFairApr', () => {
  it('approaches σ²/(2r) × P(in range) for a range starting at spot over a short horizon', () => {
    const sigma = 0.59
    const r = Math.log(1.075)
    const apr = rvFairApr({ spot: 100, low: 100, high: 107.5, sigmaAnnual: sigma, days: 0.01 })
    // Half the paths sit inside a range that starts at spot.
    expect(apr).toBeCloseTo(((sigma * sigma) / (2 * r)) * 0.5 * 100, -1)
  })

  it('matches a Monte Carlo estimate for an out-of-the-money range (76.1% at 20k paths)', () => {
    const apr = rvFairApr({ spot: 100, low: 101, high: 108, sigmaAnnual: 0.59, days: 1 })
    expect(apr).toBeGreaterThan(74)
    expect(apr).toBeLessThan(79)
  })

  it('scales with variance and is undefined for a degenerate or converted range', () => {
    const args = { spot: 100, low: 101, high: 108, days: 1 }
    const low = rvFairApr({ ...args, sigmaAnnual: 0.3 }) ?? 0
    const high = rvFairApr({ ...args, sigmaAnnual: 0.6 }) ?? 0
    expect(high).toBeGreaterThan(low * 2)
    expect(rvFairApr({ ...args, low: 108, sigmaAnnual: 0.5 })).toBeUndefined()
    expect(rvFairApr({ ...args, spot: 108, sigmaAnnual: 0.5 })).toBeUndefined()
  })

  it('sizes liquidity at the lower bound like the covered call, with spot inside the range', () => {
    // Asset is token0 and both tokens use 18 decimals, so price = 1.0001^tick.
    const strike = 1000n
    const width = 20n
    const tickSpacing = 10n
    const positionSize = 10n ** 18n
    const atTick = 1020n // inside [900, 1100]
    const quote = getCoveredCallOutcome({
      positionSize,
      assetIdx: 0n,
      strike,
      width,
      tickSpacing,
      atTick,
    })
    const low = 1.0001 ** Number(quote.lowerTick)
    const high = 1.0001 ** Number(quote.upperTick)
    const spot = 1.0001 ** Number(atTick)
    expect(spot).toBeGreaterThan(low)
    expect(rvFairAprLiquidity(low, high) * 1e18).toBeCloseTo(Number(quote.liquidity), -12)
    expect(rvFairApr({ spot, low, high, sigmaAnnual: 0.5, days: 1 })).toBeGreaterThan(0)
  })
})
