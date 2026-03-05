/**
 * Tests for getPositionEnrichmentData.
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getPositionEnrichmentData } from './enrichment'

// --- Test Constants ---

const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const ACCOUNT_ADDRESS = '0x2222222222222222222222222222222222222222' as const
const QUERY_ADDRESS = '0x3333333333333333333333333333333333333333' as const

const MOCK_BLOCK = {
  number: 12345678n,
  hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`,
  timestamp: 1700000000n,
}

const TOKEN_ID_1 = 1000n
const TOKEN_ID_2 = 2000n

// Mock checkCollateral result: [effectiveBal0, effectiveReq0, effectiveBal1, effectiveReq1]
const MOCK_COLLATERAL = [10000n, 5000n, 20000n, 8000n] as const
const MOCK_COLLATERAL_AT_MINT = [9000n, 4000n, 18000n, 7000n] as const
const ZERO_COLLATERAL = [0n, 0n, 0n, 0n] as const

// --- Helpers ---

function createMockClient(): PublicClient {
  return {
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK.number),
    multicall: vi.fn(),
    readContract: vi.fn(),
  } as unknown as PublicClient
}

/**
 * Pack two 128-bit values into a single 256-bit value (LeftRightUnsigned format).
 * right = token0 (lower 128 bits), left = token1 (upper 128 bits)
 */
function packLeftRight(right: bigint, left: bigint): bigint {
  return right + (left << 128n)
}

/**
 * Build the 5 multicall results for a single open position.
 */
function openPositionResults(
  shortPremium: bigint,
  longPremium: bigint,
  portfolio: [bigint, bigint],
  portfolioAtMint: [bigint, bigint],
  collateral: readonly [bigint, bigint, bigint, bigint] = MOCK_COLLATERAL,
  collateralAtMint: readonly [bigint, bigint, bigint, bigint] = MOCK_COLLATERAL_AT_MINT,
) {
  return [
    { status: 'success', result: [shortPremium, longPremium, [100n]] },
    { status: 'success', result: portfolio },
    { status: 'success', result: portfolioAtMint },
    { status: 'success', result: collateral },
    { status: 'success', result: collateralAtMint },
  ]
}

/**
 * Build the 4 multicall results for a single closed position.
 */
function closedPositionResults(
  portfolioAtBurn: [bigint, bigint],
  portfolioAtMint: [bigint, bigint],
  collateral: readonly [bigint, bigint, bigint, bigint] = MOCK_COLLATERAL,
  collateralAtMint: readonly [bigint, bigint, bigint, bigint] = MOCK_COLLATERAL_AT_MINT,
) {
  return [
    { status: 'success', result: portfolioAtBurn },
    { status: 'success', result: portfolioAtMint },
    { status: 'success', result: collateral },
    { status: 'success', result: collateralAtMint },
  ]
}

// --- Tests ---

