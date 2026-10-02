import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { decodeTokenId } from '../tokenId/decode'
import { encodeLeg, encodePoolId } from '../tokenId/encoding'
import { getLegValue } from './index'
import { marketRiskFromValues } from './marketPnl'
import {
  calculatePositionVolatilityMetrics,
  preparePositionGamma,
  valuePositionAccrual,
} from './positionVolatility'

const DAY = 86400n
const poolId = encodePoolId('0x0000000000000000000000000000000000000001', 10n)
const leg = (index: bigint, isLong: bigint, asset = 0n, strike = 0n, width = 20n) =>
  encodeLeg({
    index,
    isLong,
    asset,
    strike,
    width,
    optionRatio: 1n,
    tokenType: 1n,
    riskPartner: index,
  })

describe('whole-position volatility', () => {
  it('reproduces the 40-day fixture without doubling dollar-gamma', () => {
    const years = new Decimal(40).div(365)
    const logReturn = years.mul('0.26').mul('0.26').sqrt()
    const result = calculatePositionVolatilityMetrics({
      observations: [
        { timestamp: 0n, price: '1', gamma: '69.903' },
        { timestamp: 40n * DAY, price: logReturn.exp().toString(), gamma: '69.903' },
      ],
      netPremium: '-1.09',
      baseFees: new Decimal('1.09').div('1.488').neg(),
      quoteDecimals: 6,
    })
    expect(Number(result.premiumEquivalentVolatility)).toBeCloseTo(0.5334537545, 9)
    expect(Number(result.feeEquivalentVolatility)).toBeCloseTo(0.437315943, 9)
    expect(Number(result.weightedRealizedVolatility)).toBeCloseTo(0.26, 10)
    expect(Number(result.signedConvexity)).toBeCloseTo(0.258928373, 9)
    expect(Number(result.feeToConvexity)).toBeCloseTo(2.829071509, 8)
    expect(Number(result.estimatedHedgedResult)).toBeCloseTo(-0.831071627, 9)
    expect(
      Number(result.premiumEquivalentVolatility) / Number(result.feeEquivalentVolatility),
    ).toBeCloseTo(Math.sqrt(1.488), 10)
  })

  it('retains signed convexity cancellation while magnitude RV stays positive', () => {
    const result = calculatePositionVolatilityMetrics({
      observations: [
        { timestamp: 0n, price: '1', gamma: '100' },
        { timestamp: DAY, price: '1.1', gamma: '-100' },
        { timestamp: 2n * DAY, price: '1', gamma: '-100' },
      ],
      netPremium: '2',
      baseFees: '1',
      quoteDecimals: 6,
    })
    expect(Number(result.signedConvexity)).toBeCloseTo(0, 12)
    expect(Number(result.weightedRealizedVolatility)).toBeGreaterThan(0)
    expect(Number(result.estimatedHedgedResult)).toBeCloseTo(2)
    expect(result.comparisonReason).toBe('changing-sign')
    expect(result.premiumEquivalentVolatility).toBeNull()
    expect(result.premiumToConvexity).toBeNull()
    expect(result.feeEquivalentVolatility).toBeNull()
  })

  it('detects intrabucket opposite gamma without inventing its contribution', () => {
    const result = calculatePositionVolatilityMetrics({
      observations: [
        { timestamp: 0n, price: 1, gamma: 100 },
        { timestamp: DAY, price: 1, gamma: 100, rangeGammas: [-10, 100] },
      ],
      netPremium: -1,
      quoteDecimals: 6,
    })
    expect(result.signedConvexity).toBe('0')
    expect(result.comparisonReason).toBe('changing-sign')
    expect(result.weightedRealizedVolatility).toBe('0')
  })

  it('integrates changing gamma over real elapsed time, including quiet intervals', () => {
    const result = calculatePositionVolatilityMetrics({
      observations: [
        { timestamp: 0n, price: 1, gamma: -100 },
        { timestamp: DAY, price: 1, gamma: -200 },
        { timestamp: 3n * DAY, price: 1.1, gamma: 0 },
      ],
      netPremium: 2,
      quoteDecimals: 6,
    })
    expect(Number(result.exposure)).toBeCloseTo(500 / 365, 12)
    expect(Number(result.signedConvexity)).toBeCloseTo(-100 * Math.log(1.1) ** 2, 12)
    expect(result.comparisonReason).toBeNull()
  })

  it.each([0, '0.000001'])('gates zero and dust exposure (%s)', (gamma) => {
    const result = calculatePositionVolatilityMetrics({
      observations: [
        { timestamp: 0n, price: 1, gamma },
        { timestamp: DAY, price: 2, gamma },
      ],
      netPremium: -1,
      quoteDecimals: 6,
    })
    expect(result.comparisonReason).toBe('insufficient-exposure')
    expect(result.weightedRealizedVolatility).toBeNull()
    expect(result.estimatedHedgedResult).not.toBeNull()
  })

  it('ignores sign noise and preserves zero premium while rejecting inconsistent direction', () => {
    const observations = [
      { timestamp: 0n, price: 1, gamma: 100 },
      { timestamp: DAY, price: 1, gamma: '-1e-15' },
    ]
    const result = calculatePositionVolatilityMetrics({
      observations,
      netPremium: 0,
      quoteDecimals: 6,
    })
    expect(result.gammaSign).toBe('positive')
    expect(result.premiumEquivalentVolatility).toBe('0')
    expect(result.premiumToConvexity).toBeNull()
    const inconsistent = calculatePositionVolatilityMetrics({
      observations,
      netPremium: 1,
      quoteDecimals: 6,
    })
    expect(inconsistent.comparisonReason).toBe('inconsistent-premium-direction')
    expect(inconsistent.estimatedHedgedResult).toBe('1')
  })

  it('keeps price diagnostics and separately established fees when premium is missing', () => {
    const result = calculatePositionVolatilityMetrics({
      observations: [
        { timestamp: 0n, price: 1, gamma: -100 },
        { timestamp: DAY, price: 2, gamma: -100 },
      ],
      netPremium: null,
      baseFees: 1,
      quoteDecimals: 6,
    })
    expect(result.signedConvexity).not.toBeNull()
    expect(result.weightedRealizedVolatility).not.toBeNull()
    expect(result.feeEquivalentVolatility).not.toBeNull()
    expect(result.estimatedHedgedResult).toBeNull()
  })

  it('rejects missing intervals, nonpositive prices, and nonfinite accounting', () => {
    const input = {
      observations: [
        { timestamp: DAY, price: 1, gamma: 100 },
        { timestamp: DAY, price: 2, gamma: 100 },
      ],
      netPremium: -1,
      quoteDecimals: 6,
    }
    expect(() => calculatePositionVolatilityMetrics(input)).toThrow('increasing')
    expect(() =>
      calculatePositionVolatilityMetrics({
        ...input,
        observations: [{ timestamp: 0n, price: 0, gamma: 100 }, input.observations[1]],
      }),
    ).toThrow('Invalid price')
    expect(() =>
      calculatePositionVolatilityMetrics({
        ...input,
        netPremium: 'NaN',
        observations: [{ timestamp: 0n, price: 1, gamma: 100 }, input.observations[1]],
      }),
    ).toThrow('Invalid accounting')
  })
})

