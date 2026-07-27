import type { Address, PublicClient } from 'viem'

import type { BatchDispatchArgs } from '../batch/types'
import { NotEnoughTokensError, PanopticError, parsePanopticError } from '../errors'
import { getPool } from '../reads/pool'
import type { BlockMeta, DispatchSimulation, SimulationResult, TokenFlow } from '../types'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
import { buildUniqueCredit } from '../writes/loanUtils'
import { simulateDispatch } from './simulateDispatch'

const BPS_DENOMINATOR = 10_000n
const MAX_RECOVERY_QUOTE_ATTEMPTS = 8

/**
 * Pre-encoded `dispatch()` arguments the recovery wraps.
 *
 * Alias of {@link BatchDispatchArgs} — the two are the same concept.
 */
export type DispatchIntent = BatchDispatchArgs

export interface TokenShortfallRecoveryQuoteParams {
  client: PublicClient
  poolAddress: Address
  account: Address
  chainId: bigint
  existingPositionIds: bigint[]
  dispatch: DispatchIntent
  error: unknown
  /**
   * Slippage tolerance for the recovery swap, in **basis points** (1% = 100).
   * Applied to `estimatedAmountIn` to produce `maximumAmountIn`.
   * Values above `10_000` (100%) are rejected as `invalid-slippage`.
   */
  slippageBps: bigint
  /**
   * Price bound for the temporary credit legs. Defaults to the full tick range —
   * the recovery swap is protected economically by `maximumAmountIn`, not by a
   * price band, and the user's own operations keep their own limits.
   */
  tickLimitLow?: bigint
  /** See {@link TokenShortfallRecoveryQuoteParams.tickLimitLow}. */
  tickLimitHigh?: bigint
  blockNumber?: bigint
}

export interface TokenShortfallRecoveryQuote {
  tokenIn: Address
  tokenOut: Address
  /**
   * Exact amount of `tokenOut` the temporary credit sources. Covers the whole
   * dispatch, not just the first charge that reverted — a batch charges
   * commission/premia per operation, so the total needed is usually larger
   * than the `assetsRequested - assetBalance` of the first failure.
   */
  amountOut: bigint
  estimatedAmountIn: bigint
  maximumAmountIn: bigint
  slippageBps: bigint
  /**
   * Signed net change of `tokenIn` across the ENTIRE wrapped transaction —
   * the user's own operations plus the recovery swap. This is what a wallet
   * simulation shows, and it is not the same as `-estimatedAmountIn`, which
   * prices the swap leg alone.
   */
  netTokenInChange: bigint
  /** Signed net change of `tokenOut` across the entire wrapped transaction. */
  netTokenOutChange: bigint
  /** The temporary width=0 credit leg used to source the shortfall. */
  creditTokenId: bigint
  dispatch: DispatchIntent
  simulation: SimulationResult<DispatchSimulation> & { success: true }
  tokenFlow: TokenFlow
  _meta: BlockMeta
}

export type TokenShortfallRecoveryUnavailableReason =
  | 'not-token-shortfall'
  | 'invalid-shortfall'
  | 'invalid-slippage'
  | 'unsupported-token'
  | 'invalid-tick-limits'
  | 'swap-unavailable'
  | 'recovery-unavailable'

export type TokenShortfallRecoveryResult =
  | { available: true; quote: TokenShortfallRecoveryQuote }
  | {
      available: false
      reason: TokenShortfallRecoveryUnavailableReason
      /** Human-readable description of the sub-step that failed, for diagnostics. */
      detail?: string
      error?: PanopticError
    }

export interface BuildTokenShortfallRecoveryDispatchParams {
  dispatch: DispatchIntent
  /** The temporary width=0 credit leg that sources the missing token. */
  creditTokenId: bigint
  creditPositionSize: bigint
  tickLimitLow: bigint
  tickLimitHigh: bigint
}

