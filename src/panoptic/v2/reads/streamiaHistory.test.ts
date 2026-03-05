/**
 * Tests for streamiaHistory.
 * @module v2/reads/streamiaHistory.test
 */

import type { Address, PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import type { StreamiaLeg } from './streamiaHistory'
import { getStreamiaHistory } from './streamiaHistory'

const POOL = '0x1111111111111111111111111111111111111111' as Address
const UNI_POOL = '0x2222222222222222222222222222222222222222' as Address
const ACCOUNT = '0x3333333333333333333333333333333333333333' as Address
const TOKEN_ID = 123456789n

const MOCK_BLOCK = {
  number: 1000n,
  hash: '0x' + 'aa'.repeat(32),
  timestamp: 1700000000n,
}

function createMockClient(overrides: {
  premiaResults?: Array<readonly [bigint, bigint, readonly bigint[]]>
  multicallResults?: Array<{ status: 'success'; result: unknown }>[]
}): PublicClient {
  const { premiaResults = [], multicallResults = [] } = overrides
  let premiaCallIdx = 0
  let multicallCallIdx = 0

  return {
    readContract: vi.fn().mockImplementation(() => {
      return Promise.resolve(premiaResults[premiaCallIdx++])
    }),
    multicall: vi.fn().mockImplementation(() => {
      return Promise.resolve((multicallResults[multicallCallIdx++] ?? []).map((r) => r.result))
    }),
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    getBlockNumber: vi.fn().mockResolvedValue(1000n),
  } as unknown as PublicClient
}

// Pack short/long premia as LeftRight: lower 128 = token0, upper 128 = token1
function packLeftRight(token0: bigint, token1: bigint): bigint {
  return (token1 << 128n) | (token0 & ((1n << 128n) - 1n))
}

describe('getStreamiaHistory', () => {
  it('should return empty snapshots for empty blockNumbers', async () => {
    const client = createMockClient({})
    const result = await getStreamiaHistory({
      client,
      panopticPoolAddress: POOL,
      account: ACCOUNT,
      tokenId: TOKEN_ID,
      blockNumbers: [],
      legs: [],
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    expect(result.snapshots).toEqual([])
    expect(result._meta.blockNumber).toBe(1000n)
  })

  it('should compute Panoptic premia correctly', async () => {
    // short0=100, short1=200, long0=30, long1=50
    const shortPacked = packLeftRight(100n, 200n)
    const longPacked = packLeftRight(30n, 50n)

    const client = createMockClient({
      premiaResults: [[shortPacked, longPacked, [0n]]],
    })

    const result = await getStreamiaHistory({
      client,
      panopticPoolAddress: POOL,
      account: ACCOUNT,
      tokenId: TOKEN_ID,
      blockNumbers: [500n],
      legs: [],
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
      includeUniswapFees: false,
    })

    expect(result.snapshots).toHaveLength(1)
    expect(result.snapshots[0].panopticPremia.token0).toBe(70n) // 100 - 30
    expect(result.snapshots[0].panopticPremia.token1).toBe(150n) // 200 - 50
  })

  it('should subtract settled events with O(n+m) accumulation', async () => {
    const shortPacked1 = packLeftRight(100n, 200n)
    const longPacked1 = packLeftRight(0n, 0n)
    const shortPacked2 = packLeftRight(300n, 400n)
    const longPacked2 = packLeftRight(0n, 0n)

    const client = createMockClient({
      premiaResults: [
        [shortPacked1, longPacked1, [0n]],
        [shortPacked2, longPacked2, [0n]],
      ],
    })

    const result = await getStreamiaHistory({
      client,
      panopticPoolAddress: POOL,
      account: ACCOUNT,
      tokenId: TOKEN_ID,
      blockNumbers: [500n, 700n],
      legs: [],
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
      includeUniswapFees: false,
      settledEvents: [
        { blockNumber: 600n, settled0: 10n, settled1: 20n },
        { blockNumber: 400n, settled0: 5n, settled1: 15n },
      ],
    })

    // Block 500: settled events at block 400 apply (5, 15)
    expect(result.snapshots[0].panopticPremia.token0).toBe(95n) // 100 - 0 - 5
    expect(result.snapshots[0].panopticPremia.token1).toBe(185n) // 200 - 0 - 15

    // Block 700: both settled events apply (5+10=15, 15+20=35)
    expect(result.snapshots[1].panopticPremia.token0).toBe(285n) // 300 - 0 - 15
    expect(result.snapshots[1].panopticPremia.token1).toBe(365n) // 400 - 0 - 35
  })

  it('should compute Uniswap fee deltas from first block', async () => {
    const shortPacked = packLeftRight(0n, 0n)
    const longPacked = packLeftRight(0n, 0n)

    // For Uniswap fees, we need the multicall to return slot0 + globals + ticks
    // Single leg: lower=100, upper=200, liquidity=1000
    const legs: StreamiaLeg[] = [
      { lowerTick: 100, upperTick: 200, liquidity: 1000n * (1n << 128n) },
    ]

    // Two blocks. feeGrowthGlobal increases between them.
    // Simplified: current tick is 150 (inside range)
    // Lower tick feeGrowthOutside0 = 10, Upper tick feeGrowthOutside0 = 5
    // Global = 100 → fees_inside = 100 - 10 - 5 = 85, × liquidity / 2^128
    // With liquidity = 1000 * 2^128, fees = 85 * 1000 = 85000

    const makeMulticallResult = (globalFee0: bigint, globalFee1: bigint) => [
      // slot0: [sqrtPriceX96, tick, ...]
      [0n, 150, 0, 0, 0, 0, true],
      // feeGrowthGlobal0X128
      globalFee0,
      // feeGrowthGlobal1X128
      globalFee1,
      // ticks(100): [liquidityGross, liquidityNet, feeGrowthOutside0, feeGrowthOutside1, ...]
      [0n, 0n, 10n, 10n, 0n, 0n, 0, false],
      // ticks(200): same format
      [0n, 0n, 5n, 5n, 0n, 0n, 0, false],
    ]

    let multicallIdx = 0
    const multicallResults = [makeMulticallResult(100n, 100n), makeMulticallResult(200n, 200n)]

    const client = {
      readContract: vi
        .fn()
        .mockResolvedValueOnce([shortPacked, longPacked, [0n]])
        .mockResolvedValueOnce([shortPacked, longPacked, [0n]]),
      multicall: vi.fn().mockImplementation(() => {
        return Promise.resolve(multicallResults[multicallIdx++])
      }),
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
    } as unknown as PublicClient

    const result = await getStreamiaHistory({
      client,
      panopticPoolAddress: POOL,
      account: ACCOUNT,
      tokenId: TOKEN_ID,
      blockNumbers: [500n, 600n],
      legs,
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    // First block = baseline, delta = 0
    expect(result.snapshots[0].uniswapFees.token0).toBe(0n)
    expect(result.snapshots[0].uniswapFees.token1).toBe(0n)

    // Second block: fees increased
    // Block 1: global=100, below=10, above=5, inside=85, fees = 85 * 1000 = 85000
    // Block 2: global=200, below=10, above=5, inside=185, fees = 185 * 1000 = 185000
    // Delta = 185000 - 85000 = 100000
    expect(result.snapshots[1].uniswapFees.token0).toBe(100000n)
    expect(result.snapshots[1].uniswapFees.token1).toBe(100000n)
  })

  it('should deduplicate ticks across legs', async () => {
    const shortPacked = packLeftRight(0n, 0n)
    const longPacked = packLeftRight(0n, 0n)

    // Two legs sharing a tick boundary
    const legs: StreamiaLeg[] = [
      { lowerTick: 100, upperTick: 200, liquidity: 1000n },
      { lowerTick: 200, upperTick: 300, liquidity: 1000n },
    ]

    let multicallContracts: unknown[] = []
    const client = {
      readContract: vi.fn().mockResolvedValue([shortPacked, longPacked, [0n]]),
      multicall: vi.fn().mockImplementation(({ contracts }) => {
        multicallContracts = contracts
        // slot0 + feeGrowthGlobal0 + feeGrowthGlobal1 + 3 unique ticks (100, 200, 300)
        return Promise.resolve([
          [0n, 150, 0, 0, 0, 0, true], // slot0
          0n, // feeGrowthGlobal0
          0n, // feeGrowthGlobal1
          [0n, 0n, 0n, 0n, 0n, 0n, 0, false], // tick 100
          [0n, 0n, 0n, 0n, 0n, 0n, 0, false], // tick 200
          [0n, 0n, 0n, 0n, 0n, 0n, 0, false], // tick 300
        ])
      }),
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
    } as unknown as PublicClient

    await getStreamiaHistory({
      client,
      panopticPoolAddress: POOL,
      account: ACCOUNT,
      tokenId: TOKEN_ID,
      blockNumbers: [500n],
      legs,
      poolConfig: { version: 'v3', poolAddress: UNI_POOL },
    })

    // Should have 6 calls: slot0 + 2 globals + 3 unique ticks (not 4)
    expect(multicallContracts).toHaveLength(6)
  })

  it('should work with V4 pool config', async () => {
    const shortPacked = packLeftRight(50n, 60n)
    const longPacked = packLeftRight(10n, 20n)

    const legs: StreamiaLeg[] = [{ lowerTick: 100, upperTick: 200, liquidity: 1000n }]

    const stateViewAddr = '0x4444444444444444444444444444444444444444' as Address
    const poolId = ('0x' + 'ff'.repeat(32)) as `0x${string}`

    let multicallContracts: Array<{ functionName: string }> = []
    const client = {
      readContract: vi.fn().mockResolvedValue([shortPacked, longPacked, [0n]]),
      multicall: vi.fn().mockImplementation(({ contracts }) => {
        multicallContracts = contracts
        return Promise.resolve([
          [0n, 150, 0, 0], // getSlot0
          [0n, 0n], // getFeeGrowthGlobals
          [0n, 0n, 0n, 0n], // getTickInfo lower
          [0n, 0n, 0n, 0n], // getTickInfo upper
        ])
      }),
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
    } as unknown as PublicClient

    const result = await getStreamiaHistory({
      client,
      panopticPoolAddress: POOL,
      account: ACCOUNT,
      tokenId: TOKEN_ID,
      blockNumbers: [500n],
      legs,
      poolConfig: { version: 'v4', stateViewAddress: stateViewAddr, poolId },
    })

    expect(result.snapshots).toHaveLength(1)
    expect(result.snapshots[0].panopticPremia.token0).toBe(40n) // 50 - 10
    expect(result.snapshots[0].panopticPremia.token1).toBe(40n) // 60 - 20

    // V4 calls use getSlot0, getFeeGrowthGlobals, getTickInfo
    expect(multicallContracts[0].functionName).toBe('getSlot0')
    expect(multicallContracts[1].functionName).toBe('getFeeGrowthGlobals')
    expect(multicallContracts[2].functionName).toBe('getTickInfo')
  })
})
