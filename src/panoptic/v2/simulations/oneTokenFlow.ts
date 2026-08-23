/**
 * "One token out": force the net token flow of an arbitrary dispatch into a
 * single collateral token.
 *
 * Closing a multi-leg position normally settles in BOTH collateral tokens — a
 * straddle with one ITM leg pays out in one and charges in the other. This
 * module wraps the user's dispatch with a temporary width=0 credit leg that
 * cancels the non-target side, so the account's net change is (up to dust) in
 * one token only.
 *
 * Generalises {@link quoteTokenShortfallRecovery}, which handles the same
 * mechanism but only in the "user is short a token" direction and only when the
 * pool has already reverted with `NotEnoughTokens`.
 *
 * @module v2/simulations/oneTokenFlow
 */

import type { Address, PublicClient } from 'viem'

import { PanopticError } from '../errors'
import { getPool } from '../reads/pool'
import type { BlockMeta, TokenFlow } from '../types'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
import { convertToTokenIndex } from '../utils/priceConvert'
import { buildUniqueCredit } from '../writes/loanUtils'
import {
  type CreditWrapDirection,
  type DispatchIntent,
  buildCreditWrappedDispatch,
} from './creditWrap'
import { simulateDispatch } from './simulateDispatch'
import { getNotEnoughTokensError, quoteTokenShortfallRecovery } from './tokenShortfallRecovery'

const BPS_DENOMINATOR = 10_000n

/**
 * Default {@link OneTokenFlowQuoteParams.minSwapRatioBps}: 0.5%.
 *
 * A swap pays a pool fee of roughly 5-30 bps plus slippage, so a non-target
 * flow below this fraction of the target flow cannot pay for itself — while
 * still leaving any residual small enough not to surprise someone who asked to
 * settle in one token.
 */
export const DEFAULT_MIN_SWAP_RATIO_BPS = 50n

export interface OneTokenFlowQuoteParams {
  client: PublicClient
  poolAddress: Address
  account: Address
  chainId: bigint
  /** The user's actual on-chain position list BEFORE the dispatch. */
  existingPositionIds: bigint[]
  /** The dispatch the user is about to send, unwrapped. */
  dispatch: DispatchIntent
  /** Index of the token the whole net flow should land in: `0n` or `1n`. */
  targetTokenIndex: bigint
  /**
   * Slippage tolerance for the credit swap, in **basis points** (1% = 100).
   * Applied to the estimated target-token cost of an exact-out swap to produce
   * `maximumAmountIn`. Values above `10_000` (100%) are rejected.
   */
  slippageBps: bigint
  /**
   * Minimum size of the non-target flow, in **basis points** of the target
   * token's own flow, for the swap to be worth doing. Below this the residual
   * is dust and the swap would cost more in pool fee and slippage than it
   * settles, so the quote reports `below-threshold` and the caller falls back
   * to the native two-token flow. Defaults to
   * {@link DEFAULT_MIN_SWAP_RATIO_BPS}. Pass `0n` to always swap.
   *
   * Only applied when the unwrapped dispatch simulates successfully. When it
   * reverts on a shortfall, the swap is what makes the transaction possible at
   * all, so no threshold is applied.
   */
  minSwapRatioBps?: bigint
  /**
   * Price bound for the temporary credit legs. Defaults to the full tick range —
   * the swap is protected economically by the balance check, not by a price
   * band, and the user's own operations keep their own limits.
   */
  tickLimitLow?: bigint
  /** See {@link OneTokenFlowQuoteParams.tickLimitLow}. */
  tickLimitHigh?: bigint
  blockNumber?: bigint
}

export interface OneTokenFlowQuote {
  targetToken: Address
  otherToken: Address
  targetTokenIndex: bigint
  otherTokenIndex: bigint
  direction: CreditWrapDirection
  /**
   * Amount of `otherToken` the credit sources (`exact-out`) or sells
   * (`exact-in`) — i.e. the non-target flow being cancelled.
   */
  swapAmount: bigint
  /**
   * Target-token side of the swap leg alone, priced by a swap-only simulation:
   * spent for `exact-out`, received for `exact-in`. NOT the same as
   * `netTargetChange`, which also includes the user's own operations.
   */
  estimatedCounterAmount: bigint
  /** `estimatedCounterAmount` padded by `slippageBps`. `exact-out` only. */
  maximumAmountIn: bigint
  slippageBps: bigint
  /** Signed net change of the target token across the ENTIRE wrapped tx. */
  netTargetChange: bigint
  /**
   * Signed net change of the other token across the entire wrapped tx — the
   * residual dust left by sizing the credit from a single simulation. Disclose
   * this to the user rather than claiming an exact zero.
   */
  residualOtherChange: bigint
  /** The temporary width=0 credit leg used to move the flow. */
  creditTokenId: bigint
  dispatch: DispatchIntent
  tokenFlow: TokenFlow
  _meta: BlockMeta
}

