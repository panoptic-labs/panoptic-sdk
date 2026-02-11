/**
 * Tests for PanopticQuery utility functions.
 * @module v2/reads/queryUtils.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import {
  checkCollateralAcrossTicks,
  getPortfolioValue,
  optimizeTokenIdRiskPartners,
} from './queryUtils'

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

// Mock PublicClient factory
function createMockClient(): PublicClient {
  return {
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK.number),
    readContract: vi.fn(),
  } as unknown as PublicClient
}

describe('PanopticQuery Utility Functions', () => {
  describe('getPortfolioValue', () => {
    it('should return portfolio value at current tick', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100n) // getCurrentTick
        .mockResolvedValueOnce([1000n, 2000n]) // getPortfolioValue

      const result = await getPortfolioValue({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n, 456n],
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.value0).toBe(1000n)
      expect(result.value1).toBe(2000n)
      expect(result.atTick).toBe(100n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should use provided atTick parameter', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValueOnce([1500n, 2500n]) // getPortfolioValue (getCurrentTick skipped when atTick provided)

      const result = await getPortfolioValue({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        atTick: 200n,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.atTick).toBe(200n)
      expect(result.value0).toBe(1500n)
      expect(result.value1).toBe(2500n)
    })
  })

  describe('checkCollateralAcrossTicks', () => {
    it('should return collateral data across tick range', async () => {
      const client = createMockClient()

      // Mock checkCollateralListOutput return
      const mockBalanceRequired = Array(301).fill([1000n, 800n])
      const mockTickData = Array(301).fill(100n)
      const mockLiquidationPrices = [-200n, 300n] // int24 values as bigint

      vi.mocked(client.readContract).mockResolvedValueOnce([
        mockBalanceRequired,
        mockTickData,
        mockLiquidationPrices,
      ])

      const result = await checkCollateralAcrossTicks({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.dataPoints).toHaveLength(301)
      expect(result.dataPoints[0].balance).toBe(1000n)
      expect(result.dataPoints[0].required).toBe(800n)
      expect(result.liquidationPriceDown).toBe(-200n)
      expect(result.liquidationPriceUp).toBe(300n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should handle no liquidation prices', async () => {
      const client = createMockClient()

      const MIN_TICK = -887272n
      const MAX_TICK = 887272n

      const mockBalanceRequired = Array(301).fill([1000n, 500n])
      const mockTickData = Array(301).fill(0n)
      const mockLiquidationPrices = [MIN_TICK, MAX_TICK]

      vi.mocked(client.readContract).mockResolvedValueOnce([
        mockBalanceRequired,
        mockTickData,
        mockLiquidationPrices,
      ])

      const result = await checkCollateralAcrossTicks({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.liquidationPriceDown).toBeNull()
      expect(result.liquidationPriceUp).toBeNull()
    })
  })

  describe('optimizeTokenIdRiskPartners', () => {
    it('should return optimized tokenId', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100n) // getCurrentTick
        .mockResolvedValueOnce(999n) // optimizeRiskPartners

      const result = await optimizeTokenIdRiskPartners({
        client,
        poolAddress: POOL_ADDRESS,
        tokenId: 123n,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result).toBe(999n)
    })

    it('should use provided atTick parameter', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValueOnce(888n) // optimizeRiskPartners

      const result = await optimizeTokenIdRiskPartners({
        client,
        poolAddress: POOL_ADDRESS,
        tokenId: 123n,
        atTick: 200n,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result).toBe(888n)
    })
  })
})
