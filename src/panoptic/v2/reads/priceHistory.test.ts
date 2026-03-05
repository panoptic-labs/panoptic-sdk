/**
 * Tests for priceHistory.
 * @module v2/reads/priceHistory.test
 */

import type { Address, PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getPriceHistory } from './priceHistory'

const UNI_POOL = '0x2222222222222222222222222222222222222222' as Address

const MOCK_BLOCK = {
  number: 1000n,
  hash: '0x' + 'aa'.repeat(32),
  timestamp: 1700000000n,
}

describe('getPriceHistory', () => {
  it('should return empty snapshots for empty blockNumbers', async () => {
    const client = {
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    } as unknown as PublicClient

    const result = await getPriceHistory({
      client,
      blockNumbers: [],
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    expect(result.snapshots).toEqual([])
    expect(result._meta.blockNumber).toBe(1000n)
  })

  it('should fetch V3 slot0 for each block', async () => {
    const client = {
      readContract: vi
        .fn()
        .mockResolvedValueOnce([100n, -50, 0, 0, 0, 0, true]) // block 500
        .mockResolvedValueOnce([200n, 100, 0, 0, 0, 0, true]), // block 600
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    } as unknown as PublicClient

    const result = await getPriceHistory({
      client,
      blockNumbers: [500n, 600n],
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    expect(result.snapshots).toHaveLength(2)
    expect(result.snapshots[0]).toEqual({
      blockNumber: 500n,
      tick: -50,
      sqrtPriceX96: 100n,
    })
    expect(result.snapshots[1]).toEqual({
      blockNumber: 600n,
      tick: 100,
      sqrtPriceX96: 200n,
    })
  })

  it('should fetch V4 getSlot0 for each block', async () => {
    const stateViewAddr = '0x4444444444444444444444444444444444444444' as Address
    const poolId = ('0x' + 'ff'.repeat(32)) as `0x${string}`

    const client = {
      readContract: vi.fn().mockResolvedValueOnce([300n, 42, 0, 0]),
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    } as unknown as PublicClient

    const result = await getPriceHistory({
      client,
      blockNumbers: [500n],
      poolConfig: { version: 'v4', stateViewAddress: stateViewAddr, poolId },
    })

    expect(result.snapshots).toHaveLength(1)
    expect(result.snapshots[0].tick).toBe(42)
    expect(result.snapshots[0].sqrtPriceX96).toBe(300n)

    // Verify it called StateView, not V3 pool
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: stateViewAddr,
        functionName: 'getSlot0',
        args: [poolId],
      }),
    )
  })

  it('should handle undefined (latest) block numbers', async () => {
    const client = {
      readContract: vi.fn().mockResolvedValueOnce([100n, 10, 0, 0, 0, 0, true]),
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    } as unknown as PublicClient

    const result = await getPriceHistory({
      client,
      blockNumbers: [undefined],
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    expect(result.snapshots[0].blockNumber).toBeUndefined()
    expect(result.snapshots[0].tick).toBe(10)
  })
})
