/**
 * Tests for getAccountGreeks.
 * @module v2/reads/accountGreeks.test
 */

import type { Address, PublicClient } from 'viem'
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'

import { PanopticError, StorageDataNotFoundError } from '../errors'
import type { StorageAdapter } from '../storage'
import {
  createMemoryStorage,
  getPoolMetaKey,
  getPositionMetaKey,
  getPositionsKey,
  jsonSerializer,
} from '../storage'
import type { StoredPoolMeta, StoredPositionData, TokenIdLeg } from '../types'
import { calculateAccountGreeksPure, getAccountGreeks } from './accountGreeks'

// Test constants
const TEST_CHAIN_ID = 1n
const TEST_POOL_ADDRESS = '0x1234567890123456789012345678901234567890' as Address
const TEST_ACCOUNT = '0xabcdef1234567890abcdef1234567890abcdef12' as Address
const TEST_BLOCK_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`

// Mock addresses
const MOCK_CT0_ADDRESS = '0xCT00000000000000000000000000000000000000' as Address
const MOCK_CT1_ADDRESS = '0xCT11111111111111111111111111111111111111' as Address
const MOCK_RISK_ENGINE = '0xRISK000000000000000000000000000000000000' as Address
const MOCK_TOKEN0_ASSET = '0x1111111111111111111111111111111111111111' as Address
const MOCK_TOKEN1_ASSET = '0x2222222222222222222222222222222222222222' as Address

// Mock pool metadata
const MOCK_POOL_META: StoredPoolMeta = {
  tickSpacing: 60n,
  fee: 3000n,
  poolId: 12345n,
  collateralToken0Address: MOCK_CT0_ADDRESS,
  collateralToken1Address: MOCK_CT1_ADDRESS,
  riskEngineAddress: MOCK_RISK_ENGINE,
  token0Asset: MOCK_TOKEN0_ASSET,
  token1Asset: MOCK_TOKEN1_ASSET,
  token0Symbol: 'WETH',
  token1Symbol: 'USDC',
  token0Decimals: 18n,
  token1Decimals: 6n,
}

// Mock leg for position
const mockLeg: TokenIdLeg = {
  index: 0n,
  asset: 0n,
  optionRatio: 1n,
  isLong: false,
  tokenType: 0n,
  riskPartner: 0n,
  strike: 0n,
  width: 10n,
  tickLower: -300n,
  tickUpper: 300n,
}

// Mock position data
const MOCK_POSITION_1: StoredPositionData = {
  tokenId: 123n,
  positionSize: 1000n,
  legs: [mockLeg],
  tickAtMint: 100n,
  poolUtilization0AtMint: 5000n,
  poolUtilization1AtMint: 5000n,
  timestampAtMint: 1700000000n,
  blockNumberAtMint: 900n,
  swapAtMint: false,
}

const MOCK_POSITION_2: StoredPositionData = {
  tokenId: 456n,
  positionSize: 2000n,
  legs: [{ ...mockLeg, strike: 100n }],
  tickAtMint: 200n,
  poolUtilization0AtMint: 6000n,
  poolUtilization1AtMint: 6000n,
  timestampAtMint: 1700001000n,
  blockNumberAtMint: 950n,
  swapAtMint: true,
}

describe('getAccountGreeks', () => {
  let storage: StorageAdapter
  let mockClient: PublicClient

  beforeEach(() => {
    vi.clearAllMocks()
    storage = createMemoryStorage()

    // Create mock client
    mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
      getBlock: vi.fn().mockResolvedValue({
        number: 1000n,
        hash: TEST_BLOCK_HASH,
        timestamp: 1700000000n,
      }),
      readContract: vi.fn().mockResolvedValue(0), // currentTick = 0
    } as unknown as PublicClient
  })

  describe('Error Handling', () => {
    it('should throw StorageDataNotFoundError when pool metadata is missing', async () => {
      await expect(
        getAccountGreeks({
          client: mockClient,
          chainId: TEST_CHAIN_ID,
          poolAddress: TEST_POOL_ADDRESS,
          account: TEST_ACCOUNT,
          storage,
        }),
      ).rejects.toThrow(StorageDataNotFoundError)
    })

    it('should throw StorageDataNotFoundError when positions list is missing', async () => {
      const poolMetaKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      await storage.set(poolMetaKey, jsonSerializer.stringify(MOCK_POOL_META))

      await expect(
        getAccountGreeks({
          client: mockClient,
          chainId: TEST_CHAIN_ID,
          poolAddress: TEST_POOL_ADDRESS,
          account: TEST_ACCOUNT,
          storage,
        }),
      ).rejects.toThrow(StorageDataNotFoundError)
    })

    it('should throw PanopticError when includeCollateral is true but assetIndex is missing', async () => {
      const poolMetaKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      await storage.set(poolMetaKey, jsonSerializer.stringify(MOCK_POOL_META))

      const positionsKey = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(positionsKey, jsonSerializer.stringify([]))

      await expect(
        getAccountGreeks({
          client: mockClient,
          chainId: TEST_CHAIN_ID,
          poolAddress: TEST_POOL_ADDRESS,
          account: TEST_ACCOUNT,
          storage,
          includeCollateral: true,
          // assetIndex intentionally omitted
        }),
      ).rejects.toThrow(PanopticError)
    })

    it('should throw StorageDataNotFoundError when position metadata is missing', async () => {
      const poolMetaKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      await storage.set(poolMetaKey, jsonSerializer.stringify(MOCK_POOL_META))

      const positionsKey = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(positionsKey, jsonSerializer.stringify([123n]))

      await expect(
        getAccountGreeks({
          client: mockClient,
          chainId: TEST_CHAIN_ID,
          poolAddress: TEST_POOL_ADDRESS,
          account: TEST_ACCOUNT,
          storage,
        }),
      ).rejects.toThrow(StorageDataNotFoundError)
    })
  })

  describe('Empty Positions', () => {
    it('should return zeros when account has no positions', async () => {
      const poolMetaKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      await storage.set(poolMetaKey, jsonSerializer.stringify(MOCK_POOL_META))

      const positionsKey = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(positionsKey, jsonSerializer.stringify([]))

      const result = await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(result.positionsValue).toBe(0n)
      expect(result.positionsDelta).toBe(0n)
      expect(result.positionsGamma).toBe(0n)
      expect(result.positionCount).toBe(0n)
      expect(result.positions).toHaveLength(0)
      expect(result.collateralDelta).toBe(0n)
      expect(result.collateralValue).toBe(0n)
      expect(result.totalValue).toBe(0n)
      expect(result.totalDelta).toBe(0n)
      expect(result._meta.blockNumber).toBe(1000n)
    })
  })

  describe('Single Position', () => {
    beforeEach(async () => {
      const poolMetaKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      await storage.set(poolMetaKey, jsonSerializer.stringify(MOCK_POOL_META))

      const positionsKey = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(positionsKey, jsonSerializer.stringify([MOCK_POSITION_1.tokenId]))

      const posMetaKey = getPositionMetaKey(
        TEST_CHAIN_ID,
        TEST_POOL_ADDRESS,
        MOCK_POSITION_1.tokenId,
      )
      await storage.set(posMetaKey, jsonSerializer.stringify(MOCK_POSITION_1))
    })

    it('should calculate greeks for a single position', async () => {
      const result = await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(result.positionCount).toBe(1n)
      expect(result.positions).toHaveLength(1)
      expect(result.positions[0].tokenId).toBe(123n)
      expect(typeof result.positionsValue).toBe('bigint')
      expect(typeof result.positionsDelta).toBe('bigint')
      expect(typeof result.positionsGamma).toBe('bigint')
      expect(result._meta.blockNumber).toBe(1000n)
    })

    it('should use the current tick from RPC', async () => {
      ;(mockClient.readContract as Mock).mockResolvedValue(50)

      await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(mockClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: TEST_POOL_ADDRESS,
          functionName: 'getCurrentTick',
        }),
      )
    })

    it('should support historical block queries', async () => {
      const historicalBlock = 500n

      await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        blockNumber: historicalBlock,
      })

      expect(mockClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          blockNumber: historicalBlock,
        }),
      )
    })
  })

  describe('Multiple Positions', () => {
    beforeEach(async () => {
      const poolMetaKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      await storage.set(poolMetaKey, jsonSerializer.stringify(MOCK_POOL_META))

      const positionsKey = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(
        positionsKey,
        jsonSerializer.stringify([MOCK_POSITION_1.tokenId, MOCK_POSITION_2.tokenId]),
      )

      const pos1Key = getPositionMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, MOCK_POSITION_1.tokenId)
      await storage.set(pos1Key, jsonSerializer.stringify(MOCK_POSITION_1))

      const pos2Key = getPositionMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, MOCK_POSITION_2.tokenId)
      await storage.set(pos2Key, jsonSerializer.stringify(MOCK_POSITION_2))
    })

    it('should aggregate greeks across multiple positions', async () => {
      const result = await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(result.positionCount).toBe(2n)
      expect(result.positions).toHaveLength(2)

      const pos1Greeks = result.positions.find((p) => p.tokenId === 123n)!.greeks
      const pos2Greeks = result.positions.find((p) => p.tokenId === 456n)!.greeks

      expect(result.positionsValue).toBe(pos1Greeks.value + pos2Greeks.value)
      expect(result.positionsDelta).toBe(pos1Greeks.delta + pos2Greeks.delta)
      expect(result.positionsGamma).toBe(pos1Greeks.gamma + pos2Greeks.gamma)
    })
  })

  describe('includeCollateral', () => {
    beforeEach(async () => {
      const poolMetaKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      await storage.set(poolMetaKey, jsonSerializer.stringify(MOCK_POOL_META))

      const positionsKey = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(positionsKey, jsonSerializer.stringify([MOCK_POSITION_1.tokenId]))

      const posMetaKey = getPositionMetaKey(
        TEST_CHAIN_ID,
        TEST_POOL_ADDRESS,
        MOCK_POSITION_1.tokenId,
      )
      await storage.set(posMetaKey, jsonSerializer.stringify(MOCK_POSITION_1))
    })

    it('should return collateralDelta=0 when flag is not set', async () => {
      const result = await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(result.collateralDelta).toBe(0n)
    })

    it('should include asset token collateral as linear delta (assetIndex=0)', async () => {
      const token0Assets = 5000n

      ;(mockClient as unknown as { multicall: Mock }).multicall = vi
        .fn()
        .mockResolvedValueOnce([MOCK_CT0_ADDRESS, MOCK_CT1_ADDRESS])
        .mockResolvedValueOnce([token0Assets, token0Assets, token0Assets, 1000n, 1000n, 1000n, 1n])

      const result = await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        includeCollateral: true,
        assetIndex: 0n,
      })

      // collateralDelta = assetBal directly (already in asset smallest units)
      expect(result.collateralDelta).toBe(token0Assets)
      expect(result.collateralValue).not.toBe(0n)
      // totalDelta = positionsDelta + collateralDelta
      expect(result.totalDelta).toBe(result.positionsDelta + result.collateralDelta)
      // totalValue = positionsValue + collateralValue
      expect(result.totalValue).toBe(result.positionsValue + result.collateralValue)
    })

    it('should use token1 collateral when assetIndex=1', async () => {
      const token1Assets = 8000n

      ;(mockClient as unknown as { multicall: Mock }).multicall = vi
        .fn()
        .mockResolvedValueOnce([MOCK_CT0_ADDRESS, MOCK_CT1_ADDRESS])
        .mockResolvedValueOnce([500n, 500n, 500n, token1Assets, token1Assets, token1Assets, 1n])

      const result = await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        includeCollateral: true,
        assetIndex: 1n,
      })

      // collateralDelta = asset balance directly
      expect(result.collateralDelta).toBe(token1Assets)
    })

    it('should include collateral delta even with no positions', async () => {
      const token0Assets = 2000n

      const positionsKey = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(positionsKey, jsonSerializer.stringify([]))
      ;(mockClient as unknown as { multicall: Mock }).multicall = vi
        .fn()
        .mockResolvedValueOnce([MOCK_CT0_ADDRESS, MOCK_CT1_ADDRESS])
        .mockResolvedValueOnce([token0Assets, token0Assets, token0Assets, 0n, 0n, 0n, 0n])

      const result = await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        includeCollateral: true,
        assetIndex: 0n,
      })

      expect(result.positionCount).toBe(0n)
      expect(result.collateralDelta).toBe(token0Assets)
      expect(result.positionsDelta).toBe(0n)
      // With no positions, totals equal collateral
      expect(result.totalDelta).toBe(result.collateralDelta)
      expect(result.totalValue).toBe(result.collateralValue)
    })

    it('should accept pre-fetched collateralAddresses', async () => {
      ;(mockClient as unknown as { multicall: Mock }).multicall = vi
        .fn()
        .mockResolvedValueOnce([500n, 500n, 500n, 100n, 100n, 100n, 1n])

      const result = await getAccountGreeks({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        includeCollateral: true,
        assetIndex: 0n,
        collateralAddresses: {
          collateralToken0: MOCK_CT0_ADDRESS,
          collateralToken1: MOCK_CT1_ADDRESS,
        },
      })

      expect((mockClient as unknown as { multicall: Mock }).multicall).toHaveBeenCalledTimes(1)
      // collateralDelta = assetBal = 500 (no WAD scaling)
      expect(result.collateralDelta).toBe(500n)
    })
  })
})

describe('calculateAccountGreeksPure', () => {
  it('should return zero arrays for empty positions without collateral', () => {
    const result = calculateAccountGreeksPure({
      positions: [],
      tickSpacing: 60n,
      atTicks: [0n],
    })

    expect(result.totalValue).toEqual([0n])
    expect(result.totalDelta).toEqual([0n])
    expect(result.totalGamma).toEqual([0n])
    expect(result.positionCount).toBe(0n)
    expect(result.positions).toHaveLength(0)
  })

  it('should calculate greeks synchronously without RPC', () => {
    const result = calculateAccountGreeksPure({
      positions: [MOCK_POSITION_1],
      tickSpacing: 60n,
      atTicks: [0n],
    })

    expect(result.positionCount).toBe(1n)
    expect(result.positions).toHaveLength(1)
    expect(result.totalValue).toHaveLength(1)
    expect(typeof result.totalValue[0]).toBe('bigint')
    expect(typeof result.totalDelta[0]).toBe('bigint')
    expect(typeof result.totalGamma[0]).toBe('bigint')
  })

  it('should aggregate multiple positions', () => {
    const result = calculateAccountGreeksPure({
      positions: [MOCK_POSITION_1, MOCK_POSITION_2],
      tickSpacing: 60n,
      atTicks: [0n],
    })

    expect(result.positionCount).toBe(2n)
    expect(result.positions).toHaveLength(2)

    const pos1Greeks = result.positions.find((p) => p.tokenId === 123n)!.greeks
    const pos2Greeks = result.positions.find((p) => p.tokenId === 456n)!.greeks

    // Without collateral, totals equal sum of per-position values
    expect(result.totalValue[0]).toBe(pos1Greeks.value[0] + pos2Greeks.value[0])
    expect(result.totalDelta[0]).toBe(pos1Greeks.delta[0] + pos2Greeks.delta[0])
    expect(result.totalGamma[0]).toBe(pos1Greeks.gamma[0] + pos2Greeks.gamma[0])
  })

  it('should return arrays parallel to atTicks', () => {
    const ticks = [-1000n, 0n, 1000n]
    const result = calculateAccountGreeksPure({
      positions: [MOCK_POSITION_1],
      tickSpacing: 60n,
      atTicks: ticks,
    })

    expect(result.totalValue).toHaveLength(3)
    expect(result.totalDelta).toHaveLength(3)
    expect(result.totalGamma).toHaveLength(3)
    expect(result.positions[0].greeks.value).toHaveLength(3)
    expect(result.positions[0].greeks.delta).toHaveLength(3)
    expect(result.positions[0].greeks.gamma).toHaveLength(3)

    // Value and delta should differ across ticks
    expect(result.totalValue[0]).not.toBe(result.totalValue[2])
    expect(result.totalDelta[0]).not.toBe(result.totalDelta[2])
  })

  describe('collateralAssets tuple', () => {
    it('should add asset balance to delta and both balances to value', () => {
      const token0Bal = 5000n
      const token1Bal = 2000n
      const ticks = [0n]

      const withoutCollateral = calculateAccountGreeksPure({
        positions: [MOCK_POSITION_1],
        tickSpacing: 60n,
        atTicks: ticks,
      })

      const withCollateral = calculateAccountGreeksPure({
        positions: [MOCK_POSITION_1],
        tickSpacing: 60n,
        atTicks: ticks,
        collateralAssets: [token0Bal, token1Bal],
        assetIndex: 0n,
      })

      // Delta includes asset (token0) balance directly (no WAD scaling)
      expect(withCollateral.totalDelta[0]).toBe(withoutCollateral.totalDelta[0] + token0Bal)

      // Value includes both balances (token1 * price at tick=0 ≈ 1.0)
      // At tick=0: price = 1/1.0001^0 = 1, so assetBal*price + otherBal = 5000 + 2000 = 7000
      expect(withCollateral.totalValue[0]).toBe(
        withoutCollateral.totalValue[0] + token0Bal + token1Bal,
      )

      // Gamma unaffected (collateral has zero gamma)
      expect(withCollateral.totalGamma[0]).toBe(withoutCollateral.totalGamma[0])
    })

    it('should flip asset/other when assetIndex=1', () => {
      const token0Bal = 5000n
      const token1Bal = 2000n

      const asset0 = calculateAccountGreeksPure({
        positions: [],
        tickSpacing: 60n,
        atTicks: [1000n],
        collateralAssets: [token0Bal, token1Bal],
        assetIndex: 0n,
      })

      const asset1 = calculateAccountGreeksPure({
        positions: [],
        tickSpacing: 60n,
        atTicks: [1000n],
        collateralAssets: [token0Bal, token1Bal],
        assetIndex: 1n,
      })

      // assetIndex=0 → delta = token0Bal, assetIndex=1 → delta = token1Bal
      expect(asset0.totalDelta[0]).toBe(token0Bal)
      expect(asset1.totalDelta[0]).toBe(token1Bal)

      // Values differ because the "other" token price differs by direction
      expect(asset0.totalValue[0]).not.toBe(asset1.totalValue[0])
    })

    it('should vary collateral value across ticks (other token is price-dependent)', () => {
      const token0Bal = 1000n
      const token1Bal = 1000n

      const result = calculateAccountGreeksPure({
        positions: [],
        tickSpacing: 60n,
        atTicks: [-1000n, 0n, 1000n],
        collateralAssets: [token0Bal, token1Bal],
        assetIndex: 0n,
      })

      // At tick=0, price = 1, so value = assetBal*1 + otherBal = 1000 + 1000 = 2000
      expect(result.totalValue[1]).toBe(2000n)

      // Other token's value varies with tick → total value differs across ticks
      expect(result.totalValue[0]).not.toBe(result.totalValue[1])
      expect(result.totalValue[1]).not.toBe(result.totalValue[2])

      // But delta is constant (asset balance doesn't depend on tick)
      expect(result.totalDelta[0]).toBe(result.totalDelta[1])
      expect(result.totalDelta[1]).toBe(result.totalDelta[2])
    })

    it('should include collateral with no positions', () => {
      const result = calculateAccountGreeksPure({
        positions: [],
        tickSpacing: 60n,
        atTicks: [0n],
        collateralAssets: [3000n, 0n],
        assetIndex: 0n,
      })

      // At tick=0, price=1: value = 3000*1 + 0 = 3000
      expect(result.totalValue[0]).toBe(3000n)
      expect(result.totalDelta[0]).toBe(3000n)
      expect(result.totalGamma[0]).toBe(0n)
    })
  })

  it('should thread assetIndex to greeks calculations', () => {
    // Use larger position to avoid rounding collisions
    const bigPosition: StoredPositionData = { ...MOCK_POSITION_1, positionSize: 10n ** 18n }
    const defaultResult = calculateAccountGreeksPure({
      positions: [bigPosition],
      tickSpacing: 60n,
      atTicks: [500n],
    })

    const flippedResult = calculateAccountGreeksPure({
      positions: [bigPosition],
      tickSpacing: 60n,
      atTicks: [500n],
      assetIndex: 1n,
    })

    expect(flippedResult.totalValue[0]).not.toBe(defaultResult.totalValue[0])
    expect(flippedResult.totalDelta[0]).not.toBe(defaultResult.totalDelta[0])
  })

  it('should match default when assetIndex equals leg.asset', () => {
    const defaultResult = calculateAccountGreeksPure({
      positions: [MOCK_POSITION_1],
      tickSpacing: 60n,
      atTicks: [500n],
    })

    const explicitResult = calculateAccountGreeksPure({
      positions: [MOCK_POSITION_1],
      tickSpacing: 60n,
      atTicks: [500n],
      assetIndex: 0n,
    })

    expect(explicitResult.totalValue[0]).toBe(defaultResult.totalValue[0])
    expect(explicitResult.totalDelta[0]).toBe(defaultResult.totalDelta[0])
    expect(explicitResult.totalGamma[0]).toBe(defaultResult.totalGamma[0])
  })

  it('should handle empty atTicks array', () => {
    const result = calculateAccountGreeksPure({
      positions: [MOCK_POSITION_1],
      tickSpacing: 60n,
      atTicks: [],
    })

    expect(result.totalValue).toHaveLength(0)
    expect(result.totalDelta).toHaveLength(0)
    expect(result.totalGamma).toHaveLength(0)
    expect(result.positionCount).toBe(1n)
    expect(result.positions[0].greeks.value).toHaveLength(0)
  })
})
