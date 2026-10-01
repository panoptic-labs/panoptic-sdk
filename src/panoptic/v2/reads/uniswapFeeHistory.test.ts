/**
 * Tests for uniswapFeeHistory.
 * @module v2/reads/uniswapFeeHistory.test
 */

import type { Address, PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import type { StreamiaLeg } from './streamiaHistory'
import {
  type UniswapBlockData,
  computeUniswapFeesForBlock,
  feeGrowthInsideX128,
  fetchUniswapFeeData,
  getUniswapFeeHistory,
} from './uniswapFeeHistory'
import { feesFromFeeGrowthDelta } from './uniswapLpPosition'

const UNI_POOL = '0x2222222222222222222222222222222222222222' as Address

const MOCK_BLOCK = {
  number: 1000n,
  hash: '0x' + 'aa'.repeat(32),
  timestamp: 1700000000n,
}

describe('getUniswapFeeHistory', () => {
  const feeGrowth = 10n * (1n << 128n)
  const blockData = {
    currentTick: 150,
    sqrtPriceX96: 1n << 96n,
    feeGrowthGlobal0: feeGrowth,
    feeGrowthGlobal1: feeGrowth,
    tickData: new Map([
      [100, { feeGrowthOutside0: 0n, feeGrowthOutside1: 0n }],
      [200, { feeGrowthOutside0: 0n, feeGrowthOutside1: 0n }],
    ]),
  }

  it('subtracts the equivalent fees for long legs', () => {
    const fees = computeUniswapFeesForBlock(blockData, [
      { lowerTick: 100, upperTick: 200, liquidity: 1n, isLong: true },
    ])

    expect(fees).toEqual({ total0: -10n, total1: -10n })
  })

  it('adds the equivalent fees when isLong is omitted', () => {
    const fees = computeUniswapFeesForBlock(blockData, [
      { lowerTick: 100, upperTick: 200, liquidity: 1n },
    ])

    expect(fees).toEqual({ total0: 10n, total1: 10n })
  })

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
    expect(result.snapshots[0].blockNumber).toBe(MOCK_BLOCK.number)
    expect(result.snapshots[0].blockTimestamp).toBe(MOCK_BLOCK.timestamp)
    expect(result.snapshots[0].currentTick).toBe(150)
    expect(result.snapshots[0].sqrtPriceX96).toBe(0n)

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

describe('feeGrowthInsideX128', () => {
  const Q128 = 1n << 128n
  const MAX_UINT256 = 2n ** 256n - 1n
  const snapshot = (
    currentTick: number,
    global: bigint,
    lowerOutside: bigint,
    upperOutside: bigint,
  ): UniswapBlockData => ({
    currentTick,
    sqrtPriceX96: 1n << 96n,
    feeGrowthGlobal0: global,
    feeGrowthGlobal1: 2n * global,
    tickData: new Map([
      [100, { feeGrowthOutside0: lowerOutside, feeGrowthOutside1: 2n * lowerOutside }],
      [200, { feeGrowthOutside0: upperOutside, feeGrowthOutside1: 2n * upperOutside }],
    ]),
  })

  it('subtracts the growth below and above the range', () => {
    // In range: below = lowerOutside, above = upperOutside.
    expect(feeGrowthInsideX128(snapshot(150, 10n * Q128, 3n * Q128, 2n * Q128), 100, 200)).toEqual({
      feeGrowthInside0X128: 5n * Q128,
      feeGrowthInside1X128: 10n * Q128,
    })
    // Below range: below = global − lowerOutside.
    expect(
      feeGrowthInsideX128(snapshot(50, 10n * Q128, 3n * Q128, 2n * Q128), 100, 200)
        ?.feeGrowthInside0X128,
    ).toBe(1n * Q128)
  })

  it('wraps to uint256 so a delta across an underflow stays exact', () => {
    // Outside values larger than global make the inside growth underflow.
    const start = feeGrowthInsideX128(snapshot(150, 1n * Q128, 3n * Q128, 0n), 100, 200)
    const end = feeGrowthInsideX128(snapshot(150, 4n * Q128, 3n * Q128, 0n), 100, 200)
    expect(start?.feeGrowthInside0X128).toBe(MAX_UINT256 + 1n - 2n * Q128)
    expect(
      feesFromFeeGrowthDelta(
        end?.feeGrowthInside0X128 ?? 0n,
        start?.feeGrowthInside0X128 ?? 0n,
        1_000n,
      ),
    ).toBe(3_000n)
  })

  it('returns null when a bound tick was not read', () => {
    expect(feeGrowthInsideX128(snapshot(150, Q128, 0n, 0n), 100, 300)).toBeNull()
  })
})

describe('fetchUniswapFeeData', () => {
  const tickResult = [0n, 0n, 0n, 0n, 0n, 0n, 0, true]
  const makeClient = () => {
    const multicall = vi.fn(async () => [
      [1n << 96n, 150, 0, 0, 0, 0, true],
      0n,
      0n,
      tickResult,
      tickResult,
    ])
    const client = {
      chain: { contracts: { multicall3: { blockCreated: 14_353_601 } } },
      multicall,
    } as unknown as PublicClient
    return { client, multicall }
  }
  const legs = [{ lowerTick: 100, upperTick: 200, liquidity: 1n }]
  const poolConfig = { version: 'v3' as const, poolAddress: UNI_POOL }

  it.each([
    [12_000_000n, true],
    [14_353_601n, false],
    [undefined, false],
  ])(
    'uses deployless multicall only before Multicall3 existed (block %s)',
    async (block, deployless) => {
      const { client, multicall } = makeClient()
      await fetchUniswapFeeData(client, [block], legs, poolConfig)
      expect(multicall).toHaveBeenCalledWith(expect.objectContaining({ deployless }))
    },
  )
})
