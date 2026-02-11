import { describe, expect, it } from 'vitest'

import {
  BPS_DENOMINATOR,
  MAX_TICK,
  MAX_TRACKED_CHUNKS,
  MIN_TICK,
  ORACLE_EPOCH_SECONDS,
  REORG_DEPTH,
  SCHEMA_VERSION,
  STORAGE_PREFIX,
  UTILIZATION_DENOMINATOR,
  WAD,
  ZERO_COLLATERAL,
  ZERO_VALUATION,
} from './constants'

describe('constants', () => {
  describe('WAD', () => {
    it('equals 10^18', () => {
      expect(WAD).toBe(1000000000000000000n)
    })

    it('is a bigint', () => {
      expect(typeof WAD).toBe('bigint')
    })
  })

  describe('ZERO_COLLATERAL', () => {
    it('has token0 with zero values', () => {
      expect(ZERO_COLLATERAL.token0.assets).toBe(0n)
      expect(ZERO_COLLATERAL.token0.shares).toBe(0n)
      expect(ZERO_COLLATERAL.token0.availableAssets).toBe(0n)
      expect(ZERO_COLLATERAL.token0.lockedAssets).toBe(0n)
    })

    it('has token1 with zero values', () => {
      expect(ZERO_COLLATERAL.token1.assets).toBe(0n)
      expect(ZERO_COLLATERAL.token1.shares).toBe(0n)
      expect(ZERO_COLLATERAL.token1.availableAssets).toBe(0n)
      expect(ZERO_COLLATERAL.token1.lockedAssets).toBe(0n)
    })

    it('is immutable (as const)', () => {
      // TypeScript enforces this at compile time via `as const`
      // Runtime check that it's an object with expected structure
      expect(Object.keys(ZERO_COLLATERAL)).toEqual(['token0', 'token1'])
    })
  })

  describe('ZERO_VALUATION', () => {
    it('has all zero values', () => {
      expect(ZERO_VALUATION.netLiquidationValue0).toBe(0n)
      expect(ZERO_VALUATION.netLiquidationValue1).toBe(0n)
      expect(ZERO_VALUATION.maintenanceMargin0).toBe(0n)
      expect(ZERO_VALUATION.maintenanceMargin1).toBe(0n)
      expect(ZERO_VALUATION.marginExcess0).toBe(0n)
      expect(ZERO_VALUATION.marginExcess1).toBe(0n)
    })
  })

  describe('SCHEMA_VERSION', () => {
    it('is a positive number', () => {
      expect(SCHEMA_VERSION).toBeGreaterThan(0)
    })

    it('is a number (not bigint - used for JSON serialization)', () => {
      expect(typeof SCHEMA_VERSION).toBe('number')
    })
  })

  describe('STORAGE_PREFIX', () => {
    it('matches expected format', () => {
      expect(STORAGE_PREFIX).toBe('panoptic-v2-sdk')
    })
  })

  describe('MAX_TRACKED_CHUNKS', () => {
    it('is 1000 per spec', () => {
      expect(MAX_TRACKED_CHUNKS).toBe(1000)
    })
  })

  describe('REORG_DEPTH', () => {
    it('is 128 blocks per spec', () => {
      expect(REORG_DEPTH).toBe(128n)
    })
  })

  describe('ORACLE_EPOCH_SECONDS', () => {
    it('is 64 seconds', () => {
      expect(ORACLE_EPOCH_SECONDS).toBe(64n)
    })
  })

  describe('tick bounds', () => {
    it('MIN_TICK is negative', () => {
      expect(MIN_TICK).toBeLessThan(0n)
    })

    it('MAX_TICK is positive', () => {
      expect(MAX_TICK).toBeGreaterThan(0n)
    })

    it('MIN_TICK and MAX_TICK are symmetric', () => {
      expect(MIN_TICK).toBe(-MAX_TICK)
    })

    it('matches Uniswap v3 bounds', () => {
      expect(MIN_TICK).toBe(-887272n)
      expect(MAX_TICK).toBe(887272n)
    })
  })

  describe('denominators', () => {
    it('BPS_DENOMINATOR is 10000', () => {
      expect(BPS_DENOMINATOR).toBe(10000n)
    })

    it('UTILIZATION_DENOMINATOR is 10000', () => {
      expect(UTILIZATION_DENOMINATOR).toBe(10000n)
    })
  })
})