describe('getPositionEnrichmentData', () => {
  describe('empty positions', () => {
    it('should return empty map for no positions', async () => {
      const client = createMockClient()

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [],
        currentTick: 100,
      })

      expect(result.byTokenId.size).toBe(0)
      expect(result._meta.blockNumber).toBe(MOCK_BLOCK.number)
      expect(result._meta.blockTimestamp).toBe(MOCK_BLOCK.timestamp)
      expect(result._meta.blockHash).toBe(MOCK_BLOCK.hash)
      expect(vi.mocked(client.multicall)).not.toHaveBeenCalled()
    })
  })

  describe('open positions', () => {
    it('should fetch premia, portfolio values, and collateral for a single open position', async () => {
      const client = createMockClient()

      const shortPremium = packLeftRight(1000n, 2000n)
      const longPremium = packLeftRight(100n, 200n)

      vi.mocked(client.multicall).mockResolvedValueOnce(
        openPositionResults(shortPremium, longPremium, [5000n, 6000n], [3000n, 4000n]),
      )

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: true,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
          },
        ],
        currentTick: 100,
      })

      expect(result.byTokenId.size).toBe(1)

      const e = result.byTokenId.get(TOKEN_ID_1.toString())!
      expect(e.premiaOwed0).toBe(900n)
      expect(e.premiaOwed1).toBe(1800n)
      expect(e.portfolioValue0).toBe(5000n)
      expect(e.portfolioValue1).toBe(6000n)
      expect(e.portfolioValueAtMint0).toBe(3000n)
      expect(e.portfolioValueAtMint1).toBe(4000n)
      // Collateral at pnlEndTick
      expect(e.collateralEffectiveBal0).toBe(10000n)
      expect(e.collateralEffectiveReq0).toBe(5000n)
      expect(e.collateralEffectiveBal1).toBe(20000n)
      expect(e.collateralEffectiveReq1).toBe(8000n)
      // Collateral at mintTick
      expect(e.collateralAtMintEffectiveBal0).toBe(9000n)
      expect(e.collateralAtMintEffectiveReq0).toBe(4000n)
      expect(e.collateralAtMintEffectiveBal1).toBe(18000n)
      expect(e.collateralAtMintEffectiveReq1).toBe(7000n)
      expect(result._meta.blockNumber).toBe(MOCK_BLOCK.number)
    })

    it('should handle multiple open positions in a single multicall', async () => {
      const client = createMockClient()

      const sp1 = packLeftRight(100n, 200n)
      const lp1 = packLeftRight(10n, 20n)
      const sp2 = packLeftRight(300n, 400n)
      const lp2 = packLeftRight(30n, 40n)

      // 10 results total: 5 per position
      vi.mocked(client.multicall).mockResolvedValueOnce([
        ...openPositionResults(sp1, lp1, [1000n, 2000n], [500n, 600n]),
        ...openPositionResults(sp2, lp2, [3000n, 4000n], [700n, 800n]),
      ])

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: true,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
          },
          {
            tokenId: TOKEN_ID_2,
            isOpen: true,
            tickAtMint: 60,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
          },
        ],
        currentTick: 100,
      })

      expect(result.byTokenId.size).toBe(2)

      const e1 = result.byTokenId.get(TOKEN_ID_1.toString())!
      expect(e1.premiaOwed0).toBe(90n)
      expect(e1.premiaOwed1).toBe(180n)
      expect(e1.portfolioValue0).toBe(1000n)

      const e2 = result.byTokenId.get(TOKEN_ID_2.toString())!
      expect(e2.premiaOwed0).toBe(270n)
      expect(e2.premiaOwed1).toBe(360n)
      expect(e2.portfolioValue0).toBe(3000n)
    })

    it('should throw EnrichmentCallError when core calls fail', async () => {
      const client = createMockClient()

      const sp = packLeftRight(100n, 200n)
      const lp = packLeftRight(10n, 20n)

      // First position: all succeed
      // Second position: premia call fails → throws EnrichmentCallError
      vi.mocked(client.multicall).mockResolvedValueOnce([
        ...openPositionResults(sp, lp, [1000n, 2000n], [500n, 600n]),
        { status: 'failure', error: new Error('Position not found') },
        { status: 'success', result: [3000n, 4000n] },
        { status: 'success', result: [700n, 800n] },
        { status: 'success', result: MOCK_COLLATERAL },
        { status: 'success', result: MOCK_COLLATERAL_AT_MINT },
      ])

      await expect(
        getPositionEnrichmentData({
          client,
          queryAddress: QUERY_ADDRESS,
          positions: [
            {
              tokenId: TOKEN_ID_1,
              isOpen: true,
              tickAtMint: 50,
              account: ACCOUNT_ADDRESS,
              poolAddress: POOL_ADDRESS,
            },
            {
              tokenId: TOKEN_ID_2,
              isOpen: true,
              tickAtMint: 60,
              account: ACCOUNT_ADDRESS,
              poolAddress: POOL_ADDRESS,
            },
          ],
          currentTick: 100,
        }),
      ).rejects.toThrow('Enrichment call "getAccumulatedFeesAndPositionsData" failed')
    })

    it('should gracefully handle collateral call failure with zero values', async () => {
      const client = createMockClient()

      const sp = packLeftRight(100n, 200n)
      const lp = packLeftRight(10n, 20n)

      vi.mocked(client.multicall).mockResolvedValueOnce([
        { status: 'success', result: [sp, lp, [100n]] },
        { status: 'success', result: [1000n, 2000n] },
        { status: 'success', result: [500n, 600n] },
        { status: 'failure', error: new Error('checkCollateral reverted') },
        { status: 'success', result: MOCK_COLLATERAL_AT_MINT },
      ])

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: true,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
          },
        ],
        currentTick: 100,
      })

      const e = result.byTokenId.get(TOKEN_ID_1.toString())!
      // Core data still present
      expect(e.premiaOwed0).toBe(90n)
      expect(e.portfolioValue0).toBe(1000n)
      // Failed collateral defaults to 0
      expect(e.collateralEffectiveBal0).toBe(0n)
      expect(e.collateralEffectiveReq0).toBe(0n)
      // Mint collateral succeeded
      expect(e.collateralAtMintEffectiveReq0).toBe(4000n)
    })

    it('should pass correct block number to multicall', async () => {
      const client = createMockClient()

      const sp = packLeftRight(0n, 0n)
      const lp = packLeftRight(0n, 0n)

      vi.mocked(client.multicall).mockResolvedValueOnce(
        openPositionResults(sp, lp, [0n, 0n], [0n, 0n], ZERO_COLLATERAL, ZERO_COLLATERAL),
      )

      const customBlock = 99999n

      await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: true,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
          },
        ],
        currentTick: 100,
        blockNumber: customBlock,
      })

      expect(vi.mocked(client.multicall)).toHaveBeenCalledWith(
        expect.objectContaining({ blockNumber: customBlock }),
      )
    })
  })

  describe('closed positions', () => {
    it('should fetch portfolio values and collateral at burn and mint ticks', async () => {
      const client = createMockClient()

      vi.mocked(client.multicall).mockResolvedValueOnce(
        closedPositionResults([7000n, 8000n], [5000n, 6000n]),
      )

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: false,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
            tickAtBurn: 120,
            burnBlockNumber: 10000000n,
            burnPremium0: 500n,
            burnPremium1: 600n,
          },
        ],
        currentTick: 100,
      })

      expect(result.byTokenId.size).toBe(1)

      const e = result.byTokenId.get(TOKEN_ID_1.toString())!
      expect(e.premiaOwed0).toBe(500n)
      expect(e.premiaOwed1).toBe(600n)
      expect(e.portfolioValue0).toBe(7000n)
      expect(e.portfolioValue1).toBe(8000n)
      expect(e.portfolioValueAtMint0).toBe(5000n)
      expect(e.portfolioValueAtMint1).toBe(6000n)
      expect(e.collateralEffectiveReq0).toBe(5000n)
      expect(e.collateralAtMintEffectiveReq0).toBe(4000n)
    })

    it('should use burnBlockNumber - 1 as the read block', async () => {
      const client = createMockClient()

      vi.mocked(client.multicall).mockResolvedValueOnce(
        closedPositionResults([0n, 0n], [0n, 0n], ZERO_COLLATERAL, ZERO_COLLATERAL),
      )

      const burnBlock = 10000000n

      await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: false,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
            tickAtBurn: 120,
            burnBlockNumber: burnBlock,
            burnPremium0: 0n,
            burnPremium1: 0n,
          },
        ],
        currentTick: 100,
      })

      expect(vi.mocked(client.multicall)).toHaveBeenCalledWith(
        expect.objectContaining({ blockNumber: burnBlock - 1n }),
      )
    })

    it('should default burnPremium to 0 when not provided', async () => {
      const client = createMockClient()

      vi.mocked(client.multicall).mockResolvedValueOnce(
        closedPositionResults([1000n, 2000n], [500n, 600n]),
      )

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: false,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
            tickAtBurn: 120,
            burnBlockNumber: 10000000n,
          },
        ],
        currentTick: 100,
      })

      const e = result.byTokenId.get(TOKEN_ID_1.toString())!
      expect(e.premiaOwed0).toBe(0n)
      expect(e.premiaOwed1).toBe(0n)
    })

    it('should skip closed positions with no burnBlockNumber', async () => {
      const client = createMockClient()

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: false,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
            tickAtBurn: 120,
          },
        ],
        currentTick: 100,
      })

      expect(result.byTokenId.size).toBe(0)
    })

    it('should group closed positions by burnBlockNumber for batch efficiency', async () => {
      const client = createMockClient()
      const burnBlock = 10000000n

      // Both positions share the same burnBlockNumber → one multicall with 8 results (4 per position)
      vi.mocked(client.multicall).mockResolvedValueOnce([
        ...closedPositionResults([1000n, 2000n], [500n, 600n]),
        ...closedPositionResults([3000n, 4000n], [700n, 800n]),
      ])

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: false,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
            tickAtBurn: 120,
            burnBlockNumber: burnBlock,
            burnPremium0: 100n,
            burnPremium1: 200n,
          },
          {
            tokenId: TOKEN_ID_2,
            isOpen: false,
            tickAtMint: 60,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
            tickAtBurn: 130,
            burnBlockNumber: burnBlock,
            burnPremium0: 300n,
            burnPremium1: 400n,
          },
        ],
        currentTick: 100,
      })

      expect(result.byTokenId.size).toBe(2)
      expect(vi.mocked(client.multicall)).toHaveBeenCalledTimes(1)
    })
  })

  describe('mixed open and closed positions', () => {
    it('should handle both open and closed positions together', async () => {
      const client = createMockClient()

      const shortPremium = packLeftRight(1000n, 2000n)
      const longPremium = packLeftRight(100n, 200n)

      // Open: 5 calls, Closed: 4 calls — run in parallel, use dynamic mock
      vi.mocked(client.multicall).mockImplementation(
        async (args: Parameters<typeof client.multicall>[0]) => {
          const contractsLen = args.contracts.length
          if (contractsLen === 5) {
            return openPositionResults(
              shortPremium,
              longPremium,
              [5000n, 6000n],
              [3000n, 4000n],
            ) as Awaited<ReturnType<typeof client.multicall>>
          } else if (contractsLen === 4) {
            return closedPositionResults([7000n, 8000n], [1000n, 2000n]) as Awaited<
              ReturnType<typeof client.multicall>
            >
          }
          return [] as unknown as Awaited<ReturnType<typeof client.multicall>>
        },
      )

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: true,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
          },
          {
            tokenId: TOKEN_ID_2,
            isOpen: false,
            tickAtMint: 60,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
            tickAtBurn: 130,
            burnBlockNumber: 10000000n,
            burnPremium0: 500n,
            burnPremium1: 600n,
          },
        ],
        currentTick: 100,
      })

      expect(result.byTokenId.size).toBe(2)

      const openE = result.byTokenId.get(TOKEN_ID_1.toString())!
      expect(openE.premiaOwed0).toBe(900n)
      expect(openE.portfolioValue0).toBe(5000n)
      expect(openE.collateralEffectiveReq0).toBe(5000n)

      const closedE = result.byTokenId.get(TOKEN_ID_2.toString())!
      expect(closedE.premiaOwed0).toBe(500n)
      expect(closedE.portfolioValue0).toBe(7000n)
      expect(closedE.collateralEffectiveReq0).toBe(5000n)
    })
  })

  describe('pre-fetched _meta', () => {
    it('should use provided _meta and skip getBlockMeta call', async () => {
      const client = createMockClient()

      const customMeta = {
        blockNumber: 99999n,
        blockTimestamp: 1600000000n,
        blockHash:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
      }

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [],
        currentTick: 100,
        _meta: customMeta,
      })

      expect(result._meta).toEqual(customMeta)
      expect(vi.mocked(client.getBlock)).not.toHaveBeenCalled()
    })
  })

  describe('negative premia (long positions)', () => {
    it('should correctly compute negative premiaOwed when long > short', async () => {
      const client = createMockClient()

      const shortPremium = packLeftRight(100n, 200n)
      const longPremium = packLeftRight(500n, 600n)

      vi.mocked(client.multicall).mockResolvedValueOnce(
        openPositionResults(shortPremium, longPremium, [1000n, 2000n], [500n, 600n]),
      )

      const result = await getPositionEnrichmentData({
        client,
        queryAddress: QUERY_ADDRESS,
        positions: [
          {
            tokenId: TOKEN_ID_1,
            isOpen: true,
            tickAtMint: 50,
            account: ACCOUNT_ADDRESS,
            poolAddress: POOL_ADDRESS,
          },
        ],
        currentTick: 100,
      })

      const e = result.byTokenId.get(TOKEN_ID_1.toString())!
      expect(e.premiaOwed0).toBe(-400n)
      expect(e.premiaOwed1).toBe(-400n)
    })
  })
})
