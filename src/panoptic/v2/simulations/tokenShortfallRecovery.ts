import type { Address, PublicClient } from 'viem'

import { NotEnoughTokensError, PanopticError, parsePanopticError } from '../errors'
import { tickLimits } from '../formatters/tick'
import { getPool } from '../reads/pool'
import type { BlockMeta, DispatchSimulation, SimulationResult, TokenFlow } from '../types'
import { convertToTokenIndex } from '../utils/priceConvert'
import { buildUniqueCredit } from '../writes/loanUtils'
import {
  type CreditWrapDirection,
  type DispatchIntent,
  buildCreditWrappedDispatch,
} from './creditWrap'
import { simulateDispatch } from './simulateDispatch'

const BPS_DENOMINATOR = 10_000n
const MAX_RECOVERY_QUOTE_ATTEMPTS = 8

export type { DispatchIntent }

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
   * Price bound for the temporary credit legs. Defaults to a slippage-bounded
   * range around the pool's current tick.
   */
  tickLimitLow?: bigint
  /** See {@link TokenShortfallRecoveryQuoteParams.tickLimitLow}. */
  tickLimitHigh?: bigint
  blockNumber?: bigint
}

export interface TokenShortfallRecoveryQuote {
  tokenIn: Address
  tokenOut: Address
  /** Swap construction used by the temporary credit wrapper. */
  direction: CreditWrapDirection
  /**
   * Exact amount of `tokenOut` the temporary credit sources. Covers the whole
   * dispatch, not just the first charge that reverted — a batch charges
   * commission/premia per operation, so the total needed is usually larger
   * than the `assetsRequested - assetBalance` of the first failure.
   */
  amountOut: bigint
  /** Output measured for the temporary swap alone. May exceed `amountOut` for exact-in. */
  estimatedAmountOut: bigint
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
  return buildCreditWrappedDispatch({ ...params, direction: 'exact-out', placement: 'straddle' })
}

function buildPrefixedExactInputRecoveryDispatch(
  params: BuildTokenShortfallRecoveryDispatchParams,
): DispatchIntent {
  return buildCreditWrappedDispatch({ ...params, direction: 'exact-in', placement: 'prepend' })
}

/**
 * Extract a fully-decoded `NotEnoughTokens` revert from an arbitrary error.
 *
 * Returns `null` when the error is something else, or when only the 4-byte
 * selector could be matched (the parser's fallback path constructs the error
 * with undefined args, which is not actionable).
 */
export function getNotEnoughTokensError(error: unknown): NotEnoughTokensError | null {
  const visited = new Set<unknown>()
  let current: unknown = error

  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current)
    const parsed =
      current instanceof NotEnoughTokensError ? current : parsePanopticError(current)?.error
    const candidate = parsed instanceof NotEnoughTokensError ? parsed : null
    if (candidate !== null) {
      // Selector-only decodes yield undefined args at runtime despite the types.
      const args: Partial<
        Pick<NotEnoughTokensError, 'tokenAddress' | 'assetsRequested' | 'assetBalance'>
      > = candidate
      if (
        args.tokenAddress !== undefined &&
        args.assetsRequested !== undefined &&
        args.assetBalance !== undefined
      ) {
        return candidate
      }
    }

    current = current instanceof Error && 'cause' in current ? current.cause : undefined
  }
  return null
}

