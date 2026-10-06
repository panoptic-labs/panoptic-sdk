import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import {
  calculatePositionVolatilityMetrics,
  prepareLiquidityGamma,
  preparePositionGamma,
} from '../panoptic/v2/greeks/positionVolatility'
import { encodeLeg, encodePoolId } from '../panoptic/v2/tokenId/encoding'
import { calculateLpPositionVolatility } from './lpVolatility'

const snapshot = (timestamp: bigint, tick: number, token0 = 0n, token1 = 0n) => ({
  blockNumber: timestamp,
  blockTimestamp: timestamp,
  currentTick: tick,
  sqrtPriceX96: tickToSqrtPriceX96(BigInt(tick)),
  fees: { token0, token1 },
})
const base = {
  liquidity: 10n ** 15n,
  tickLower: -201000n,
  tickUpper: -199000n,
  snapshots: [
    snapshot(1000n, -200000),
    snapshot(4600n, -199900, 10n ** 15n, 1000000n),
    snapshot(8200n, -199950, 2n * 10n ** 15n, 2000000n),
  ],
}

describe('Uniswap LP historical convexity', () => {
  it.each([false, true])(
    'retains within-tick price movement and fee conversion (%s)',
    (quoteIsToken0) => {
      const q96 = 1n << 96n
      const first = q96 + q96 / 100000n
      const second = q96 + q96 / 50000n
      const snapshots = [
        { ...snapshot(1000n, 0), sqrtPriceX96: first },
        { ...snapshot(4600n, 0, 10n ** 18n, 2n * 10n ** 18n), sqrtPriceX96: second },
      ]
      const quoteDecimals = quoteIsToken0 ? 18 : 6
      const input = {
        ...base,
        tickLower: -10n,
        tickUpper: 10n,
        snapshots,
        quoteIsToken0,
        quoteDecimals,
      }
      const result = calculateLpPositionVolatility(input)
      const price = new Decimal(first.toString()).div(q96.toString()).pow(2)
      const expectedFees = (
        quoteIsToken0
          ? new Decimal('1e18').plus(new Decimal('2e18').div(price))
          : new Decimal('1e18').mul(price).plus('2e18')
      ).div(new Decimal(10).pow(quoteDecimals))
      expect(new Decimal(result.netPremium ?? 0).div(expectedFees).toNumber()).toBeCloseTo(1, 12)
      expect(new Decimal(result.weightedRealizedVolatility ?? 0).gt(0)).toBe(true)
      expect(new Decimal(result.signedConvexity).lt(0)).toBe(true)
      const flat = calculateLpPositionVolatility({
        ...input,
        snapshots: snapshots.map((point) => ({ ...point, sqrtPriceX96: first })),
      })
      expect(flat.signedConvexity).toBe('0')
    },
  )

  it.each([false, true])('values both fee assets in quote token0=%s', (quoteIsToken0) => {
    const quoteDecimals = quoteIsToken0 ? 18 : 6
    const result = calculateLpPositionVolatility({ ...base, quoteIsToken0, quoteDecimals })
    const expected = [-200000, -199900]
      .reduce((total, tick) => {
        const price = new Decimal('1.0001').pow(tick)
        return total.plus(
          quoteIsToken0
            ? new Decimal(1000000).div(price).plus('1e15')
            : new Decimal('1e15').mul(price).plus(1000000),
        )
      }, new Decimal(0))
      .div(new Decimal(10).pow(quoteDecimals))
    expect(new Decimal(result.netPremium ?? 0).div(expected).toNumber()).toBeCloseTo(1, 12)
    expect(result.gammaSign).toBe('negative')
    expect(new Decimal(result.signedConvexity).lt(0)).toBe(true)
    expect(result.premiumEquivalentVolatility).not.toBeNull()
    expect(new Decimal(result.estimatedHedgedResult ?? 0).toNumber()).toBeCloseTo(
      new Decimal(result.netPremium ?? 0).plus(result.signedConvexity).toNumber(),
      12,
    )
  })

  it.each([false, true])('has no convexity while out of range (%s)', (quoteIsToken0) => {
    const result = calculateLpPositionVolatility({
      ...base,
      quoteIsToken0,
      quoteDecimals: quoteIsToken0 ? 18 : 6,
      snapshots: [snapshot(1000n, -198000), snapshot(4600n, -197000)],
    })
    expect(result.signedConvexity).toBe('0')
    expect(result.premiumEquivalentVolatility).toBeNull()
    expect(result.comparisonReason).toBe('insufficient-exposure')
  })

  it('rejects duplicate times and closed liquidity', () => {
    const input = { ...base, quoteIsToken0: false, quoteDecimals: 6 }
    expect(() => calculateLpPositionVolatility({ ...input, liquidity: 0n })).toThrow('liquidity')
    expect(() =>
      calculateLpPositionVolatility({
        ...input,
        snapshots: [base.snapshots[0], base.snapshots[0]],
      }),
    ).toThrow('increasing')
  })
})

