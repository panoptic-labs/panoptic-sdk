import { describe, expect, it } from 'vitest'

import { createTokenIdBuilder } from './builder'
import { buildEarnCoveredCallTokenId } from './coveredCall'
import { getEarnCoveredCallCloseSummary } from './coveredCallCloseSummary'

const inputs = (assetIdx: 0n | 1n) => ({
  tokenId: buildEarnCoveredCallTokenId({
    poolId: 1n,
    assetIdx,
    strike: assetIdx === 0n ? -200000n : 200000n,
    width: 72n,
    loanStrike: assetIdx === 0n ? -276324n : 276324n,
  }),
  positionSize: 10n ** 18n,
  accruedPremium0: assetIdx === 0n ? 10n ** 15n : 500_000n,
  accruedPremium1: assetIdx === 0n ? 500_000n : 10n ** 15n,
  settledPremium0: assetIdx === 0n ? 2n * 10n ** 15n : 250_000n,
  settledPremium1: assetIdx === 0n ? 250_000n : 2n * 10n ** 15n,
  currentTick: assetIdx === 0n ? -200000n : 200000n,
})

describe('Earn close advance and premium summary', () => {
  it.each([0n, 1n] as const)(
    'summarizes a call with a quote-token credit in native ordering %s',
    (assetIdx) => {
      const loanArgs = inputs(assetIdx)
      const credit = getEarnCoveredCallCloseSummary({
        ...loanArgs,
        tokenId: createTokenIdBuilder(1n)
          .addCall({
            asset: assetIdx,
            optionRatio: 1n,
            isLong: false,
            strike: assetIdx === 0n ? -200000n : 200000n,
            width: 72n,
          })
          .addCredit({
            asset: assetIdx,
            tokenType: assetIdx === 0n ? 1n : 0n,
            strike: assetIdx === 0n ? -276324n : 276324n,
          })
          .build(),
      })
      const loan = getEarnCoveredCallCloseSummary(loanArgs)
      expect(credit.isCredit).toBe(true)
      expect(loan.isCredit).toBe(false)
      expect(credit.advanceQuote).toBe(loan.advanceQuote)
      expect(credit.premiumQuote).toBe(loan.premiumQuote)
    },
  )
  it.each([0n, 1n] as const)(
    'compares a mixed-decimal call and loan in native ordering %s',
    (assetIdx) => {
      const args = inputs(assetIdx)
      const result = getEarnCoveredCallCloseSummary(args)
      expect(result.quoteTokenIndex).toBe(assetIdx === 0n ? 1n : 0n)
      expect(assetIdx === 0n ? result.advance0 : result.advance1).toBe(0n)
      expect(assetIdx === 0n ? result.advance1 : result.advance0).toBe(result.advanceQuote)
      expect(result.advanceQuote).toBeGreaterThan(999_000n)
      expect(result.advanceQuote).toBeLessThan(1_001_000n)
      expect(assetIdx === 0n ? result.premium0 : result.premium1).toBe(3n * 10n ** 15n)
      expect(assetIdx === 0n ? result.premium1 : result.premium0).toBe(750_000n)
      expect(result.premiumQuote).toBeGreaterThan(6_930_000n)
      expect(result.premiumQuote).toBeLessThan(6_950_000n)
      expect(getEarnCoveredCallCloseSummary({ ...args, currentTick: 0n }).advanceQuote).toBe(
        result.advanceQuote,
      )
    },
  )
  it('does not double-count the loan as premium or include another account loan', () => {
    const result = getEarnCoveredCallCloseSummary({
      ...inputs(0n),
      accruedPremium0: 0n,
      accruedPremium1: 0n,
      settledPremium0: 0n,
      settledPremium1: 0n,
    })
    expect(result.advanceQuote).toBeGreaterThan(0n)
    expect(result.premiumQuote).toBe(0n)
  })
  it('scales the advance with the current remaining position size', () => {
    const args = inputs(0n)
    const full = getEarnCoveredCallCloseSummary(args)
    const half = getEarnCoveredCallCloseSummary({ ...args, positionSize: args.positionSize / 2n })
    expect(half.advanceQuote * 2n).toBeGreaterThanOrEqual(full.advanceQuote - 1n)
    expect(half.advanceQuote * 2n).toBeLessThanOrEqual(full.advanceQuote)
  })
  it('rejects a standalone option and a zero-sized position', () => {
    const tokenId = createTokenIdBuilder(1n)
      .addCall({ asset: 0n, optionRatio: 1n, isLong: false, strike: -200000n, width: 72n })
      .build()
    expect(() => getEarnCoveredCallCloseSummary({ ...inputs(0n), tokenId })).toThrow(
      'open Earn covered call',
    )
    expect(() => getEarnCoveredCallCloseSummary({ ...inputs(0n), positionSize: 0n })).toThrow(
      'open Earn covered call',
    )
  })
})
