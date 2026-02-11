import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'

import { mutationEffects } from './mutationEffects'
import { queryKeys } from './queryKeys'

describe('queryKeys', () => {
  const chainId = 1n
  const poolAddress = '0x1234567890123456789012345678901234567890' as Address
  const account = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01' as Address
  const tokenId = 123456789012345678901234567890n
  const token = '0x1111111111111111111111111111111111111111' as Address
  const spender = '0x2222222222222222222222222222222222222222' as Address

  describe('all', () => {
    it('returns base key', () => {
      expect(queryKeys.all).toEqual(['panoptic-v2'])
    })
  })

  describe('pool', () => {
    it('includes base key and pool identifiers', () => {
      const key = queryKeys.pool(chainId, poolAddress)
      expect(key[0]).toBe('panoptic-v2')
      expect(key[1]).toBe('pool')
      expect(key[2]).toBe('1')
      expect(key[3]).toBe(poolAddress)
    })

    it('converts chainId to string', () => {
      const key = queryKeys.pool(42161n, poolAddress)
      expect(key[2]).toBe('42161')
    })
  })

  describe('position', () => {
    it('includes tokenId as string', () => {
      const key = queryKeys.position(chainId, poolAddress, tokenId)
      expect(key).toContain('position')
      expect(key[4]).toBe(tokenId.toString())
    })
  })

  describe('positions', () => {
    it('includes account', () => {
      const key = queryKeys.positions(chainId, poolAddress, account)
      expect(key).toContain('positions')
      expect(key[4]).toBe(account)
    })
  })

  describe('accountSummaryBasic', () => {
    it('includes all identifiers', () => {
      const key = queryKeys.accountSummaryBasic(chainId, poolAddress, account)
      expect(key).toContain('accountSummaryBasic')
      expect(key).toContain(poolAddress)
      expect(key).toContain(account)
    })
  })

  describe('accountSummaryRisk', () => {
    it('includes all identifiers', () => {
      const key = queryKeys.accountSummaryRisk(chainId, poolAddress, account)
      expect(key).toContain('accountSummaryRisk')
      expect(key).toContain(poolAddress)
      expect(key).toContain(account)
    })
  })

  describe('approval', () => {
    it('includes token, owner, and spender', () => {
      const key = queryKeys.approval(chainId, token, account, spender)
      expect(key).toContain('approval')
      expect(key).toContain(token)
      expect(key).toContain(account)
      expect(key).toContain(spender)
    })
  })

  describe('key uniqueness', () => {
    it('different chainIds produce different keys', () => {
      const key1 = queryKeys.pool(1n, poolAddress)
      const key2 = queryKeys.pool(42161n, poolAddress)
      expect(key1).not.toEqual(key2)
    })

    it('different pools produce different keys', () => {
      const key1 = queryKeys.pool(chainId, poolAddress)
      const key2 = queryKeys.pool(chainId, '0x9999999999999999999999999999999999999999' as Address)
      expect(key1).not.toEqual(key2)
    })

    it('different query types produce different keys', () => {
      const poolKey = queryKeys.pool(chainId, poolAddress)
      const utilizationKey = queryKeys.utilization(chainId, poolAddress)
      expect(poolKey).not.toEqual(utilizationKey)
    })
  })

  describe('key format', () => {
    it('all keys are readonly arrays', () => {
      const key = queryKeys.pool(chainId, poolAddress)
      // TypeScript enforces this at compile time with `as const`
      expect(Array.isArray(key)).toBe(true)
    })

    it('all keys start with panoptic-v2', () => {
      const keys = [
        queryKeys.pool(chainId, poolAddress),
        queryKeys.utilization(chainId, poolAddress),
        queryKeys.oracle(chainId, poolAddress),
        queryKeys.positions(chainId, poolAddress, account),
        queryKeys.accountSummaryBasic(chainId, poolAddress, account),
        queryKeys.accountSummaryRisk(chainId, poolAddress, account),
      ]

      for (const key of keys) {
        expect(key[0]).toBe('panoptic-v2')
      }
    })
  })
})

