/**
 * Tests for Uniswap V3/V4 LP position reads.
 * @module v2/reads/uniswapLpPosition.test
 */

import type { PublicClient } from 'viem'
import { BaseError, ExecutionRevertedError } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import {
  feesFromFeeGrowthDelta,
  getUniswapV3LpPositionState,
  getUniswapV4LpPositionState,
} from './uniswapLpPosition'

const NFPM_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const STATE_VIEW_ADDRESS = '0x2222222222222222222222222222222222222222' as const
const POSM_ADDRESS = '0x3333333333333333333333333333333333333333' as const
const OWNER = '0x4444444444444444444444444444444444444444' as const
const TOKEN0 = '0x5555555555555555555555555555555555555555' as const
const TOKEN1 = '0x6666666666666666666666666666666666666666' as const
const POOL_ID = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const

const MAX_UINT256 = 2n ** 256n - 1n
const Q128 = 2n ** 128n

const MOCK_BLOCK = {
  number: 12345678n,
  hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
  timestamp: 1700000000n,
}

function createMockClient(): PublicClient {
  return {
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    readContract: vi.fn(),
    simulateContract: vi.fn(),
    multicall: vi.fn(),
  } as unknown as PublicClient
}

/** A viem-shaped on-chain revert, as simulateContract surfaces one. */
function makeRevertError(): BaseError {
  return new BaseError('execution reverted', {
    cause: new ExecutionRevertedError({ message: 'execution reverted' }),
  })
}

describe('feesFromFeeGrowthDelta', () => {
  it('computes fees from a simple growth delta', () => {
    const delta = 5n * Q128
    expect(feesFromFeeGrowthDelta(delta, 0n, 100n)).toBe(500n)
  })

  it('wraps around uint256 when current < last (v4 underflow case)', () => {
    const last = MAX_UINT256 - Q128 + 1n // 1 full unit before wrap
    const current = Q128 // wrapped past 0
    // true delta = 2 * Q128 (mod 2^256)
    expect(feesFromFeeGrowthDelta(current, last, 7n)).toBe(14n)
  })

  it('returns 0 for zero liquidity', () => {
    expect(feesFromFeeGrowthDelta(123n * Q128, 0n, 0n)).toBe(0n)
  })
})

describe('getUniswapV3LpPositionState', () => {
  const mockPosition = [
    0n, // nonce
    OWNER, // operator
    TOKEN0,
    TOKEN1,
    3000, // fee
    -60_000, // tickLower
    60_000, // tickUpper
    123_456n, // liquidity
    0n,
    0n,
    0n,
    0n,
  ]

  it('returns position state with fees from collect simulation', async () => {
    const client = createMockClient()
    vi.mocked(client.readContract).mockResolvedValueOnce(mockPosition)
    vi.mocked(client.simulateContract).mockResolvedValueOnce({
      result: [111n, 222n],
    } as never)

    const result = await getUniswapV3LpPositionState({
      client,
      nfpmAddress: NFPM_ADDRESS,
      tokenId: 42n,
      owner: OWNER,
      blockNumber: 12_000_000n,
    })

    expect(result).toEqual({
      token0: TOKEN0,
      token1: TOKEN1,
      fee: 3000,
      tickLower: -60_000,
      tickUpper: 60_000,
      liquidity: 123_456n,
      fees0: 111n,
      fees1: 222n,
      _meta: {
        blockNumber: MOCK_BLOCK.number,
        blockHash: MOCK_BLOCK.hash,
        blockTimestamp: MOCK_BLOCK.timestamp,
      },
    })

    expect(client.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: NFPM_ADDRESS,
        functionName: 'collect',
        account: OWNER,
        args: [
          expect.objectContaining({
            tokenId: 42n,
            recipient: OWNER,
            amount0Max: 2n ** 128n - 1n,
            amount1Max: 2n ** 128n - 1n,
          }),
        ],
      }),
    )
    expect(client.getBlock).toHaveBeenCalledWith({
      blockNumber: 12_000_000n,
      includeTransactions: false,
    })
  })

  it('falls back to zero fees when the collect simulation reverts', async () => {
    const client = createMockClient()
    vi.mocked(client.readContract).mockResolvedValueOnce(mockPosition)
    vi.mocked(client.simulateContract).mockRejectedValueOnce(makeRevertError())

    const result = await getUniswapV3LpPositionState({
      client,
      nfpmAddress: NFPM_ADDRESS,
      tokenId: 42n,
      owner: OWNER,
    })

    expect(result.fees0).toBe(0n)
    expect(result.fees1).toBe(0n)
    expect(result.liquidity).toBe(123_456n)
  })

  it('propagates transport errors from the collect simulation instead of reporting zero fees', async () => {
    const client = createMockClient()
    vi.mocked(client.readContract).mockResolvedValueOnce(mockPosition)
    const rpcError = new Error('request timed out')
    vi.mocked(client.simulateContract).mockRejectedValueOnce(rpcError)

    await expect(
      getUniswapV3LpPositionState({
        client,
        nfpmAddress: NFPM_ADDRESS,
        tokenId: 42n,
        owner: OWNER,
      }),
    ).rejects.toBe(rpcError)
  })

  it('propagates errors from the positions read', async () => {
    const client = createMockClient()
    const rpcError = new Error('HTTP request failed')
    vi.mocked(client.readContract).mockRejectedValueOnce(rpcError)

    await expect(
      getUniswapV3LpPositionState({
        client,
        nfpmAddress: NFPM_ADDRESS,
        tokenId: 42n,
        owner: OWNER,
      }),
    ).rejects.toBe(rpcError)
  })
})

