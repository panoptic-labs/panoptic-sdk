import type { PublicClient } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotEnoughTokensError } from '../errors'
import { getPool } from '../reads/pool'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
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
    const partial = new NotEnoughTokensError(
      undefined as unknown as `0x${string}`,
      undefined as unknown as bigint,
      undefined as unknown as bigint,
    )
    expect(getNotEnoughTokensError(partial)).toBeNull()
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

  it('defaults the loan legs to the full tick range', async () => {
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
    expect(limits[0]).toEqual([MAX_TICK, MIN_TICK, 0n])
    expect(limits[limits.length - 1]).toEqual([MIN_TICK, MAX_TICK, 0n])
  })
})