describe('whole-position gamma curve', () => {
  it('nets opposing legs before taking any magnitude', () => {
    const curve = preparePositionGamma({
      tokenId: poolId | leg(0n, 0n) | leg(1n, 1n),
      positionSize: 10n ** 18n,
      quoteIsToken0: false,
      quoteDecimals: 18,
    })
    expect(curve.atTick(0n).isZero()).toBe(true)
    expect(curve.inRange(-1000n, 1000n).every((gamma) => gamma.isZero())).toBe(true)
  })

  it.each([false, true])(
    'matches whole-value second derivatives in quote frame %s',
    (quoteIsToken0) => {
      const tokenId = poolId | leg(0n, 0n) | leg(1n, 1n, 1n, 50n, 40n)
      const positionSize = 10n ** 18n
      const curve = preparePositionGamma({ tokenId, positionSize, quoteIsToken0, quoteDecimals: 0 })
      const decoded = decodeTokenId(tokenId)
      const sample = (tick: bigint) => {
        const price1 = new Decimal('1.0001').pow(tick.toString())
        const value = decoded.legs.reduce((total, part) => {
          const native = new Decimal(
            getLegValue(part, tick, 0n, positionSize, decoded.tickSpacing, false).toString(),
          )
          const inToken1 = part.asset === 0n ? native : native.mul(price1)
          return total.plus(quoteIsToken0 ? inToken1.div(price1) : inToken1)
        }, new Decimal(0))
        return { price: quoteIsToken0 ? new Decimal(1).div(price1) : price1, value }
      }
      const risk = marketRiskFromValues({
        lower: sample(quoteIsToken0 ? 1n : -1n),
        current: sample(0n),
        upper: sample(quoteIsToken0 ? -1n : 1n),
      })
      expect(risk).not.toBeNull()
      if (risk === null) return
      expect(risk.gamma.div(curve.atTick(0n)).toNumber()).toBeCloseTo(1, 4)
      expect(curve.atTick(-1000n).isZero()).toBe(true)
      expect(curve.atTick(1000n).isZero()).toBe(true)
    },
  )

  it('uses asymmetric contract tick bounds for odd widths and no gamma for loans', () => {
    const id = encodePoolId('0x0000000000000000000000000000000000000001', 1n)
    const curve = preparePositionGamma({
      tokenId: id | leg(0n, 0n, 0n, 0n, 3n) | leg(1n, 0n, 1n, 0n, 0n),
      positionSize: 10n ** 12n,
      quoteIsToken0: false,
      quoteDecimals: 6,
    })
    expect(curve.chunks).toHaveLength(1)
    expect(curve.chunks[0].lowerTick).toBe(-1)
    expect(curve.chunks[0].upperTick).toBe(2)
    expect(curve.atTick(1n).lt(0)).toBe(true)
    expect(curve.atTick(2n).isZero()).toBe(true)
  })
})

describe('net accrued premium valuation', () => {
  it.each([false, true])(
    'values increments rather than revaluing lifetime holdings (%s)',
    (quoteIsToken0) => {
      const value = valuePositionAccrual({
        snapshots: [
          { token0: 1000000n, token1: 2000000n, tick: 0n },
          { token0: 1000000n, token1: 2000000n, tick: 10000n },
        ],
        quoteIsToken0,
        quoteDecimals: 6,
      })
      expect(value.toString()).toBe('3')
    },
  )
  it('uses recorded variable-multiplier payments and retains signed adjustments', () => {
    const value = valuePositionAccrual({
      snapshots: [
        { token0: 0n, token1: -1000000n, tick: 0n },
        { token0: 0n, token1: -3000000n, tick: 100n },
        { token0: 0n, token1: -2900000n, tick: 100n },
      ],
      quoteIsToken0: false,
      quoteDecimals: 6,
    })
    expect(value.toString()).toBe('-2.9')
  })
})
