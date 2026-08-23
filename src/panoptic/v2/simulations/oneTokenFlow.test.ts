import type { PublicClient } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotEnoughTokensError, PanopticError } from '../errors'
import { getPool } from '../reads/pool'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
import { type DispatchIntent, buildCreditWrappedDispatch } from './creditWrap'
import { quoteOneTokenFlow } from './oneTokenFlow'
import { simulateDispatch } from './simulateDispatch'

vi.mock('../reads/pool', () => ({ getPool: vi.fn() }))
vi.mock('./simulateDispatch', () => ({ simulateDispatch: vi.fn() }))

const TOKEN0 = '0x0000000000000000000000000000000000000010'
const TOKEN1 = '0x0000000000000000000000000000000000000011'
const TRACKER0 = '0x0000000000000000000000000000000000000020'
const TRACKER1 = '0x0000000000000000000000000000000000000021'
const POOL = '0x0000000000000000000000000000000000000030'
const ACCOUNT = '0x0000000000000000000000000000000000000040'

const META = { blockNumber: 123n, blockTimestamp: 456n, blockHash: '0x01' as const }

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

interface Flow {
  delta0: bigint
  delta1: bigint
  balanceBefore0?: bigint
  balanceBefore1?: bigint
}

/** A successful `simulateDispatch` result carrying the given deltas. */
const ok = (flow: Flow) => {
  const tokenFlow = {
    delta0: flow.delta0,
    delta1: flow.delta1,
    balanceBefore0: flow.balanceBefore0 ?? 1_000n,
    balanceBefore1: flow.balanceBefore1 ?? 1_000n,
    balanceAfter0: (flow.balanceBefore0 ?? 1_000n) + flow.delta0,
    balanceAfter1: (flow.balanceBefore1 ?? 1_000n) + flow.delta1,
    tickBefore: 0n,
    tickAfter: 0n,
  }
  return {
    success: true as const,
    data: {
      netAmount0: tokenFlow.delta0,
      netAmount1: tokenFlow.delta1,
      positionsCreated: [],
      positionsClosed: [],
      postCollateral0: tokenFlow.balanceAfter0,
      postCollateral1: tokenFlow.balanceAfter1,
      preMarginExcess0: null,
      preMarginExcess1: null,
      postMarginExcess0: null,
      postMarginExcess1: null,
    },
    gasEstimate: 1n,
    tokenFlow,
    _meta: META,
  }
}

const mockPool = () => {
  vi.mocked(getPool).mockResolvedValue({
    poolId: 1n,
    currentTick: 0n,
    // 2^96 — price 1.0, so the dust gate's cross-token compare is an identity.
    sqrtPriceX96: 79228162514264337593543950336n,
    tickSpacing: 10n,
    collateralTracker0: { address: TRACKER0, token: TOKEN0 },
    collateralTracker1: { address: TRACKER1, token: TOKEN1 },
  } as unknown as Awaited<ReturnType<typeof getPool>>)
}

const quote = (overrides: Partial<Parameters<typeof quoteOneTokenFlow>[0]> = {}) =>
  quoteOneTokenFlow({
    client: { getBlockNumber: vi.fn().mockResolvedValue(123n) } as unknown as PublicClient,
    poolAddress: POOL,
    account: ACCOUNT,
    chainId: 1n,
    existingPositionIds: [11n],
    dispatch: baseDispatch,
    targetTokenIndex: 1n,
    slippageBps: 50n,
    ...overrides,
  })