/**
 * Wrap a dispatch with a temporary credit leg that sources the shortfall.
 *
 * Exact-output construction: mint the credit with `swapAtMint=true` (paying a
 * swapped amount of the token the account has), run the user's operations, then
 * burn it with `swapAtMint=false` to receive exactly the missing token.
 *
 * A credit rather than a loan so the recovery is never capped by the shortfall
 * token's utilization — the case that fails today on a >94% utilized tracker.
 */
export function buildTokenShortfallRecoveryDispatch(
  params: BuildTokenShortfallRecoveryDispatchParams,
): DispatchIntent {
  const { dispatch, creditTokenId, creditPositionSize, tickLimitLow, tickLimitHigh } = params
  const low = tickLimitLow <= tickLimitHigh ? tickLimitLow : tickLimitHigh
  const high = tickLimitLow <= tickLimitHigh ? tickLimitHigh : tickLimitLow
  const mintLimits = [high, low, 0n] as const
  const burnLimits = [low, high, 0n] as const

  return {
    positionIdList: [creditTokenId, ...dispatch.positionIdList, creditTokenId],
    finalPositionIdList: [...dispatch.finalPositionIdList],
    positionSizes: [creditPositionSize, ...dispatch.positionSizes, 0n],
    tickAndSpreadLimits: [mintLimits, ...dispatch.tickAndSpreadLimits, burnLimits],
    usePremiaAsCollateral: dispatch.usePremiaAsCollateral,
    builderCode: dispatch.builderCode,
  }
}

/**
 * Extract a fully-decoded `NotEnoughTokens` revert from an arbitrary error.
 *
 * Returns `null` when the error is something else, or when only the 4-byte
 * selector could be matched (the parser's fallback path constructs the error
 * with undefined args, which is not actionable).
 */
export function getNotEnoughTokensError(error: unknown): NotEnoughTokensError | null {
  let candidate: NotEnoughTokensError | null = null
  if (error instanceof NotEnoughTokensError) {
    candidate = error
  } else {
    const parsed = parsePanopticError(error)
    if (parsed?.error instanceof NotEnoughTokensError) candidate = parsed.error
  }
  if (candidate === null) return null
  // Selector-only decodes yield undefined args at runtime despite the types.
  const args: Partial<
    Pick<NotEnoughTokensError, 'tokenAddress' | 'assetsRequested' | 'assetBalance'>
  > = candidate
  if (
    args.tokenAddress === undefined ||
    args.assetsRequested === undefined ||
    args.assetBalance === undefined
  ) {
    return null
  }
  return candidate
}

