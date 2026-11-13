import { describe, expect, it } from 'vitest'

import { getCoveredCallAdvance } from './coveredCall'
import { getCoveredCallPerformance } from './coveredCallPerformance'

describe('covered call performance', () => {
  it('annualizes earned fees against opening notional and measures advance coverage', () => {
    expect(
      getCoveredCallPerformance({
        earnedPremium: 100n,
        openingNotionalQuote: 10000n,
        advancePrincipal: 200n,
        mintTimestamp: 1000n,
        nowTimestamp: 1000n + 7n * 86400n,
        timescaleSeconds: 30n * 86400n,
      }),
    ).toMatchObject({
      earnedApr: '52.1',
      advanceProgressBps: 5000n,
      remainingSeconds: 23n * 86400n,
    })
  })
  it('does not turn missing history or zero principal into a zero APR or completed advance', () => {
    const result = getCoveredCallPerformance({
      earnedPremium: 1n,
      openingNotionalQuote: 0n,
      nowTimestamp: 10n,
    })
    expect(result.earnedApr).toBeUndefined()
    expect(result.advanceProgressBps).toBeUndefined()
    expect(result.remainingSeconds).toBeUndefined()
  })
  it('retains over-target and negative earnings while stopping the horizon countdown at zero', () => {
    const args = {
      openingNotionalQuote: 1000n,
      advancePrincipal: 100n,
      mintTimestamp: 0n,
      nowTimestamp: 864000n,
      timescaleSeconds: 86400n,
    }
    expect(getCoveredCallPerformance({ ...args, earnedPremium: 150n })).toMatchObject({
      advanceProgressBps: 15000n,
      remainingSeconds: 0n,
    })
    expect(getCoveredCallPerformance({ ...args, earnedPremium: -10n }).earnedApr).toBe('-36.5')
  })
  it.each([0n, 1n])('keeps APR independent of token ordering %s', (assetIdx) => {
    const notional = getCoveredCallAdvance(
      10n ** 18n,
      assetIdx === 0n ? -200000n : 200000n,
      assetIdx === 0n ? 0n : 1n,
    )
    const result = getCoveredCallPerformance({
      earnedPremium: notional / 100n,
      openingNotionalQuote: notional,
      mintTimestamp: 0n,
      nowTimestamp: 365n * 86400n,
    })
    expect(result.earnedApr).toBe('1.0')
  })
})