describe('buildCreditWrappedDispatch', () => {
  const args = {
    dispatch: baseDispatch,
    creditTokenId: 99n,
    creditPositionSize: 5n,
    tickLimitLow: -100n,
    tickLimitHigh: 100n,
  }

  it('straddles the user ops for an exact-output swap, swapping on the mint leg', () => {
    expect(
      buildCreditWrappedDispatch({ ...args, direction: 'exact-out', placement: 'straddle' }),
    ).toEqual({
      positionIdList: [99n, 11n, 12n, 99n],
      finalPositionIdList: [9n, 12n],
      positionSizes: [5n, 100n, 0n, 0n],
      tickAndSpreadLimits: [
        // descending = swapAtMint on
        [100n, -100n, 0n],
        [10n, 20n, 30n],
        [40n, 50n, 0n],
        // ascending = swapAtMint off
        [-100n, 100n, 0n],
      ],
      usePremiaAsCollateral: true,
      builderCode: 77n,
    })
  })

  it('appends after the user ops for an exact-input swap, swapping on the burn leg', () => {
    expect(
      buildCreditWrappedDispatch({ ...args, direction: 'exact-in', placement: 'append' }),
    ).toEqual({
      positionIdList: [11n, 12n, 99n, 99n],
      finalPositionIdList: [9n, 12n],
      positionSizes: [100n, 0n, 5n, 0n],
      tickAndSpreadLimits: [
        [10n, 20n, 30n],
        [40n, 50n, 0n],
        [-100n, 100n, 0n],
        [100n, -100n, 0n],
      ],
      usePremiaAsCollateral: true,
      builderCode: 77n,
    })
  })

  it('prepends an exact-input swap so existing collateral funds later user ops', () => {
    expect(
      buildCreditWrappedDispatch({ ...args, direction: 'exact-in', placement: 'prepend' }),
    ).toEqual({
      positionIdList: [99n, 99n, 11n, 12n],
      finalPositionIdList: [9n, 12n],
      positionSizes: [5n, 0n, 100n, 0n],
      tickAndSpreadLimits: [
        [-100n, 100n, 0n],
        [100n, -100n, 0n],
        [10n, 20n, 30n],
        [40n, 50n, 0n],
      ],
      usePremiaAsCollateral: true,
      builderCode: 77n,
    })
  })

  it('does not mutate the base dispatch arrays', () => {
    buildCreditWrappedDispatch({ ...args, direction: 'exact-in', placement: 'append' })
    expect(baseDispatch.positionIdList).toEqual([11n, 12n])
    expect(baseDispatch.finalPositionIdList).toEqual([9n, 12n])
  })
})

