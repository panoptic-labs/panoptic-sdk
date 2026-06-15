import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InputListFailError, MissingPositionIdsError, SwapTokenMismatchError } from '../errors'
import { borrow, repay, supply, unsupply } from './lending'
import { submitWrite } from './utils'
import { deposit, withdraw } from './vault'

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

const mockPool = vi.hoisted(() => ({
  poolId: 1n,
  currentTick: 200000n,
  collateralTracker0: {
    address: '0xCT0' as `0x${string}`,
    token: '0xToken0' as `0x${string}`,
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
    address: '0xCT1' as `0x${string}`,
    token: '0xToken1' as `0x${string}`,
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
    currency0: '0xToken0' as `0x${string}`,
    currency1: '0xToken1' as `0x${string}`,
    fee: 500n,
    tickSpacing: 10n,
    hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  },
  tickSpacing: 10n,
}))

vi.mock('../reads/pool', () => ({
  getPool: vi.fn().mockResolvedValue(mockPool),
}))

vi.mock('../sync/getTrackedPositionIds', () => ({
  getTrackedPositionIds: vi.fn().mockResolvedValue([]),
}))

vi.mock('./utils', () => ({
  submitWrite: vi.fn().mockResolvedValue(mockTxResult),
}))

vi.mock('./vault', () => ({
  deposit: vi.fn().mockResolvedValue(mockTxResult),
  withdraw: vi.fn().mockResolvedValue(mockTxResult),
}))

vi.mock('../tokenId/builder', () => ({
  createTokenIdBuilder: vi.fn().mockReturnValue({
    addLoan: vi.fn().mockReturnValue({
      build: vi.fn().mockReturnValue(12345n),
    }),
  }),
}))

const mockClient = {} as Parameters<typeof supply>[0]['client']
const mockWalletClient = {} as Parameters<typeof supply>[0]['walletClient']
const account = '0xUser' as `0x${string}`
const poolAddress = '0xPool' as `0x${string}`

describe('supply', () => {
  beforeEach(() => {
    vi.mocked(deposit).mockReset().mockResolvedValue(mockTxResult)
  })

  it('should resolve token0 to collateralTracker0 and call deposit', async () => {
    const result = await supply({
      client: mockClient,
      walletClient: mockWalletClient,
      account,
      poolAddress,
      chainId: 1n,
      token: '0xToken0' as `0x${string}`,
      amount: 1000n,
    })

    expect(result.hash).toBe('0xabc')
    const calls = vi.mocked(deposit).mock.calls
    expect(calls).toHaveLength(1)
    const args = calls[0]?.[0]
    expect(args).toBeDefined()
    expect(args?.collateralTrackerAddress).toBe('0xCT0')
    expect(args?.assets).toBe(1000n)
  })

  it('should resolve token1 to collateralTracker1', async () => {
    await supply({
      client: mockClient,
      walletClient: mockWalletClient,
      account,
      poolAddress,
      chainId: 1n,
      token: '0xToken1' as `0x${string}`,
      amount: 500n,
    })

    const args = vi.mocked(deposit).mock.calls[0]?.[0]
    expect(args).toBeDefined()
    expect(args?.collateralTrackerAddress).toBe('0xCT1')
  })

  it('should throw SwapTokenMismatchError for unknown token', async () => {
    await expect(
      supply({
        client: mockClient,
        walletClient: mockWalletClient,
        account,
        poolAddress,
        chainId: 1n,
        token: '0xUnknown' as `0x${string}`,
        amount: 1000n,
      }),
    ).rejects.toThrow(SwapTokenMismatchError)
  })

  it('should pass isNativeETH to deposit', async () => {
    await supply({
      client: mockClient,
      walletClient: mockWalletClient,
      account,
      poolAddress,
      chainId: 1n,
      token: '0xToken0' as `0x${string}`,
      amount: 1000n,
      isNativeETH: true,
    })

    const args = vi.mocked(deposit).mock.calls[0]?.[0]
    expect(args).toBeDefined()
    expect(args?.isNativeETH).toBe(true)
  })
})

describe('unsupply', () => {
  beforeEach(() => {
    vi.mocked(withdraw).mockReset().mockResolvedValue(mockTxResult)
  })

  it('should resolve token and call withdraw', async () => {
    const result = await unsupply({
      client: mockClient,
      walletClient: mockWalletClient,
      account,
      poolAddress,
      chainId: 1n,
      token: '0xToken0' as `0x${string}`,
      amount: 500n,
    })

    expect(result.hash).toBe('0xabc')
    const calls = vi.mocked(withdraw).mock.calls
    expect(calls).toHaveLength(1)
    const args = calls[0]?.[0]
    expect(args).toBeDefined()
    expect(args?.collateralTrackerAddress).toBe('0xCT0')
    expect(args?.assets).toBe(500n)
  })

  it('should throw SwapTokenMismatchError for unknown token', async () => {
    await expect(
      unsupply({
        client: mockClient,
        walletClient: mockWalletClient,
        account,
        poolAddress,
        chainId: 1n,
        token: '0xUnknown' as `0x${string}`,
        amount: 500n,
      }),
    ).rejects.toThrow(SwapTokenMismatchError)
  })
})

