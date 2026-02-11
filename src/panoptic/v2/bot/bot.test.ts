import { describe, expect, it } from 'vitest'

import { SafeModeError, StaleDataError, UnhealthyPoolError } from '../errors'
import type { BlockMeta, Pool, SafeModeState } from '../types'
import {
  assertCanBurn,
  assertCanForceExercise,
  assertCanLiquidate,
  assertCanMint,
  assertFresh,
  assertHealthy,
  assertTradeable,
  isGasError,
  isNonceError,
  isRetryableRpcError,
} from './index'

// Helper to create mock BlockMeta
function createMeta(blockTimestamp: bigint): BlockMeta {
  return {
    blockNumber: 1000n,
    blockTimestamp,
    blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  }
}

// Helper to create mock Pool
function createPool(healthStatus: 'active' | 'low_liquidity' | 'paused' = 'active'): Pool {
  return {
    address: '0x1234567890123456789012345678901234567890',
    chainId: 1n,
    poolId: 123n,
    poolKey: {
      currency0: '0x0000000000000000000000000000000000000001',
      currency1: '0x0000000000000000000000000000000000000002',
      fee: 500n,
      tickSpacing: 10n,
      hooks: '0x0000000000000000000000000000000000000000',
    },
    collateralTracker0: {
      address: '0x0000000000000000000000000000000000000003',
      token: '0x0000000000000000000000000000000000000001',
      symbol: 'WETH',
      decimals: 18n,
      totalAssets: 1000000n,
      insideAMM: 0n,
      creditedShares: 0n,
      totalShares: 1000000n,
      utilization: 5000n,
      borrowRate: 0n,
      supplyRate: 0n,
    },
    collateralTracker1: {
      address: '0x0000000000000000000000000000000000000004',
      token: '0x0000000000000000000000000000000000000002',
      symbol: 'USDC',
      decimals: 6n,
      totalAssets: 1000000n,
      insideAMM: 0n,
      creditedShares: 0n,
      totalShares: 1000000n,
      utilization: 5000n,
      borrowRate: 0n,
      supplyRate: 0n,
    },
    riskEngine: {
      address: '0x0000000000000000000000000000000000000005',
      collateralRequirement: 10000n,
      maintenanceMargin: 5000n,
      commissionRate: 10n,
    },
    currentTick: 0n,
    sqrtPriceX96: 2n ** 96n,
    healthStatus,
    _meta: createMeta(BigInt(Math.floor(Date.now() / 1000))),
  }
}

// Helper to create mock SafeModeState
function createSafeMode(
  mode: 'normal' | 'restricted' | 'emergency' = 'normal',
  overrides: Partial<SafeModeState> = {},
): SafeModeState {
  const defaults: SafeModeState = {
    mode,
    canMint: mode === 'normal',
    canBurn: mode !== 'emergency',
    canForceExercise: mode !== 'emergency',
    canLiquidate: true, // Always allowed
    _meta: createMeta(BigInt(Math.floor(Date.now() / 1000))),
  }
  return { ...defaults, ...overrides }
}

