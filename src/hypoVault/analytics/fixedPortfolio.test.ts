import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { getLegDeltaInVaultFrame, isDefinedRisk } from '../../panoptic/v2/greeks'
import {
  calculateFixedPortfolioScenarios,
  estimateFixedPoolHedgeTriggers,
  estimateFixedPortfolioPremium,
  prepareFixedPoolValue,
} from './fixedPortfolio'

const scenarioInputs = {
  navRaw: 1_000_000_000n,
  quoteDecimals: 6,
  valueChangeAtMove: (move: Decimal.Value) => new Decimal(move).pow(2).mul(1_000_000),
  premiumDailyRaw: '1000000',
  lendingDailyRaw: '200000',
}

describe('fixed portfolio scenarios', () => {
  it('deducts carry once and normalizes to depositor NAV, without annualizing', () => {
    const [week, month, quarter] = calculateFixedPortfolioScenarios(scenarioInputs)
    expect(week.days).toBe('7')
    expect(week.premiumCost).toBe('7')
    expect(week.lendingIncome).toBe('1.4')
    expect(week.netCost).toBe('5.6')
    expect(week.points.find((point) => point.movePct === '0')?.returnPct).toBe('-0.56')
    expect(month.premiumCost).toBe('30')
    expect(quarter.premiumCost).toBe('90')
    expect(Number(week.targets[0].upMovePct)).toBeCloseTo(Math.sqrt(15.6), 1)
    expect(Number(week.targets[0].downMovePct)).toBeCloseTo(-Math.sqrt(15.6), 1)
  })
  it('compounds the selected-period returns into APY, retaining signed cost impacts', () => {
    const scenarios = calculateFixedPortfolioScenarios(scenarioInputs)
    for (const scenario of scenarios) {
      const exponent = 365 / Number(scenario.days)
      const zeroMove = scenario.points.find((point) => point.movePct === '0')
      expect(Number(zeroMove?.apyPct)).toBeCloseTo(
        ((1 + Number(zeroMove?.returnPct) / 100) ** exponent - 1) * 100,
        8,
      )
      expect(Number(scenario.premiumCostApyPct)).toBeLessThan(0)
      expect(Number(scenario.lendingApyPct)).toBeGreaterThan(0)
      expect(Number(scenario.targets[0].apyPct)).toBeCloseTo((1.01 ** exponent - 1) * 100, 8)
    }
    const [loss] = calculateFixedPortfolioScenarios({
      ...scenarioInputs,
      valueChangeAtMove: () => new Decimal('-2000000000'),
    })
    expect(loss.points[0].apyPct).toBeNull()
    const [totalLoss] = calculateFixedPortfolioScenarios({
      ...scenarioInputs,
      premiumDailyRaw: '0',
      lendingDailyRaw: '0',
      valueChangeAtMove: () => new Decimal('-1000000000'),
    })
    expect(totalLoss.points[0].apyPct).toBe('-100')
  })
  it('preserves asymmetric exposure, unreachable targets and a negative net holding cost', () => {
    const [week] = calculateFixedPortfolioScenarios({
      ...scenarioInputs,
      premiumDailyRaw: '0',
      valueChangeAtMove: (move) => new Decimal(move).mul(10_000_000),
    })
    expect(week.netCost).toBe('-1.4')
    expect(week.targets[0].downMovePct).toBeNull()
    expect(Number(week.targets[0].upMovePct)).toBeCloseTo(0.86, 2)
  })
  it('rejects invalid NAV and missing carry rather than publishing zero-cost estimates', () => {
    expect(() => calculateFixedPortfolioScenarios({ ...scenarioInputs, navRaw: 0n })).toThrow()
    expect(() =>
      calculateFixedPortfolioScenarios({ ...scenarioInputs, premiumDailyRaw: 'NaN' }),
    ).toThrow()
  })
  it.each([true, false])('values both token balances with quoteIsToken0=%s', (quoteIsToken0) => {
    const amount = 10n ** 18n
    const valueAt = prepareFixedPoolValue({
      currentTick: 0n,
      quoteIsToken0,
      curve: [
        { tick: -887272n, value0: amount, value1: -amount / 2n },
        { tick: 887272n, value0: amount, value1: -amount / 2n },
      ],
      balance0: amount * 2n,
      balance1: amount * 4n,
    })
    const up = valueAt('10')
    const down = valueAt('-10')
    const base = valueAt(0)
    expect(base.toString()).toBe('6500000000000000000')
    expect(up.gt(base)).toBe(true)
    expect(down.lt(base)).toBe(true)
    expect(() => valueAt('-100')).toThrow()
  })
  it('aggregates multiple position curves in mixed asset frames before computing returns', () => {
    const curve = [
      { tick: -887272n, value0: 3_000_000n, value1: -1_000_000n },
      { tick: 887272n, value0: 3_000_000n, value1: -1_000_000n },
    ]
    const a = prepareFixedPoolValue({
      currentTick: 0n,
      quoteIsToken0: true,
      curve,
      balance0: 2_000_000n,
      balance1: 4_000_000n,
    })
    const b = prepareFixedPoolValue({
      currentTick: 0n,
      quoteIsToken0: false,
      curve,
      balance0: 2_000_000n,
      balance1: 4_000_000n,
    })
    const [week] = calculateFixedPortfolioScenarios({
      ...scenarioInputs,
      valueChangeAtMove: (move) =>
        a(move)
          .minus(a(0))
          .plus(b(move).minus(b(0))),
    })
    expect(week.points.find((point) => point.movePct === '0')?.returnPct).toBe('-0.56')
    expect(Number(week.points.find((point) => point.movePct === '10')?.returnPct)).toBeGreaterThan(
      -0.56,
    )
  })
})