function maximumAmountIn(estimatedAmountIn: bigint, slippageBps: bigint): bigint {
  if (slippageBps < 0n) {
    throw new PanopticError('slippageBps must be non-negative')
  }
  return (
    (estimatedAmountIn * (BPS_DENOMINATOR + slippageBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
  )
}

function getInputAmount(tokenFlow: TokenFlow, tokenInIndex: 0n | 1n): bigint {
  const delta = tokenInIndex === 0n ? tokenFlow.delta0 : tokenFlow.delta1
  return delta < 0n ? -delta : delta
}

function getBalanceBefore(tokenFlow: TokenFlow, tokenIndex: 0n | 1n): bigint {
  return tokenIndex === 0n ? tokenFlow.balanceBefore0 : tokenFlow.balanceBefore1
}

function getOutputAmount(tokenFlow: TokenFlow, tokenOutIndex: 0n | 1n): bigint {
  const delta = tokenOutIndex === 0n ? tokenFlow.delta0 : tokenFlow.delta1
  return delta > 0n ? delta : 0n
}

export async function quoteTokenShortfallRecovery(
  params: TokenShortfallRecoveryQuoteParams,
): Promise<TokenShortfallRecoveryResult> {
  const shortfallError = getNotEnoughTokensError(params.error)
  if (shortfallError === null) {
    return { available: false, reason: 'not-token-shortfall' }
  }

  let amountOut = shortfallError.assetsRequested - shortfallError.assetBalance
  if (amountOut <= 0n) {
    return {
      available: false,
      reason: 'invalid-shortfall',
      detail: `requested=${shortfallError.assetsRequested} <= balance=${shortfallError.assetBalance}`,
    }
  }
  if (params.slippageBps < 0n || params.slippageBps > BPS_DENOMINATOR) {
    return {
      available: false,
      reason: 'invalid-slippage',
      detail: `slippageBps=${params.slippageBps} is outside [0, ${BPS_DENOMINATOR}]`,
    }
  }
  // The credit legs default to the full tick range: the swap is bounded
  // economically by maximumAmountIn, and the user's own ops keep their limits.
  const tickLimitLow = params.tickLimitLow ?? MIN_TICK
  const tickLimitHigh = params.tickLimitHigh ?? MAX_TICK
  if (tickLimitLow >= tickLimitHigh) {
    return {
      available: false,
      reason: 'invalid-tick-limits',
      detail: `tickLimitLow=${tickLimitLow} >= tickLimitHigh=${tickLimitHigh}`,
    }
  }

  const targetBlockNumber = params.blockNumber ?? (await params.client.getBlockNumber())
  const pool = await getPool({
    client: params.client,
    poolAddress: params.poolAddress,
    chainId: params.chainId,
    blockNumber: targetBlockNumber,
  })
  const token0 = pool.collateralTracker0.token
  const token1 = pool.collateralTracker1.token
  const normalizedShortfallToken = shortfallError.tokenAddress.toLowerCase()
  const isToken0Shortfall =
    normalizedShortfallToken === token0.toLowerCase() ||
    normalizedShortfallToken === pool.collateralTracker0.address.toLowerCase()
  const isToken1Shortfall =
    normalizedShortfallToken === token1.toLowerCase() ||
    normalizedShortfallToken === pool.collateralTracker1.address.toLowerCase()
  const tokenOutIndex = isToken0Shortfall ? 0n : isToken1Shortfall ? 1n : null
  if (tokenOutIndex === null) {
    return {
      available: false,
      reason: 'unsupported-token',
      detail: `${shortfallError.tokenAddress} is neither collateral token of ${params.poolAddress}`,
    }
  }

  const tokenInIndex = tokenOutIndex === 0n ? 1n : 0n
  const tokenOut = tokenOutIndex === 0n ? token0 : token1
  const tokenIn = tokenInIndex === 0n ? token0 : token1
  const collisionIds = Array.from(
    new Set([
      ...params.existingPositionIds,
      ...params.dispatch.positionIdList,
      ...params.dispatch.finalPositionIdList,
    ]),
  )
  for (let attempt = 0; attempt < MAX_RECOVERY_QUOTE_ATTEMPTS; attempt++) {
    // asset === tokenType === tokenOutIndex: the credit is denominated in the
    // token being sourced. Passing tokenInIndex as tokenType is the loan
    // convention and reverses the flow (pays the shortfall token instead of
    // receiving it).
    const credit = buildUniqueCredit(
      pool.poolId,
      tokenOutIndex,
      tokenOutIndex,
      pool.currentTick,
      pool.tickSpacing,
      collisionIds,
      amountOut,
    )
    const recoveredDispatch = buildTokenShortfallRecoveryDispatch({
      dispatch: params.dispatch,
      creditTokenId: credit.tokenId,
      creditPositionSize: credit.adjustedSize,
      tickLimitLow,
      tickLimitHigh,
    })
    const swapDispatch = buildTokenShortfallRecoveryDispatch({
      dispatch: {
        positionIdList: [],
        finalPositionIdList: [...params.existingPositionIds],
        positionSizes: [],
        tickAndSpreadLimits: [],
        usePremiaAsCollateral: false,
        builderCode: 0n,
      },
      creditTokenId: credit.tokenId,
      creditPositionSize: credit.adjustedSize,
      tickLimitLow,
      tickLimitHigh,
    })

    const swapSimulation = await simulateDispatch({
      client: params.client,
      poolAddress: params.poolAddress,
      account: params.account,
      existingPositionIdList: params.existingPositionIds,
      ...swapDispatch,
      blockNumber: targetBlockNumber,
    })
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
    const estimatedAmountIn = getInputAmount(swapSimulation.tokenFlow, tokenInIndex)
    const maxAmountIn = maximumAmountIn(estimatedAmountIn, params.slippageBps)
    const swapOutput = getOutputAmount(swapSimulation.tokenFlow, tokenOutIndex)
    const sourceBalance = getBalanceBefore(swapSimulation.tokenFlow, tokenInIndex)
    if (swapOutput < amountOut || sourceBalance < maxAmountIn) {
      return {
        available: false,
        reason: 'swap-unavailable',
        detail:
          swapOutput < amountOut
            ? `swap output ${swapOutput} < required ${amountOut}`
            : `source balance ${sourceBalance} < maximumAmountIn ${maxAmountIn} (estimated ${estimatedAmountIn}, slippageBps ${params.slippageBps})`,
        error: new PanopticError('Insufficient source collateral for the recovery swap'),
      }
    }

    const recoverySimulation = await simulateDispatch({
      client: params.client,
      poolAddress: params.poolAddress,
      account: params.account,
      existingPositionIdList: params.existingPositionIds,
      ...recoveredDispatch,
      blockNumber: targetBlockNumber,
    })
    if (recoverySimulation.success) {
      if (recoverySimulation.tokenFlow !== undefined) {
        return {
          available: true,
          quote: {
            tokenIn,
            tokenOut,
            amountOut,
            estimatedAmountIn,
            maximumAmountIn: maxAmountIn,
            slippageBps: params.slippageBps,
            netTokenInChange:
              tokenInIndex === 0n
                ? recoverySimulation.tokenFlow.delta0
                : recoverySimulation.tokenFlow.delta1,
            netTokenOutChange:
              tokenOutIndex === 0n
                ? recoverySimulation.tokenFlow.delta0
                : recoverySimulation.tokenFlow.delta1,
            creditTokenId: credit.tokenId,
            dispatch: recoveredDispatch,
            simulation: {
              ...recoverySimulation,
              tokenFlow: recoverySimulation.tokenFlow,
            },
            tokenFlow: recoverySimulation.tokenFlow,
            _meta: recoverySimulation._meta,
          },
        }
      }
      return {
        available: false,
        reason: 'recovery-unavailable',
        detail: 'wrapped dispatch simulation returned no token flow',
        error: new PanopticError('Recovery simulation did not return token flow'),
      }
    }

    const remainingShortfall = getNotEnoughTokensError(recoverySimulation.error)
    if (
      remainingShortfall === null ||
      remainingShortfall.tokenAddress.toLowerCase() !== normalizedShortfallToken
    ) {
      return {
        available: false,
        reason: 'recovery-unavailable',
        detail: `wrapped dispatch reverted with a non-shortfall error: ${recoverySimulation.error.message}`,
        error: recoverySimulation.error,
      }
    }
    // Grow by the residual the contract just reported. If that residual is
    // non-positive (assetsRequested <= assetBalance, e.g. the shortfall moved to
    // a rounding/fee boundary the revert no longer quantifies), fall back to
    // reusing amountOut — i.e. DOUBLE the target each retry. Bounded by
    // MAX_RECOVERY_QUOTE_ATTEMPTS and by the source-balance check above, so a
    // runaway size fails as swap-unavailable rather than looping.
    const decodedShortfall = remainingShortfall.assetsRequested - remainingShortfall.assetBalance
    const additionalAmountOut = decodedShortfall > 0n ? decodedShortfall : amountOut
    amountOut += additionalAmountOut
  }

  return {
    available: false,
    reason: 'recovery-unavailable',
    detail: `still short after ${MAX_RECOVERY_QUOTE_ATTEMPTS} sizing attempts (last target ${amountOut})`,
    error: new PanopticError('Could not cover recovery swap costs within the quote attempt limit'),
  }
}