describe('LP candle observations', () => {
  it.each([false, true])(
    'captures a round trip hidden between accounting snapshots (%s)',
    (quoteIsToken0) => {
      const quoteDecimals = quoteIsToken0 ? 18 : 6
      const snapshots = [snapshot(1000n, -200000), snapshot(8200n, -200000, 10n ** 15n, 1000000n)]
      const gamma = prepareLiquidityGamma({
        chunks: [
          { lowerTick: -201000, upperTick: -199000, liquidity: base.liquidity, isLong: false },
        ],
        quoteIsToken0,
        quoteDecimals,
      })
      const observations = [-200000n, -199900n, -200000n].map((tick, index) => ({
        timestamp: 1000n + BigInt(index) * 3600n,
        price: new Decimal('1.0001').pow((quoteIsToken0 ? -tick : tick).toString()).toString(),
        gamma: gamma.atTick(tick).toString(),
      }))
      const input = { ...base, quoteIsToken0, quoteDecimals, snapshots }
      const sparse = calculateLpPositionVolatility(input)
      const candles = calculateLpPositionVolatility({ ...input, observations })
      expect(sparse.weightedRealizedVolatility).toBe('0')
      expect(Number(candles.weightedRealizedVolatility)).toBeGreaterThan(0)
      expect(candles.netPremium).toBe(sparse.netPremium)
      expect(() =>
        calculateLpPositionVolatility({ ...input, observations: observations.slice(1) }),
      ).toThrow('same window')
    },
  )

  it.each([false, true])(
    'matches a mixed-asset, multi-leg Panoptic position in quote token0=%s',
    (quoteIsToken0) => {
      const poolId = encodePoolId('0x0000000000000000000000000000000000000001', 10n)
      const tokenId = [0n, 1n].reduce(
        (id, index) =>
          id |
          encodeLeg({
            index,
            isLong: 0n,
            asset: index,
            strike: -200000n,
            width: 200n,
            optionRatio: 1n,
            tokenType: index,
            riskPartner: index,
          }),
        poolId,
      )
      const quoteDecimals = quoteIsToken0 ? 18 : 6
      const panoptic = preparePositionGamma({
        tokenId,
        positionSize: 10n ** 18n,
        quoteIsToken0,
        quoteDecimals,
      })
      const liquidity = panoptic.chunks.reduce((sum, chunk) => sum + chunk.liquidity, 0n)
      const lp = prepareLiquidityGamma({
        chunks: [{ lowerTick: -201000, upperTick: -199000, liquidity, isLong: false }],
        quoteIsToken0,
        quoteDecimals,
      })
      const ticks = [-201100n, -201000n, -200000n, -199000n, -199900n]
      const observations = (gamma: typeof lp) =>
        ticks.map((tick, index) => ({
          timestamp: 1000n + BigInt(index) * 3600n,
          price: new Decimal('1.0001').pow((quoteIsToken0 ? -tick : tick).toString()).toString(),
          gamma: gamma.atTick(tick).toString(),
        }))
      const expected = calculatePositionVolatilityMetrics({
        observations: observations(panoptic),
        quoteDecimals,
        netPremium: 0,
      })
      const actual = calculateLpPositionVolatility({
        ...base,
        liquidity,
        quoteIsToken0,
        quoteDecimals,
        observations: observations(lp),
        snapshots: [snapshot(1000n, -201100), snapshot(15400n, -199900)],
      })
      expect(actual.weightedRealizedVolatility).toBe(expected.weightedRealizedVolatility)
      expect(actual.signedConvexity).toBe(expected.signedConvexity)
    },
  )
})
