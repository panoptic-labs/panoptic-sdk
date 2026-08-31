import { createPublicClient, custom, zeroAddress } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotEnoughTokensError, PanopticError } from '../errors'
import { getPool } from '../reads/pool'
import type { Pool } from '../types'
import { simulateDispatch } from './simulateDispatch'
import {
  buildTemporaryLoanRecoveryDispatch,
  quoteTemporaryLoanRecovery,
} from './temporaryLoanRecovery'

vi.mock('../reads/pool', () => ({ getPool: vi.fn() }))
vi.mock('./simulateDispatch', () => ({ simulateDispatch: vi.fn() }))

const TOKEN0 = '0x0000000000000000000000000000000000000010'
const TOKEN1 = '0x0000000000000000000000000000000000000011'
const TRACKER0 = '0x0000000000000000000000000000000000000020'
const TRACKER1 = '0x0000000000000000000000000000000000000021'
const POOL_ADDRESS = '0x0000000000000000000000000000000000000030'
const ACCOUNT = '0x0000000000000000000000000000000000000040'
const META = { blockNumber: 123n, blockTimestamp: 456n, blockHash: '0x01' as const }

const tracker = (address: `0x${string}`, token: `0x${string}`) => ({
  address,
  token,
  symbol: 'TOKEN',
  decimals: 18n,
  totalAssets: 1_000n,
  insideAMM: 0n,
  creditedShares: 0n,
  totalShares: 1_000n,
  utilization: 0n,
  borrowRate: 0n,
  supplyRate: 0n,
})

const POOL: Pool = {
  address: POOL_ADDRESS,
  chainId: 1n,
  poolId: 1n,
  poolKey: {
    currency0: TOKEN0,
    currency1: TOKEN1,
    fee: 3_000n,
    tickSpacing: 10n,
    hooks: zeroAddress,
  },
  tickSpacing: 10n,
  collateralTracker0: tracker(TRACKER0, TOKEN0),
  collateralTracker1: tracker(TRACKER1, TOKEN1),
  riskEngine: {
    address: zeroAddress,
    collateralRequirement: 0n,
    maintenanceMargin: 0n,
    commissionRate: 0n,
    premiumFeeRate: 0n,
    vegoid: 0n,
    maxSpread: 0n,
  },
  currentTick: 100n,
  sqrtPriceX96: 1n << 96n,
  uniswapPoolLiquidity: 1_000n,
  healthStatus: 'active',
  metadata: {
    poolKeyBytes: '0x',
    poolId: 1n,
    collateralToken0Address: TRACKER0,
    collateralToken1Address: TRACKER1,
    riskEngineAddress: zeroAddress,
    token0Asset: TOKEN0,
    token1Asset: TOKEN1,
    token0Symbol: 'TOKEN0',
    token1Symbol: 'TOKEN1',
    token0Decimals: 18n,
    token1Decimals: 18n,
    token0Name: 'Token 0',
    token1Name: 'Token 1',
    underlyingPoolId: POOL_ADDRESS,
    isV4: false,
    tickSpacing: 10n,
    fee: 3_000n,
    sfpmAddress: zeroAddress,
  },
  _meta: META,
}

const baseDispatch = {
  positionIdList: [11n],
  finalPositionIdList: [],
  positionSizes: [0n],
  tickAndSpreadLimits: [[90n, 110n, 0n] as const],
  usePremiaAsCollateral: true,
  builderCode: 77n,
}

const success = () => ({
  success: true as const,
  data: {
    netAmount0: 2n,
    netAmount1: -3n,
    premiaReceived0: null,
    premiaReceived1: null,
    positionsCreated: [],
    positionsClosed: [11n],
    postCollateral0: 12n,
    postCollateral1: 17n,
    preMarginExcess0: 1n,
    preMarginExcess1: 1n,
    postMarginExcess0: 12n,
    postMarginExcess1: 17n,
  },
  gasEstimate: 123_000n,
  tokenFlow: {
    delta0: 2n,
    delta1: -3n,
    balanceBefore0: 10n,
    balanceBefore1: 20n,
    balanceAfter0: 12n,
    balanceAfter1: 17n,
    tickBefore: 100n,
    tickAfter: 100n,
  },
  _meta: META,
})

const client = createPublicClient({
  transport: custom({ request: vi.fn() }),
})
vi.spyOn(client, 'getBlockNumber').mockResolvedValue(123n)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPool).mockResolvedValue(POOL)
})

describe('buildTemporaryLoanRecoveryDispatch', () => {
  it('straddles the operation with an intentional repeated loan and swapped burn', () => {
    const dispatch = buildTemporaryLoanRecoveryDispatch({
      dispatch: baseDispatch,
      loanTokenId: 99n,
      loanPositionSize: 6n,
      tickLimitLow: 50n,
      tickLimitHigh: 150n,
    })

    expect(dispatch).toEqual({
      positionIdList: [99n, 11n, 99n],
      finalPositionIdList: [],
      positionSizes: [6n, 0n, 0n],
      tickAndSpreadLimits: [
        [50n, 150n, 0n],
        [90n, 110n, 0n],
        [150n, 50n, 0n],
      ],
      usePremiaAsCollateral: true,
      builderCode: 77n,
    })
  })
})

