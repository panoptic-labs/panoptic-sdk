import { type PublicClient, createPublicClient, custom, zeroAddress } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotEnoughTokensError, PanopticError } from '../errors'
import { getPool } from '../reads/pool'
import type { Pool } from '../types'
import { simulateDispatch } from './simulateDispatch'
import {
  type DispatchIntent,
  buildTokenShortfallRecoveryDispatch,
  getNotEnoughTokensError,
  quoteTokenShortfallRecovery,
} from './tokenShortfallRecovery'

vi.mock('../reads/pool', () => ({ getPool: vi.fn() }))
vi.mock('./simulateDispatch', () => ({ simulateDispatch: vi.fn() }))

const baseDispatch: DispatchIntent = {
  positionIdList: [11n, 12n],
  finalPositionIdList: [9n, 12n],
  positionSizes: [100n, 0n],
  tickAndSpreadLimits: [
    [10n, 20n, 30n],
    [40n, 50n, 0n],
  ],
  usePremiaAsCollateral: true,
  builderCode: 77n,
}

const PREFIX_TOKEN0 = '0x0000000000000000000000000000000000000010'
const PREFIX_TOKEN1 = '0x0000000000000000000000000000000000000011'
const PREFIX_TRACKER0 = '0x0000000000000000000000000000000000000020'
const PREFIX_TRACKER1 = '0x0000000000000000000000000000000000000021'
const PREFIX_META = { blockNumber: 123n, blockTimestamp: 456n, blockHash: '0x01' as const }
const PREFIX_POOL_ADDRESS = '0x0000000000000000000000000000000000000030'
const PREFIX_RISK_ENGINE = '0x0000000000000000000000000000000000000050'

const collateralTracker = (address: `0x${string}`, token: `0x${string}`, symbol: string) => ({
  address,
  token,
  symbol,
  decimals: 18n,
  totalAssets: 1_000n,
  insideAMM: 0n,
  creditedShares: 0n,
  totalShares: 1_000n,
  utilization: 0n,
  borrowRate: 0n,
  supplyRate: 0n,
})

const PREFIX_POOL: Pool = {
  address: PREFIX_POOL_ADDRESS,
  chainId: 1n,
  poolId: 1n,
  poolKey: {
    currency0: PREFIX_TOKEN0,
    currency1: PREFIX_TOKEN1,
    fee: 3_000n,
    tickSpacing: 10n,
    hooks: zeroAddress,
  },
  tickSpacing: 10n,
  collateralTracker0: collateralTracker(PREFIX_TRACKER0, PREFIX_TOKEN0, 'TOKEN0'),
  collateralTracker1: collateralTracker(PREFIX_TRACKER1, PREFIX_TOKEN1, 'TOKEN1'),
  riskEngine: {
    address: PREFIX_RISK_ENGINE,
    collateralRequirement: 0n,
    maintenanceMargin: 0n,
    commissionRate: 0n,
    premiumFeeRate: 0n,
    vegoid: 0n,
    maxSpread: 0n,
  },
  currentTick: 0n,
  sqrtPriceX96: 1n << 96n,
  uniswapPoolLiquidity: 1_000n,
  healthStatus: 'active',
  metadata: {
    poolKeyBytes: '0x',
    poolId: 1n,
    collateralToken0Address: PREFIX_TRACKER0,
    collateralToken1Address: PREFIX_TRACKER1,
    riskEngineAddress: PREFIX_RISK_ENGINE,
    token0Asset: PREFIX_TOKEN0,
    token1Asset: PREFIX_TOKEN1,
    token0Symbol: 'TOKEN0',
    token1Symbol: 'TOKEN1',
    token0Decimals: 18n,
    token1Decimals: 18n,
    token0Name: 'Token 0',
    token1Name: 'Token 1',
    underlyingPoolId: PREFIX_POOL_ADDRESS,
    isV4: false,
    tickSpacing: 10n,
    fee: 3_000n,
    sfpmAddress: zeroAddress,
  },
  _meta: PREFIX_META,
}