function maximumAmountIn(estimatedAmountIn: bigint, slippageBps: bigint): bigint {
  if (slippageBps < 0n) {
    throw new PanopticError('slippageBps must be non-negative')
  }
  return (
    (estimatedAmountIn * (BPS_DENOMINATOR + slippageBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
  )
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
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
  const targetBlockNumber = params.blockNumber ?? (await params.client.getBlockNumber())
  const pool = await getPool({
    client: params.client,
    poolAddress: params.poolAddress,
    chainId: params.chainId,
    blockNumber: targetBlockNumber,
  })
  const defaultTickLimits = tickLimits(pool.currentTick, params.slippageBps)
  const tickLimitLow = params.tickLimitLow ?? defaultTickLimits.low
  const tickLimitHigh = params.tickLimitHigh ?? defaultTickLimits.high
  if (tickLimitLow >= tickLimitHigh) {
    return {
      available: false,
      reason: 'invalid-tick-limits',
      detail: `tickLimitLow=${tickLimitLow} >= tickLimitHigh=${tickLimitHigh}`,
    }
  }

  const token0 = pool.collateralTracker0.token
  const token1 = pool.collateralTracker1.token
  const shortfallTokenIndex = (error: NotEnoughTokensError): 0n | 1n | null => {
    const address = error.tokenAddress.toLowerCase()
    if (
      address === token0.toLowerCase() ||
      address === pool.collateralTracker0.address.toLowerCase()
    ) {
      return 0n
    }
    if (
      address === token1.toLowerCase() ||
      address === pool.collateralTracker1.address.toLowerCase()
    ) {
      return 1n
    }
    return null
  }
  const tokenOutIndex = shortfallTokenIndex(shortfallError)
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

  const quotePrefixedExactInput = async (
    initialRequiredOutput: bigint,
  ): Promise<TokenShortfallRecoveryResult> => {
    let requiredOutput = initialRequiredOutput
    const spotInput = convertToTokenIndex(
      requiredOutput,
      tokenOutIndex,
      tokenInIndex,
      pool.sqrtPriceX96,
    )
    let creditInput = maximumAmountIn(spotInput > 0n ? spotInput : 1n, params.slippageBps)

    for (let attempt = 0; attempt < MAX_RECOVERY_QUOTE_ATTEMPTS; attempt++) {
      const credit = buildUniqueCredit(
        pool.poolId,
        tokenInIndex,
        tokenInIndex,
        pool.currentTick,
        pool.tickSpacing,
        collisionIds,
        creditInput,
      )
      const wrapArgs = {
        creditTokenId: credit.tokenId,
        creditPositionSize: credit.adjustedSize,
        tickLimitLow,
        tickLimitHigh,
      }
      const swapDispatch = buildPrefixedExactInputRecoveryDispatch({
        ...wrapArgs,
        dispatch: {
          positionIdList: [],
          finalPositionIdList: [...params.existingPositionIds],
          positionSizes: [],
          tickAndSpreadLimits: [],
          usePremiaAsCollateral: false,
          builderCode: 0n,
        },
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
            ? 'prefixed swap simulation returned no token flow'
            : `prefixed swap simulation reverted: ${swapSimulation.error.message}`,
          error: swapSimulation.success ? undefined : swapSimulation.error,
        }
      }

      const estimatedAmountIn = getInputAmount(swapSimulation.tokenFlow, tokenInIndex)
      const estimatedAmountOut = getOutputAmount(swapSimulation.tokenFlow, tokenOutIndex)
      const sourceBalance = getBalanceBefore(swapSimulation.tokenFlow, tokenInIndex)
      if (sourceBalance < estimatedAmountIn) {
        return {
          available: false,
          reason: 'swap-unavailable',
          detail: `source balance ${sourceBalance} < exact input cost ${estimatedAmountIn}`,
          error: new PanopticError('Insufficient source collateral for the recovery swap'),
        }
      }
      if (estimatedAmountOut < requiredOutput) {
        creditInput =
          estimatedAmountOut > 0n
            ? ceilDiv(creditInput * requiredOutput, estimatedAmountOut) + 1n
            : creditInput * 2n
        continue
      }

      const recoveredDispatch = buildPrefixedExactInputRecoveryDispatch({
        ...wrapArgs,
        dispatch: params.dispatch,
      })
      const recoverySimulation = await simulateDispatch({
        client: params.client,
        poolAddress: params.poolAddress,
        account: params.account,
        existingPositionIdList: params.existingPositionIds,
        ...recoveredDispatch,
        blockNumber: targetBlockNumber,
      })
      if (recoverySimulation.success && recoverySimulation.tokenFlow !== undefined) {
        return {
          available: true,
          quote: {
            tokenIn,
            tokenOut,
            direction: 'exact-in',
            amountOut: requiredOutput,
            estimatedAmountOut,
            estimatedAmountIn,
            // The input credit has a fixed size. Its tick limit protects output;
            // unlike exact-out, execution cannot consume an unbounded input.
            maximumAmountIn: estimatedAmountIn,
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
      if (recoverySimulation.success) {
        return {
          available: false,
          reason: 'recovery-unavailable',
          detail: 'prefixed recovery simulation returned no token flow',
          error: new PanopticError('Recovery simulation did not return token flow'),
        }
      }

      const remainingShortfall = getNotEnoughTokensError(recoverySimulation.error)
      if (
        remainingShortfall === null ||
        shortfallTokenIndex(remainingShortfall) !== tokenOutIndex
      ) {
        return {
          available: false,
          reason: 'recovery-unavailable',
          detail: `prefixed recovery reverted with a non-output shortfall: ${recoverySimulation.error.message}`,
          error: recoverySimulation.error,
        }
      }
      const residual = remainingShortfall.assetsRequested - remainingShortfall.assetBalance
      requiredOutput += residual > 0n ? residual : requiredOutput
      creditInput = ceilDiv(creditInput * requiredOutput, estimatedAmountOut) + 1n
    }

    return {
      available: false,
      reason: 'recovery-unavailable',
      detail: `prefixed recovery remained short after ${MAX_RECOVERY_QUOTE_ATTEMPTS} attempts`,
      error: new PanopticError('Could not size the prefixed recovery swap'),
    }
  }

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
      const bootstrapShortfall = swapSimulation.success
        ? null
        : getNotEnoughTokensError(swapSimulation.error)
      if (
        bootstrapShortfall !== null &&
        shortfallTokenIndex(bootstrapShortfall) === tokenOutIndex
      ) {
        return quotePrefixedExactInput(amountOut)
      }
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
            direction: 'exact-out',
            amountOut,
            estimatedAmountOut: swapOutput,
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
    if (remainingShortfall === null || shortfallTokenIndex(remainingShortfall) !== tokenOutIndex) {
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
