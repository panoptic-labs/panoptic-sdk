/**
 * Tests for the sync module.
 * @module v2/sync/sync.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChunkLimitError } from '../errors'
import type { StorageAdapter } from '../storage'
import { createMemoryStorage } from '../storage'
import type { ClosedPosition } from '../types'
import { MAX_TRACKED_CHUNKS, WAD } from '../utils/constants'
import type { LiquidityChunkKey, PendingPosition } from './index'
import {
  addPendingPosition,
  addTrackedChunks,
  calculateResyncBlock,
  calculateSpreadWad,
  cleanupStalePendingPositions,
  clearCheckpoint,
  clearPendingPositions,
  clearTrackedChunks,
  clearTrackedPositions,
  clearTradeHistory,
  confirmPendingPosition,
  failPendingPosition,
  getPendingPositions,
  getRealizedPnL,
  getSyncStatus,
  getTrackedChunks,
  getTrackedPositionIds,
  getTradeHistory,
  isPositionTracked,
  loadCheckpoint,
  removeTrackedChunks,
  saveCheckpoint,
  saveClosedPosition,
} from './index'

// Test constants
const TEST_CHAIN_ID = 1n
const TEST_POOL_ADDRESS = '0x1234567890123456789012345678901234567890' as const
const TEST_ACCOUNT = '0xabcdef1234567890abcdef1234567890abcdef12' as const
const TEST_TX_HASH = '0x0000000000000000000000000000000000000000000000000000000000000001' as const
const TEST_BLOCK_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000002' as const

describe('Sync Module', () => {
  let storage: StorageAdapter

  beforeEach(() => {
    storage = createMemoryStorage()
  })

  describe('getSyncStatus', () => {
    it('should return not synced when no checkpoint exists', async () => {
      const mockClient = {
        getBlockNumber: vi.fn().mockResolvedValue(1000n),
      } as unknown as Parameters<typeof getSyncStatus>[0]['client']

      const status = await getSyncStatus({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(status.hasCheckpoint).toBe(false)
      expect(status.isSynced).toBe(false)
      expect(status.lastSyncedBlock).toBe(0n)
      expect(status.blocksBehind).toBe(1000n)
      expect(status.positionCount).toBe(0n)
    })

    it('should return synced status when checkpoint matches current block', async () => {
      // Save a checkpoint
      await saveCheckpoint({
        storage,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        lastBlock: 1000n,
        lastBlockHash: TEST_BLOCK_HASH,
        positionIds: [123n, 456n],
      })

      const mockClient = {
        getBlockNumber: vi.fn().mockResolvedValue(1000n),
      } as unknown as Parameters<typeof getSyncStatus>[0]['client']

      const status = await getSyncStatus({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(status.hasCheckpoint).toBe(true)
      expect(status.isSynced).toBe(true)
      expect(status.lastSyncedBlock).toBe(1000n)
      expect(status.blocksBehind).toBe(0n)
      expect(status.positionCount).toBe(2n)
    })

    it('should show blocks behind when checkpoint is stale', async () => {
      await saveCheckpoint({
        storage,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        lastBlock: 900n,
        lastBlockHash: TEST_BLOCK_HASH,
        positionIds: [],
      })

      const mockClient = {
        getBlockNumber: vi.fn().mockResolvedValue(1000n),
      } as unknown as Parameters<typeof getSyncStatus>[0]['client']

      const status = await getSyncStatus({
        client: mockClient,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(status.isSynced).toBe(false)
      expect(status.blocksBehind).toBe(100n)
    })
  })

  describe('getTrackedPositionIds', () => {
    it('should return empty array when no positions tracked', async () => {
      const ids = await getTrackedPositionIds({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(ids).toEqual([])
    })

    it('should return tracked position IDs', async () => {
      // Manually save positions using the storage key format
      const { getPositionsKey, jsonSerializer } = await import('../storage')
      const key = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(key, jsonSerializer.stringify([111n, 222n, 333n]))

      const ids = await getTrackedPositionIds({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(ids).toHaveLength(3)
      expect(ids).toContainEqual(111n)
      expect(ids).toContainEqual(222n)
      expect(ids).toContainEqual(333n)
    })

    it('should check if position is tracked', async () => {
      const { getPositionsKey, jsonSerializer } = await import('../storage')
      const key = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(key, jsonSerializer.stringify([111n, 222n]))

      const params = {
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      }

      expect(await isPositionTracked(params, 111n)).toBe(true)
      expect(await isPositionTracked(params, 999n)).toBe(false)
    })

    it('should clear tracked positions', async () => {
      const { getPositionsKey, jsonSerializer } = await import('../storage')
      const key = getPositionsKey(TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)
      await storage.set(key, jsonSerializer.stringify([111n]))

      await clearTrackedPositions({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      const ids = await getTrackedPositionIds({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(ids).toEqual([])
    })
  })

  describe('Trade History', () => {
    const createClosedPosition = (
      tokenId: bigint,
      pnl0: bigint,
      pnl1: bigint,
      closeBlock: bigint,
    ): ClosedPosition => ({
      tokenId,
      owner: TEST_ACCOUNT,
      poolAddress: TEST_POOL_ADDRESS,
      positionSize: 1000n,
      openBlock: 100n,
      closeBlock,
      openTimestamp: 1700000000n,
      closeTimestamp: 1700001000n,
      tickAtOpen: 0n,
      tickAtClose: 100n,
      realizedPnL0: pnl0,
      realizedPnL1: pnl1,
      premiaCollected0: 0n,
      premiaCollected1: 0n,
      closureReason: 'closed',
    })

    it('should save and retrieve closed positions', async () => {
      const position = createClosedPosition(123n, 100n, 0n, 500n)

      await saveClosedPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        closedPosition: position,
      })

      const history = await getTradeHistory({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(history).toHaveLength(1)
      expect(history[0].tokenId).toBe(123n)
    })

    it('should sort positions by close block (most recent first)', async () => {
      await saveClosedPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        closedPosition: createClosedPosition(1n, 0n, 0n, 100n),
      })

      await saveClosedPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        closedPosition: createClosedPosition(2n, 0n, 0n, 300n),
      })

      await saveClosedPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        closedPosition: createClosedPosition(3n, 0n, 0n, 200n),
      })

      const history = await getTradeHistory({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(history[0].tokenId).toBe(2n) // Block 300
      expect(history[1].tokenId).toBe(3n) // Block 200
      expect(history[2].tokenId).toBe(1n) // Block 100
    })

    it('should apply pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await saveClosedPosition({
          chainId: TEST_CHAIN_ID,
          poolAddress: TEST_POOL_ADDRESS,
          account: TEST_ACCOUNT,
          storage,
          closedPosition: createClosedPosition(BigInt(i), 0n, 0n, BigInt(100 + i)),
        })
      }

      const page1 = await getTradeHistory({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        limit: 2n,
        offset: 0n,
      })

      const page2 = await getTradeHistory({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        limit: 2n,
        offset: 2n,
      })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
    })

    it('should calculate realized PnL', async () => {
      await saveClosedPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        closedPosition: createClosedPosition(1n, 100n, 0n, 100n),
      })

      await saveClosedPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        closedPosition: createClosedPosition(2n, -50n, 0n, 200n),
      })

      await saveClosedPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        closedPosition: createClosedPosition(3n, 75n, 0n, 300n),
      })

      const pnl = await getRealizedPnL({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(pnl.total0).toBe(125n) // 100 - 50 + 75
      expect(pnl.positionCount).toBe(3n)
      expect(pnl.winCount).toBe(2n) // 1 and 3 are winners
      expect(pnl.lossCount).toBe(1n) // 2 is loser
    })

    it('should clear trade history', async () => {
      await saveClosedPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        closedPosition: createClosedPosition(1n, 0n, 0n, 100n),
      })

      await clearTradeHistory({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      const history = await getTradeHistory({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(history).toHaveLength(0)
    })
  })

  describe('Chunk Tracking', () => {
    it('should add and retrieve tracked chunks', async () => {
      const chunks: LiquidityChunkKey[] = [
        { tokenType: 0n, tickLower: 100n, tickUpper: 200n },
        { tokenType: 1n, tickLower: 200n, tickUpper: 300n },
      ]

      await addTrackedChunks({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        storage,
        chunks,
      })

      const tracked = await getTrackedChunks({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        storage,
      })

      expect(tracked).toHaveLength(2)
    })

    it('should remove tracked chunks', async () => {
      const chunks: LiquidityChunkKey[] = [
        { tokenType: 0n, tickLower: 100n, tickUpper: 200n },
        { tokenType: 1n, tickLower: 200n, tickUpper: 300n },
      ]

      await addTrackedChunks({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        storage,
        chunks,
      })

      await removeTrackedChunks({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        storage,
        chunks: [{ tokenType: 0n, tickLower: 100n, tickUpper: 200n }],
      })

      const tracked = await getTrackedChunks({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        storage,
      })

      expect(tracked).toHaveLength(1)
      expect(tracked[0].tokenType).toBe(1n)
    })

    it('should throw ChunkLimitError when exceeding limit', async () => {
      // Add max chunks
      const chunks: LiquidityChunkKey[] = []
      for (let i = 0; i < MAX_TRACKED_CHUNKS; i++) {
        chunks.push({ tokenType: 0n, tickLower: BigInt(i * 100), tickUpper: BigInt(i * 100 + 50) })
      }

      await addTrackedChunks({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        storage,
        chunks,
      })

      // Try to add one more
      await expect(
        addTrackedChunks({
          chainId: TEST_CHAIN_ID,
          poolAddress: TEST_POOL_ADDRESS,
          storage,
          chunks: [{ tokenType: 1n, tickLower: 999999n, tickUpper: 999999n + 50n }],
        }),
      ).rejects.toThrow(ChunkLimitError)
    })

    it('should calculate spread correctly', () => {
      // With no removed liquidity, spread = 1.0x
      expect(calculateSpreadWad(1000n, 0n)).toBe(WAD)

      // With removed liquidity, spread > 1.0x
      // spread = 1 + (1/4) * 400/1000 = 1 + 0.1 = 1.1x
      const spread = calculateSpreadWad(1000n, 400n, 4n)
      expect(spread).toBe(WAD + WAD / 10n)

      // With zero net liquidity, return 1.0x
      expect(calculateSpreadWad(0n, 100n)).toBe(WAD)
    })

    it('should clear tracked chunks', async () => {
      await addTrackedChunks({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        storage,
        chunks: [{ tokenType: 0n, tickLower: 100n, tickUpper: 200n }],
      })

      await clearTrackedChunks({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        storage,
      })

      const tracked = await getTrackedChunks({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        storage,
      })

      expect(tracked).toHaveLength(0)
    })
  })

  describe('Pending Positions', () => {
    const createPendingPosition = (tokenId: bigint, block: bigint): PendingPosition => ({
      tokenId,
      owner: TEST_ACCOUNT,
      poolAddress: TEST_POOL_ADDRESS,
      positionSize: 1000n,
      legs: [],
      txHash: TEST_TX_HASH,
      submittedAtBlock: block,
      submittedAt: 1700000000n,
      status: 'pending',
    })

    it('should add and retrieve pending positions', async () => {
      await addPendingPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        position: createPendingPosition(123n, 100n),
      })

      const pending = await getPendingPositions({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(pending).toHaveLength(1)
      expect(pending[0].tokenId).toBe(123n)
      expect(pending[0].status).toBe('pending')
    })

    it('should confirm pending position', async () => {
      await addPendingPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        position: createPendingPosition(123n, 100n),
      })

      await confirmPendingPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        tokenId: 123n,
      })

      const pending = await getPendingPositions({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      // Confirmed positions are removed from pending
      expect(pending).toHaveLength(0)
    })

    it('should fail pending position', async () => {
      await addPendingPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        position: createPendingPosition(123n, 100n),
      })

      await failPendingPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        txHash: TEST_TX_HASH,
      })

      const pending = await getPendingPositions({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(pending).toHaveLength(0)
    })

    it('should cleanup stale pending positions', async () => {
      await addPendingPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        position: createPendingPosition(1n, 100n), // Old
      })

      await addPendingPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        position: createPendingPosition(2n, 950n), // Recent
      })

      await cleanupStalePendingPositions(
        {
          chainId: TEST_CHAIN_ID,
          poolAddress: TEST_POOL_ADDRESS,
          account: TEST_ACCOUNT,
          storage,
        },
        1000n, // Current block
        100n, // Max age
      )

      const pending = await getPendingPositions({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(pending).toHaveLength(1)
      expect(pending[0].tokenId).toBe(2n)
    })

    it('should clear all pending positions', async () => {
      await addPendingPosition({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
        position: createPendingPosition(1n, 100n),
      })

      await clearPendingPositions({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      const pending = await getPendingPositions({
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        storage,
      })

      expect(pending).toHaveLength(0)
    })
  })

  describe('Checkpoint Management', () => {
    it('should save and load checkpoint', async () => {
      await saveCheckpoint({
        storage,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        lastBlock: 1000n,
        lastBlockHash: TEST_BLOCK_HASH,
        positionIds: [111n, 222n],
      })

      const checkpoint = await loadCheckpoint(
        storage,
        TEST_CHAIN_ID,
        TEST_POOL_ADDRESS,
        TEST_ACCOUNT,
      )

      expect(checkpoint).not.toBeNull()
      expect(checkpoint?.lastBlock).toBe(1000n)
      expect(checkpoint?.lastBlockHash).toBe(TEST_BLOCK_HASH)
      expect(checkpoint?.positionIds).toEqual([111n, 222n])
    })

    it('should return null when no checkpoint exists', async () => {
      const checkpoint = await loadCheckpoint(
        storage,
        TEST_CHAIN_ID,
        TEST_POOL_ADDRESS,
        TEST_ACCOUNT,
      )

      expect(checkpoint).toBeNull()
    })

    it('should clear checkpoint', async () => {
      await saveCheckpoint({
        storage,
        chainId: TEST_CHAIN_ID,
        poolAddress: TEST_POOL_ADDRESS,
        account: TEST_ACCOUNT,
        lastBlock: 1000n,
        lastBlockHash: TEST_BLOCK_HASH,
        positionIds: [],
      })

      await clearCheckpoint(storage, TEST_CHAIN_ID, TEST_POOL_ADDRESS, TEST_ACCOUNT)

      const checkpoint = await loadCheckpoint(
        storage,
        TEST_CHAIN_ID,
        TEST_POOL_ADDRESS,
        TEST_ACCOUNT,
      )

      expect(checkpoint).toBeNull()
    })
  })

  describe('Reorg Handling', () => {
    it('should calculate resync block correctly', () => {
      // Normal case: roll back 128 blocks
      expect(calculateResyncBlock(1000n, 128n)).toBe(872n)

      // Edge case: don't go below 0
      expect(calculateResyncBlock(50n, 128n)).toBe(0n)

      // Exactly at reorg depth
      expect(calculateResyncBlock(128n, 128n)).toBe(0n)
    })
  })
})
