import { type Address, type PublicClient, isAddress, isHex } from 'viem'

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
import {
  type RequiredWithdrawal,
  assertDispatchWithdrawal,
  WithdrawalShortfallError,
} from './dispatchWithdrawal'
import { getEarnMintCalls, getEarnRecoveryInputBudget } from './earnRecoveryBudget'
import { type SimulateDispatchParams, simulateDispatch } from './simulateDispatch'

const BPS_DENOMINATOR = 10_000n
const MAX_RECOVERY_QUOTE_ATTEMPTS = 8

export type { DispatchIntent }

export interface TokenShortfallRecoveryQuoteParams {
  requiredWithdrawal?: RequiredWithdrawal
  /** Buyer settlements included in the quoted transaction. */
  settleSequence?: SimulateDispatchParams['settleSequence']
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
  requiredWithdrawal?: RequiredWithdrawal
  tokenIn: Address
  tokenOut: Address
  /** Swap construction used by the temporary credit wrapper. */
  direction: CreditWrapDirection
  /**
   * Exact amount of `tokenOut` the temporary credit sources. Covers the whole
   * dispatch, not just the first charge that reverted — a batch charges
   * commission/streamia per operation, so the total needed is usually larger
   * than the `assetsRequested - assetBalance` of the first failure.
   */
  amountOut: bigint
  /** Output measured for the temporary swap alone. May exceed `amountOut` for exact-in. */
  estimatedAmountOut: bigint
  estimatedAmountIn: bigint
  /** Reviewed input budget; a fixed-input dispatch can spend less than this cap. */
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
    const decoded = parsePanopticError(current)
    // Public entry points can carry separate class identities after bundling.
    const candidate =
      current instanceof Error && current.name === 'NotEnoughTokensError' ? current : decoded?.error
    if (
      candidate?.name === 'NotEnoughTokensError' &&
      'tokenAddress' in candidate &&
      typeof candidate.tokenAddress === 'string' &&
      isAddress(candidate.tokenAddress) &&
      'assetsRequested' in candidate &&
      typeof candidate.assetsRequested === 'bigint' &&
      'assetBalance' in candidate &&
      typeof candidate.assetBalance === 'bigint'
    ) {
      if (candidate instanceof NotEnoughTokensError) return candidate
      const Constructor =
        'fundingStage' in candidate && candidate.fundingStage === 'withdrawal'
          ? WithdrawalShortfallError
          : NotEnoughTokensError
      return new Constructor(
        candidate.tokenAddress,
        candidate.assetsRequested,
        candidate.assetBalance,
        candidate,
      )
    }

