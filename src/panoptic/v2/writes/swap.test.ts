import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InputListFailError, MissingPositionIdsError, SwapTokenMismatchError } from '../errors'
import { swapExactIn, swapExactInAndWait, swapExactOut, swapExactOutAndWait } from './swap'
import { submitWrite } from './utils'

const mockTxResult = vi.hoisted(() => ({
  hash: '0xabc' as `0x${string}`,
  wait: vi.fn().mockResolvedValue({
    hash: '0xabc' as `0x${string}`,
    blockNumber: 100n,
    blockHash: '0xblock' as `0x${string}`,
    gasUsed: 200000n,
    status: 'success' as const,
    events: [],
  }),
}))

vi.mock('../reads/pool', () => ({
  getPool: vi.fn().mockResolvedValue({
    poolId: 1n,
    currentTick: 200000n,
    collateralTracker0: {
      address: '0xCT0',
      token: '0xToken0',
      symbol: 'WETH',
      decimals: 18n,
      totalAssets: 0n,
      insideAMM: 0n,
      creditedShares: 0n,
      totalShares: 0n,
      utilization: 0n,
      borrowRate: 0n,
      supplyRate: 0n,
    },
    collateralTracker1: {
      address: '0xCT1',
      token: '0xToken1',
      symbol: 'USDC',
      decimals: 6n,
      totalAssets: 0n,
      insideAMM: 0n,
      creditedShares: 0n,
      totalShares: 0n,
      utilization: 0n,
      borrowRate: 0n,
      supplyRate: 0n,
    },
    poolKey: {
      currency0: '0xToken0',
      currency1: '0xToken1',
      fee: 500n,
      tickSpacing: 10n,
      hooks: '0x0000000000000000000000000000000000000000',
    },
    tickSpacing: 10n,
  }),
}))

vi.mock('../sync/getTrackedPositionIds', () => ({
  getTrackedPositionIds: vi.fn().mockResolvedValue([]),
}))

vi.mock('./utils', () => ({
  submitWrite: vi.fn().mockResolvedValue(mockTxResult),
}))

vi.mock('../tokenId/builder', () => ({
  createTokenIdBuilder: vi.fn().mockReturnValue({
    addLoan: vi.fn().mockReturnValue({
      build: vi.fn().mockReturnValue(12345n),
    }),
  }),
}))

const mockClient = {} as Parameters<typeof swapExactOut>[0]['client']
const mockWalletClient = {} as Parameters<typeof swapExactOut>[0]['walletClient']