describe('getUniswapV4LpPositionState', () => {
  it('reads position info + fee growth and derives fees', async () => {
    const client = createMockClient()
    const liquidity = 1_000n
    const last0 = 10n * Q128
    const last1 = 20n * Q128
    const current0 = 13n * Q128 // +3 per unit of liquidity
    const current1 = 25n * Q128 // +5 per unit of liquidity

    vi.mocked(client.multicall).mockResolvedValueOnce([
      [liquidity, last0, last1],
      [current0, current1],
    ] as never)

    const result = await getUniswapV4LpPositionState({
      client,
      stateViewAddress: STATE_VIEW_ADDRESS,
      positionManagerAddress: POSM_ADDRESS,
      poolId: POOL_ID,
      tokenId: 7n,
      tickLower: -100,
      tickUpper: 100,
      blockNumber: 12_000_000n,
    })

    expect(result).toEqual({
      liquidity,
      tickLower: -100,
      tickUpper: 100,
      fees0: 3_000n,
      fees1: 5_000n,
      _meta: {
        blockNumber: MOCK_BLOCK.number,
        blockHash: MOCK_BLOCK.hash,
        blockTimestamp: MOCK_BLOCK.timestamp,
      },
    })

    const call = vi.mocked(client.multicall).mock.calls[0][0]
    expect(call.contracts[0]).toMatchObject({
      address: STATE_VIEW_ADDRESS,
      functionName: 'getPositionInfo',
      args: [
        POOL_ID,
        POSM_ADDRESS,
        -100,
        100,
        // posm salt = bytes32(tokenId)
        '0x0000000000000000000000000000000000000000000000000000000000000007',
      ],
    })
    expect(call.contracts[1]).toMatchObject({
      functionName: 'getFeeGrowthInside',
      args: [POOL_ID, -100, 100],
    })
    expect(client.getBlock).toHaveBeenCalledWith({
      blockNumber: 12_000_000n,
      includeTransactions: false,
    })
  })

  it('propagates errors from the StateView multicall', async () => {
    const client = createMockClient()
    const rpcError = new Error('429 rate limited')
    vi.mocked(client.multicall).mockRejectedValueOnce(rpcError)

    await expect(
      getUniswapV4LpPositionState({
        client,
        stateViewAddress: STATE_VIEW_ADDRESS,
        positionManagerAddress: POSM_ADDRESS,
        poolId: POOL_ID,
        tokenId: 7n,
        tickLower: -100,
        tickUpper: 100,
      }),
    ).rejects.toBe(rpcError)
  })
})