describe('quoteTemporaryLoanRecovery', () => {
  const quote = (error: unknown) =>
    quoteTemporaryLoanRecovery({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      chainId: 1n,
      existingPositionIds: [11n],
      dispatch: baseDispatch,
      error,
      slippageBps: 30n,
    })

  it('quotes a fully simulated temporary loan at a pinned block', async () => {
    vi.mocked(simulateDispatch).mockResolvedValue(success())

    const result = await quote(new NotEnoughTokensError(TRACKER0, 10n, 4n))

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.quote).toMatchObject({
      loanToken: TOKEN0,
      repaymentToken: TOKEN1,
      loanTokenIndex: 0n,
      loanAmount: 6n,
      netLoanTokenChange: 2n,
      netRepaymentTokenChange: -3n,
    })
    expect(result.quote.dispatch.positionIdList[0]).toBe(result.quote.loanTokenId)
    expect(result.quote.dispatch.positionIdList.at(-1)).toBe(result.quote.loanTokenId)
    expect(result.quote.dispatch.tickAndSpreadLimits[0]).toEqual([70n, 130n, 0n])
    expect(result.quote.dispatch.tickAndSpreadLimits.at(-1)).toEqual([130n, 70n, 0n])
    expect(simulateDispatch).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 123n }))
  })

  it('grows the loan by a decoded residual and retries', async () => {
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce({
        success: false,
        error: new NotEnoughTokensError(TRACKER0, 10n, 8n),
        _meta: META,
      })
      .mockResolvedValueOnce(success())

    const result = await quote(new NotEnoughTokensError(TRACKER0, 10n, 4n))

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.quote.loanAmount).toBe(8n)
    expect(simulateDispatch).toHaveBeenCalledTimes(2)
  })

  it('keeps probing when asset/share rounding reports a non-positive residual', async () => {
    vi.mocked(simulateDispatch)
      .mockResolvedValueOnce({
        success: false,
        error: new NotEnoughTokensError(TRACKER0, 10n, 11n),
        _meta: META,
      })
      .mockResolvedValueOnce(success())

    const result = await quote(new NotEnoughTokensError(TRACKER0, 10n, 4n))

    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.quote.loanAmount).toBe(7n)
    expect(simulateDispatch).toHaveBeenCalledTimes(2)
  })

  it('stops when repayment moves the shortfall to the counter-token', async () => {
    vi.mocked(simulateDispatch).mockResolvedValue({
      success: false,
      error: new NotEnoughTokensError(TRACKER1, 10n, 4n),
      _meta: META,
    })

    await expect(quote(new NotEnoughTokensError(TRACKER0, 10n, 4n))).resolves.toMatchObject({
      available: false,
      reason: 'repayment-token-shortfall',
    })
  })

  it('does not retry non-shortfall failures', async () => {
    vi.mocked(simulateDispatch).mockResolvedValue({
      success: false,
      error: new PanopticError('price impact'),
      _meta: META,
    })

    await expect(quote(new NotEnoughTokensError(TRACKER0, 10n, 4n))).resolves.toMatchObject({
      available: false,
      reason: 'recovery-unavailable',
    })
    expect(simulateDispatch).toHaveBeenCalledTimes(1)
  })

  it('rejects zero slippage because the repayment limits must be inverted', async () => {
    const result = await quoteTemporaryLoanRecovery({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      chainId: 1n,
      existingPositionIds: [11n],
      dispatch: baseDispatch,
      error: new NotEnoughTokensError(TRACKER0, 10n, 4n),
      slippageBps: 0n,
    })

    expect(result).toMatchObject({ available: false, reason: 'invalid-slippage' })
    expect(getPool).not.toHaveBeenCalled()
  })

  it('rejects partial-close dispatches before building a temporary loan', async () => {
    await expect(
      quoteTemporaryLoanRecovery({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT,
        chainId: 1n,
        existingPositionIds: [11n, 12n],
        dispatch: { ...baseDispatch, finalPositionIdList: [12n] },
        error: new NotEnoughTokensError(TRACKER0, 10n, 4n),
        slippageBps: 30n,
      }),
    ).rejects.toThrow(
      'Temporary-loan recovery requires a full-close dispatch with an empty finalPositionIdList',
    )
    expect(client.getBlockNumber).not.toHaveBeenCalled()
    expect(getPool).not.toHaveBeenCalled()
  })

  it('wraps getBlockNumber RPC failures and retains the cause', async () => {
    const cause = new Error('block RPC unavailable')
    vi.mocked(client.getBlockNumber).mockRejectedValueOnce(cause)

    const result = quote(new NotEnoughTokensError(TRACKER0, 10n, 4n))

    await expect(result).rejects.toMatchObject({
      message: 'Failed to resolve the block for temporary-loan recovery',
      cause,
    })
    expect(getPool).not.toHaveBeenCalled()
  })

  it('wraps getPool RPC failures and retains the cause', async () => {
    const cause = new Error('pool RPC unavailable')
    vi.mocked(getPool).mockRejectedValueOnce(cause)

    const result = quote(new NotEnoughTokensError(TRACKER0, 10n, 4n))

    await expect(result).rejects.toMatchObject({
      message: 'Failed to load the pool for temporary-loan recovery',
      cause,
    })
  })

  it('preserves PanopticError instances from RPC reads', async () => {
    const error = new PanopticError('pool read failed')
    vi.mocked(getPool).mockRejectedValueOnce(error)

    await expect(quote(new NotEnoughTokensError(TRACKER0, 10n, 4n))).rejects.toBe(error)
  })
})