describe('mutationEffects', () => {
  const chainId = 1n
  const poolAddress = '0x1234567890123456789012345678901234567890' as Address
  const account = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01' as Address
  const tokenId = 123456789012345678901234567890n
  const token = '0x1111111111111111111111111111111111111111' as Address
  const spender = '0x2222222222222222222222222222222222222222' as Address

  describe('openPosition', () => {
    it('returns keys for position-related queries', () => {
      const keys = mutationEffects.openPosition({ chainId, poolAddress, account })

      // Should include position-related keys
      expect(keys.some((k) => k.includes('positions'))).toBe(true)
      expect(keys.some((k) => k.includes('accountCollateral'))).toBe(true)
      expect(keys.some((k) => k.includes('accountSummaryBasic'))).toBe(true)
      expect(keys.some((k) => k.includes('accountSummaryRisk'))).toBe(true)
      expect(keys.some((k) => k.includes('chunkSpreads'))).toBe(true)
    })

    it('returns multiple keys for cache invalidation', () => {
      const keys = mutationEffects.openPosition({ chainId, poolAddress, account })
      expect(keys.length).toBeGreaterThan(1)
    })
  })

  describe('closePosition', () => {
    it('includes closed positions and trade history', () => {
      const keys = mutationEffects.closePosition({ chainId, poolAddress, account })

      expect(keys.some((k) => k.includes('closedPositions'))).toBe(true)
      expect(keys.some((k) => k.includes('tradeHistory'))).toBe(true)
      expect(keys.some((k) => k.includes('realizedPnL'))).toBe(true)
    })

    it('includes specific position key when tokenId provided', () => {
      const keys = mutationEffects.closePosition({ chainId, poolAddress, account, tokenId })

      expect(keys.some((k) => k.includes('position') && k.includes(tokenId.toString()))).toBe(true)
    })

    it('does not include specific position key when tokenId not provided', () => {
      const keys = mutationEffects.closePosition({ chainId, poolAddress, account })

      // Check that no key contains the tokenId
      expect(keys.every((k) => !k.includes(tokenId.toString()))).toBe(true)
    })
  })

  describe('deposit/withdraw', () => {
    it('deposit invalidates collateral-related queries', () => {
      const keys = mutationEffects.deposit({ chainId, poolAddress, account })

      expect(keys.some((k) => k.includes('accountCollateral'))).toBe(true)
      expect(keys.some((k) => k.includes('isLiquidatable'))).toBe(true)
    })

    it('withdraw returns same keys as deposit', () => {
      const depositKeys = mutationEffects.deposit({ chainId, poolAddress, account })
      const withdrawKeys = mutationEffects.withdraw({ chainId, poolAddress, account })

      expect(withdrawKeys).toEqual(depositKeys)
    })

    it('mint returns same keys as deposit', () => {
      const depositKeys = mutationEffects.deposit({ chainId, poolAddress, account })
      const mintKeys = mutationEffects.mint({ chainId, poolAddress, account })

      expect(mintKeys).toEqual(depositKeys)
    })

    it('redeem returns same keys as withdraw', () => {
      const withdrawKeys = mutationEffects.withdraw({ chainId, poolAddress, account })
      const redeemKeys = mutationEffects.redeem({ chainId, poolAddress, account })

      expect(redeemKeys).toEqual(withdrawKeys)
    })
  })

  describe('approve', () => {
    it('returns only approval key', () => {
      const keys = mutationEffects.approve(chainId, token, account, spender)

      expect(keys.length).toBe(1)
      expect(keys[0]).toContain('approval')
    })
  })

  describe('pokeOracle', () => {
    it('invalidates oracle and safe mode', () => {
      const keys = mutationEffects.pokeOracle({ chainId, poolAddress })

      expect(keys.some((k) => k.includes('oracle'))).toBe(true)
      expect(keys.some((k) => k.includes('safeMode'))).toBe(true)
    })
  })

  describe('liquidate', () => {
    it('invalidates all position and collateral data for liquidated account', () => {
      const keys = mutationEffects.liquidate({ chainId, poolAddress, account })

      expect(keys.some((k) => k.includes('positions'))).toBe(true)
      expect(keys.some((k) => k.includes('accountCollateral'))).toBe(true)
      expect(keys.some((k) => k.includes('isLiquidatable'))).toBe(true)
      expect(keys.some((k) => k.includes('closedPositions'))).toBe(true)
    })
  })

  describe('forceExercise', () => {
    it('invalidates pool and collateral data', () => {
      const keys = mutationEffects.forceExercise({ chainId, poolAddress, account })

      expect(keys.some((k) => k.includes('pool'))).toBe(true)
      expect(keys.some((k) => k.includes('accountCollateral'))).toBe(true)
    })
  })

  describe('settleAccumulatedPremia', () => {
    it('invalidates collateral data', () => {
      const keys = mutationEffects.settleAccumulatedPremia({ chainId, poolAddress, account })

      expect(keys.some((k) => k.includes('accountCollateral'))).toBe(true)
      expect(keys.some((k) => k.includes('accountSummaryBasic'))).toBe(true)
      expect(keys.some((k) => k.includes('accountSummaryRisk'))).toBe(true)
    })

    it('includes position key when tokenId provided', () => {
      const keys = mutationEffects.settleAccumulatedPremia({
        chainId,
        poolAddress,
        account,
        tokenId,
      })

      expect(keys.some((k) => k.includes('position') && k.includes(tokenId.toString()))).toBe(true)
    })
  })
})
