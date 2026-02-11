/**
 * Tests for getMarginBuffer.
 * @module v2/reads/margin.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { PanopticHelperNotDeployedError } from '../errors'
import { getMarginBuffer } from './margin'

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

// Sentinel ticks (same as PanopticQuery)
const MIN_TICK = -887272
const MAX_TICK = 887272

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

describe('getMarginBuffer', () => {
  it('should throw PanopticHelperNotDeployedError without queryAddress', async () => {
    const client = createMockClient()

    await expect(
      getMarginBuffer({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        queryAddress: undefined as unknown as `0x${string}`,
      }),
    ).rejects.toThrow(PanopticHelperNotDeployedError)
  })

  it('should return positive buffers for a safe account', async () => {
    const client = createMockClient()

    // Mock collateral balance: 200 token0, 300 token1
    const collateralBalance = packLeftRightUnsigned(200n, 300n)
    // Mock required collateral: 100 token0, 150 token1
    const requiredCollateral = packLeftRightUnsigned(100n, 150n)

    vi.mocked(client.readContract)
      .mockResolvedValueOnce(100) // getCurrentTick → 100
      .mockResolvedValueOnce([collateralBalance, requiredCollateral]) // checkCollateral
      .mockResolvedValueOnce([MIN_TICK, MAX_TICK]) // getLiquidationPrices (no liq boundaries)

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
    })

    expect(result.buffer0).toBe(100n) // 200 - 100
    expect(result.buffer1).toBe(150n) // 300 - 150
    expect(result.bufferPercent0).toBe(10000n) // 100/100 * 10000 = 10000 bps = 100%
    expect(result.bufferPercent1).toBe(10000n) // 150/150 * 10000 = 10000 bps = 100%
    expect(result.currentMargin0).toBe(200n)
    expect(result.currentMargin1).toBe(300n)
    expect(result.requiredMargin0).toBe(100n)
    expect(result.requiredMargin1).toBe(150n)
    expect(result.currentTick).toBe(100n)
    expect(result.liquidationDistance).toBeNull()
    expect(result.lowerLiquidationTick).toBeNull()
    expect(result.upperLiquidationTick).toBeNull()
    expect(result._meta.blockNumber).toBe(12345678n)
  })

  it('should return negative buffer when token0 has shortfall', async () => {
    const client = createMockClient()

    // Mock collateral balance: 50 token0, 300 token1
    const collateralBalance = packLeftRightUnsigned(50n, 300n)
    // Mock required collateral: 200 token0, 100 token1
    const requiredCollateral = packLeftRightUnsigned(200n, 100n)

    vi.mocked(client.readContract)
      .mockResolvedValueOnce(0) // getCurrentTick
      .mockResolvedValueOnce([collateralBalance, requiredCollateral]) // checkCollateral
      .mockResolvedValueOnce([-500, 500]) // getLiquidationPrices

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
    })

    expect(result.buffer0).toBe(-150n) // 50 - 200 = -150
    expect(result.buffer1).toBe(200n) // 300 - 100 = 200
    expect(result.bufferPercent0).toBe(-7500n) // -150/200 * 10000 = -7500 bps
    expect(result.bufferPercent1).toBe(20000n) // 200/100 * 10000 = 20000 bps
  })

  it('should return null bufferPercent when no margin required (no positions)', async () => {
    const client = createMockClient()

    // Some collateral, zero required
    const collateralBalance = packLeftRightUnsigned(1000n, 2000n)
    const requiredCollateral = packLeftRightUnsigned(0n, 0n)

    vi.mocked(client.readContract)
      .mockResolvedValueOnce(0) // getCurrentTick
      .mockResolvedValueOnce([collateralBalance, requiredCollateral]) // checkCollateral
      .mockResolvedValueOnce([MIN_TICK, MAX_TICK]) // getLiquidationPrices (no boundaries)

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [],
      queryAddress: QUERY_ADDRESS,
    })

    expect(result.buffer0).toBe(1000n)
    expect(result.buffer1).toBe(2000n)
    expect(result.bufferPercent0).toBeNull()
    expect(result.bufferPercent1).toBeNull()
    expect(result.liquidationDistance).toBeNull()
  })

  it('should pick lower distance when only lower liquidation boundary exists', async () => {
    const client = createMockClient()

    const collateralBalance = packLeftRightUnsigned(100n, 100n)
    const requiredCollateral = packLeftRightUnsigned(50n, 50n)

    // Current tick = 1000, lower liq tick = 800, upper = MAX_TICK (no upper boundary)
    vi.mocked(client.readContract)
      .mockResolvedValueOnce(1000) // getCurrentTick
      .mockResolvedValueOnce([collateralBalance, requiredCollateral]) // checkCollateral
      .mockResolvedValueOnce([800, MAX_TICK]) // getLiquidationPrices

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
    })

    expect(result.lowerLiquidationTick).toBe(800n)
    expect(result.upperLiquidationTick).toBeNull()
    expect(result.liquidationDistance).toBe(200n) // 1000 - 800
    expect(result.currentTick).toBe(1000n)
  })

  it('should pick upper distance when only upper liquidation boundary exists', async () => {
    const client = createMockClient()

    const collateralBalance = packLeftRightUnsigned(100n, 100n)
    const requiredCollateral = packLeftRightUnsigned(50n, 50n)

    // Current tick = 1000, lower = MIN_TICK (no lower boundary), upper liq tick = 1500
    vi.mocked(client.readContract)
      .mockResolvedValueOnce(1000) // getCurrentTick
      .mockResolvedValueOnce([collateralBalance, requiredCollateral]) // checkCollateral
      .mockResolvedValueOnce([MIN_TICK, 1500]) // getLiquidationPrices

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
    })

    expect(result.lowerLiquidationTick).toBeNull()
    expect(result.upperLiquidationTick).toBe(1500n)
    expect(result.liquidationDistance).toBe(500n) // 1500 - 1000
  })

  it('should pick nearest boundary when both liquidation boundaries exist', async () => {
    const client = createMockClient()

    const collateralBalance = packLeftRightUnsigned(100n, 100n)
    const requiredCollateral = packLeftRightUnsigned(80n, 80n)

    // Current tick = 1000, lower = 700, upper = 1200
    // Distance to lower = 300, distance to upper = 200 → nearest = 200
    vi.mocked(client.readContract)
      .mockResolvedValueOnce(1000) // getCurrentTick
      .mockResolvedValueOnce([collateralBalance, requiredCollateral]) // checkCollateral
      .mockResolvedValueOnce([700, 1200]) // getLiquidationPrices

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n, 456n],
      queryAddress: QUERY_ADDRESS,
    })

    expect(result.lowerLiquidationTick).toBe(700n)
    expect(result.upperLiquidationTick).toBe(1200n)
    expect(result.liquidationDistance).toBe(200n) // min(300, 200)
    expect(result.currentTick).toBe(1000n)
  })

  it('should pass custom blockNumber to all RPC calls', async () => {
    const client = createMockClient()
    const customBlock = 99999n

    const collateralBalance = packLeftRightUnsigned(100n, 100n)
    const requiredCollateral = packLeftRightUnsigned(50n, 50n)

    vi.mocked(client.readContract)
      .mockResolvedValueOnce(0) // getCurrentTick
      .mockResolvedValueOnce([collateralBalance, requiredCollateral]) // checkCollateral
      .mockResolvedValueOnce([MIN_TICK, MAX_TICK]) // getLiquidationPrices

    await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
      blockNumber: customBlock,
    })

    // All readContract calls should use the custom block number
    const calls = vi.mocked(client.readContract).mock.calls
    expect(calls).toHaveLength(3)

    // getCurrentTick
    expect(calls[0][0]).toMatchObject({
      functionName: 'getCurrentTick',
      blockNumber: customBlock,
    })

    // checkCollateral
    expect(calls[1][0]).toMatchObject({
      functionName: 'checkCollateral',
      blockNumber: customBlock,
    })

    // getLiquidationPrices
    expect(calls[2][0]).toMatchObject({
      functionName: 'getLiquidationPrices',
      blockNumber: customBlock,
    })

    // getBlockNumber should NOT have been called (blockNumber was provided)
    expect(client.getBlockNumber).not.toHaveBeenCalled()
  })
})
