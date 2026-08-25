import { describe, expect, it } from 'vitest'

import { MAX_TICK, MIN_TICK } from '../utils/constants'
import { createTokenIdBuilder } from './builder'
import { LEG_LIMITS, TOKEN_ID_BITS } from './constants'
import { deriveUniqueTokenId, planDeriveStrategy } from './deriveUniqueTokenId'
import { countLegs, decodeAllLegs, decodeLeg } from './encoding'

const POOL_ID = 0x1234567890abcdefn

function makeSimplePut(): bigint {
  return createTokenIdBuilder(POOL_ID)
    .addPut({ strike: 200000n, width: 20n, optionRatio: 1n, isLong: false })
    .build()
}

function makeStrangle(): bigint {
  return createTokenIdBuilder(POOL_ID)
    .addPut({ strike: 180000n, width: 20n, optionRatio: 1n, isLong: false })
    .addCall({ strike: 220000n, width: 20n, optionRatio: 1n, isLong: false })
    .build()
}

function makeFourLegSpread(ratio: bigint = 1n): bigint {
  return createTokenIdBuilder(POOL_ID)
    .addPut({ strike: 180000n, width: 20n, optionRatio: ratio, isLong: false })
    .addPut({ strike: 190000n, width: 20n, optionRatio: ratio, isLong: false })
    .addCall({ strike: 210000n, width: 20n, optionRatio: ratio, isLong: false })
    .addCall({ strike: 220000n, width: 20n, optionRatio: ratio, isLong: false })
    .build()
}

describe('deriveUniqueTokenId — tiny-credit path', () => {
  it('appends a width=0 credit leg for a 1-leg position and keeps target size', () => {
    const base = makeSimplePut()
    const result = deriveUniqueTokenId({ baseTokenId: base, targetPositionSize: 12345n })

    expect(result.strategy).toBe('tiny-credit')
    expect(result.newTokenId).not.toBe(base)
    expect(result.newPositionSize).toBe(12345n)
    expect(countLegs(result.newTokenId)).toBe(countLegs(base) + 1n)

    const appended = decodeLeg(result.newTokenId, countLegs(base))
    expect(appended.width).toBe(0n)
    expect(appended.isLong).toBe(true)
    expect(appended.optionRatio).toBe(1n)
    // Strike stays safely inside (MIN_TICK + tickSpacing, MAX_TICK - tickSpacing)
    // so the SFPM's internal width-2 chunk (strike ± tickSpacing) doesn't
    // overflow MAX_POOL_TICK. Default tickSpacing safety margin = 200.
    const SAFE_MARGIN = 201n
    expect(appended.strike > MIN_TICK + SAFE_MARGIN).toBe(true)
    expect(appended.strike < MAX_TICK - SAFE_MARGIN).toBe(true)
  })

  it('tick range from appended leg (strike ± tickSpacing) stays inside pool bounds', () => {
    // Fictitious width-2 chunk expansion: absolute tick MUST stay ≤ MAX_TICK.
    for (const tickSpacing of [1n, 10n, 60n, 200n]) {
      for (const size of [1n, 10n ** 6n, 10n ** 18n, 10n ** 27n]) {
        const base = makeSimplePut()
        const r = deriveUniqueTokenId({
          baseTokenId: base,
          targetPositionSize: size,
          tickSpacing,
        })
        const leg = decodeLeg(r.newTokenId, countLegs(base))
        const abs = leg.strike < 0n ? -leg.strike : leg.strike
        expect(abs + tickSpacing).toBeLessThanOrEqual(MAX_TICK)
      }
    }
  })

  it('is idempotent w.r.t. base legs (existing legs preserved verbatim)', () => {
    const base = makeStrangle()
    const before = decodeAllLegs(base)
    const { newTokenId } = deriveUniqueTokenId({ baseTokenId: base, targetPositionSize: 1n })
    const preserved = decodeAllLegs(newTokenId).slice(0, before.length)
    expect(preserved).toEqual(before)
  })

  it('accepts any positive target size (arbitrary reduction)', () => {
    const base = makeSimplePut()
    for (const size of [1n, 7n, 999n, 10n ** 18n]) {
      const r = deriveUniqueTokenId({ baseTokenId: base, targetPositionSize: size })
      expect(r.newPositionSize).toBe(size)
    }
  })
})

describe('deriveUniqueTokenId — ratio-scale fallback', () => {
  it('kicks in when all 4 leg slots are used', () => {
    const base = makeFourLegSpread(1n)
    const target = 1000n
    const r = deriveUniqueTokenId({ baseTokenId: base, targetPositionSize: target })

    expect(r.strategy).toBe('ratio-scale')
    expect(countLegs(r.newTokenId)).toBe(TOKEN_ID_BITS.MAX_LEGS)

    const legs = decodeAllLegs(r.newTokenId)
    // Every leg's ratio is scaled by the same N; N is floor(127 / maxRatio_base).
    const N = LEG_LIMITS.MAX_RATIO / 1n
    for (const leg of legs) {
      expect(leg.optionRatio).toBe(1n * N)
    }
    // Effective per-leg liquidity = newSize · N ≥ target (ceil).
    expect(r.newPositionSize * N).toBeGreaterThanOrEqual(target)
  })

  it('rounds newPositionSize UP so effective size never underruns the target', () => {
    const base = makeFourLegSpread(1n)
    // target that is NOT divisible by N — force ceil to bite
    const target = 1001n
    const r = deriveUniqueTokenId({ baseTokenId: base, targetPositionSize: target })
    const N = LEG_LIMITS.MAX_RATIO / 1n
    expect(r.newPositionSize).toBe((target + N - 1n) / N)
    expect(r.newPositionSize * N).toBeGreaterThanOrEqual(target)
    // Effective size == newPositionSize · N (SDK-exposed field). Callers
    // compare this against the base tokenId's stored size to validate that
    // ceil-rounding didn't push exposure above what's held on-chain.
    expect(r.effectivePositionSize).toBe(r.newPositionSize * N)
    expect(r.effectivePositionSize).toBeGreaterThanOrEqual(target)
  })

  it('throws when ratio ceiling leaves no scale factor', () => {
    const base = makeFourLegSpread(100n) // max scale factor = floor(127/100) = 1 → invalid
    expect(() => deriveUniqueTokenId({ baseTokenId: base, targetPositionSize: 10n })).toThrow(
      /optionRatios already near the 127 ceiling/,
    )
  })
})

describe('deriveUniqueTokenId — input validation', () => {
  it('rejects non-positive target sizes', () => {
    const base = makeSimplePut()
    expect(() => deriveUniqueTokenId({ baseTokenId: base, targetPositionSize: 0n })).toThrow(
      /targetPositionSize must be > 0/,
    )
  })

  it('rejects a base tokenId with no legs', () => {
    expect(() => deriveUniqueTokenId({ baseTokenId: POOL_ID, targetPositionSize: 1n })).toThrow(
      /no legs/,
    )
  })
})

describe('planDeriveStrategy', () => {
  it('predicts tiny-credit for < 4 legs', () => {
    expect(planDeriveStrategy(makeSimplePut())).toBe('tiny-credit')
    expect(planDeriveStrategy(makeStrangle())).toBe('tiny-credit')
  })
  it('predicts ratio-scale for 4 legs', () => {
    expect(planDeriveStrategy(makeFourLegSpread(1n))).toBe('ratio-scale')
  })
})
