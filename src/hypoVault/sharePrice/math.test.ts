import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { calculateAnnualizedApyPct, computeSharePriceFromNavSnapshot } from './math'

describe('computeSharePriceFromNavSnapshot', () => {
  it('computes share price from nav snapshot', () => {
    const sharePrice = computeSharePriceFromNavSnapshot({
      nav: 1_000_000n,
      assetsDeposited: 10_000n,
      reservedWithdrawalAssets: 50_000n,
      shares: 475_000n,
    })

    expect(sharePrice?.toString()).toBe('1.9789494736842105263')
  })

  it('returns null when shares are zero', () => {
    const sharePrice = computeSharePriceFromNavSnapshot({
      nav: 1_000_000n,
      assetsDeposited: 0n,
      reservedWithdrawalAssets: 0n,
      shares: 0n,
    })

    expect(sharePrice).toBeNull()
  })

  it('returns null when adjusted assets are zero or negative', () => {
    const sharePrice = computeSharePriceFromNavSnapshot({
      nav: 100n,
      assetsDeposited: 80n,
      reservedWithdrawalAssets: 21n,
      shares: 1000n,
    })

    expect(sharePrice).toBeNull()
  })
})

describe('calculateAnnualizedApyPct', () => {
  it('returns positive APY for positive growth', () => {
    const apy = calculateAnnualizedApyPct({
      currentSharePrice: new Decimal('2.01'),
      previousSharePrice: new Decimal('2.0'),
      days: 7,
    })

    expect(apy).not.toBeNull()
    expect(apy as number).toBeGreaterThan(0)
  })

  it('returns negative APY for negative growth', () => {
    const apy = calculateAnnualizedApyPct({
      currentSharePrice: new Decimal('1.99'),
      previousSharePrice: new Decimal('2.0'),
      days: 7,
    })

    expect(apy).not.toBeNull()
    expect(apy as number).toBeLessThan(0)
  })

  it('returns zero APY for flat growth', () => {
    const apy = calculateAnnualizedApyPct({
      currentSharePrice: new Decimal('2.0'),
      previousSharePrice: new Decimal('2.0'),
      days: 7,
    })

    expect(apy).toBe(0)
  })

  it('returns null when previous share price is invalid', () => {
    const apy = calculateAnnualizedApyPct({
      currentSharePrice: new Decimal('2.0'),
      previousSharePrice: new Decimal('0'),
      days: 7,
    })

    expect(apy).toBeNull()
  })
})