function mockPrefixedPool() {
  vi.mocked(getPool).mockResolvedValue(PREFIX_POOL)
}

function prefixedClient(): PublicClient {
  return createPublicClient({
    transport: custom({ request: vi.fn().mockResolvedValue('0x7b') }),
  })
}

function malformedNotEnoughTokensError(): NotEnoughTokensError {
  const error = new NotEnoughTokensError(PREFIX_TRACKER0, 1n, 0n)
  Object.defineProperties(error, {
    tokenAddress: { value: undefined },
    assetsRequested: { value: undefined },
    assetBalance: { value: undefined },
  })
  return error
}

function prefixedSuccess({
  delta0,
  delta1,
  balanceBefore0 = 0n,
  balanceBefore1 = 100n,
}: {
  delta0: bigint
  delta1: bigint
  balanceBefore0?: bigint
  balanceBefore1?: bigint
}) {
  return {
    success: true as const,
    data: {
      netAmount0: delta0,
      netAmount1: delta1,
      positionsCreated: [],
      positionsClosed: [],
      postCollateral0: balanceBefore0 + delta0,
      postCollateral1: balanceBefore1 + delta1,
      preMarginExcess0: null,
      preMarginExcess1: null,
      postMarginExcess0: null,
      postMarginExcess1: null,
    },
    gasEstimate: 1n,
    tokenFlow: {
      delta0,
      delta1,
      balanceBefore0,
      balanceBefore1,
      balanceAfter0: balanceBefore0 + delta0,
      balanceAfter1: balanceBefore1 + delta1,
      tickBefore: 0n,
      tickAfter: 0n,
    },
    _meta: PREFIX_META,
  }
}

const bootstrapFailure = () => ({
  success: false as const,
  error: new NotEnoughTokensError(PREFIX_TRACKER0, 1n, 0n),
  _meta: PREFIX_META,
})

const quotePrefixedRecovery = () =>
  quoteTokenShortfallRecovery({
    client: prefixedClient(),
    poolAddress: PREFIX_POOL_ADDRESS,
    account: '0x0000000000000000000000000000000000000040',
    chainId: 1n,
    existingPositionIds: [],
    dispatch: baseDispatch,
    error: new NotEnoughTokensError(PREFIX_TRACKER0, 6n, 0n),
    slippageBps: 50n,
  })

describe('buildTokenShortfallRecoveryDispatch', () => {
  it('wraps the original operations in an exact-output temporary credit', () => {
    expect(
      buildTokenShortfallRecoveryDispatch({
        dispatch: baseDispatch,
        creditTokenId: 99n,
        creditPositionSize: 5n,
        tickLimitLow: -100n,
        tickLimitHigh: 100n,
      }),
    ).toEqual({
      positionIdList: [99n, 11n, 12n, 99n],
      finalPositionIdList: [9n, 12n],
      positionSizes: [5n, 100n, 0n, 0n],
      tickAndSpreadLimits: [
        [100n, -100n, 0n],
        [10n, 20n, 30n],
        [40n, 50n, 0n],
        [-100n, 100n, 0n],
      ],
      usePremiaAsCollateral: true,
      builderCode: 77n,
    })
  })

  it('does not mutate the base dispatch arrays', () => {
    buildTokenShortfallRecoveryDispatch({
      dispatch: baseDispatch,
      creditTokenId: 99n,
      creditPositionSize: 5n,
      tickLimitLow: -100n,
      tickLimitHigh: 100n,
    })

    expect(baseDispatch.positionIdList).toEqual([11n, 12n])
    expect(baseDispatch.finalPositionIdList).toEqual([9n, 12n])
  })
})