    const innerData = decoded?.errorName === 'ExecuteError' ? decoded.args[1] : undefined
    current =
      typeof innerData === 'string' && isHex(innerData)
        ? { data: innerData }
        : current instanceof Error && 'cause' in current
          ? current.cause
          : undefined
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

function getOutputAmount(tokenFlow: TokenFlow, tokenOutIndex: 0n | 1n): bigint {
  const delta = tokenOutIndex === 0n ? tokenFlow.delta0 : tokenFlow.delta1
  return delta > 0n ? delta : 0n
}

export function getTokenShortfallAmount(error: unknown) {
  const shortfall = getNotEnoughTokensError(error)
  if (!shortfall || shortfall.assetsRequested <= shortfall.assetBalance) return undefined
  return {
    tokenAddress: shortfall.tokenAddress,
    amount: shortfall.assetsRequested - shortfall.assetBalance,
    ...(shortfall instanceof WithdrawalShortfallError
      ? { fundingStage: 'withdrawal' as const }
      : {}),
  }
}

export async function quoteTokenShortfallRecovery(
  params: TokenShortfallRecoveryQuoteParams,
): Promise<TokenShortfallRecoveryResult> {
  const initialShortfallError = getNotEnoughTokensError(params.error)
  if (initialShortfallError === null) {
    return { available: false, reason: 'not-token-shortfall' }
  }
  let shortfallError = initialShortfallError
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
  const withdrawal = params.requiredWithdrawal
  if (withdrawal && (withdrawal.assets < 0n || withdrawal.tokenIndex !== tokenOutIndex))
    return {
      available: false,
      reason: 'unsupported-token',
      detail: 'The funding token must match the requested withdrawal.',
    }
  const reserve =
    withdrawal && withdrawal.assets > 0n
      ? withdrawal.assets + (ceilDiv(withdrawal.assets * params.slippageBps, BPS_DENOMINATOR) || 1n)
      : 0n
  const reserveShortfall = (flow: TokenFlow) => {
    if (!withdrawal || withdrawal.assets === 0n) return 0n
    const balance = tokenOutIndex === 0n ? flow.balanceAfter0 : flow.balanceAfter1
    return reserve > balance ? reserve - balance : 0n
  }
  const refreshEarnFunding =
    withdrawal !== undefined &&
    withdrawal.assets > 0n &&
    getEarnMintCalls(params.dispatch, params.existingPositionIds, tokenOutIndex) !== undefined
  if (refreshEarnFunding) {
    const current = await simulateDispatch({
      client: params.client,
      poolAddress: params.poolAddress,
      account: params.account,
      existingPositionIdList: params.existingPositionIds,
      ...params.dispatch,
      settleSequence: params.settleSequence,
      measurePremia: true,
      blockNumber: targetBlockNumber,
    })
    if (current.success && current.tokenFlow) {
      amountOut = reserveShortfall(current.tokenFlow)
      if (amountOut === 0n)
        return {
          available: false,
          reason: 'not-token-shortfall',
          detail: 'A funding swap is no longer required. Refresh the opening quote.',
        }
      const balance =
        tokenOutIndex === 0n ? current.tokenFlow.balanceAfter0 : current.tokenFlow.balanceAfter1
      shortfallError = new WithdrawalShortfallError(shortfallError.tokenAddress, reserve, balance)
    } else {
      const currentError = current.success ? null : getNotEnoughTokensError(current.error)
      if (!currentError || shortfallTokenIndex(currentError) !== tokenOutIndex)
        return {
          available: false,
          reason: 'recovery-unavailable',
          detail: 'Could not refresh the covered call funding requirement.',
          error: current.success ? undefined : current.error,
        }
      shortfallError = currentError
      amountOut = currentError.assetsRequested - currentError.assetBalance
      if (amountOut <= 0n)
        return { available: false, reason: 'invalid-shortfall', error: currentError }
    }
  }
  const verifyWithdrawal = async (dispatch: DispatchIntent, tokenFlow: TokenFlow) => {
    if (!withdrawal) return undefined
    try {
      await assertDispatchWithdrawal({
        client: params.client,
        poolAddress: params.poolAddress,
        account: params.account,
        dispatch,
        requiredWithdrawal: withdrawal,
        tokenFlow,
        blockNumber: targetBlockNumber,
        settleSequence: params.settleSequence,
      })
      return undefined
    } catch (error) {
      return {
        available: false as const,
        reason: 'recovery-unavailable' as const,
        detail: 'The full upfront payment could not be verified.',
        error:
          error instanceof PanopticError
            ? error
            : new PanopticError(
                'Could not verify the full upfront payment.',
                error instanceof Error ? error : undefined,
              ),
      }
    }
  }
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
      // Affordability is deliberately NOT pre-checked here. `balanceBefore` is
      // sampled before the whole transaction, so it cannot see the settlement
      // proceeds that land ahead of this prefixed swap. The settlement-aware
      // recovery simulation below is the only honest test.
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
        settleSequence: params.settleSequence,
        measurePremia: true,
        blockNumber: targetBlockNumber,
      })
      if (recoverySimulation.success && recoverySimulation.tokenFlow !== undefined) {
        const missingReserve = reserveShortfall(recoverySimulation.tokenFlow)
        if (missingReserve > 0n) {
          requiredOutput += missingReserve
          creditInput = ceilDiv(creditInput * requiredOutput, estimatedAmountOut) + 1n
          continue
        }
        const unavailableWithdrawal = await verifyWithdrawal(
          recoveredDispatch,
          recoverySimulation.tokenFlow,
        )
        if (unavailableWithdrawal) return unavailableWithdrawal
        return {
          available: true,
          quote: {
            tokenIn,
            requiredWithdrawal: withdrawal,
            tokenOut,
            direction: 'exact-in',
            amountOut: requiredOutput,
            estimatedAmountOut,
            estimatedAmountIn,
            maximumAmountIn: getEarnRecoveryInputBudget({
              dispatch: params.dispatch,
              existingPositionIds: params.existingPositionIds,
              tokenOutIndex,
              currentTick: pool.currentTick,
              sqrtPriceX96: pool.sqrtPriceX96,
              tickSpacing: pool.tickSpacing,
              tickLimitLow,
              tickLimitHigh,
              estimatedAmountIn,
              estimatedAmountOut,
              slippageBps: params.slippageBps,
            }),
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

  // The credit is sized to notionally emit `amountOut`, but real Uniswap
  // execution costs fees + price impact so the actual `swapOutput` can fall a
  // few bps short of that notional. When it does, we grow the credit sizing
  // by the observed ratio and retry (mirrors `quotePrefixedExactInput`).
  let creditOutSize = amountOut
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
      creditOutSize,
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
    if (swapOutput < amountOut) {
      // Grow the credit's output sizing by the ratio needed vs got, plus a
      // 1-wei safety, and try again. Falls through to the exact-in path only
      // if we exhaust the attempts.
      creditOutSize =
        swapOutput > 0n ? ceilDiv(creditOutSize * amountOut, swapOutput) + 1n : creditOutSize * 2n
      continue
    }
    // Affordability is deliberately NOT pre-checked here: `balanceBefore` is
    // read before the whole transaction, so it excludes the settlement proceeds
    // that fund the swap. The settlement-aware recovery simulation below is the
    // only honest test.
    const recoverySimulation = await simulateDispatch({
      client: params.client,
      poolAddress: params.poolAddress,
      account: params.account,
      existingPositionIdList: params.existingPositionIds,
      ...recoveredDispatch,
      settleSequence: params.settleSequence,
      measurePremia: true,
      blockNumber: targetBlockNumber,
    })
    if (recoverySimulation.success) {
      if (recoverySimulation.tokenFlow !== undefined) {
        const missingReserve = reserveShortfall(recoverySimulation.tokenFlow)
        if (missingReserve > 0n) {
          amountOut += missingReserve
          creditOutSize = ceilDiv(creditOutSize * amountOut, swapOutput) + 1n
          continue
        }
        const unavailableWithdrawal = await verifyWithdrawal(
          recoveredDispatch,
          recoverySimulation.tokenFlow,
        )
        if (unavailableWithdrawal) return unavailableWithdrawal
        return {
          available: true,
          quote: {
            tokenIn,
            requiredWithdrawal: withdrawal,
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
    // reusing amountOut — i.e. DOUBLE the target each retry. Bounded strictly by
    // MAX_RECOVERY_QUOTE_ATTEMPTS: the loop exits after that many iterations and
    // returns `recovery-unavailable` rather than looping unboundedly.
    const decodedShortfall = remainingShortfall.assetsRequested - remainingShortfall.assetBalance
    // A straddled credit can produce the right final flow without making the
    // output spendable during the user's mint. Increasing it cannot repair
    // that ordering constraint: complete an exact-input swap first instead.
    if (decodedShortfall >= shortfallError.assetsRequested - shortfallError.assetBalance) {
      return quotePrefixedExactInput(amountOut)
    }
    const additionalAmountOut = decodedShortfall > 0n ? decodedShortfall : amountOut
    amountOut += additionalAmountOut
    // Immediately rescale the credit sizing to the new (larger) target so the
    // next iteration doesn't just re-observe the same shortfall (mirrors the
    // rescale in `quotePrefixedExactInput`).
    creditOutSize =
      swapOutput > 0n ? ceilDiv(creditOutSize * amountOut, swapOutput) + 1n : creditOutSize * 2n
  }

  return quotePrefixedExactInput(shortfallError.assetsRequested - shortfallError.assetBalance)
}
