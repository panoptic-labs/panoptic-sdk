/**
 * Tests for syncPositions position data and pool metadata storage.
 * @module v2/sync/syncPositions.test
 */

import type { Address, PublicClient } from 'viem'
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPoolMetadata } from '../reads/pool'
import { getPositions } from '../reads/position'
import type { StorageAdapter } from '../storage'
import { createMemoryStorage, getPoolMetaKey, getPositionMetaKey, jsonSerializer } from '../storage'
import type { StoredPoolMeta, StoredPositionData, TokenIdLeg } from '../types'
import { getOpenPositionIds } from './getTrackedPositionIds'
import { detectReorg, loadCheckpoint, saveCheckpoint } from './reorgHandling'
// Import after mocking
import { syncPositions } from './syncPositions'

// Mock the dependencies
vi.mock('../reads/position', () => ({
  getPositions: vi.fn(),
}))

vi.mock('../reads/pool', () => ({
  getPoolMetadata: vi.fn(),
}))

vi.mock('./getTrackedPositionIds', () => ({
  getOpenPositionIds: vi.fn(),
}))

vi.mock('./reorgHandling', () => ({
  detectReorg: vi.fn(),
  saveCheckpoint: vi.fn(),
  loadCheckpoint: vi.fn(),
}))

// Test constants
const TEST_CHAIN_ID = 1n
const TEST_POOL_ADDRESS = '0x1234567890123456789012345678901234567890' as Address
const TEST_ACCOUNT = '0xabcdef1234567890abcdef1234567890abcdef12' as Address
const TEST_BLOCK_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`

// Mock addresses for pool metadata
const MOCK_CT0_ADDRESS = '0xCT00000000000000000000000000000000000000' as Address
const MOCK_CT1_ADDRESS = '0xCT11111111111111111111111111111111111111' as Address
const MOCK_RISK_ENGINE = '0xRISK000000000000000000000000000000000000' as Address
const MOCK_TOKEN0_ASSET = '0x1111111111111111111111111111111111111111' as Address
const MOCK_TOKEN1_ASSET = '0x2222222222222222222222222222222222222222' as Address

// Pool key bytes with tickSpacing = 60 (encoded at slot 3)
const MOCK_POOL_KEY_BYTES = ('0x' +
  '0000000000000000000000001111111111111111111111111111111111111111' + // currency0
  '0000000000000000000000002222222222222222222222222222222222222222' + // currency1
  '0000000000000000000000000000000000000000000000000000000000000bb8' + // fee = 3000
  '000000000000000000000000000000000000000000000000000000000000003c' + // tickSpacing = 60
  '0000000000000000000000003333333333333333333333333333333333333333') as  // hooks
`0x${string}`

// Mock pool metadata returned by getPoolMetadata
const MOCK_POOL_METADATA = {
  poolKeyBytes: MOCK_POOL_KEY_BYTES,
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
  tickSpacing: 60n,
  fee: 3000n,
  isV4: false,
  underlyingPoolId: TEST_POOL_ADDRESS,
}

// Mock legs for position
const mockLegs: TokenIdLeg[] = [
  {
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
  },
]

describe('syncPositions - Position Data Storage', () => {
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
      getLogs: vi.fn().mockResolvedValue([]),
      readContract: vi.fn().mockResolvedValue(MOCK_POOL_KEY_BYTES),
      multicall: vi.fn().mockResolvedValue([]),
    } as unknown as PublicClient

    // Default mock implementations
    ;(loadCheckpoint as Mock).mockResolvedValue(null)
    ;(getOpenPositionIds as Mock).mockResolvedValue([])
    ;(saveCheckpoint as Mock).mockResolvedValue(undefined)
    ;(detectReorg as Mock).mockResolvedValue({ detected: false })
    ;(getPoolMetadata as Mock).mockResolvedValue(MOCK_POOL_METADATA)
  })

  describe('Pool Metadata Storage', () => {
    it('should store full pool metadata on first sync', async () => {
      // Account has no events, no positions
      ;(mockClient.getLogs as Mock).mockResolvedValue([])
      ;(getPositions as Mock).mockResolvedValue({ positions: [], _meta: {} })

      await syncPositions({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      // Check pool metadata was stored with all fields
      const poolMetaKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      const storedRaw = await storage.get(poolMetaKey)
      expect(storedRaw).not.toBeNull()

      const poolMeta = jsonSerializer.parse(storedRaw!) as StoredPoolMeta
      expect(poolMeta.tickSpacing).toBe(60n)
      expect(poolMeta.fee).toBe(3000n)
      expect(poolMeta.poolId).toBe(12345n)
      expect(poolMeta.collateralToken0Address).toBe(MOCK_CT0_ADDRESS)
      expect(poolMeta.collateralToken1Address).toBe(MOCK_CT1_ADDRESS)
      expect(poolMeta.riskEngineAddress).toBe(MOCK_RISK_ENGINE)
      expect(poolMeta.token0Asset).toBe(MOCK_TOKEN0_ASSET)
      expect(poolMeta.token1Asset).toBe(MOCK_TOKEN1_ASSET)
      expect(poolMeta.token0Symbol).toBe('WETH')
      expect(poolMeta.token1Symbol).toBe('USDC')
      expect(poolMeta.token0Decimals).toBe(18n)
      expect(poolMeta.token1Decimals).toBe(6n)
    })

    it('should not re-fetch pool metadata if already stored', async () => {
      // Pre-store pool metadata
      const poolMetaKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      const existingMeta: StoredPoolMeta = {
        tickSpacing: 100n,
        fee: 500n,
        poolId: 99999n,
        collateralToken0Address: MOCK_CT0_ADDRESS,
        collateralToken1Address: MOCK_CT1_ADDRESS,
        riskEngineAddress: MOCK_RISK_ENGINE,
        token0Asset: MOCK_TOKEN0_ASSET,
        token1Asset: MOCK_TOKEN1_ASSET,
        token0Symbol: 'TEST0',
        token1Symbol: 'TEST1',
        token0Decimals: 18n,
        token1Decimals: 8n,
      }
      await storage.set(poolMetaKey, jsonSerializer.stringify(existingMeta))
      ;(mockClient.getLogs as Mock).mockResolvedValue([])
      ;(getPositions as Mock).mockResolvedValue({ positions: [], _meta: {} })

      await syncPositions({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      // getPoolMetadata should not be called (already stored)
      expect(getPoolMetadata).not.toHaveBeenCalled()

      // Original values should be preserved
      const storedRaw = await storage.get(poolMetaKey)
      const poolMeta = jsonSerializer.parse(storedRaw!) as StoredPoolMeta
      expect(poolMeta.tickSpacing).toBe(100n)
      expect(poolMeta.fee).toBe(500n)
      expect(poolMeta.poolId).toBe(99999n)
      expect(poolMeta.token0Symbol).toBe('TEST0')
    })
  })

  describe('Position Data Storage', () => {
    it('should store position data for discovered positions', async () => {
      const tokenId1 = 123n
      const tokenId2 = 456n

      // getOpenPositionIds returns positions
      ;(getOpenPositionIds as Mock).mockResolvedValue([tokenId1, tokenId2])

      // Mock getPositions returns full position data
      const mockPositions = [
        {
          tokenId: tokenId1,
          positionSize: 1000n,
          legs: mockLegs,
          tickAtMint: 100n,
          poolUtilization0AtMint: 5000n,
          poolUtilization1AtMint: 5000n,
          timestampAtMint: 1700000000n,
          blockNumberAtMint: 900n,
          swapAtMint: false,
        },
        {
          tokenId: tokenId2,
          positionSize: 2000n,
          legs: mockLegs,
          tickAtMint: 200n,
          poolUtilization0AtMint: 6000n,
          poolUtilization1AtMint: 6000n,
          timestampAtMint: 1700001000n,
          blockNumberAtMint: 950n,
          swapAtMint: true,
        },
      ]
      ;(getPositions as Mock).mockResolvedValue({
        positions: mockPositions,
        _meta: { blockNumber: 1000n },
      })

      await syncPositions({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      // Verify position data was stored
      const pos1Key = getPositionMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, tokenId1)
      const pos1Raw = await storage.get(pos1Key)
      expect(pos1Raw).not.toBeNull()

      const pos1Data = jsonSerializer.parse(pos1Raw!) as StoredPositionData
      expect(pos1Data.tokenId).toBe(tokenId1)
      expect(pos1Data.positionSize).toBe(1000n)
      expect(pos1Data.tickAtMint).toBe(100n)
      expect(pos1Data.legs).toHaveLength(1)

      const pos2Key = getPositionMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, tokenId2)
      const pos2Raw = await storage.get(pos2Key)
      expect(pos2Raw).not.toBeNull()

      const pos2Data = jsonSerializer.parse(pos2Raw!) as StoredPositionData
      expect(pos2Data.tokenId).toBe(tokenId2)
      expect(pos2Data.positionSize).toBe(2000n)
      expect(pos2Data.swapAtMint).toBe(true)
    })

    it('should store position data after incremental sync', async () => {
      const tokenId = 789n

      // Simulate existing checkpoint
      ;(loadCheckpoint as Mock).mockResolvedValue({
        lastBlock: 900n,
        lastBlockHash: TEST_BLOCK_HASH,
        positionIds: [],
      })
      ;(detectReorg as Mock).mockResolvedValue({ detected: false })

      // getOpenPositionIds returns the position
      ;(getOpenPositionIds as Mock).mockResolvedValue([tokenId])
      ;(getPositions as Mock).mockResolvedValue({
        positions: [
          {
            tokenId,
            positionSize: 500n,
            legs: mockLegs,
            tickAtMint: 50n,
            poolUtilization0AtMint: 3000n,
            poolUtilization1AtMint: 3000n,
            timestampAtMint: 1700002000n,
            blockNumberAtMint: 990n,
            swapAtMint: false,
          },
        ],
        _meta: { blockNumber: 1000n },
      })

      const result = await syncPositions({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      // Should be incremental since checkpoint existed
      expect(result.incremental).toBe(true)

      // Verify position data was stored
      const posKey = getPositionMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, tokenId)
      const posRaw = await storage.get(posKey)
      expect(posRaw).not.toBeNull()

      const posData = jsonSerializer.parse(posRaw!) as StoredPositionData
      expect(posData.tokenId).toBe(tokenId)
      expect(posData.positionSize).toBe(500n)
    })

    it('should not call getPositions when no positions', async () => {
      // getOpenPositionIds returns empty, no events
      ;(getOpenPositionIds as Mock).mockResolvedValue([])
      ;(mockClient.getLogs as Mock).mockResolvedValue([])

      await syncPositions({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      // getPositions should not be called
      expect(getPositions).not.toHaveBeenCalled()
    })
  })

  describe('Integration with Storage Keys', () => {
    it('should use correct storage key format for pool metadata', async () => {
      ;(mockClient.getLogs as Mock).mockResolvedValue([])
      ;(getPositions as Mock).mockResolvedValue({ positions: [], _meta: {} })

      await syncPositions({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      // Verify the key format
      const expectedKey = getPoolMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS)
      expect(expectedKey).toContain('chain1')
      expect(expectedKey).toContain(TEST_POOL_ADDRESS.toLowerCase())
      expect(expectedKey).toContain('poolMeta')

      // Should be stored
      const stored = await storage.get(expectedKey)
      expect(stored).not.toBeNull()
    })

    it('should use correct storage key format for position metadata', async () => {
      const tokenId = 999n

      ;(getOpenPositionIds as Mock).mockResolvedValue([tokenId])
      ;(getPositions as Mock).mockResolvedValue({
        positions: [
          {
            tokenId,
            positionSize: 100n,
            legs: [],
            tickAtMint: 0n,
            poolUtilization0AtMint: 0n,
            poolUtilization1AtMint: 0n,
            timestampAtMint: 0n,
            blockNumberAtMint: 0n,
            swapAtMint: false,
          },
        ],
        _meta: { blockNumber: 1000n },
      })

      await syncPositions({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      // Verify the key format
      const expectedKey = getPositionMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, tokenId)
      expect(expectedKey).toContain('chain1')
      expect(expectedKey).toContain(TEST_POOL_ADDRESS.toLowerCase())
      expect(expectedKey).toContain('positionMeta')
      expect(expectedKey).toContain(tokenId.toString())

      // Should be stored
      const stored = await storage.get(expectedKey)
      expect(stored).not.toBeNull()
    })
  })

  describe('Error Propagation', () => {
    const tokenId1 = 123n
    const tokenId2 = 456n

    it('should propagate getOpenPositionIds rejection', async () => {
      ;(getOpenPositionIds as Mock).mockRejectedValue(
        new Error('RPC timeout fetching position IDs'),
      )

      await expect(
        syncPositions({
          client: mockClient,
          chainId: TEST_CHAIN_ID,
          poolAddress: TEST_POOL_ADDRESS,
          account: TEST_ACCOUNT,
          storage,
        }),
      ).rejects.toThrow('RPC timeout fetching position IDs')

      // getPositions should never be called if getOpenPositionIds fails
      expect(getPositions).not.toHaveBeenCalled()
    })

    it('should propagate getPositions rejection when getOpenPositionIds resolves', async () => {
      ;(getOpenPositionIds as Mock).mockResolvedValue([tokenId1, tokenId2])
      ;(getPositions as Mock).mockRejectedValue(new Error('RPC timeout fetching positions'))

      await expect(
        syncPositions({
          client: mockClient,
          chainId: TEST_CHAIN_ID,
          poolAddress: TEST_POOL_ADDRESS,
          account: TEST_ACCOUNT,
          storage,
        }),
      ).rejects.toThrow('RPC timeout fetching positions')

      // getOpenPositionIds succeeded, getPositions was called with the resolved IDs
      expect(getOpenPositionIds).toHaveBeenCalled()
      expect(getPositions).toHaveBeenCalledWith(
        expect.objectContaining({ tokenIds: [tokenId1, tokenId2] }),
      )

      // No position data should be stored
      const pos1Key = getPositionMetaKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, tokenId1)
      const stored = await storage.get(pos1Key)
      expect(stored).toBeNull()
    })
  })

  describe('Reorg Detection', () => {
    it('should detect reorg and still return correct positions', async () => {
      const tokenId = 111n

      ;(loadCheckpoint as Mock).mockResolvedValue({
        lastBlock: 900n,
        lastBlockHash: TEST_BLOCK_HASH,
        positionIds: [222n], // stale position from checkpoint
      })
      ;(detectReorg as Mock).mockResolvedValue({
        detected: true,
        reorgBlock: 895n,
      })
      ;(getOpenPositionIds as Mock).mockResolvedValue([tokenId])
      ;(getPositions as Mock).mockResolvedValue({
        positions: [
          {
            tokenId,
            positionSize: 100n,
            legs: [],
            tickAtMint: 0n,
            poolUtilization0AtMint: 0n,
            poolUtilization1AtMint: 0n,
            timestampAtMint: 0n,
            blockNumberAtMint: 0n,
            swapAtMint: false,
          },
        ],
        _meta: { blockNumber: 1000n },
      })

      let reorgDetected = false
      const result = await syncPositions({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        onUpdate: (event) => {
          if (event.type === 'reorg-detected') reorgDetected = true
        },
      })

      expect(reorgDetected).toBe(true)
      // getOpenPositionIds returns authoritative list regardless of reorg
      expect(result.positionIds).toEqual([tokenId])
      expect(result.positionCount).toBe(1n)
    })
  })
})