describe('quoteOneTokenFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPool()
  })

  it('sources the other token with an exact-output credit when the account pays it', async () => {
    vi.mocked(simulateDispatch)
      // base: pays 6 of token0, receives 100 of token1 → target is token1
      .mockResolvedValueOnce(ok({ delta0: -6n, delta1: 100n }))
      // swap-only: sources 6 token0 for 120 token1
      .mockResolvedValueOnce(ok({ delta0: 6n, delta1: -120n }))
      // wrapped: token0 flat but for dust, everything lands in token1
      .mockResolvedValueOnce(ok({ delta0: -1n, delta1: -21n }))

    const result = await quote({ targetTokenIndex: 1n })

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.quote.direction).toBe('exact-out')
    expect(result.quote.targetToken).toBe(TOKEN1)
    expect(result.quote.otherToken).toBe(TOKEN0)
    expect(result.quote.swapAmount).toBe(6n)
    expect(result.quote.estimatedCounterAmount).toBe(120n)
    // 120 padded by 50bps, rounded up
    expect(result.quote.maximumAmountIn).toBe(121n)
    expect(result.quote.netTargetChange).toBe(-21n)
    expect(result.quote.residualOtherChange).toBe(-1n)
    // exact-out straddles
    expect(result.quote.dispatch.positionIdList).toEqual([
      result.quote.creditTokenId,
      ...baseDispatch.positionIdList,
      result.quote.creditTokenId,
    ])
    expect(simulateDispatch).toHaveBeenCalledTimes(3)
  })

  it('sells the other token with an exact-input credit when the account receives it', async () => {
    vi.mocked(simulateDispatch)
      // base: receives 6 of token0 alongside the token1 flow
      .mockResolvedValueOnce(ok({ delta0: 6n, delta1: -100n }))
      // wrapped: token0 cancelled, token1 up by the 110 the sale fetched
      .mockResolvedValueOnce(ok({ delta0: 0n, delta1: 10n }))

    const result = await quote({ targetTokenIndex: 1n })

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.quote.direction).toBe('exact-in')
    expect(result.quote.swapAmount).toBe(6n)
    // Recovered from the wrap: -100 (plain close) → +10, so the sale fetched 110.
    expect(result.quote.estimatedCounterAmount).toBe(110n)
    // no exact-out source guard applies
    expect(result.quote.maximumAmountIn).toBe(0n)
    expect(result.quote.residualOtherChange).toBe(0n)
    // No swap-only simulation on this path — it would revert for an account
    // holding none of the token the close is about to hand it.
    expect(simulateDispatch).toHaveBeenCalledTimes(2)
    // exact-in appends both legs AFTER the user ops
    expect(result.quote.dispatch.positionIdList).toEqual([
      ...baseDispatch.positionIdList,
      result.quote.creditTokenId,
      result.quote.creditTokenId,
    ])
  })

  it('reports already-single-token when the other side does not move', async () => {
    vi.mocked(simulateDispatch).mockResolvedValueOnce(ok({ delta0: 0n, delta1: -100n }))

    await expect(quote({ targetTokenIndex: 1n })).resolves.toMatchObject({
      available: false,
      reason: 'already-single-token',
    })
    expect(simulateDispatch).toHaveBeenCalledTimes(1)
  })

  describe('dust gate', () => {
    // Default is 50bps of the target flow. Target flow 10_000 → anything under
    // 50 of the other token (price 1.0 in these mocks) is not worth swapping.
    it('skips the swap when the other side is dust next to the target flow', async () => {
      vi.mocked(simulateDispatch).mockResolvedValueOnce(ok({ delta0: -1n, delta1: 10_000n }))

      await expect(quote({ targetTokenIndex: 1n })).resolves.toMatchObject({
        available: false,
        reason: 'below-threshold',
      })
      // Bailed before pricing the swap.
      expect(simulateDispatch).toHaveBeenCalledTimes(1)
    })

    it('swaps once the other side reaches the threshold', async () => {
      vi.mocked(simulateDispatch)
        .mockResolvedValueOnce(ok({ delta0: -50n, delta1: 10_000n }))
        .mockResolvedValueOnce(ok({ delta0: 50n, delta1: -60n }))
        .mockResolvedValueOnce(ok({ delta0: 0n, delta1: 9_940n }))

      await expect(quote({ targetTokenIndex: 1n })).resolves.toMatchObject({ available: true })
    })

    it('honours an explicit threshold', async () => {
      vi.mocked(simulateDispatch).mockResolvedValueOnce(ok({ delta0: -50n, delta1: 10_000n }))

      await expect(quote({ targetTokenIndex: 1n, minSwapRatioBps: 100n })).resolves.toMatchObject({
        available: false,
        reason: 'below-threshold',
      })
    })

    it('always swaps when the threshold is disabled', async () => {
      vi.mocked(simulateDispatch)
        .mockResolvedValueOnce(ok({ delta0: -1n, delta1: 10_000n }))
        .mockResolvedValueOnce(ok({ delta0: 1n, delta1: -2n }))
        .mockResolvedValueOnce(ok({ delta0: 0n, delta1: 9_998n }))

      await expect(quote({ targetTokenIndex: 1n, minSwapRatioBps: 0n })).resolves.toMatchObject({
        available: true,
      })
    })

    // The swap is what makes the transaction possible, not a convenience, so
    // the threshold must not suppress it.
    it('does not apply the threshold when the base dispatch reverted on a shortfall', async () => {
      vi.mocked(simulateDispatch)
        .mockResolvedValueOnce({
          success: false,
          error: new NotEnoughTokensError(TRACKER0, 10n, 9n),
          _meta: META,
        })
        .mockResolvedValueOnce(ok({ delta0: 1n, delta1: -2n }))
        .mockResolvedValueOnce(ok({ delta0: 0n, delta1: 9_998n }))

      await expect(quote({ targetTokenIndex: 1n })).resolves.toMatchObject({ available: true })
    })
  })

  it('sizes the swap from a NotEnoughTokens revert on the base dispatch', async () => {
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce({
        success: false,
        error: new NotEnoughTokensError(TRACKER0, 10n, 4n),
        _meta: META,
      })
      .mockResolvedValueOnce(ok({ delta0: 6n, delta1: -120n }))
      .mockResolvedValueOnce(ok({ delta0: 0n, delta1: -20n }))

    const result = await quote({ targetTokenIndex: 1n })

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.quote.direction).toBe('exact-out')
    expect(result.quote.swapAmount).toBe(6n)
    const recoverySwapLimits = vi.mocked(simulateDispatch).mock.calls[1]?.[0].tickAndSpreadLimits
    expect(recoverySwapLimits?.[0]).toEqual([50n, -50n, 0n])
  })

  it('gives up when the base dispatch reverts for an unrelated reason', async () => {
    vi.mocked(simulateDispatch).mockResolvedValueOnce({
      success: false,
      error: new PanopticError('PriceBoundFail'),
      _meta: META,
    })

    await expect(quote()).resolves.toMatchObject({
      available: false,
      reason: 'base-simulation-failed',
    })
  })

  it('refuses an exact-output swap the target balance cannot fund', async () => {
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce(ok({ delta0: -6n, delta1: 100n }))
      .mockResolvedValueOnce(ok({ delta0: 6n, delta1: -120n, balanceBefore1: 100n }))

    await expect(quote({ targetTokenIndex: 1n })).resolves.toMatchObject({
      available: false,
      reason: 'swap-unavailable',
    })
    // never reaches the wrapped simulation
    expect(simulateDispatch).toHaveBeenCalledTimes(2)
  })

  it('surfaces a revert of the wrapped dispatch', async () => {
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce(ok({ delta0: -6n, delta1: 100n }))
      .mockResolvedValueOnce(ok({ delta0: 6n, delta1: -120n }))
      .mockResolvedValueOnce({
        success: false,
        error: new PanopticError('InputListFail'),
        _meta: META,
      })

    await expect(quote({ targetTokenIndex: 1n })).resolves.toMatchObject({
      available: false,
      reason: 'wrap-unavailable',
    })
  })

  // Target is token1, so a shortfall reported against tracker1 is the account
  // being unable to fund the position at all — sourcing token0 would quote a
  // swap that does not address it.
  it('refuses to size a credit when the shortfall is in the target collateral', async () => {
    vi.mocked(simulateDispatch).mockResolvedValueOnce({
      success: false,
      error: new NotEnoughTokensError(TRACKER1, 10n, 4n),
      _meta: META,
    })

    await expect(quote({ targetTokenIndex: 1n })).resolves.toMatchObject({
      available: false,
      reason: 'base-simulation-failed',
    })
    expect(simulateDispatch).toHaveBeenCalledTimes(1)
  })

  it('refuses to size a credit when the shortfall is in neither collateral', async () => {
    vi.mocked(simulateDispatch).mockResolvedValueOnce({
      success: false,
      error: new NotEnoughTokensError(ACCOUNT, 10n, 4n),
      _meta: META,
    })

    await expect(quote({ targetTokenIndex: 1n })).resolves.toMatchObject({
      available: false,
      reason: 'base-simulation-failed',
    })
  })

  it('rejects tick limits that are reversed', async () => {
    await expect(quote({ tickLimitLow: 100n, tickLimitHigh: -100n })).resolves.toMatchObject({
      available: false,
      reason: 'invalid-tick-limits',
    })
    expect(simulateDispatch).not.toHaveBeenCalled()
  })

  it('rejects tick limits that are equal', async () => {
    await expect(quote({ tickLimitLow: 50n, tickLimitHigh: 50n })).resolves.toMatchObject({
      available: false,
      reason: 'invalid-tick-limits',
    })
    expect(simulateDispatch).not.toHaveBeenCalled()
  })

  it('rejects slippage that is not expressed in basis points', async () => {
    await expect(quote({ slippageBps: 887_272n })).resolves.toMatchObject({
      available: false,
      reason: 'invalid-slippage',
    })
    expect(simulateDispatch).not.toHaveBeenCalled()
  })

  it('rejects a target index that is not a token side', async () => {
    await expect(quote({ targetTokenIndex: 2n })).resolves.toMatchObject({
      available: false,
      reason: 'invalid-target-token',
    })
  })

  it('defaults the credit legs to the full tick range', async () => {
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce(ok({ delta0: -6n, delta1: 100n }))
      .mockResolvedValueOnce(ok({ delta0: 6n, delta1: -120n }))
      .mockResolvedValueOnce(ok({ delta0: 0n, delta1: -20n }))

    const result = await quote({ targetTokenIndex: 1n })

    expect(result.available).toBe(true)
    if (!result.available) return
    const limits = result.quote.dispatch.tickAndSpreadLimits
    expect(limits[0]).toEqual([MAX_TICK, MIN_TICK, 0n])
    expect(limits[limits.length - 1]).toEqual([MIN_TICK, MAX_TICK, 0n])
  })
})
