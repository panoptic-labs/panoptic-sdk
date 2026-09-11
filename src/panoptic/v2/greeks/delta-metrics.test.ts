import { describe, expect, it } from 'vitest'

import { decodeTokenId } from '../tokenId/decode'
import {
  getLegDeltaInVaultFrame,
  getPositionDeltaMetrics,
  isDefinedRisk,
  toVaultFrameAtTick,
} from './index'

const legs = decodeTokenId(0x18030674002018030674602000a0888e6a0c2ddn).legs
const input = {
  legs,
  positionSize: 10_000_000_000n,
  mintTick: 198262n,
  currentTick: 198213n,
  poolTickSpacing: 10n,
  assetIndex: 0n as const,
}

describe('strategy delta metrics', () => {
  it('reproduces the reported price-snapshot discrepancy and uses one contract notional', () => {
    expect(getPositionDeltaMetrics(input)).toEqual({
      delta: 3_922_253_782n,
      contractSize: 10_000_000_000n,
    })
    expect(getPositionDeltaMetrics({ ...input, currentTick: 198211n }).delta).toBe(4_089_319_908n)
  })

  it.each([0n, 1n] as const)(
    'keeps option ratios in exposure rather than the contract denominator (asset %s)',
    (assetIndex) => {
      const mirroredLegs = legs.map((leg) => ({
        ...leg,
        asset: assetIndex,
        tokenType: assetIndex === 0n ? leg.tokenType : 1n - leg.tokenType,
        strike: assetIndex === 0n ? leg.strike : -leg.strike,
      }))
      const params = {
        ...input,
        legs: mirroredLegs,
        assetIndex,
        currentTick: assetIndex === 0n ? input.currentTick : -input.currentTick,
        mintTick: assetIndex === 0n ? input.mintTick : -input.mintTick,
      }
      const base = getPositionDeltaMetrics(params)
      const doubled = getPositionDeltaMetrics({
        ...params,
        legs: mirroredLegs.map((leg) => ({ ...leg, optionRatio: 2n })),
      })
      expect(doubled.contractSize).toBe(base.contractSize)
      expect(doubled.delta - 2n * base.delta).toBeLessThanOrEqual(4n)
      expect(doubled.delta - 2n * base.delta).toBeGreaterThanOrEqual(-4n)
      const unequal = mirroredLegs.map((leg, index) => ({
        ...leg,
        optionRatio: index === 0 ? 2n : 1n,
      }))
      expect(getPositionDeltaMetrics({ ...params, legs: unequal }).delta).toBe(
        unequal.reduce(
          (sum, leg) =>
            sum +
            getLegDeltaInVaultFrame(
              leg,
              params.currentTick,
              params.positionSize,
              params.poolTickSpacing,
              params.mintTick,
              isDefinedRisk(unequal),
              assetIndex,
            ),
          0n,
        ),
      )
    },
  )

  it.each([0n, 1n] as const)(
    'normalizes mixed assets in one frame and ignores prepended credit legs for contract denomination (%s)',
    (assetIndex) => {
      const mixed = legs.map((leg, index) => ({
        ...leg,
        index: BigInt(index + 1),
        asset: BigInt(index),
      }))
      const credit = { ...legs[0], index: 0n, width: 0n, asset: 1n, optionRatio: 5n }
      const result = getPositionDeltaMetrics({ ...input, legs: [credit, ...mixed], assetIndex })
      expect(result.contractSize).toBe(
        toVaultFrameAtTick(input.positionSize, 0n, assetIndex, input.currentTick),
      )
      expect(result.delta).toBe(
        [credit, ...mixed].reduce(
          (sum, leg) =>
            sum +
            getLegDeltaInVaultFrame(
              leg,
              input.currentTick,
              input.positionSize,
              input.poolTickSpacing,
              input.mintTick,
              isDefinedRisk([credit, ...mixed]),
              assetIndex,
            ),
          0n,
        ),
      )
    },
  )

  it('keeps a nonzero denominator for spreads with flat tails and four-leg strategies', () => {
    const spread = [
      { ...legs[0], strike: 198100n },
      { ...legs[0], index: 1n, strike: 198300n, isLong: true },
    ]
    expect(getPositionDeltaMetrics({ ...input, legs: spread }).contractSize).toBe(
      input.positionSize,
    )
    const four = [
      ...spread,
      ...spread.map((leg) => ({ ...leg, index: leg.index + 2n, tokenType: 1n - leg.tokenType })),
    ]
    expect(getPositionDeltaMetrics({ ...input, legs: four }).contractSize).toBe(input.positionSize)
  })

  it('handles zero-size and empty positions', () => {
    expect(getPositionDeltaMetrics({ ...input, positionSize: 0n })).toEqual({
      delta: 0n,
      contractSize: 0n,
    })
    expect(getPositionDeltaMetrics({ ...input, legs: [] })).toEqual({ delta: 0n, contractSize: 0n })
  })
})