describe('borrow', () => {
  beforeEach(() => {
    vi.mocked(submitWrite).mockReset().mockResolvedValue(mockTxResult)
  })

  it('should call dispatch with single mint operation', async () => {
    const result = await borrow({
      client: mockClient,
      walletClient: mockWalletClient,
      account,
      poolAddress,
      chainId: 1n,
      token: '0xToken1' as `0x${string}`,
      amount: 1000n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(result.hash).toBe('0xabc')
    const args = vi.mocked(submitWrite).mock.calls[0]?.[0]
    expect(args).toBeDefined()
    expect(args.functionName).toBe('dispatch')
    const dispatchArgs = args.args as unknown[][]
    // positionIdList: [loanTokenId]
    expect(dispatchArgs[0]).toEqual([12345n])
    // finalPositionIdList: [loanTokenId] (empty existing + new)
    expect(dispatchArgs[1]).toEqual([12345n])
    // positionSizes: [adjustedSize]
    expect(dispatchArgs[2]).toEqual([1000n])
    // Single tick limits (ascending = no swap)
    const limits = dispatchArgs[3] as [number, number, number][]
    expect(limits).toHaveLength(1)
    expect(limits[0]![0]).toBeLessThan(limits[0]![1])
  })

  it('should throw MissingPositionIdsError when no IDs and no storage', async () => {
    await expect(
      borrow({
        client: mockClient,
        walletClient: mockWalletClient,
        account,
        poolAddress,
        chainId: 1n,
        token: '0xToken0' as `0x${string}`,
        amount: 1000n,
        slippageBps: 500n,
      }),
    ).rejects.toThrow(MissingPositionIdsError)
  })

  it('should retry on InputListFailError', async () => {
    vi.mocked(submitWrite)
      .mockRejectedValueOnce(new InputListFailError())
      .mockResolvedValueOnce(mockTxResult)

    const result = await borrow({
      client: mockClient,
      walletClient: mockWalletClient,
      account,
      poolAddress,
      chainId: 1n,
      token: '0xToken0' as `0x${string}`,
      amount: 1000n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(result.hash).toBe('0xabc')
    expect(vi.mocked(submitWrite)).toHaveBeenCalledTimes(2)
  })
})

describe('repay', () => {
  const loanTokenId = 12345n

  beforeEach(() => {
    vi.mocked(submitWrite).mockReset().mockResolvedValue(mockTxResult)
  })

  it('should do full repay when amount >= currentSize', async () => {
    const mockReadContract = vi.fn().mockResolvedValue([0n, 0n, [500n], [0n], [0n]])
    const client = { readContract: mockReadContract } as unknown as Parameters<
      typeof repay
    >[0]['client']

    await repay({
      client,
      walletClient: mockWalletClient,
      account,
      poolAddress,
      chainId: 1n,
      loanTokenId,
      amount: 500n, // equals currentSize
      slippageBps: 500n,
      existingPositionIds: [loanTokenId],
    })

    const args = vi.mocked(submitWrite).mock.calls[0]?.[0]
    expect(args).toBeDefined()
    const dispatchArgs = args.args as unknown[][]
    // positionIdList: [loanTokenId] (burn)
    expect(dispatchArgs[0]).toEqual([loanTokenId])
    // finalPositionIdList: [] (removed)
    expect(dispatchArgs[1]).toEqual([])
    // positionSizes: [0n] (burn all)
    expect(dispatchArgs[2]).toEqual([0n])
  })

  it('should do partial repay when amount < currentSize', async () => {
    const mockReadContract = vi.fn().mockResolvedValue([0n, 0n, [1000n], [0n], [0n]])
    const client = { readContract: mockReadContract } as unknown as Parameters<
      typeof repay
    >[0]['client']

    await repay({
      client,
      walletClient: mockWalletClient,
      account,
      poolAddress,
      chainId: 1n,
      loanTokenId,
      amount: 300n, // less than currentSize of 1000n
      slippageBps: 500n,
      existingPositionIds: [loanTokenId],
    })

    const args = vi.mocked(submitWrite).mock.calls[0]?.[0]
    expect(args).toBeDefined()
    const dispatchArgs = args.args as unknown[][]
    // positionIdList: [loanTokenId, loanTokenId] (burn + remint)
    expect(dispatchArgs[0]).toEqual([loanTokenId, loanTokenId])
    // finalPositionIdList: [loanTokenId] (stays in list)
    expect(dispatchArgs[1]).toEqual([loanTokenId])
    // positionSizes: [currentSize, newSize]
    expect(dispatchArgs[2]).toEqual([1000n, 700n])
  })

  it('should retry on InputListFailError', async () => {
    const mockReadContract = vi.fn().mockResolvedValue([0n, 0n, [500n], [0n], [0n]])
    const client = { readContract: mockReadContract } as unknown as Parameters<
      typeof repay
    >[0]['client']

    vi.mocked(submitWrite)
      .mockRejectedValueOnce(new InputListFailError())
      .mockResolvedValueOnce(mockTxResult)

    const result = await repay({
      client,
      walletClient: mockWalletClient,
      account,
      poolAddress,
      chainId: 1n,
      loanTokenId,
      amount: 500n,
      slippageBps: 500n,
      existingPositionIds: [loanTokenId],
    })

    expect(result.hash).toBe('0xabc')
    expect(vi.mocked(submitWrite)).toHaveBeenCalledTimes(2)
  })
})
