/**
 * Tests for simulation functions.
 * @module v2/simulations/simulations.test
 */

import type { PublicClient } from 'viem'
import { encodeAbiParameters } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import {
  simulateClosePosition,
  simulateDeposit,
  simulateOpenPosition,
  simulateWithdraw,
} from './index'

// Mock addresses
const MOCK_TOKEN0 = '0x4444444444444444444444444444444444444444' as const
const MOCK_TOKEN1 = '0x5555555555555555555555555555555555555555' as const

/**
 * Encode a mock getAssetsOf return value (uint256, uint256).
 */
function encodeAssetsOf(assets0: bigint, assets1: bigint): `0x${string}` {
  return encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [assets0, assets1])
}

/**
 * Create a mock simulateContract that handles the multicall pattern
 * used by simulateWithTokenFlow: [getAssetsOf, dispatch, getAssetsOf].
 */
function createMulticallSimulateContract(
  assetsBefore0: bigint,
  assetsBefore1: bigint,
  assetsAfter0: bigint,
  assetsAfter1: bigint,
) {
  return vi.fn().mockResolvedValue({
    result: [
      encodeAssetsOf(assetsBefore0, assetsBefore1),
      '0x' as `0x${string}`, // dispatch result (unused)
      encodeAssetsOf(assetsAfter0, assetsAfter1),
    ],
    request: {},
  })
}

// Mock clients
function createMockPublicClient(overrides: Partial<PublicClient> = {}): PublicClient {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(12345678n),
    getBlock: vi.fn().mockResolvedValue({
      number: 12345678n,
      hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
      timestamp: 1700000000n,
    }),
    simulateContract: createMulticallSimulateContract(
      1000n,
      2000n, // before
      900n,
      1800n, // after (user deposited 100 token0, 200 token1)
    ),
    estimateContractGas: vi.fn().mockResolvedValue(200000n),
    estimateGas: vi.fn().mockResolvedValue(200000n),
    // Default multicall for pool tokens
    multicall: vi.fn().mockResolvedValue([
      MOCK_TOKEN0, // collateralToken0
      MOCK_TOKEN1, // collateralToken1
      MOCK_TOKEN0, // token0 (underlying of CT0)
      MOCK_TOKEN1, // token1 (underlying of CT1)
    ]),
    ...overrides,
  } as unknown as PublicClient
}

const MOCK_POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const MOCK_ACCOUNT = '0x2222222222222222222222222222222222222222' as const
const MOCK_COLLATERAL_TRACKER = '0x3333333333333333333333333333333333333333' as const