describe('getNotEnoughTokensError', () => {
  it('returns an already parsed token shortfall', () => {
    const error = new NotEnoughTokensError('0x0000000000000000000000000000000000000001', 10n, 4n)
    expect(getNotEnoughTokensError(error)).toBe(error)
  })

  it('ignores unrelated errors', () => {
    expect(getNotEnoughTokensError(new Error('no'))).toBeNull()
  })

  it('ignores selector-only decodes with undefined args', () => {
    // parsePanopticError's fallback path constructs the error with no args when
    // it can only match the 4-byte selector (e.g. from a multicall error string).
    const partial = malformedNotEnoughTokensError()
    expect(getNotEnoughTokensError(partial)).toBeNull()
  })

  it('continues through a partial decode to a complete cause', () => {
    const complete = new NotEnoughTokensError('0x0000000000000000000000000000000000000001', 10n, 4n)
    const partial = malformedNotEnoughTokensError()
    Object.defineProperty(partial, 'cause', { value: complete })

    expect(getNotEnoughTokensError(partial)).toBe(complete)
  })
})

describe('quoteTokenShortfallRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a CollateralTracker shortfall and verifies the wrapped dispatch', async () => {
    const token0 = '0x0000000000000000000000000000000000000010'
    const token1 = '0x0000000000000000000000000000000000000011'
    const tracker0 = '0x0000000000000000000000000000000000000020'
    const tracker1 = '0x0000000000000000000000000000000000000021'
    vi.mocked(getPool).mockResolvedValue({
      poolId: 1n,
      currentTick: 0n,
      tickSpacing: 10n,
      collateralTracker0: { address: tracker0, token: token0 },
      collateralTracker1: { address: tracker1, token: token1 },
    } as unknown as Awaited<ReturnType<typeof getPool>>)

    const meta = {
      blockNumber: 123n,
      blockTimestamp: 456n,
      blockHash: '0x01' as const,
    }
    const swapTokenFlow = {
      delta0: 6n,
      delta1: -100n,
      balanceBefore0: 4n,
      balanceBefore1: 1_000n,
      balanceAfter0: 10n,
      balanceAfter1: 900n,
      tickBefore: 0n,
      tickAfter: 0n,
    }
    const recoveredTokenFlow = {
      ...swapTokenFlow,
      delta0: 0n,
      balanceAfter0: 4n,
    }
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce({
        success: true,
        data: {
          netAmount0: 6n,
          netAmount1: -100n,
          positionsCreated: [],
          positionsClosed: [],
          postCollateral0: 10n,
          postCollateral1: 900n,
          preMarginExcess0: null,
          preMarginExcess1: null,
          postMarginExcess0: null,
          postMarginExcess1: null,
        },
        gasEstimate: 1n,
        tokenFlow: swapTokenFlow,
        _meta: meta,
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          netAmount0: 0n,
          netAmount1: -100n,
          positionsCreated: [12n],
          positionsClosed: [11n],
          postCollateral0: 4n,
          postCollateral1: 900n,
          preMarginExcess0: null,
          preMarginExcess1: null,
          postMarginExcess0: null,
          postMarginExcess1: null,
        },
        gasEstimate: 2n,
        tokenFlow: recoveredTokenFlow,
        _meta: meta,
      })

    const client = { getBlockNumber: vi.fn().mockResolvedValue(123n) } as unknown as PublicClient
    const result = await quoteTokenShortfallRecovery({
      client,
      poolAddress: '0x0000000000000000000000000000000000000030',
      account: '0x0000000000000000000000000000000000000040',
      chainId: 1n,
      existingPositionIds: [11n],
      dispatch: baseDispatch,
      error: new NotEnoughTokensError(tracker0, 10n, 4n),
      slippageBps: 50n,
      tickLimitLow: -50n,
      tickLimitHigh: 50n,
    })

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.quote.tokenIn).toBe(token1)
    expect(result.quote.tokenOut).toBe(token0)
    expect(result.quote.amountOut).toBe(6n)
    expect(result.quote.estimatedAmountIn).toBe(100n)
    expect(result.quote.maximumAmountIn).toBe(101n)
    expect(result.quote.dispatch.positionIdList).toEqual([
      result.quote.creditTokenId,
      ...baseDispatch.positionIdList,
      result.quote.creditTokenId,
    ])
    expect(result.quote.dispatch.finalPositionIdList).toEqual(baseDispatch.finalPositionIdList)
    expect(simulateDispatch).toHaveBeenCalledTimes(2)
  })

  it('prepends an exact-input swap when zero output balance cannot pay the credit fee', async () => {
    const token0 = '0x0000000000000000000000000000000000000010'
    const token1 = '0x0000000000000000000000000000000000000011'
    const tracker0 = '0x0000000000000000000000000000000000000020'
    const tracker1 = '0x0000000000000000000000000000000000000021'
    vi.mocked(getPool).mockResolvedValue({
      poolId: 1n,
      currentTick: 0n,
      sqrtPriceX96: 1n << 96n,
      tickSpacing: 10n,
      collateralTracker0: { address: tracker0, token: token0 },
      collateralTracker1: { address: tracker1, token: token1 },
    } as unknown as Awaited<ReturnType<typeof getPool>>)

    const meta = { blockNumber: 123n, blockTimestamp: 456n, blockHash: '0x01' as const }
    const successful = (delta0: bigint, delta1: bigint) => ({
      success: true as const,
      data: {
        netAmount0: delta0,
        netAmount1: delta1,
        positionsCreated: [],
        positionsClosed: [],
        postCollateral0: 10n + delta0,
        postCollateral1: 100n + delta1,
        preMarginExcess0: null,
        preMarginExcess1: null,
        postMarginExcess0: null,
        postMarginExcess1: null,
      },
      gasEstimate: 1n,
      tokenFlow: {
        delta0,
        delta1,
        balanceBefore0: 10n,
        balanceBefore1: 100n,
        balanceAfter0: 10n + delta0,
        balanceAfter1: 100n + delta1,
        tickBefore: 0n,
        tickAfter: 0n,
      },
      _meta: meta,
    })
    vi.mocked(simulateDispatch)
      // Exact-output bootstrap fails because the account owns no token0.
      .mockResolvedValueOnce({
        success: false,
        error: new NotEnoughTokensError(tracker0, 1n, 0n),
        _meta: meta,
      })
      // A token1-denominated exact-input credit successfully sources token0 first.
      .mockResolvedValueOnce(successful(6n, -7n))
      .mockResolvedValueOnce(successful(0n, -7n))

    const result = await quoteTokenShortfallRecovery({
      client: { getBlockNumber: vi.fn().mockResolvedValue(123n) } as unknown as PublicClient,
      poolAddress: '0x0000000000000000000000000000000000000030',
      account: '0x0000000000000000000000000000000000000040',
      chainId: 1n,
      existingPositionIds: [],
      dispatch: baseDispatch,
      error: new NotEnoughTokensError(tracker0, 6n, 0n),
      slippageBps: 50n,
    })

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.quote.direction).toBe('exact-in')
    expect(result.quote.estimatedAmountOut).toBe(6n)
    expect(result.quote.dispatch.positionIdList).toEqual([
      result.quote.creditTokenId,
      result.quote.creditTokenId,
      ...baseDispatch.positionIdList,
    ])
    expect(simulateDispatch).toHaveBeenCalledTimes(3)
  })

  it('rejects a prefixed swap whose input exceeds the source balance', async () => {
    mockPrefixedPool()
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce(bootstrapFailure())
      .mockResolvedValueOnce(prefixedSuccess({ delta0: 6n, delta1: -7n, balanceBefore1: 6n }))

    await expect(quotePrefixedRecovery()).resolves.toMatchObject({
      available: false,
      reason: 'swap-unavailable',
    })
  })

  it('reports a failed prefixed swap simulation as swap-unavailable', async () => {
    mockPrefixedPool()
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce(bootstrapFailure())
      .mockResolvedValueOnce({
        success: false,
        error: new PanopticError('prefixed swap failed'),
        _meta: PREFIX_META,
      })

    await expect(quotePrefixedRecovery()).resolves.toMatchObject({
      available: false,
      reason: 'swap-unavailable',
    })
  })

  it('grows an under-delivering prefixed swap before succeeding', async () => {
    mockPrefixedPool()
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce(bootstrapFailure())
      .mockResolvedValueOnce(prefixedSuccess({ delta0: 3n, delta1: -7n }))
      .mockResolvedValueOnce(prefixedSuccess({ delta0: 6n, delta1: -15n }))
      .mockResolvedValueOnce(prefixedSuccess({ delta0: 0n, delta1: -15n }))

    const result = await quotePrefixedRecovery()

    expect(result.available).toBe(true)
    expect(simulateDispatch).toHaveBeenCalledTimes(4)
    const firstSize = vi.mocked(simulateDispatch).mock.calls[1]?.[0].positionSizes[0]
    const secondSize = vi.mocked(simulateDispatch).mock.calls[2]?.[0].positionSizes[0]
    expect(firstSize).toBeDefined()
    expect(secondSize).toBeDefined()
    if (firstSize === undefined || secondSize === undefined) return
    expect(secondSize).toBeGreaterThan(firstSize)
  })

  it('returns recovery-unavailable after exhausting prefixed recovery retries', async () => {
    mockPrefixedPool()
    const simulation = vi.mocked(simulateDispatch).mockResolvedValueOnce(bootstrapFailure())
    for (let attempt = 0; attempt < 8; attempt++) {
      simulation
        .mockResolvedValueOnce(prefixedSuccess({ delta0: 100n, delta1: -7n }))
        .mockResolvedValueOnce({
          success: false,
          error: new NotEnoughTokensError(PREFIX_TRACKER0, 1n, 0n),
          _meta: PREFIX_META,
        })
    }

    await expect(quotePrefixedRecovery()).resolves.toMatchObject({
      available: false,
      reason: 'recovery-unavailable',
    })
    expect(simulateDispatch).toHaveBeenCalledTimes(17)
  })

  it('increases exact output through decoded and share-rounding shortfalls', async () => {
    const token0 = '0x0000000000000000000000000000000000000010'
    const token1 = '0x0000000000000000000000000000000000000011'
    const tracker0 = '0x0000000000000000000000000000000000000020'
    vi.mocked(getPool).mockResolvedValue({
      poolId: 1n,
      currentTick: 0n,
      tickSpacing: 10n,
      collateralTracker0: { address: tracker0, token: token0 },
      collateralTracker1: {
        address: '0x0000000000000000000000000000000000000021',
        token: token1,
      },
    } as unknown as Awaited<ReturnType<typeof getPool>>)

    const meta = {
      blockNumber: 123n,
      blockTimestamp: 456n,
      blockHash: '0x01' as const,
    }
    const swapFlow = {
      delta0: 6n,
      delta1: -100n,
      balanceBefore0: 4n,
      balanceBefore1: 1_000n,
      balanceAfter0: 10n,
      balanceAfter1: 900n,
      tickBefore: 0n,
      tickAfter: 0n,
    }
    const successfulRecovery = {
      success: true as const,
      data: {
        netAmount0: 0n,
        netAmount1: -120n,
        positionsCreated: [],
        positionsClosed: [],
        postCollateral0: 4n,
        postCollateral1: 880n,
        preMarginExcess0: null,
        preMarginExcess1: null,
        postMarginExcess0: null,
        postMarginExcess1: null,
      },
      gasEstimate: 2n,
      tokenFlow: { ...swapFlow, delta0: 0n, delta1: -120n },
      _meta: meta,
    }
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce({
        ...successfulRecovery,
        tokenFlow: swapFlow,
      })
      .mockResolvedValueOnce({
        success: false,
        error: new NotEnoughTokensError(tracker0, 11n, 10n),
        _meta: meta,
      })
      .mockResolvedValueOnce({
        ...successfulRecovery,
        tokenFlow: {
          ...swapFlow,
          delta0: 7n,
          delta1: -120n,
          balanceAfter0: 11n,
          balanceAfter1: 880n,
        },
      })
      .mockResolvedValueOnce({
        success: false,
        error: new NotEnoughTokensError(tracker0, 10n, 11n),
        _meta: meta,
      })
      .mockResolvedValueOnce({
        ...successfulRecovery,
        tokenFlow: {
          ...swapFlow,
          delta0: 14n,
          delta1: -200n,
          balanceAfter0: 18n,
          balanceAfter1: 800n,
        },
      })
      .mockResolvedValueOnce(successfulRecovery)

    const result = await quoteTokenShortfallRecovery({
      client: { getBlockNumber: vi.fn().mockResolvedValue(123n) } as unknown as PublicClient,
      poolAddress: '0x0000000000000000000000000000000000000030',
      account: '0x0000000000000000000000000000000000000040',
      chainId: 1n,
      existingPositionIds: [11n],
      dispatch: baseDispatch,
      error: new NotEnoughTokensError(tracker0, 10n, 4n),
      slippageBps: 50n,
      tickLimitLow: -50n,
      tickLimitHigh: 50n,
    })

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.quote.amountOut).toBe(14n)
    expect(result.quote.estimatedAmountIn).toBe(200n)
    expect(simulateDispatch).toHaveBeenCalledTimes(6)
  })

  it('rejects slippage that is not expressed in basis points', async () => {
    const result = await quoteTokenShortfallRecovery({
      client: { getBlockNumber: vi.fn() } as unknown as PublicClient,
      poolAddress: '0x0000000000000000000000000000000000000030',
      account: '0x0000000000000000000000000000000000000040',
      chainId: 1n,
      existingPositionIds: [],
      dispatch: baseDispatch,
      error: new NotEnoughTokensError('0x0000000000000000000000000000000000000020', 10n, 4n),
      // A tick delta, which is what the UI used to pass by mistake.
      slippageBps: 887_272n,
    })

    expect(result).toMatchObject({ available: false, reason: 'invalid-slippage' })
    expect(getPool).not.toHaveBeenCalled()
  })

  it('defaults recovery swaps to slippage-bounded ticks', async () => {
    const token0 = '0x0000000000000000000000000000000000000010'
    const token1 = '0x0000000000000000000000000000000000000011'
    const tracker0 = '0x0000000000000000000000000000000000000020'
    vi.mocked(getPool).mockResolvedValue({
      poolId: 1n,
      currentTick: 0n,
      tickSpacing: 10n,
      collateralTracker0: { address: tracker0, token: token0 },
      collateralTracker1: {
        address: '0x0000000000000000000000000000000000000021',
        token: token1,
      },
    } as unknown as Awaited<ReturnType<typeof getPool>>)

    const meta = { blockNumber: 123n, blockTimestamp: 456n, blockHash: '0x01' as const }
    const flow = {
      delta0: 6n,
      delta1: -100n,
      balanceBefore0: 4n,
      balanceBefore1: 1_000n,
      balanceAfter0: 10n,
      balanceAfter1: 900n,
      tickBefore: 0n,
      tickAfter: 0n,
    }
    const ok = {
      success: true as const,
      data: {
        netAmount0: 6n,
        netAmount1: -100n,
        positionsCreated: [],
        positionsClosed: [],
        postCollateral0: 10n,
        postCollateral1: 900n,
        preMarginExcess0: null,
        preMarginExcess1: null,
        postMarginExcess0: null,
        postMarginExcess1: null,
      },
      gasEstimate: 1n,
      tokenFlow: flow,
      _meta: meta,
    }
    vi.mocked(simulateDispatch).mockResolvedValue(ok)

    const result = await quoteTokenShortfallRecovery({
      client: { getBlockNumber: vi.fn().mockResolvedValue(123n) } as unknown as PublicClient,
      poolAddress: '0x0000000000000000000000000000000000000030',
      account: '0x0000000000000000000000000000000000000040',
      chainId: 1n,
      existingPositionIds: [11n],
      dispatch: baseDispatch,
      error: new NotEnoughTokensError(tracker0, 10n, 4n),
      slippageBps: 50n,
    })

    expect(result.available).toBe(true)
    if (!result.available) return
    const limits = result.quote.dispatch.tickAndSpreadLimits
    expect(limits[0]).toEqual([50n, -50n, 0n])
    expect(limits[limits.length - 1]).toEqual([-50n, 50n, 0n])
  })
})