describe('current holdings weighted by Earn fee history', () => {
  const endTime = 720 * 3600
  const candles = Array.from({ length: 720 }, (_, index) => ({
    t: index * 3600,
    l: 0,
    h: 0,
    c: 0,
    n: 1,
    v0: '1000000000',
    v1: '1000000000',
    liq: '1000000',
  }))
  const legs = [
    { lowerTick: -100n, upperTick: 100n, liquidity: 10000n, isLong: true },
    { lowerTick: -100n, upperTick: 100n, liquidity: 2500n, isLong: false },
  ]
  it.each([true, false])(
    'weights long and short liquidity with quoteIsToken0=%s',
    (quoteIsToken0) => {
      expect(
        estimateFixedPortfolioPremium({
          candles,
          legs,
          quoteIsToken0,
          feeFraction: '0.003',
          endTime,
        }).toString(),
      ).toBe('540000')
    },
  )
  it('excludes out-of-range legs and rejects incomplete history instead of inventing zero fees', () => {
    expect(
      estimateFixedPortfolioPremium({
        candles,
        legs: [{ lowerTick: 10n, upperTick: 100n, liquidity: 10000n, isLong: true }],
        quoteIsToken0: true,
        feeFraction: '0.003',
        endTime,
      }).toString(),
    ).toBe('0')
    expect(() =>
      estimateFixedPortfolioPremium({
        candles: candles.slice(100),
        legs,
        quoteIsToken0: true,
        feeFraction: '0.003',
        endTime,
      }),
    ).toThrow('Insufficient')
    expect(() =>
      estimateFixedPortfolioPremium({
        candles: candles.map((candle) => ({ ...candle, liq: undefined })),
        legs,
        quoteIsToken0: true,
        feeFraction: '0.003',
        endTime,
      }),
    ).toThrow('liquidity')
  })
})

describe('fixed holding hedge triggers', () => {
  it.each([0n, 1n] as const)(
    'finds both boundaries for a mixed-frame multi-leg book, risk asset %s',
    (riskAssetIndex) => {
      const legs = [0n, 1n].map((tokenType) => ({
        index: tokenType,
        asset: tokenType,
        optionRatio: 1n,
        isLong: true,
        tokenType,
        riskPartner: tokenType,
        strike: 0n,
        width: 100n,
        tickLower: -500n,
        tickUpper: 500n,
      }))
      const position = { legs, positionSize: 1_000_000_000_000n, tickAtMint: 0n }
      const delta = legs.reduce(
        (sum, leg) =>
          sum +
          getLegDeltaInVaultFrame(
            leg,
            0n,
            position.positionSize,
            10n,
            0n,
            isDefinedRisk(legs),
            riskAssetIndex,
          ),
        0n,
      )
      const inputs = {
        positions: [position],
        currentTick: 0n,
        tickSpacing: 10n,
        riskAssetIndex,
        collateralRisk: -delta,
        walletRisk: 0n,
        thresholdBps: 1500n,
      }
      const triggers = estimateFixedPoolHedgeTriggers(inputs)
      expect(Number(triggers.downMovePct)).toBeLessThan(0)
      expect(Number(triggers.upMovePct)).toBeGreaterThan(0)
      expect(Math.abs(Number(triggers.downMovePct))).toBeLessThan(30)
      expect(
        estimateFixedPoolHedgeTriggers({ ...inputs, walletRisk: 10_000_000_000_000n }).upMovePct,
      ).toBe('0')
      expect(
        estimateFixedPoolHedgeTriggers({ ...inputs, thresholdBps: 1000000n }).upMovePct,
      ).toBeNull()
      expect(estimateFixedPoolHedgeTriggers({ ...inputs, positions: [] }).downMovePct).toBeNull()
      const loan = {
        ...legs[0],
        asset: riskAssetIndex,
        tokenType: riskAssetIndex,
        width: 0n,
        isLong: false,
      }
      const withLoan = estimateFixedPoolHedgeTriggers({
        ...inputs,
        positions: [{ ...position, legs: [...legs, loan] }],
        walletRisk: position.positionSize,
      })
      expect(withLoan).toEqual(triggers)
    },
  )
})