describe('simulateOpenPosition', () => {
  it('should return success result with token flow data', async () => {
    const client = createMockPublicClient()

    const result = await simulateOpenPosition({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      account: MOCK_ACCOUNT,
      existingPositionIds: [],
      tokenId: 123456789n,
      positionSize: 1n,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.position.tokenId).toBe(123456789n)
      expect(result.data.position.positionSize).toBe(1n)
      expect(result._meta.blockNumber).toBe(12345678n)
      // Token flow is now populated via simulateWithTokenFlow
      expect(result.tokenFlow).toBeDefined()
      // amount0Required = -(assetsAfter0 - assetsBefore0) = -(900 - 1000) = 100
      expect(result.data.amount0Required).toBe(100n)
      expect(result.data.amount1Required).toBe(200n)
      // Post-collateral values from token flow
      expect(result.data.postCollateral0).toBe(900n)
      expect(result.data.postCollateral1).toBe(1800n)
    }
  })

  it('should return failure result on simulation error', async () => {
    const client = createMockPublicClient({
      simulateContract: vi.fn().mockRejectedValue(new Error('Simulation failed')),
    })

    const result = await simulateOpenPosition({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      account: MOCK_ACCOUNT,
      existingPositionIds: [],
      tokenId: 123456789n,
      positionSize: 1n,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toContain('Simulation failed')
    }
  })

  it('should use provided block number', async () => {
    const client = createMockPublicClient({
      getBlock: vi.fn().mockResolvedValue({
        number: 10000000n,
        hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as const,
        timestamp: 1600000000n,
      }),
    })

    const result = await simulateOpenPosition({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      account: MOCK_ACCOUNT,
      existingPositionIds: [],
      tokenId: 123456789n,
      positionSize: 1n,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
      blockNumber: 10000000n,
    })

    expect(result.success).toBe(true)
    expect(result._meta.blockNumber).toBe(10000000n)
    expect(vi.mocked(client.simulateContract)).toHaveBeenCalledWith(
      expect.objectContaining({
        blockNumber: 10000000n,
      }),
    )
    expect(vi.mocked(client.estimateGas)).toHaveBeenCalledWith(
      expect.objectContaining({
        blockNumber: 10000000n,
      }),
    )
  })

  it('should decode position legs from tokenId', async () => {
    const client = createMockPublicClient()

    const result = await simulateOpenPosition({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      account: MOCK_ACCOUNT,
      existingPositionIds: [],
      tokenId: 123456789n,
      positionSize: 1n,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      // Legs are decoded from tokenId (may be empty for simple tokenIds)
      expect(Array.isArray(result.data.position.legs)).toBe(true)
    }
  })
})

describe('simulateClosePosition', () => {
  it('should return success result with token flow data', async () => {
    // For close: user receives collateral back (assetsAfter > assetsBefore)
    const client = createMockPublicClient({
      simulateContract: createMulticallSimulateContract(
        1000n,
        2000n, // before
        1100n,
        2200n, // after (user received 100 token0, 200 token1)
      ),
    })

    const result = await simulateClosePosition({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      account: MOCK_ACCOUNT,
      positionIdList: [123456789n],
      tokenId: 123456789n,
      positionSize: 1n,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result._meta.blockNumber).toBe(12345678n)
      // Token flow is now populated
      expect(result.tokenFlow).toBeDefined()
      // amount0Received = delta0 = assetsAfter0 - assetsBefore0 = 100
      expect(result.data.amount0Received).toBe(100n)
      expect(result.data.amount1Received).toBe(200n)
      // Post-collateral values
      expect(result.data.postCollateral0).toBe(1100n)
      expect(result.data.postCollateral1).toBe(2200n)
    }
  })

  it('should return failure result on simulation error', async () => {
    const client = createMockPublicClient({
      simulateContract: vi.fn().mockRejectedValue(new Error('Position not owned')),
    })

    const result = await simulateClosePosition({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      account: MOCK_ACCOUNT,
      positionIdList: [123456789n],
      tokenId: 123456789n,
      positionSize: 1n,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toContain('Position not owned')
    }
  })

  it('should use provided block number', async () => {
    const client = createMockPublicClient({
      getBlock: vi.fn().mockResolvedValue({
        number: 10000000n,
        hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as const,
        timestamp: 1600000000n,
      }),
    })

    const result = await simulateClosePosition({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      account: MOCK_ACCOUNT,
      positionIdList: [123456789n],
      tokenId: 123456789n,
      positionSize: 1n,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
      blockNumber: 10000000n,
    })

    expect(result.success).toBe(true)
    expect(result._meta.blockNumber).toBe(10000000n)
    expect(vi.mocked(client.simulateContract)).toHaveBeenCalledWith(
      expect.objectContaining({
        blockNumber: 10000000n,
      }),
    )
    expect(vi.mocked(client.estimateGas)).toHaveBeenCalledWith(
      expect.objectContaining({
        blockNumber: 10000000n,
      }),
    )
  })
})

describe('simulateDeposit', () => {
  it('should return success result with deposit preview', async () => {
    const client = createMockPublicClient({
      multicall: vi.fn().mockResolvedValue([
        100n, // currentShares
        1000n, // currentAssets
        50n, // previewedShares
        MOCK_TOKEN0, // underlying asset
      ]),
    })

    const result = await simulateDeposit({
      client,
      collateralTrackerAddress: MOCK_COLLATERAL_TRACKER,
      account: MOCK_ACCOUNT,
      assets: 500n,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sharesMinted).toBe(50n)
      expect(result.data.postAssets).toBe(1500n) // 1000 + 500
      expect(result.data.postShares).toBe(150n) // 100 + 50
      // Token flow not returned from deposit simulation (deterministic from previewDeposit)
      expect(result.tokenFlow).toBeUndefined()
    }
  })

  it('should return failure on simulation error', async () => {
    const client = createMockPublicClient({
      multicall: vi.fn().mockResolvedValue([100n, 1000n, 50n, MOCK_TOKEN0]),
      estimateContractGas: vi.fn().mockRejectedValue(new Error('Insufficient balance')),
    })

    const result = await simulateDeposit({
      client,
      collateralTrackerAddress: MOCK_COLLATERAL_TRACKER,
      account: MOCK_ACCOUNT,
      assets: 500n,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toContain('Insufficient balance')
    }
  })
})

describe('simulateWithdraw', () => {
  it('should return success result when withdrawal is possible', async () => {
    const client = createMockPublicClient({
      multicall: vi.fn().mockResolvedValue([
        100n, // currentShares
        1000n, // currentAssets
        800n, // maxWithdrawable
        50n, // previewedShares
      ]),
    })

    const result = await simulateWithdraw({
      client,
      collateralTrackerAddress: MOCK_COLLATERAL_TRACKER,
      account: MOCK_ACCOUNT,
      assets: 500n,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.canWithdraw).toBe(true)
      expect(result.data.sharesBurned).toBe(50n)
      expect(result.data.assetsReceived).toBe(500n)
      expect(result.data.postAssets).toBe(500n) // 1000 - 500
      expect(result.data.postShares).toBe(50n) // 100 - 50
      // Token flow not returned from withdraw simulation (deterministic from previewWithdraw)
      expect(result.tokenFlow).toBeUndefined()
    }
  })

  it('should indicate cannot withdraw when exceeds max', async () => {
    const client = createMockPublicClient({
      multicall: vi.fn().mockResolvedValue([
        100n, // currentShares
        1000n, // currentAssets
        200n, // maxWithdrawable (less than requested)
        50n, // previewedShares
      ]),
    })

    const result = await simulateWithdraw({
      client,
      collateralTrackerAddress: MOCK_COLLATERAL_TRACKER,
      account: MOCK_ACCOUNT,
      assets: 500n,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.canWithdraw).toBe(false)
      expect(result.data.reason).toContain('max withdrawable is 200')
      expect(result.gasEstimate).toBe(0n)
      // Token flow not returned when withdrawal not possible
      expect(result.tokenFlow).toBeUndefined()
    }
  })
})