export type OneTokenFlowUnavailableReason =
  | 'already-single-token'
  | 'below-threshold'
  | 'base-simulation-failed'
  | 'invalid-slippage'
  | 'invalid-target-token'
  | 'invalid-tick-limits'
  | 'swap-unavailable'
  | 'wrap-unavailable'

export type OneTokenFlowResult =
  | { available: true; quote: OneTokenFlowQuote }
  | {
      available: false
      reason: OneTokenFlowUnavailableReason
      /** Human-readable description of the sub-step that failed, for diagnostics. */
      detail?: string
      error?: PanopticError
    }

function deltaAt(tokenFlow: TokenFlow, index: bigint): bigint {
  return index === 0n ? tokenFlow.delta0 : tokenFlow.delta1
}

function balanceBeforeAt(tokenFlow: TokenFlow, index: bigint): bigint {
  return index === 0n ? tokenFlow.balanceBefore0 : tokenFlow.balanceBefore1
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

function padForSlippage(amount: bigint, slippageBps: bigint): bigint {
  return (amount * (BPS_DENOMINATOR + slippageBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
}

/**
 * Quote a dispatch wrapped so its net flow lands in `targetTokenIndex` only.
 *
 * Three simulations, all pinned to one block and with no convergence loop:
 *
 * 1. the user's dispatch as-is, to measure the non-target flow to cancel;
 * 2. the credit legs alone, to price the swap and check the source balance;
 * 3. the wrapped dispatch, whose token flow is what the user is shown and what
 *    the residual dust is read from.
 */
export async function quoteOneTokenFlow(
  params: OneTokenFlowQuoteParams,
): Promise<OneTokenFlowResult> {
  const { targetTokenIndex } = params
  const minSwapRatioBps = params.minSwapRatioBps ?? DEFAULT_MIN_SWAP_RATIO_BPS
  if (targetTokenIndex !== 0n && targetTokenIndex !== 1n) {
    return {
      available: false,
      reason: 'invalid-target-token',
      detail: `targetTokenIndex=${targetTokenIndex} is neither 0 nor 1`,
    }
  }
  if (params.slippageBps < 0n || params.slippageBps > BPS_DENOMINATOR) {
    return {
      available: false,
      reason: 'invalid-slippage',
      detail: `slippageBps=${params.slippageBps} is outside [0, ${BPS_DENOMINATOR}]`,
    }
  }
  const tickLimitLow = params.tickLimitLow ?? MIN_TICK
  const tickLimitHigh = params.tickLimitHigh ?? MAX_TICK
  if (tickLimitLow >= tickLimitHigh) {
    return {
      available: false,
      reason: 'invalid-tick-limits',
      detail: `tickLimitLow=${tickLimitLow} >= tickLimitHigh=${tickLimitHigh}`,
    }
  }

  const otherTokenIndex = targetTokenIndex === 0n ? 1n : 0n
  const targetBlockNumber = params.blockNumber ?? (await params.client.getBlockNumber())
  const simulateArgs = {
    client: params.client,
    poolAddress: params.poolAddress,
    account: params.account,
    existingPositionIdList: params.existingPositionIds,
    blockNumber: targetBlockNumber,
  }

  // Read ahead of the simulation: the shortfall branch below has to know which
  // collateral a NotEnoughTokens revert refers to before it can size a credit.
  const pool = await getPool({
    client: params.client,
    poolAddress: params.poolAddress,
    chainId: params.chainId,
    blockNumber: targetBlockNumber,
  })
  const token0 = pool.collateralTracker0.token
  const token1 = pool.collateralTracker1.token
  const targetToken = targetTokenIndex === 0n ? token0 : token1
  const otherToken = otherTokenIndex === 0n ? token0 : token1
  // NotEnoughTokens is raised by the CollateralTracker and carries ITS address,
  // not the underlying token's.
  const otherTracker =
    otherTokenIndex === 0n ? pool.collateralTracker0.address : pool.collateralTracker1.address

  // 1. The user's dispatch as-is. When it reverts because the account is short
  //    the non-target token, the revert itself quantifies the flow to cancel —
  //    so one-token-out subsumes the plain shortfall-recovery case.
  const baseSimulation = await simulateDispatch({ ...simulateArgs, ...params.dispatch })
  let swapAmount: bigint
  let direction: CreditWrapDirection
  // The target-token flow of the user's ops alone. Null when the base dispatch
  // reverted, which only happens on the exact-out path.
  let baseTargetDelta: bigint | null = null
  if (baseSimulation.success && baseSimulation.tokenFlow !== undefined) {
    baseTargetDelta = deltaAt(baseSimulation.tokenFlow, targetTokenIndex)
    const otherDelta = deltaAt(baseSimulation.tokenFlow, otherTokenIndex)
    if (otherDelta === 0n) {
      return {
        available: false,
        reason: 'already-single-token',
        detail: 'the dispatch does not move the non-target token',
      }
    }
    // delta < 0: the account PAYS the other token — source it (exact-out).
    // delta > 0: the account RECEIVES it — sell it into the target (exact-in).
    direction = otherDelta < 0n ? 'exact-out' : 'exact-in'
    swapAmount = abs(otherDelta)
  } else {
    const shortfall = baseSimulation.success ? null : getNotEnoughTokensError(baseSimulation.error)
    if (shortfall === null) {
      return {
        available: false,
        reason: 'base-simulation-failed',
        detail: baseSimulation.success
          ? 'base simulation returned no token flow'
          : `base simulation reverted: ${baseSimulation.error.message}`,
        error: baseSimulation.success ? undefined : baseSimulation.error,
      }
    }
    // Only a shortfall in the NON-target collateral can be sized as a credit in
    // otherTokenIndex. A shortfall in the target token (or in neither) means the
    // account cannot fund the position at all, and sourcing the other token
    // would quote a swap that does not address it.
    if (shortfall.tokenAddress.toLowerCase() !== otherTracker.toLowerCase()) {
      return {
        available: false,
        reason: 'base-simulation-failed',
        detail: `shortfall is in ${shortfall.tokenAddress}, not the non-target collateral ${otherTracker}`,
        error: baseSimulation.success ? undefined : baseSimulation.error,
      }
    }
    const pending = shortfall.assetsRequested - shortfall.assetBalance
    if (pending <= 0n) {
      return {
        available: false,
        reason: 'base-simulation-failed',
        detail: `requested=${shortfall.assetsRequested} <= balance=${shortfall.assetBalance}`,
      }
    }
    const recovery = await quoteTokenShortfallRecovery({
      client: params.client,
      poolAddress: params.poolAddress,
      account: params.account,
      chainId: params.chainId,
      existingPositionIds: params.existingPositionIds,
      dispatch: params.dispatch,
      error: shortfall,
      slippageBps: params.slippageBps,
      tickLimitLow: params.tickLimitLow,
      tickLimitHigh: params.tickLimitHigh,
      blockNumber: targetBlockNumber,
    })
    if (!recovery.available) {
      return {
        available: false,
        reason: recovery.reason === 'swap-unavailable' ? 'swap-unavailable' : 'wrap-unavailable',
        detail: recovery.detail,
        error: recovery.error,
      }
    }
    return {
      available: true,
      quote: {
        targetToken,
        otherToken,
        targetTokenIndex,
        otherTokenIndex,
        direction: recovery.quote.direction,
        swapAmount: recovery.quote.amountOut,
        estimatedCounterAmount: recovery.quote.estimatedAmountIn,
        maximumAmountIn: recovery.quote.maximumAmountIn,
        slippageBps: params.slippageBps,
        netTargetChange: recovery.quote.netTokenInChange,
        residualOtherChange: recovery.quote.netTokenOutChange,
        creditTokenId: recovery.quote.creditTokenId,
        dispatch: recovery.quote.dispatch,
        tokenFlow: recovery.quote.tokenFlow,
        _meta: recovery.quote._meta,
      },
    }
  }

  // Dust gate. The non-target flow is only worth swapping if it is material
  // next to the flow being settled; below that the swap burns a pool fee and
  // slippage to move an amount the user cannot see. Skipped when the base
  // dispatch reverted (baseTargetDelta === null), because there the swap is
  // what makes the transaction possible rather than a convenience.
  //
  // Compared in the target token's terms so the two sides share a scale. Note
  // this is deliberately NOT a fraction of notional: Neutralize ITM drives the
  // net flow toward zero while notional stays large, which would suppress the
  // swap on nearly every neutralized position.
  if (baseTargetDelta !== null && minSwapRatioBps > 0n) {
    const swapInTargetTerms = convertToTokenIndex(
      swapAmount,
      otherTokenIndex,
      targetTokenIndex,
      pool.sqrtPriceX96,
    )
    if (swapInTargetTerms * BPS_DENOMINATOR < minSwapRatioBps * abs(baseTargetDelta)) {
      return {
        available: false,
        reason: 'below-threshold',
        detail:
          `non-target flow ${swapInTargetTerms} (in target token terms) is below ` +
          `${minSwapRatioBps}bps of the target flow ${abs(baseTargetDelta)}`,
      }
    }
  }

  // asset === tokenType === otherTokenIndex: the credit is denominated in the
  // token whose flow is being cancelled. Passing the counter-token as tokenType
  // is the LOAN convention and silently inverts the swap.
  const collisionIds = Array.from(
    new Set([
      ...params.existingPositionIds,
      ...params.dispatch.positionIdList,
      ...params.dispatch.finalPositionIdList,
    ]),
  )
  const credit = buildUniqueCredit(
    pool.poolId,
    otherTokenIndex,
    otherTokenIndex,
    pool.currentTick,
    pool.tickSpacing,
    collisionIds,
    swapAmount,
  )

  // exact-out must straddle the user's ops so the sourced token is available
  // while they run; exact-in can only follow them, since the token being sold
  // does not exist until they have run.
  const placement = direction === 'exact-out' ? 'straddle' : 'append'
  const creditWrapArgs = {
    creditTokenId: credit.tokenId,
    creditPositionSize: credit.adjustedSize,
    tickLimitLow,
    tickLimitHigh,
    direction,
    placement,
  } as const

  // 2. For exact-out ONLY, the credit legs alone: prices the swap and proves the
  //    account can cover it out of the target token before it is committed to.
  //
  //    Deliberately skipped for exact-in. There, the token being sold does not
  //    exist until the user's ops have run, so a swap-only simulation reverts
  //    for an account holding none of it — refusing a wrap that would in fact
  //    have worked. Its price is recovered from the wrapped run instead, and no
  //    balance guard is needed since the ops themselves fund the sale.
  let estimatedCounterAmount = 0n
  let maximumAmountIn = 0n
  if (direction === 'exact-out') {
    const swapOnlyDispatch = buildCreditWrappedDispatch({
      ...creditWrapArgs,
      dispatch: {
        positionIdList: [],
        finalPositionIdList: [...params.existingPositionIds],
        positionSizes: [],
        tickAndSpreadLimits: [],
        usePremiaAsCollateral: false,
        builderCode: 0n,
      },
    })
    const swapSimulation = await simulateDispatch({ ...simulateArgs, ...swapOnlyDispatch })
    if (!swapSimulation.success || swapSimulation.tokenFlow === undefined) {
      return {
        available: false,
        reason: 'swap-unavailable',
        detail: swapSimulation.success
          ? 'swap-only simulation returned no token flow'
          : `swap-only simulation reverted: ${swapSimulation.error.message}`,
        error: swapSimulation.success ? undefined : swapSimulation.error,
      }
    }
    estimatedCounterAmount = abs(deltaAt(swapSimulation.tokenFlow, targetTokenIndex))
    maximumAmountIn = padForSlippage(estimatedCounterAmount, params.slippageBps)
    const sourceBalance = balanceBeforeAt(swapSimulation.tokenFlow, targetTokenIndex)
    if (sourceBalance < maximumAmountIn) {
      return {
        available: false,
        reason: 'swap-unavailable',
        detail: `source balance ${sourceBalance} < maximumAmountIn ${maximumAmountIn} (estimated ${estimatedCounterAmount}, slippageBps ${params.slippageBps})`,
        error: new PanopticError('Insufficient collateral to fund the one-token-out swap'),
      }
    }
  }

  // 3. The wrapped dispatch. Single pass — the swap itself shifts fees and
  //    commission slightly, so the non-target side lands near, not exactly at,
  //    zero. That remainder is surfaced as `residualOtherChange`.
  const wrappedDispatch = buildCreditWrappedDispatch({
    ...creditWrapArgs,
    dispatch: params.dispatch,
  })
  const wrappedSimulation = await simulateDispatch({ ...simulateArgs, ...wrappedDispatch })
  if (!wrappedSimulation.success || wrappedSimulation.tokenFlow === undefined) {
    return {
      available: false,
      reason: 'wrap-unavailable',
      detail: wrappedSimulation.success
        ? 'wrapped dispatch simulation returned no token flow'
        : `wrapped dispatch reverted: ${wrappedSimulation.error.message}`,
      error: wrappedSimulation.success ? undefined : wrappedSimulation.error,
    }
  }

  // exact-in never priced the swap on its own (see above): recover it as the
  // extra target-token the wrap produced over the plain dispatch.
  if (direction === 'exact-in' && baseTargetDelta !== null) {
    estimatedCounterAmount = abs(
      deltaAt(wrappedSimulation.tokenFlow, targetTokenIndex) - baseTargetDelta,
    )
  }

  return {
    available: true,
    quote: {
      targetToken,
      otherToken,
      targetTokenIndex,
      otherTokenIndex,
      direction,
      swapAmount,
      estimatedCounterAmount,
      maximumAmountIn,
      slippageBps: params.slippageBps,
      netTargetChange: deltaAt(wrappedSimulation.tokenFlow, targetTokenIndex),
      residualOtherChange: deltaAt(wrappedSimulation.tokenFlow, otherTokenIndex),
      creditTokenId: credit.tokenId,
      dispatch: wrappedDispatch,
      tokenFlow: wrappedSimulation.tokenFlow,
      _meta: wrappedSimulation._meta,
    },
  }
}
