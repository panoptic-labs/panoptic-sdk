/**
 * Tests for SFPM read functions.
 * @module v2/reads/sfpm.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import {
  getChunkLiquidities,
  getEnforcedTickLimits,
  getUniswapV3PoolFromId,
  getUniswapV4PoolKeyFromId,
} from './sfpm'

const SFPM_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const POOL_ADDRESS = '0x2222222222222222222222222222222222222222' as const

const MOCK_BLOCK = {
  number: 12345678n,
  hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
  timestamp: 1700000000n,
}

function createMockClient(): PublicClient {
  return {
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK.number),
    multicall: vi.fn(),
    readContract: vi.fn(),
  } as unknown as PublicClient
}

describe('SFPM Read Functions', () => {
  describe('getUniswapV3PoolFromId', () => {
    it('should resolve poolId to V3 pool address', async () => {
      const client = createMockClient()
      const expectedPool = '0x3333333333333333333333333333333333333333' as const
      ;(client.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(expectedPool)

      const result = await getUniswapV3PoolFromId({
        client,
        sfpmAddress: SFPM_ADDRESS,
        poolId: 42n,
      })

      expect(result).toBe(expectedPool)
      expect(client.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: SFPM_ADDRESS,
          functionName: 'getUniswapV3PoolFromId',
          args: [42n],
        }),
      )
    })
  })

  describe('getUniswapV4PoolKeyFromId', () => {
    it('should resolve poolId to V4 pool key with bigint fee/tickSpacing', async () => {
      const client = createMockClient()
      ;(client.readContract as ReturnType<typeof vi.fn>).mockResolvedValue({
        currency0: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        currency1: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        fee: 500, // ABI returns number
        tickSpacing: 10, // ABI returns number
        hooks: '0x0000000000000000000000000000000000000000',
      })

      const result = await getUniswapV4PoolKeyFromId({
        client,
        sfpmAddress: SFPM_ADDRESS,
        poolId: 7n,
      })

      expect(result.fee).toBe(500n)
      expect(result.tickSpacing).toBe(10n)
      expect(typeof result.fee).toBe('bigint')
      expect(typeof result.tickSpacing).toBe('bigint')
      expect(result.currency0).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    })
  })

  describe('getEnforcedTickLimits', () => {
    it('should return min and max enforced ticks', async () => {
      const client = createMockClient()
      ;(client.readContract as ReturnType<typeof vi.fn>).mockResolvedValue([-887220, 887220])

      const result = await getEnforcedTickLimits({
        client,
        sfpmAddress: SFPM_ADDRESS,
        poolId: 123n,
      })

      expect(result).toEqual({
        minEnforcedTick: -887220,
        maxEnforcedTick: 887220,
      })
      expect(client.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: SFPM_ADDRESS,
          functionName: 'getEnforcedTickLimits',
          args: [123n],
        }),
      )
    })
  })

  describe('getChunkLiquidities', () => {
    const POOL_KEY_BYTES = '0xdeadbeef' as `0x${string}`

    it('should return empty results for empty chunks', async () => {
      const client = createMockClient()

      const result = await getChunkLiquidities({
        client,
        sfpmAddress: SFPM_ADDRESS,
        poolKeyBytes: POOL_KEY_BYTES,
        chunks: [],
      })

      expect(result.results).toEqual([])
      expect(result._meta.blockNumber).toBe(MOCK_BLOCK.number)
    })

    it('should decode packed liquidity correctly', async () => {
      const client = createMockClient()
      const netLiquidity = 1000n
      const removedLiquidity = 250n
      const packed = (removedLiquidity << 128n) | netLiquidity
      ;(client.multicall as ReturnType<typeof vi.fn>).mockResolvedValue([
        { status: 'success', result: packed },
      ])

      const result = await getChunkLiquidities({
        client,
        sfpmAddress: SFPM_ADDRESS,
        poolKeyBytes: POOL_KEY_BYTES,
        chunks: [
          {
            owner: POOL_ADDRESS,
            tokenType: 0n,
            tickLower: -100n,
            tickUpper: 100n,
          },
        ],
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0]).toEqual({
        netLiquidity: 1000n,
        removedLiquidity: 250n,
        totalLiquidity: 1250n,
        shortLiquidity: 1250n,
        longLiquidity: 250n,
      })
    })

    it('should handle failed multicall results gracefully', async () => {
      const client = createMockClient()
      ;(client.multicall as ReturnType<typeof vi.fn>).mockResolvedValue([
        { status: 'failure', error: new Error('revert') },
      ])

      const result = await getChunkLiquidities({
        client,
        sfpmAddress: SFPM_ADDRESS,
        poolKeyBytes: POOL_KEY_BYTES,
        chunks: [
          {
            owner: POOL_ADDRESS,
            tokenType: 0n,
            tickLower: 0n,
            tickUpper: 100n,
          },
        ],
      })

      expect(result.results[0].netLiquidity).toBe(0n)
      expect(result.results[0].totalLiquidity).toBe(0n)
    })

    it('should throw ChunkLimitError when exceeding max chunks', async () => {
      const client = createMockClient()
      const chunks = Array.from({ length: 1001 }, (_, i) => ({
        owner: POOL_ADDRESS,
        tokenType: 0n,
        tickLower: BigInt(i * 10),
        tickUpper: BigInt(i * 10 + 10),
      }))

      await expect(
        getChunkLiquidities({
          client,
          sfpmAddress: SFPM_ADDRESS,
          poolKeyBytes: POOL_KEY_BYTES,
          chunks,
        }),
      ).rejects.toThrow()
    })

    it('should use provided _meta instead of fetching', async () => {
      const client = createMockClient()
      const customMeta = {
        blockNumber: 99999n,
        blockTimestamp: 1700000099n,
        blockHash:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
      }

      const result = await getChunkLiquidities({
        client,
        sfpmAddress: SFPM_ADDRESS,
        poolKeyBytes: POOL_KEY_BYTES,
        chunks: [],
        _meta: customMeta,
      })

      expect(result._meta).toBe(customMeta)
      expect(client.getBlock).not.toHaveBeenCalled()
    })
  })
})
