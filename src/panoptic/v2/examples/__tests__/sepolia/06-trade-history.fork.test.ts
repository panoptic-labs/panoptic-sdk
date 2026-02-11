/**
 * Trade history fork tests against Sepolia
 *
 * Tests the trade history functionality:
 * - Saving closed positions to storage
 * - Querying trade history with filters
 * - Pagination (limit/offset)
 * - Realized PnL aggregation
 * - Clearing trade history
 *
 * NOTE: Actual PnL calculation requires PanopticQuery contract (not yet finalized).
 * These tests use mock/placeholder PnL values for demonstration.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/sepolia/06-trade-history.fork.test.ts
 *
 * @module examples/__tests__/sepolia/06-trade-history.fork.test
 */

import type { Address } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

// SDK imports - storage
import { type StorageAdapter, createMemoryStorage } from '../../../storage'
// SDK imports - trade history
import {
  clearTradeHistory,
  getClosedPositions,
  getRealizedPnL,
  getTradeHistory,
  saveClosedPosition,
} from '../../../sync'
// SDK imports - types
import type { ClosedPosition } from '../../../types'
// Test config
import { SEPOLIA_ANVIL_CONFIG, SEPOLIA_CONTRACTS } from '../sepolia.config'

describe('Sepolia Fork: Trade History', () => {
  let storage: StorageAdapter
  const chainId = SEPOLIA_ANVIL_CONFIG.chainId
  const poolAddress = SEPOLIA_CONTRACTS.pool.address
  const testAccount = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

  /**
   * Create a sample closed position for testing.
   *
   * NOTE: realizedPnL and premiaCollected values are placeholders.
   * TODO: Actual values require PanopticQuery contract (not yet finalized).
   */
  function createMockClosedPosition(
    tokenId: bigint,
    overrides: Partial<ClosedPosition> = {},
  ): ClosedPosition {
    const now = BigInt(Math.floor(Date.now() / 1000))
    return {
      tokenId,
      owner: testAccount,
      poolAddress,
      positionSize: 1000000000000000000n, // 1e18
      openBlock: 18000000n,
      closeBlock: 18000100n,
      openTimestamp: now - 86400n, // 1 day ago
      closeTimestamp: now,
      tickAtOpen: 200000n,
      tickAtClose: 200050n,
      // TODO: These should be computed via PanopticQuery
      realizedPnL0: 0n,
      realizedPnL1: 0n,
      premiaCollected0: 0n,
      premiaCollected1: 0n,
      closureReason: 'closed',
      ...overrides,
    }
  }

  beforeEach(() => {
    // Fresh storage for each test
    storage = createMemoryStorage()
  })

  describe('saveClosedPosition()', () => {
    it('should save a closed position to storage', async () => {
      const position = createMockClosedPosition(12345n)

      await saveClosedPosition({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closedPosition: position,
      })

      // Verify it was saved
      const history = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      expect(history.length).toBe(1)
      expect(history[0].tokenId).toBe(12345n)
    })

    it('should save multiple positions and maintain order by closeBlock', async () => {
      const positions = [
        createMockClosedPosition(1n, { closeBlock: 100n }),
        createMockClosedPosition(2n, { closeBlock: 300n }),
        createMockClosedPosition(3n, { closeBlock: 200n }),
      ]

      for (const position of positions) {
        await saveClosedPosition({
          chainId,
          poolAddress,
          account: testAccount,
          storage,
          closedPosition: position,
        })
      }

      const history = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      // Should be sorted by closeBlock descending (most recent first)
      expect(history.length).toBe(3)
      expect(history[0].closeBlock).toBe(300n)
      expect(history[1].closeBlock).toBe(200n)
      expect(history[2].closeBlock).toBe(100n)
    })
  })

  describe('getTradeHistory()', () => {
    beforeEach(async () => {
      // Seed with test data
      const positions = [
        createMockClosedPosition(1n, {
          closeBlock: 100n,
          closureReason: 'closed',
          realizedPnL0: 100n,
          realizedPnL1: 50n,
        }),
        createMockClosedPosition(2n, {
          closeBlock: 200n,
          closureReason: 'liquidated',
          realizedPnL0: -200n,
          realizedPnL1: -100n,
        }),
        createMockClosedPosition(3n, {
          closeBlock: 300n,
          closureReason: 'force_exercised',
          realizedPnL0: 50n,
          realizedPnL1: 25n,
        }),
        createMockClosedPosition(4n, {
          closeBlock: 400n,
          closureReason: 'closed',
          realizedPnL0: 150n,
          realizedPnL1: 75n,
        }),
      ]

      for (const position of positions) {
        await saveClosedPosition({
          chainId,
          poolAddress,
          account: testAccount,
          storage,
          closedPosition: position,
        })
      }
    })

    it('should return all positions when no filters applied', async () => {
      const history = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      expect(history.length).toBe(4)
    })

    it('should filter by closure reason', async () => {
      const closedOnly = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closureReason: 'closed',
      })

      expect(closedOnly.length).toBe(2)
      closedOnly.forEach((p) => {
        expect(p.closureReason).toBe('closed')
      })

      const liquidatedOnly = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closureReason: 'liquidated',
      })

      expect(liquidatedOnly.length).toBe(1)
      expect(liquidatedOnly[0].closureReason).toBe('liquidated')

      const forceExercisedOnly = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closureReason: 'force_exercised',
      })

      expect(forceExercisedOnly.length).toBe(1)
      expect(forceExercisedOnly[0].closureReason).toBe('force_exercised')
    })

    it('should filter by fromBlock', async () => {
      const history = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        fromBlock: 250n,
      })

      expect(history.length).toBe(2)
      history.forEach((p) => {
        expect(p.closeBlock).toBeGreaterThanOrEqual(250n)
      })
    })

    it('should filter by toBlock', async () => {
      const history = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        toBlock: 250n,
      })

      expect(history.length).toBe(2)
      history.forEach((p) => {
        expect(p.closeBlock).toBeLessThanOrEqual(250n)
      })
    })

    it('should filter by block range (fromBlock and toBlock)', async () => {
      const history = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        fromBlock: 150n,
        toBlock: 350n,
      })

      expect(history.length).toBe(2)
      history.forEach((p) => {
        expect(p.closeBlock).toBeGreaterThanOrEqual(150n)
        expect(p.closeBlock).toBeLessThanOrEqual(350n)
      })
    })

    it('should apply pagination with limit', async () => {
      const page = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        limit: 2n,
      })

      expect(page.length).toBe(2)
      // Should be most recent first
      expect(page[0].closeBlock).toBe(400n)
      expect(page[1].closeBlock).toBe(300n)
    })

    it('should apply pagination with offset', async () => {
      const page = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        limit: 2n,
        offset: 2n,
      })

      expect(page.length).toBe(2)
      // Should skip first 2, get next 2
      expect(page[0].closeBlock).toBe(200n)
      expect(page[1].closeBlock).toBe(100n)
    })

    it('should combine filters with pagination', async () => {
      const page = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closureReason: 'closed',
        limit: 1n,
        offset: 0n,
      })

      expect(page.length).toBe(1)
      expect(page[0].closureReason).toBe('closed')
      // Most recent 'closed' position
      expect(page[0].closeBlock).toBe(400n)
    })

    it('should return empty array for non-existent account', async () => {
      const history = await getTradeHistory({
        chainId,
        poolAddress,
        account: '0x0000000000000000000000000000000000000001' as Address,
        storage,
      })

      expect(history).toEqual([])
    })
  })

  describe('getClosedPositions()', () => {
    it('should be an alias for getTradeHistory', async () => {
      const position = createMockClosedPosition(999n, { closureReason: 'liquidated' })

      await saveClosedPosition({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closedPosition: position,
      })

      const fromTradeHistory = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      const fromClosedPositions = await getClosedPositions({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      expect(fromClosedPositions).toEqual(fromTradeHistory)
    })
  })

  describe('getRealizedPnL()', () => {
    beforeEach(async () => {
      // Seed with positions that have different PnL outcomes
      // TODO: In production, these values would be computed via PanopticQuery
      const positions = [
        createMockClosedPosition(1n, {
          closeBlock: 100n,
          realizedPnL0: 100n, // Win
          realizedPnL1: 50n,
        }),
        createMockClosedPosition(2n, {
          closeBlock: 200n,
          realizedPnL0: -200n, // Loss
          realizedPnL1: -100n,
        }),
        createMockClosedPosition(3n, {
          closeBlock: 300n,
          realizedPnL0: 150n, // Win
          realizedPnL1: 75n,
        }),
      ]

      for (const position of positions) {
        await saveClosedPosition({
          chainId,
          poolAddress,
          account: testAccount,
          storage,
          closedPosition: position,
        })
      }
    })

    it('should aggregate PnL across all positions', async () => {
      const pnl = await getRealizedPnL({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      expect(pnl.positionCount).toBe(3n)
      expect(pnl.total0).toBe(50n) // 100 - 200 + 150
      expect(pnl.total1).toBe(25n) // 50 - 100 + 75
    })

    it('should count wins and losses correctly', async () => {
      const pnl = await getRealizedPnL({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      // 2 wins (positive PnL on both tokens), 1 loss (negative PnL on both tokens)
      expect(pnl.winCount).toBe(2n)
      expect(pnl.lossCount).toBe(1n)
    })

    it('should filter by block range', async () => {
      const pnl = await getRealizedPnL({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        fromBlock: 150n,
      })

      // Only positions at block 200 and 300
      expect(pnl.positionCount).toBe(2n)
      expect(pnl.total0).toBe(-50n) // -200 + 150
      expect(pnl.total1).toBe(-25n) // -100 + 75
    })

    it('should return zeros for empty history', async () => {
      const emptyStorage = createMemoryStorage()

      const pnl = await getRealizedPnL({
        chainId,
        poolAddress,
        account: testAccount,
        storage: emptyStorage,
      })

      expect(pnl.positionCount).toBe(0n)
      expect(pnl.total0).toBe(0n)
      expect(pnl.total1).toBe(0n)
      expect(pnl.winCount).toBe(0n)
      expect(pnl.lossCount).toBe(0n)
    })
  })

  describe('clearTradeHistory()', () => {
    it('should clear all trade history for an account', async () => {
      // Add some positions
      await saveClosedPosition({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closedPosition: createMockClosedPosition(1n),
      })
      await saveClosedPosition({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closedPosition: createMockClosedPosition(2n),
      })

      // Verify they exist
      let history = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })
      expect(history.length).toBe(2)

      // Clear
      await clearTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      // Verify cleared
      history = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })
      expect(history.length).toBe(0)
    })

    it('should not affect other accounts', async () => {
      const otherAccount = '0x0000000000000000000000000000000000000002' as Address

      // Add position for test account
      await saveClosedPosition({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closedPosition: createMockClosedPosition(1n),
      })

      // Add position for other account
      await saveClosedPosition({
        chainId,
        poolAddress,
        account: otherAccount,
        storage,
        closedPosition: createMockClosedPosition(2n, { owner: otherAccount }),
      })

      // Clear test account
      await clearTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      // Test account should be empty
      const testHistory = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })
      expect(testHistory.length).toBe(0)

      // Other account should still have data
      const otherHistory = await getTradeHistory({
        chainId,
        poolAddress,
        account: otherAccount,
        storage,
      })
      expect(otherHistory.length).toBe(1)
    })
  })

  describe('Storage isolation', () => {
    it('should not leak data between storage instances', async () => {
      const storage1 = createMemoryStorage()
      const storage2 = createMemoryStorage()

      // Save to storage1
      await saveClosedPosition({
        chainId,
        poolAddress,
        account: testAccount,
        storage: storage1,
        closedPosition: createMockClosedPosition(1n),
      })

      // storage1 should have the position
      const history1 = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage: storage1,
      })
      expect(history1.length).toBe(1)

      // storage2 should be empty
      const history2 = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage: storage2,
      })
      expect(history2.length).toBe(0)
    })
  })

  describe('Data types', () => {
    it('should preserve bigint values through storage round-trip', async () => {
      const position = createMockClosedPosition(123456789012345678901234567890n, {
        positionSize: 999999999999999999999n,
        openBlock: 18000000n,
        closeBlock: 18000100n,
        openTimestamp: 1700000000n,
        closeTimestamp: 1700086400n,
        tickAtOpen: -200000n,
        tickAtClose: 200000n,
        realizedPnL0: -123456789012345678n,
        realizedPnL1: 987654321098765432n,
        premiaCollected0: 11111111111111111n,
        premiaCollected1: 22222222222222222n,
      })

      await saveClosedPosition({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
        closedPosition: position,
      })

      const [retrieved] = await getTradeHistory({
        chainId,
        poolAddress,
        account: testAccount,
        storage,
      })

      // All bigint fields should be preserved
      expect(retrieved.tokenId).toBe(123456789012345678901234567890n)
      expect(retrieved.positionSize).toBe(999999999999999999999n)
      expect(retrieved.openBlock).toBe(18000000n)
      expect(retrieved.closeBlock).toBe(18000100n)
      expect(retrieved.openTimestamp).toBe(1700000000n)
      expect(retrieved.closeTimestamp).toBe(1700086400n)
      expect(retrieved.tickAtOpen).toBe(-200000n)
      expect(retrieved.tickAtClose).toBe(200000n)
      expect(retrieved.realizedPnL0).toBe(-123456789012345678n)
      expect(retrieved.realizedPnL1).toBe(987654321098765432n)
      expect(retrieved.premiaCollected0).toBe(11111111111111111n)
      expect(retrieved.premiaCollected1).toBe(22222222222222222n)
    })
  })
})
