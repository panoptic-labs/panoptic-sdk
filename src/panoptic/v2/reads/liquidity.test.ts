/**
 * Tests for getPoolLiquidities.
 * @module v2/reads/liquidity.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getPoolLiquidities } from './liquidity'

// Common mock addresses
const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
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

describe('getPoolLiquidities', () => {
  it('should return ticks, liquidityNets, and _meta', async () => {
    const client = createMockClient()

    const mockTicks = [100n, 200n, 300n]
    const mockLiquidityNets = [1000n, -500n, 2000n]

    vi.mocked(client.readContract).mockResolvedValueOnce([mockTicks, mockLiquidityNets])

    const result = await getPoolLiquidities({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      startTick: 100n,
      nTicks: 3n,
    })

    expect(result.ticks).toEqual([100n, 200n, 300n])
    expect(result.liquidityNets).toEqual([1000n, -500n, 2000n])
    expect(result._meta.blockNumber).toBe(12345678n)
    expect(result._meta.blockTimestamp).toBe(1700000000n)
  })

  it('should pass correct args to readContract', async () => {
    const client = createMockClient()

    vi.mocked(client.readContract).mockResolvedValueOnce([[], []])

    await getPoolLiquidities({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      startTick: 500n,
      nTicks: 10n,
    })

    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: QUERY_ADDRESS,
        functionName: 'getTickNets',
        args: [POOL_ADDRESS, 500, 10n],
        blockNumber: MOCK_BLOCK.number,
      }),
    )
  })

  it('should use custom blockNumber parameter', async () => {
    const client = createMockClient()
    const customBlock = 99999n

    vi.mocked(client.readContract).mockResolvedValueOnce([[1n], [2n]])
    vi.mocked(client.getBlock).mockResolvedValueOnce({
      ...MOCK_BLOCK,
      number: customBlock,
    } as never)

    const result = await getPoolLiquidities({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      startTick: 0n,
      nTicks: 1n,
      blockNumber: customBlock,
    })

    expect(client.getBlockNumber).not.toHaveBeenCalled()
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        blockNumber: customBlock,
      }),
    )
    expect(result._meta.blockNumber).toBe(customBlock)
  })

  it('should handle nTicks=0 (empty arrays)', async () => {
    const client = createMockClient()

    vi.mocked(client.readContract).mockResolvedValueOnce([[], []])

    const result = await getPoolLiquidities({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      startTick: 0n,
      nTicks: 0n,
    })

    expect(result.ticks).toEqual([])
    expect(result.liquidityNets).toEqual([])
  })

  it('should handle negative startTick', async () => {
    const client = createMockClient()

    vi.mocked(client.readContract).mockResolvedValueOnce([
      [-100n, -99n],
      [500n, -200n],
    ])

    await getPoolLiquidities({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      startTick: -100n,
      nTicks: 2n,
    })

    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [POOL_ADDRESS, -100, 2n],
      }),
    )
  })

  it('should return mutable arrays (not readonly)', async () => {
    const client = createMockClient()

    const mockTicks = [10n, 20n]
    const mockLiquidityNets = [100n, 200n]

    vi.mocked(client.readContract).mockResolvedValueOnce([mockTicks, mockLiquidityNets])

    const result = await getPoolLiquidities({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      startTick: 10n,
      nTicks: 2n,
    })

    // Should be mutable - push should work without type error
    result.ticks.push(30n)
    result.liquidityNets.push(300n)

    expect(result.ticks).toHaveLength(3)
    expect(result.liquidityNets).toHaveLength(3)
  })
})