describe('swapExactOut', () => {
  beforeEach(() => {
    vi.mocked(submitWrite).mockReset().mockResolvedValue(mockTxResult)
  })

  it('should call dispatch with correct args for token0 output', async () => {
    const result = await swapExactOut({
      client: mockClient,
      walletClient: mockWalletClient,
      account: '0xUser' as `0x${string}`,
      poolAddress: '0xPool' as `0x${string}`,
      chainId: 1n,
      tokenOut: '0xToken0' as `0x${string}`,
      amountOut: 1000n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(result.hash).toBe('0xabc')

    const writeCalls = vi.mocked(submitWrite)
    expect(writeCalls).toHaveBeenCalledTimes(1)

    expect(writeCalls.mock.calls).toHaveLength(1)
    const callArgs = writeCalls.mock.calls[0]
    expect(callArgs).toBeDefined()
    const args = callArgs?.[0]
    expect(args).toBeDefined()
    expect(args?.functionName).toBe('dispatch')
    const dispatchArgs = args?.args as unknown[][]
    expect(dispatchArgs[0]).toEqual([12345n, 12345n])
    expect(dispatchArgs[1]).toEqual([])
    expect(dispatchArgs[2]).toEqual([1000n, 0n])
  })

  it('should throw SwapTokenMismatchError for unknown token', async () => {
    await expect(
      swapExactOut({
        client: mockClient,
        walletClient: mockWalletClient,
        account: '0xUser' as `0x${string}`,
        poolAddress: '0xPool' as `0x${string}`,
        chainId: 1n,
        tokenOut: '0xUnknown' as `0x${string}`,
        amountOut: 1000n,
        slippageBps: 500n,
        existingPositionIds: [],
      }),
    ).rejects.toThrow(SwapTokenMismatchError)
  })

  it('should throw MissingPositionIdsError when no IDs and no storage', async () => {
    await expect(
      swapExactOut({
        client: mockClient,
        walletClient: mockWalletClient,
        account: '0xUser' as `0x${string}`,
        poolAddress: '0xPool' as `0x${string}`,
        chainId: 1n,
        tokenOut: '0xToken0' as `0x${string}`,
        amountOut: 1000n,
        slippageBps: 500n,
      }),
    ).rejects.toThrow(MissingPositionIdsError)
  })

  it('should retry on InputListFailError', async () => {
    vi.mocked(submitWrite)
      .mockRejectedValueOnce(new InputListFailError())
      .mockResolvedValueOnce(mockTxResult)

    const mockStorage = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      delete: vi.fn(),
      has: vi.fn().mockResolvedValue(false),
      keys: vi.fn().mockResolvedValue([]),
      clear: vi.fn(),
    }

    const result = await swapExactOut({
      client: mockClient,
      walletClient: mockWalletClient,
      account: '0xUser' as `0x${string}`,
      poolAddress: '0xPool' as `0x${string}`,
      chainId: 1n,
      tokenOut: '0xToken0' as `0x${string}`,
      amountOut: 1000n,
      slippageBps: 500n,
      storage: mockStorage,
    })

    expect(result.hash).toBe('0xabc')
    expect(vi.mocked(submitWrite)).toHaveBeenCalledTimes(2)
  })

  it('should pass tick limits in correct order (mint=descending, burn=ascending)', async () => {
    await swapExactOut({
      client: mockClient,
      walletClient: mockWalletClient,
      account: '0xUser' as `0x${string}`,
      poolAddress: '0xPool' as `0x${string}`,
      chainId: 1n,
      tokenOut: '0xToken0' as `0x${string}`,
      amountOut: 1000n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    const calls = vi.mocked(submitWrite).mock.calls
    expect(calls).toHaveLength(1)
    const callArg = calls[0]?.[0]
    expect(callArg).toBeDefined()
    const allArgs = callArg?.args as unknown[]
    const tickLimitsArr = allArgs[3] as [number, number, number][]
    // mint: descending [high, low, 0]
    expect(tickLimitsArr[0]?.[0]).toBeGreaterThan(tickLimitsArr[0]?.[1] ?? 0)
    // burn: ascending [low, high, 0]
    expect(tickLimitsArr[1]?.[0]).toBeLessThan(tickLimitsArr[1]?.[1] ?? 0)
  })

  it('should throw MaxRetriesExceededError after exhausting retries', async () => {
    vi.mocked(submitWrite).mockRejectedValue(new InputListFailError())

    const mockStorage = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      delete: vi.fn(),
      has: vi.fn().mockResolvedValue(false),
      keys: vi.fn().mockResolvedValue([]),
      clear: vi.fn(),
    }

    await expect(
      swapExactOut({
        client: mockClient,
        walletClient: mockWalletClient,
        account: '0xUser' as `0x${string}`,
        poolAddress: '0xPool' as `0x${string}`,
        chainId: 1n,
        tokenOut: '0xToken0' as `0x${string}`,
        amountOut: 1000n,
        slippageBps: 500n,
        storage: mockStorage,
      }),
    ).rejects.toThrow(InputListFailError)

    // MAX_RETRIES = 3, last attempt throws without catching
    expect(vi.mocked(submitWrite)).toHaveBeenCalledTimes(3)
  })
})

describe('swapExactIn', () => {
  beforeEach(() => {
    vi.mocked(submitWrite).mockReset().mockResolvedValue(mockTxResult)
  })

  it('should call dispatch with correct args for token0 input', async () => {
    const result = await swapExactIn({
      client: mockClient,
      walletClient: mockWalletClient,
      account: '0xUser' as `0x${string}`,
      poolAddress: '0xPool' as `0x${string}`,
      chainId: 1n,
      tokenIn: '0xToken0' as `0x${string}`,
      amountIn: 500n,
      slippageBps: 300n,
      existingPositionIds: [],
    })

    expect(result.hash).toBe('0xabc')
    const calls = vi.mocked(submitWrite).mock.calls
    expect(calls).toHaveLength(1)
    const args = calls[0]?.[0]
    expect(args).toBeDefined()
    expect(args?.functionName).toBe('dispatch')
    const dispatchArgs = args?.args as unknown[][]
    expect(dispatchArgs[2]).toEqual([500n, 0n])
  })

  it('should pass tick limits in correct order (mint=ascending, burn=descending)', async () => {
    await swapExactIn({
      client: mockClient,
      walletClient: mockWalletClient,
      account: '0xUser' as `0x${string}`,
      poolAddress: '0xPool' as `0x${string}`,
      chainId: 1n,
      tokenIn: '0xToken0' as `0x${string}`,
      amountIn: 500n,
      slippageBps: 300n,
      existingPositionIds: [],
    })

    const calls = vi.mocked(submitWrite).mock.calls
    expect(calls).toHaveLength(1)
    const callArg = calls[0]?.[0]
    expect(callArg).toBeDefined()
    const allArgs = callArg?.args as unknown[]
    const tickLimitsArr = allArgs[3] as [number, number, number][]
    // mint: ascending [low, high, 0]
    expect(tickLimitsArr[0]?.[0]).toBeLessThan(tickLimitsArr[0]?.[1] ?? 0)
    // burn: descending [high, low, 0]
    expect(tickLimitsArr[1]?.[0]).toBeGreaterThan(tickLimitsArr[1]?.[1] ?? 0)
  })

  it('should throw SwapTokenMismatchError for unknown token', async () => {
    await expect(
      swapExactIn({
        client: mockClient,
        walletClient: mockWalletClient,
        account: '0xUser' as `0x${string}`,
        poolAddress: '0xPool' as `0x${string}`,
        chainId: 1n,
        tokenIn: '0xBadToken' as `0x${string}`,
        amountIn: 500n,
        slippageBps: 300n,
        existingPositionIds: [],
      }),
    ).rejects.toThrow(SwapTokenMismatchError)
  })
})

describe('swapExactOutAndWait', () => {
  beforeEach(() => {
    vi.mocked(submitWrite).mockReset().mockResolvedValue(mockTxResult)
  })

  it('should return receipt', async () => {
    const receipt = await swapExactOutAndWait({
      client: mockClient,
      walletClient: mockWalletClient,
      account: '0xUser' as `0x${string}`,
      poolAddress: '0xPool' as `0x${string}`,
      chainId: 1n,
      tokenOut: '0xToken1' as `0x${string}`,
      amountOut: 2000n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(receipt.status).toBe('success')
  })
})

describe('swapExactInAndWait', () => {
  beforeEach(() => {
    vi.mocked(submitWrite).mockReset().mockResolvedValue(mockTxResult)
  })

  it('should return receipt', async () => {
    const receipt = await swapExactInAndWait({
      client: mockClient,
      walletClient: mockWalletClient,
      account: '0xUser' as `0x${string}`,
      poolAddress: '0xPool' as `0x${string}`,
      chainId: 1n,
      tokenIn: '0xToken1' as `0x${string}`,
      amountIn: 2000n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(receipt.status).toBe('success')
  })
})
