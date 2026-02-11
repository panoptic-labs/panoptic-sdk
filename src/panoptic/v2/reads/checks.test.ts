/**
 * Tests for check functions with PanopticQuery.
 * @module v2/reads/checks.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { PanopticHelperNotDeployedError } from '../errors'
import { isLiquidatable } from './checks'

// Common mock addresses
const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const ACCOUNT_ADDRESS = '0x2222222222222222222222222222222222222222' as const
const QUERY_ADDRESS = '0x3333333333333333333333333333333333333333' as const

// Common mock block
const MOCK_BLOCK = {
  number: 12345678n,
  hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
  timestamp: 1700000000n,
}

/**
 * Pack two unsigned 128-bit values into LeftRightUnsigned format.
 * right (token0) = lower 128 bits, left (token1) = upper 128 bits
 */
function packLeftRightUnsigned(right: bigint, left: bigint): bigint {
  return right + (left << 128n)
}

// Mock PublicClient factory
function createMockClient(): PublicClient {
  return {
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK.number),
    readContract: vi.fn(),
  } as unknown as PublicClient
}

describe('Liquidation Checks with PanopticQuery', () => {
  describe('isLiquidatable', () => {
    it('should throw PanopticHelperNotDeployedError with invalid queryAddress', async () => {
      const client = createMockClient()

      await expect(
        isLiquidatable({
          client,
          poolAddress: POOL_ADDRESS,
          account: ACCOUNT_ADDRESS,
          tokenIds: [123n],
          queryAddress: '' as `0x${string}`,
        }),
      ).rejects.toThrow(PanopticHelperNotDeployedError)
    })

    it('should return isLiquidatable=true when margin shortfall exists', async () => {
      const client = createMockClient()

      // Mock collateral balance: 100 token0, 200 token1
      const collateralBalance = packLeftRightUnsigned(100n, 200n)
      // Mock required collateral: 150 token0, 180 token1 (shortfall in token0)
      const requiredCollateral = packLeftRightUnsigned(150n, 180n)

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100) // getCurrentTick
        .mockResolvedValueOnce([collateralBalance, requiredCollateral]) // checkCollateral

      const result = await isLiquidatable({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n, 456n],
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.isLiquidatable).toBe(true)
      expect(result.currentMargin0).toBe(100n)
      expect(result.currentMargin1).toBe(200n)
      expect(result.requiredMargin0).toBe(150n)
      expect(result.requiredMargin1).toBe(180n)
      expect(result.marginShortfall0).toBe(50n) // 150 - 100 = 50 shortfall
      expect(result.marginShortfall1).toBe(-20n) // 180 - 200 = -20 excess
      expect(result.atTick).toBe(100n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should return isLiquidatable=false when no shortfall', async () => {
      const client = createMockClient()

      // Mock collateral balance: 200 token0, 300 token1
      const collateralBalance = packLeftRightUnsigned(200n, 300n)
      // Mock required collateral: 100 token0, 150 token1 (excess in both)
      const requiredCollateral = packLeftRightUnsigned(100n, 150n)

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100) // getCurrentTick
        .mockResolvedValueOnce([collateralBalance, requiredCollateral]) // checkCollateral

      const result = await isLiquidatable({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.isLiquidatable).toBe(false)
      expect(result.currentMargin0).toBe(200n)
      expect(result.currentMargin1).toBe(300n)
      expect(result.requiredMargin0).toBe(100n)
      expect(result.requiredMargin1).toBe(150n)
      expect(result.marginShortfall0).toBe(-100n) // excess
      expect(result.marginShortfall1).toBe(-150n) // excess
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should use provided atTick parameter', async () => {
      const client = createMockClient()

      const collateralBalance = packLeftRightUnsigned(100n, 100n)
      const requiredCollateral = packLeftRightUnsigned(50n, 50n)

      vi.mocked(client.readContract).mockResolvedValueOnce([collateralBalance, requiredCollateral])

      const result = await isLiquidatable({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        atTick: 500n,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.isLiquidatable).toBe(false)
      expect(result.atTick).toBe(500n)

      // Verify atTick was used (not getCurrentTick) - tick is converted to number for viem
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'checkCollateral',
          args: expect.arrayContaining([
            expect.anything(),
            expect.anything(),
            expect.anything(),
            500,
          ]),
        }),
      )
    })

    it('should detect liquidatable when only token1 has shortfall', async () => {
      const client = createMockClient()

      // Excess in token0, shortfall in token1
      const collateralBalance = packLeftRightUnsigned(1000n, 50n)
      const requiredCollateral = packLeftRightUnsigned(500n, 100n)

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(0) // getCurrentTick
        .mockResolvedValueOnce([collateralBalance, requiredCollateral])

      const result = await isLiquidatable({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.isLiquidatable).toBe(true)
      expect(result.marginShortfall0).toBe(-500n) // excess
      expect(result.marginShortfall1).toBe(50n) // shortfall
    })

    it('should handle zero margin case', async () => {
      const client = createMockClient()

      // Zero collateral, some required
      const collateralBalance = packLeftRightUnsigned(0n, 0n)
      const requiredCollateral = packLeftRightUnsigned(100n, 100n)

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(0) // getCurrentTick
        .mockResolvedValueOnce([collateralBalance, requiredCollateral])

      const result = await isLiquidatable({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.isLiquidatable).toBe(true)
      expect(result.currentMargin0).toBe(0n)
      expect(result.currentMargin1).toBe(0n)
      expect(result.marginShortfall0).toBe(100n)
      expect(result.marginShortfall1).toBe(100n)
    })

    it('should handle no positions (zero required margin)', async () => {
      const client = createMockClient()

      // Some collateral, zero required (no positions)
      const collateralBalance = packLeftRightUnsigned(1000n, 2000n)
      const requiredCollateral = packLeftRightUnsigned(0n, 0n)

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(0) // getCurrentTick
        .mockResolvedValueOnce([collateralBalance, requiredCollateral])

      const result = await isLiquidatable({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [],
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.isLiquidatable).toBe(false)
      expect(result.marginShortfall0).toBe(-1000n) // all excess
      expect(result.marginShortfall1).toBe(-2000n) // all excess
    })
  })
})
