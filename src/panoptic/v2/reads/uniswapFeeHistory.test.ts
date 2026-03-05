/**
 * Tests for uniswapFeeHistory.
 * @module v2/reads/uniswapFeeHistory.test
 */

import type { Address, PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import type { StreamiaLeg } from './streamiaHistory'
import { getUniswapFeeHistory } from './uniswapFeeHistory'

const UNI_POOL = '0x2222222222222222222222222222222222222222' as Address

const MOCK_BLOCK = {
  number: 1000n,
  hash: '0x' + 'aa'.repeat(32),
  timestamp: 1700000000n,
}

describe('getUniswapFeeHistory', () => {
  it('should return empty snapshots for empty blockNumbers', async () => {
    const client = {
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    } as unknown as PublicClient

    const result = await getUniswapFeeHistory({
      client,
      blockNumbers: [],
      legs: [{ lowerTick: 100, upperTick: 200, liquidity: 1000n }],
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    expect(result.snapshots).toEqual([])
  })

  it('should return empty snapshots for empty legs', async () => {
    const client = {
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    } as unknown as PublicClient

    const result = await getUniswapFeeHistory({
      client,
      blockNumbers: [500n],
      legs: [],
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    expect(result.snapshots).toEqual([])
  })

  it('should compute fee deltas from first block', async () => {
    const legs: StreamiaLeg[] = [
      { lowerTick: 100, upperTick: 200, liquidity: 1000n * (1n << 128n) },
    ]

    const makeMulticallResult = (globalFee0: bigint, globalFee1: bigint) => [
      [0n, 150, 0, 0, 0, 0, true], // slot0
      globalFee0,
      globalFee1,
      [0n, 0n, 10n, 10n, 0n, 0n, 0, false], // tick 100
      [0n, 0n, 5n, 5n, 0n, 0n, 0, false], // tick 200
    ]

    let multicallIdx = 0
    const multicallResults = [makeMulticallResult(100n, 100n), makeMulticallResult(200n, 200n)]

    const client = {
      multicall: vi.fn().mockImplementation(() => {
        return Promise.resolve(multicallResults[multicallIdx++])
      }),
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    } as unknown as PublicClient

    const result = await getUniswapFeeHistory({
      client,
      blockNumbers: [500n, 600n],
      legs,
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    expect(result.snapshots).toHaveLength(2)

    // First block = baseline, delta = 0
    expect(result.snapshots[0].fees.token0).toBe(0n)
    expect(result.snapshots[0].fees.token1).toBe(0n)

    // Second block: delta = 100000
    expect(result.snapshots[1].fees.token0).toBe(100000n)
    expect(result.snapshots[1].fees.token1).toBe(100000n)
  })

  it('should work without a Panoptic pool', async () => {
    // This is the key use case — pure Uniswap fee tracking
    const legs: StreamiaLeg[] = [
      { lowerTick: -100, upperTick: 100, liquidity: 500n * (1n << 128n) },
    ]

    const client = {
      multicall: vi.fn().mockResolvedValue([
        [0n, 0, 0, 0, 0, 0, true], // slot0 (tick=0, inside range)
        50n, // feeGrowthGlobal0
        50n, // feeGrowthGlobal1
        [0n, 0n, 0n, 0n, 0n, 0n, 0, false], // tick -100
        [0n, 0n, 0n, 0n, 0n, 0n, 0, false], // tick 100
      ]),
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    } as unknown as PublicClient

    const result = await getUniswapFeeHistory({
      client,
      blockNumbers: [500n],
      legs,
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    // Single block = baseline = 0 delta
    expect(result.snapshots).toHaveLength(1)
    expect(result.snapshots[0].fees.token0).toBe(0n)
  })
})
