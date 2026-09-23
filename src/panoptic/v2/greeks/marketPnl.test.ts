import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

import {
  marketPnlInQuote,
  marketRiskFromValues,
  marketScenario,
  netLiquidationValueInQuote,
} from './marketPnl'

describe('market risk PnL', () => {
  it.each([true, false])(
    'converts both token legs in the selected quote frame (%s)',
    (isAssetToken0) => {
      const tick = 1000n
      const price = new Decimal('1.0001').pow(1000)
      const result = netLiquidationValueInQuote(
        -2000000000000000000n,
        7000000000n,
        tick,
        isAssetToken0,
      )
      const expected = isAssetToken0
        ? new Decimal('7000000000').minus(price.mul('2000000000000000000'))
        : new Decimal('-2000000000000000000').plus(new Decimal('7000000000').div(price))
      expect(result.eq(expected)).toBe(true)
    },
  )

  it('preserves accrued premium at spot and adds collateral only when supplied', () => {
    const input = { relativeValue: 0, premium: 25, price: 2000, baselinePrice: 2000 }
    expect(marketPnlInQuote(input).toString()).toBe('25')
    expect(marketPnlInQuote({ ...input, relativeValue: -100, price: 2200 }).toString()).toBe('-75')
    expect(
      marketPnlInQuote({ ...input, relativeValue: -100, price: 2200, assetBalance: 2n }).toString(),
    ).toBe('325')
  })

  it.each([true, false])(
    'maps both token betas and orientation to the scenario tick (%s)',
    (isAssetToken0) => {
      const scenario = marketScenario({
        currentTick: 0n,
        isAssetToken0,
        assetBeta: '1.5',
        quoteBeta: '0.5',
        shock: '0.2',
      })
      expect(scenario).not.toBeNull()
      if (scenario === null) return
      expect(scenario.quoteFactor.toString()).toBe('1.1')
      const ratio = new Decimal('1.0001').pow(
        (isAssetToken0 ? scenario.tick : -scenario.tick).toString(),
      )
      expect(ratio.toNumber()).toBeCloseTo(1.3 / 1.1, 4)
    },
  )

  it('keeps the pool price unchanged for equal betas while repricing quote USD', () => {
    const scenario = marketScenario({
      currentTick: 120n,
      isAssetToken0: false,
      assetBeta: 1,
      quoteBeta: 1,
      shock: '0.25',
    })
    expect(scenario?.tick).toBe(120n)
    expect(scenario?.quoteFactor.toString()).toBe('1.25')
  })

  it('rejects nonpositive factors and out-of-range ticks', () => {
    expect(
      marketScenario({
        currentTick: 0n,
        isAssetToken0: true,
        assetBeta: 3,
        quoteBeta: 0,
        shock: '-0.5',
      }),
    ).toBeNull()
    expect(
      marketScenario({
        currentTick: 887272n,
        isAssetToken0: true,
        assetBeta: 1,
        quoteBeta: 0,
        shock: '0.5',
      }),
    ).toBeNull()
  })

  it('nets mixed long/short and linear loan legs before computing delta and gamma', () => {
    const value = (price: number) =>
      new Decimal(price).pow(2).mul('-0.02').plus(new Decimal(price).mul(3)).minus(40)
    const risk = marketRiskFromValues({
      lower: { price: 99, value: value(99) },
      current: { price: 100, value: value(100) },
      upper: { price: 101, value: value(101) },
    })
    expect(risk?.asset.toNumber()).toBe(-1)
    expect(risk?.quote.toNumber()).toBe(160)
    expect(risk?.gamma.toNumber()).toBe(-400)
  })

  it('has zero gamma for width-zero loan/credit-like linear values', () => {
    const risk = marketRiskFromValues({
      lower: { price: 9, value: -18 },
      current: { price: 10, value: -20 },
      upper: { price: 11, value: -22 },
    })
    expect(risk?.asset.toNumber()).toBe(-2)
    expect(risk?.quote.toNumber()).toBe(0)
    expect(risk?.gamma.toNumber()).toBe(0)
  })
})