describe('bot utilities', () => {
  describe('assertFresh', () => {
    it('should not throw for fresh data', () => {
      const now = BigInt(Math.floor(Date.now() / 1000))
      const data = { _meta: createMeta(now - 30n) }

      expect(() => assertFresh(data, 60, now)).not.toThrow()
    })

    it('should throw StaleDataError for stale data', () => {
      const now = BigInt(Math.floor(Date.now() / 1000))
      const data = { _meta: createMeta(now - 120n) }

      expect(() => assertFresh(data, 60, now)).toThrow(StaleDataError)
    })

    it('should accept number for maxAgeSeconds', () => {
      const now = BigInt(Math.floor(Date.now() / 1000))
      const data = { _meta: createMeta(now - 30n) }

      expect(() => assertFresh(data, 60, now)).not.toThrow()
    })

    it('should use current time when not provided', () => {
      const now = BigInt(Math.floor(Date.now() / 1000))
      const data = { _meta: createMeta(now - 30n) }

      // This should not throw since data is recent
      expect(() => assertFresh(data, 60)).not.toThrow()
    })

    it('should throw with correct staleness info', () => {
      const now = 1000000n
      const blockTimestamp = 999900n // 100 seconds ago
      const data = { _meta: createMeta(blockTimestamp) }

      try {
        assertFresh(data, 60, now)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(StaleDataError)
        const staleError = error as StaleDataError
        expect(staleError.blockTimestamp).toBe(blockTimestamp)
        expect(staleError.currentTimestamp).toBe(now)
        expect(staleError.stalenessSeconds).toBe(100n)
      }
    })
  })

  describe('assertHealthy', () => {
    it('should not throw for active pool', () => {
      const pool = createPool('active')
      expect(() => assertHealthy(pool)).not.toThrow()
    })

    it('should throw UnhealthyPoolError for low_liquidity pool', () => {
      const pool = createPool('low_liquidity')
      expect(() => assertHealthy(pool)).toThrow(UnhealthyPoolError)
    })

    it('should throw UnhealthyPoolError for paused pool', () => {
      const pool = createPool('paused')
      expect(() => assertHealthy(pool)).toThrow(UnhealthyPoolError)
    })

    it('should include health status in error', () => {
      const pool = createPool('paused')

      try {
        assertHealthy(pool)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(UnhealthyPoolError)
        expect((error as UnhealthyPoolError).healthStatus).toBe('paused')
      }
    })
  })

  describe('assertTradeable', () => {
    it('should not throw for healthy pool in normal mode', () => {
      const pool = createPool('active')
      const safeMode = createSafeMode('normal')

      expect(() => assertTradeable(pool, safeMode)).not.toThrow()
    })

    it('should not throw for healthy pool without safe mode check', () => {
      const pool = createPool('active')

      expect(() => assertTradeable(pool)).not.toThrow()
    })

    it('should throw UnhealthyPoolError first if pool is unhealthy', () => {
      const pool = createPool('paused')
      const safeMode = createSafeMode('restricted')

      expect(() => assertTradeable(pool, safeMode)).toThrow(UnhealthyPoolError)
    })

    it('should throw SafeModeError for restricted mode', () => {
      const pool = createPool('active')
      const safeMode = createSafeMode('restricted', { reason: 'High volatility' })

      expect(() => assertTradeable(pool, safeMode)).toThrow(SafeModeError)
    })

    it('should throw SafeModeError for emergency mode', () => {
      const pool = createPool('active')
      const safeMode = createSafeMode('emergency', { reason: 'Critical issue' })

      expect(() => assertTradeable(pool, safeMode)).toThrow(SafeModeError)
    })
  })

  describe('assertCanMint', () => {
    it('should not throw when minting is allowed', () => {
      const safeMode = createSafeMode('normal', { canMint: true })
      expect(() => assertCanMint(safeMode)).not.toThrow()
    })

    it('should throw SafeModeError when minting is not allowed', () => {
      const safeMode = createSafeMode('restricted', { canMint: false })
      expect(() => assertCanMint(safeMode)).toThrow(SafeModeError)
    })
  })

  describe('assertCanBurn', () => {
    it('should not throw when burning is allowed', () => {
      const safeMode = createSafeMode('normal', { canBurn: true })
      expect(() => assertCanBurn(safeMode)).not.toThrow()
    })

    it('should throw SafeModeError when burning is not allowed', () => {
      const safeMode = createSafeMode('emergency', { canBurn: false })
      expect(() => assertCanBurn(safeMode)).toThrow(SafeModeError)
    })
  })

  describe('assertCanLiquidate', () => {
    it('should not throw when liquidations are allowed', () => {
      const safeMode = createSafeMode('normal', { canLiquidate: true })
      expect(() => assertCanLiquidate(safeMode)).not.toThrow()
    })

    it('should throw SafeModeError when liquidations are not allowed', () => {
      const safeMode = createSafeMode('emergency', { canLiquidate: false })
      expect(() => assertCanLiquidate(safeMode)).toThrow(SafeModeError)
    })
  })

  describe('assertCanForceExercise', () => {
    it('should not throw when force exercise is allowed', () => {
      const safeMode = createSafeMode('normal', { canForceExercise: true })
      expect(() => assertCanForceExercise(safeMode)).not.toThrow()
    })

    it('should throw SafeModeError when force exercise is not allowed', () => {
      const safeMode = createSafeMode('emergency', { canForceExercise: false })
      expect(() => assertCanForceExercise(safeMode)).toThrow(SafeModeError)
    })
  })

  describe('isRetryableRpcError', () => {
    it('should return false for null/undefined', () => {
      expect(isRetryableRpcError(null)).toBe(false)
      expect(isRetryableRpcError(undefined)).toBe(false)
    })

    it('should return true for timeout errors', () => {
      expect(isRetryableRpcError(new Error('Request timeout'))).toBe(true)
      expect(isRetryableRpcError(new Error('Connection timed out'))).toBe(true)
      expect(isRetryableRpcError({ message: 'ETIMEDOUT' })).toBe(true)
    })

    it('should return true for rate limit errors', () => {
      expect(isRetryableRpcError(new Error('Rate limit exceeded'))).toBe(true)
      expect(isRetryableRpcError(new Error('Too many requests'))).toBe(true)
      expect(isRetryableRpcError(new Error('429 Too Many Requests'))).toBe(true)
    })

    it('should return true for connection errors', () => {
      expect(isRetryableRpcError(new Error('Connection refused'))).toBe(true)
      expect(isRetryableRpcError(new Error('ECONNRESET'))).toBe(true)
      expect(isRetryableRpcError(new Error('ECONNREFUSED'))).toBe(true)
      expect(isRetryableRpcError(new Error('Socket hang up'))).toBe(true)
    })

    it('should return true for server errors', () => {
      expect(isRetryableRpcError(new Error('503 Service Unavailable'))).toBe(true)
      expect(isRetryableRpcError(new Error('502 Bad Gateway'))).toBe(true)
      expect(isRetryableRpcError(new Error('Internal server error'))).toBe(true)
    })

    it('should return true for nonce errors', () => {
      expect(isRetryableRpcError(new Error('nonce too low'))).toBe(true)
      expect(isRetryableRpcError(new Error('transaction already known'))).toBe(true)
    })

    it('should return true for gas errors', () => {
      expect(isRetryableRpcError(new Error('replacement transaction underpriced'))).toBe(true)
    })

    it('should return true for retryable RPC codes', () => {
      expect(isRetryableRpcError({ code: -32005, message: 'Limit exceeded' })).toBe(true)
      expect(isRetryableRpcError({ code: -32000, message: 'Server error' })).toBe(true)
    })

    it('should return false for non-retryable errors', () => {
      expect(isRetryableRpcError(new Error('Execution reverted'))).toBe(false)
      expect(isRetryableRpcError(new Error('insufficient funds'))).toBe(false)
      expect(isRetryableRpcError(new Error('Invalid parameters'))).toBe(false)
    })

    it('should check nested cause', () => {
      const error = {
        message: 'Top level error',
        cause: new Error('Connection refused'),
      }
      expect(isRetryableRpcError(error)).toBe(true)
    })

    it('should check viem-style details', () => {
      const error = {
        message: 'Request failed',
        details: { code: -32005, message: 'Rate limited' },
      }
      expect(isRetryableRpcError(error)).toBe(true)
    })
  })

  describe('isNonceError', () => {
    it('should return true for nonce errors', () => {
      expect(isNonceError(new Error('nonce too low'))).toBe(true)
      expect(isNonceError(new Error('Nonce too high'))).toBe(true)
      expect(isNonceError(new Error('transaction already known'))).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isNonceError(new Error('timeout'))).toBe(false)
      expect(isNonceError(new Error('insufficient funds'))).toBe(false)
    })
  })

  describe('isGasError', () => {
    it('should return true for gas errors', () => {
      expect(isGasError(new Error('replacement transaction underpriced'))).toBe(true)
      expect(isGasError(new Error('intrinsic gas too low'))).toBe(true)
      expect(isGasError(new Error('max fee per gas less than block base fee'))).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isGasError(new Error('timeout'))).toBe(false)
      expect(isGasError(new Error('nonce too low'))).toBe(false)
    })
  })
})
