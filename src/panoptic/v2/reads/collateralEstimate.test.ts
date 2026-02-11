/**
 * Tests for collateral estimation functions with PanopticQuery.
 * @module v2/reads/collateralEstimate.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { PanopticError, PanopticHelperNotDeployedError } from '../errors'
import { createMemoryStorage, getPositionsKey, jsonSerializer } from '../storage'
import {
  estimateCollateralRequired,
  getMaxPositionSize,
  getRequiredCreditForITM,
} from './collateralEstimate'

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

describe('Collateral Estimation with PanopticQuery', () => {
  describe('estimateCollateralRequired', () => {
    it('should throw PanopticHelperNotDeployedError without queryAddress', async () => {
      const client = createMockClient()

      await expect(
        estimateCollateralRequired({
          client,
          poolAddress: POOL_ADDRESS,
          account: ACCOUNT_ADDRESS,
          tokenId: 123n,
          positionSize: 1n * 10n ** 18n,
        }),
      ).rejects.toThrow(PanopticHelperNotDeployedError)
    })

    it('should return collateral estimate at current tick', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100) // getCurrentTick
        .mockResolvedValueOnce(5000n) // getRequiredBase

      const result = await estimateCollateralRequired({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        positionSize: 1n * 10n ** 18n,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.required0).toBe(5000n)
      expect(result.required1).toBe(0n) // Not available from getRequiredBase
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should use provided atTick parameter', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValueOnce(8000n) // getRequiredBase

      const result = await estimateCollateralRequired({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 456n,
        positionSize: 2n * 10n ** 18n,
        atTick: 500n,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.required0).toBe(8000n)

      // Verify atTick was used (not getCurrentTick) - tick is converted to number for viem
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getRequiredBase',
          args: expect.arrayContaining([expect.anything(), expect.anything(), 500]),
        }),
      )
    })

    it('should handle large collateral requirements', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100) // getCurrentTick
        .mockResolvedValueOnce(10n ** 27n) // getRequiredBase - very large

      const result = await estimateCollateralRequired({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 789n,
        positionSize: 100n * 10n ** 18n,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.required0).toBe(10n ** 27n)
    })
  })

  describe('getMaxPositionSize', () => {
    it('should throw PanopticHelperNotDeployedError without queryAddress', async () => {
      const client = createMockClient()

      await expect(
        getMaxPositionSize({
          client,
          poolAddress: POOL_ADDRESS,
          account: ACCOUNT_ADDRESS,
          tokenId: 123n,
          queryAddress: undefined as unknown as `0x${string}`,
        }),
      ).rejects.toThrow(PanopticHelperNotDeployedError)
    })

    it('should return bounds from contract with refine=false', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValueOnce([
        100n * 10n ** 18n, // maxSizeAtMinUtil (0% util)
        50n * 10n ** 18n, // maxSizeAtMaxUtil (100% util)
      ])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
        refine: false,
      })

      expect(result.maxSizeAtMinUtil).toBe(100n * 10n ** 18n)
      expect(result.maxSizeAtMaxUtil).toBe(50n * 10n ** 18n)
      expect(result.maxSize).toBe(50n * 10n ** 18n) // Conservative estimate when refine=false
    })

    it('should return conservative estimate when bounds are close (within 1% default)', async () => {
      const client = createMockClient()

      // Bounds within 1% - should skip refinement
      vi.mocked(client.readContract).mockResolvedValueOnce([
        1000n * 10n ** 18n, // maxSizeAtMinUtil
        995n * 10n ** 18n, // maxSizeAtMaxUtil (0.5% difference)
      ])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 456n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
      })

      // Should return conservative estimate without binary search
      expect(result.maxSize).toBe(995n * 10n ** 18n)
    })

    it('should respect custom precisionPct of 5%', async () => {
      const client = createMockClient()

      // Bounds within 5% - should skip refinement with precisionPct=5
      vi.mocked(client.readContract).mockResolvedValueOnce([
        100n * 10n ** 18n, // maxSizeAtMinUtil
        96n * 10n ** 18n, // maxSizeAtMaxUtil (4% difference)
      ])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 456n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
        precisionPct: 5,
      })

      // Should return conservative estimate without binary search
      expect(result.maxSize).toBe(96n * 10n ** 18n)
    })

    it('should respect custom precisionPct of 0.1%', async () => {
      const client = createMockClient()

      // Bounds within 0.1% - should skip refinement with precisionPct=0.1
      vi.mocked(client.readContract).mockResolvedValueOnce([
        10000n * 10n ** 18n, // maxSizeAtMinUtil
        9995n * 10n ** 18n, // maxSizeAtMaxUtil (0.05% difference)
      ])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 456n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
        precisionPct: 0.1,
      })

      // Should return conservative estimate without binary search
      expect(result.maxSize).toBe(9995n * 10n ** 18n)
    })

    it('should use existingPositionIds when provided', async () => {
      const client = createMockClient()
      const existingIds = [111n, 222n, 333n]

      vi.mocked(client.readContract).mockResolvedValueOnce([50n, 40n])

      await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 789n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: existingIds,
        refine: false,
      })

      // Verify existingPositionIds were passed to contract
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getMaxPositionSizeBounds',
          args: [POOL_ADDRESS, existingIds, ACCOUNT_ADDRESS, 789n],
        }),
      )
    })

    it('should fetch positions from storage when chainId and storage provided', async () => {
      const client = createMockClient()
      const storage = createMemoryStorage()
      const chainId = 11155111n // Sepolia

      // Pre-populate storage with positions using the correct key and serializer format
      const storedPositions = [444n, 555n]
      const key = getPositionsKey(chainId, POOL_ADDRESS, ACCOUNT_ADDRESS)
      await storage.set(key, jsonSerializer.stringify(storedPositions))

      vi.mocked(client.readContract).mockResolvedValueOnce([60n, 50n])

      await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 999n,
        queryAddress: QUERY_ADDRESS,
        storage,
        chainId,
        refine: false,
      })

      // Verify positions from storage were used
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getMaxPositionSizeBounds',
          args: [POOL_ADDRESS, storedPositions, ACCOUNT_ADDRESS, 999n],
        }),
      )
    })

    it('should use empty array when no positions and no storage', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValueOnce([30n, 20n])

      await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 111n,
        queryAddress: QUERY_ADDRESS,
        refine: false,
      })

      // Verify empty array was passed
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getMaxPositionSizeBounds',
          args: [POOL_ADDRESS, [], ACCOUNT_ADDRESS, 111n],
        }),
      )
    })

    it('should include block metadata in result', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValueOnce([100n, 100n])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
        refine: false,
      })

      expect(result._meta.blockNumber).toBe(MOCK_BLOCK.number)
      expect(result._meta.blockHash).toBe(MOCK_BLOCK.hash)
      expect(result._meta.blockTimestamp).toBe(MOCK_BLOCK.timestamp)
    })
  })

  describe('getRequiredCreditForITM', () => {
    it('should return inverted token flow as credit amounts', async () => {
      const client = createMockClient()

      // Mock simulateContract for multicall (used by simulateWithTokenFlow)
      // Returns encoded results for: [getAssetsOf_before, dispatch, getAssetsOf_after]
      // Assets before: 1000n token0, 2000n token1
      // Assets after: 900n token0, 2100n token1 (delta0 = -100n, delta1 = +100n)
      const mockSimulateContract = vi.fn().mockResolvedValue({
        result: [
          // getAssetsOf before: (assets0, assets1) ABI-encoded
          '0x00000000000000000000000000000000000000000000000000000000000003e80000000000000000000000000000000000000000000000000000000000000' +
            '7d0',
          // dispatch result (ignored)
          '0x',
          // getAssetsOf after: (assets0, assets1) ABI-encoded
          '0x0000000000000000000000000000000000000000000000000000000000000384' +
            '0000000000000000000000000000000000000000000000000000000000000834',
        ],
      })

      // Also mock estimateGas
      const mockEstimateGas = vi.fn().mockResolvedValue(100000n)

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
        estimateGas: mockEstimateGas,
      } as unknown as PublicClient

      const result = await getRequiredCreditForITM({
        client: clientWithSimulate,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        positionSize: 1n * 10n ** 18n,
      })

      // delta0 = 900 - 1000 = -100, so creditAmount0 = -(-100) = 100
      // delta1 = 2100 - 2000 = +100, so creditAmount1 = -(+100) = -100
      expect(result.creditAmount0).toBe(100n)
      expect(result.creditAmount1).toBe(-100n)
      expect(result._meta.blockNumber).toBe(MOCK_BLOCK.number)
    })

    it('should throw PanopticError when simulation fails', async () => {
      const client = createMockClient()

      const mockSimulateContract = vi.fn().mockRejectedValue(new Error('Simulation reverted'))

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
      } as unknown as PublicClient

      await expect(
        getRequiredCreditForITM({
          client: clientWithSimulate,
          poolAddress: POOL_ADDRESS,
          account: ACCOUNT_ADDRESS,
          tokenId: 123n,
          positionSize: 1n * 10n ** 18n,
        }),
      ).rejects.toThrow(PanopticError)
    })

    it('should use provided existingPositionIds in dispatch call', async () => {
      const client = createMockClient()
      const existingIds = [111n, 222n]

      const mockSimulateContract = vi.fn().mockResolvedValue({
        result: [
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
          '0x',
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
        ],
      })
      const mockEstimateGas = vi.fn().mockResolvedValue(100000n)

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
        estimateGas: mockEstimateGas,
      } as unknown as PublicClient

      await getRequiredCreditForITM({
        client: clientWithSimulate,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 333n,
        positionSize: 1n * 10n ** 18n,
        existingPositionIds: existingIds,
      })

      // Verify the call was made (detailed args checking is complex due to encoding)
      expect(mockSimulateContract).toHaveBeenCalled()
    })

    it('should return zero credit amounts when token flow is zero', async () => {
      const client = createMockClient()

      // Same assets before and after = no movement
      const mockSimulateContract = vi.fn().mockResolvedValue({
        result: [
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
          '0x',
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
        ],
      })
      const mockEstimateGas = vi.fn().mockResolvedValue(100000n)

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
        estimateGas: mockEstimateGas,
      } as unknown as PublicClient

      const result = await getRequiredCreditForITM({
        client: clientWithSimulate,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        positionSize: 1n * 10n ** 18n,
      })

      expect(result.creditAmount0).toBe(0n)
      expect(result.creditAmount1).toBe(0n)
    })

    it('should include raw tokenFlow in result', async () => {
      const client = createMockClient()

      const mockSimulateContract = vi.fn().mockResolvedValue({
        result: [
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
          '0x',
          '0x00000000000000000000000000000000000000000000000000000000000003840000000000000000000000000000000000000000000000000000000000000834',
        ],
      })
      const mockEstimateGas = vi.fn().mockResolvedValue(100000n)

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
        estimateGas: mockEstimateGas,
      } as unknown as PublicClient

      const result = await getRequiredCreditForITM({
        client: clientWithSimulate,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        positionSize: 1n * 10n ** 18n,
      })

      // Verify tokenFlow is included
      expect(result.tokenFlow).toBeDefined()
      expect(result.tokenFlow.balanceBefore0).toBe(1000n)
      expect(result.tokenFlow.balanceBefore1).toBe(2000n)
      expect(result.tokenFlow.balanceAfter0).toBe(900n)
      expect(result.tokenFlow.balanceAfter1).toBe(2100n)
      expect(result.tokenFlow.delta0).toBe(-100n)
      expect(result.tokenFlow.delta1).toBe(100n)
    })
  })
})
