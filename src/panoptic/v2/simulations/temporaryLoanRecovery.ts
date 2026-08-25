/**
 * Atomic temporary-loan recovery for otherwise uncloseable dispatches.
 *
 * The wrapper borrows the token reported by `NotEnoughTokens`, runs the user's
 * dispatch, then burns the loan with an exact-output swap. The loan is absent
 * from `finalPositionIdList`, so a successful call never leaves debt behind.
 *
 * @module v2/simulations/temporaryLoanRecovery
 */

import type { Address, PublicClient } from 'viem'

import { PanopticError } from '../errors'
import { tickLimits } from '../formatters/tick'
import { getPool } from '../reads/pool'
import type { BlockMeta, DispatchSimulation, SimulationResult, TokenFlow } from '../types'
import { buildUniqueLoan } from '../writes/loanUtils'
import type { DispatchIntent } from './creditWrap'
import { simulateDispatch } from './simulateDispatch'
import { getNotEnoughTokensError } from './tokenShortfallRecovery'

const BPS_DENOMINATOR = 10_000n
const MAX_RECOVERY_ATTEMPTS = 8n
const MAX_UINT128 = (1n << 128n) - 1n
const LOAN_GROWTH_DENOMINATOR = 20n

/** Parameters for inserting a temporary loan around a close dispatch. */
export interface BuildTemporaryLoanRecoveryDispatchParams {
  /** Full-close dispatch to wrap with the temporary loan mint and burn. */
  dispatch: DispatchIntent
  /** Unique position ID used exclusively for the temporary loan. */
  loanTokenId: bigint
  /** Position size that encodes the amount borrowed by the temporary loan. */
  loanPositionSize: bigint
  /** Lower tick bound for minting the temporary loan. */
  tickLimitLow: bigint
  /** Upper tick bound for minting the temporary loan. */
  tickLimitHigh: bigint
}

/**
 * Wrap a dispatch with `loan mint -> user operations -> swapped loan burn`.
 * The repeated tokenId is intentional: the first occurrence mints it and the
 * last occurrence burns it after the user's operations have settled.
 */
export function buildTemporaryLoanRecoveryDispatch(
  params: BuildTemporaryLoanRecoveryDispatchParams,
): DispatchIntent {
  const low =
    params.tickLimitLow <= params.tickLimitHigh ? params.tickLimitLow : params.tickLimitHigh
  const high =
    params.tickLimitLow <= params.tickLimitHigh ? params.tickLimitHigh : params.tickLimitLow

  return {
    positionIdList: [params.loanTokenId, ...params.dispatch.positionIdList, params.loanTokenId],
    finalPositionIdList: [...params.dispatch.finalPositionIdList],
    positionSizes: [params.loanPositionSize, ...params.dispatch.positionSizes, 0n],
    tickAndSpreadLimits: [[low, high, 0n], ...params.dispatch.tickAndSpreadLimits, [high, low, 0n]],
    usePremiaAsCollateral: params.dispatch.usePremiaAsCollateral,
    builderCode: params.dispatch.builderCode,
  }
}

/** Parameters for quoting an atomic temporary-loan-assisted full close. */
export interface TemporaryLoanRecoveryQuoteParams {
  /** Public client used to pin and simulate the quote against chain state. */
  client: PublicClient
  /** Panoptic pool containing the positions to close. */
  poolAddress: Address
  /** Account that owns the positions and will submit the dispatch. */
  account: Address
  /** Chain identifier used to resolve pool metadata. */
  chainId: bigint
  /** Position IDs currently held by the account. */
  existingPositionIds: bigint[]
  /** Full-close dispatch that failed with a token shortfall. */
  dispatch: DispatchIntent
  /** Original simulation error used to identify the token shortfall. */
  error: unknown
  /** Slippage tolerance for the exact-output repayment swap, in basis points. */
  slippageBps: bigint
  /** Optional lower tick bound; defaults to a slippage-derived bound. */
  tickLimitLow?: bigint
  /** Optional upper tick bound; defaults to a slippage-derived bound. */
  tickLimitHigh?: bigint
  /** Optional pinned block; when omitted, the current block is fetched once. */
  blockNumber?: bigint
}

/** A successfully simulated temporary-loan-assisted full-close quote. */
export interface TemporaryLoanRecoveryQuote {
  /** Underlying token borrowed to cover the close shortfall. */
  loanToken: Address
  /** Counter-token used by the exact-output swap that repays the loan. */
  repaymentToken: Address
  /** Pool token index corresponding to {@link loanToken}. */
  loanTokenIndex: 0n | 1n
  /** Effective amount borrowed, including optionRatio when the unique ID uses one. */
  loanAmount: bigint
  /** Encoded dispatch position size for the temporary loan. */
  loanPositionSize: bigint
  /** Unique position ID created and burned within the wrapped dispatch. */
  loanTokenId: bigint
  /** Slippage tolerance applied to repayment, in basis points. */
  slippageBps: bigint
  /** Simulated net account balance change in the borrowed token. */
  netLoanTokenChange: bigint
  /** Simulated net account balance change in the repayment token. */
  netRepaymentTokenChange: bigint
  /** Atomic dispatch containing the loan mint, close, and loan burn. */
  dispatch: DispatchIntent
  /** Successful dispatch simulation at the quote's pinned block. */
  simulation: SimulationResult<DispatchSimulation> & { success: true }
  /** Token balance changes produced by the successful simulation. */
  tokenFlow: TokenFlow
  /** Block metadata identifying the state used for the simulation. */
  _meta: BlockMeta
}

/**
 * Why a temporary-loan recovery quote is unavailable.
 *
 * - `not-token-shortfall`: the supplied error is not a decoded token shortfall.
 * - `invalid-shortfall`: the decoded shortfall does not require a positive loan.
 * - `invalid-slippage`: slippage is outside the supported basis-point range.
 * - `unsupported-token`: the shortfall token is not a pool collateral token.
 * - `invalid-tick-limits`: the repayment swap limits are empty or inverted.
 * - `repayment-token-shortfall`: repayment shifted the deficit to the counter-token.
 * - `recovery-unavailable`: bounded simulation could not produce a recoverable dispatch.
 */
export type TemporaryLoanRecoveryUnavailableReason =
  | 'not-token-shortfall'
  | 'invalid-shortfall'
  | 'invalid-slippage'
  | 'unsupported-token'
  | 'invalid-tick-limits'
  | 'repayment-token-shortfall'
  | 'recovery-unavailable'

/**
 * Result of quoting temporary-loan recovery: either an executable quote or an
 * unavailable reason with optional diagnostic detail and SDK error.
 */
export type TemporaryLoanRecoveryResult =
  | {
      /** Indicates that an executable quote was produced. */
      available: true
      /** Fully simulated dispatch and loan details. */
      quote: TemporaryLoanRecoveryQuote
    }
  | {
      /** Indicates that recovery could not be quoted. */
      available: false
      /** Stable category describing why recovery is unavailable. */
      reason: TemporaryLoanRecoveryUnavailableReason
      /** Optional human-readable diagnostic context. */
      detail?: string
      /** Optional SDK error that caused the unavailable result. */
      error?: PanopticError
    }

/**
 * Quotes and simulates an atomic temporary loan around a full-close dispatch.
 *
 * @param params - Chain client, account, failed dispatch, shortfall error, and quote limits.
 * @returns An executable quote when recovery succeeds, otherwise a categorized unavailable result.
 * @throws {PanopticError} When the dispatch is not a full close or required RPC reads fail.
 */
export async function quoteTemporaryLoanRecovery(
  params: TemporaryLoanRecoveryQuoteParams,
): Promise<TemporaryLoanRecoveryResult> {
  const initialShortfall = getNotEnoughTokensError(params.error)
  if (initialShortfall === null) return { available: false, reason: 'not-token-shortfall' }

  let loanAmount = initialShortfall.assetsRequested - initialShortfall.assetBalance
  if (loanAmount <= 0n) {
    return {
      available: false,
      reason: 'invalid-shortfall',
      detail: `requested=${initialShortfall.assetsRequested} <= balance=${initialShortfall.assetBalance}`,
    }
  }
  if (params.slippageBps <= 0n || params.slippageBps > BPS_DENOMINATOR) {
    return {
      available: false,
      reason: 'invalid-slippage',
      detail: `slippageBps=${params.slippageBps} is outside (0, ${BPS_DENOMINATOR}]`,
    }
  }
  if (params.dispatch.finalPositionIdList.length !== 0) {
    throw new PanopticError(
      'Temporary-loan recovery requires a full-close dispatch with an empty finalPositionIdList',
    )
  }

  let targetBlockNumber: bigint
  try {
    targetBlockNumber = params.blockNumber ?? (await params.client.getBlockNumber())
  } catch (error) {
    if (error instanceof PanopticError) throw error
    throw new PanopticError(
      'Failed to resolve the block for temporary-loan recovery',
      error instanceof Error ? error : new Error(String(error)),
    )
  }

  let pool: Awaited<ReturnType<typeof getPool>>
  try {
    pool = await getPool({
      client: params.client,
      poolAddress: params.poolAddress,
      chainId: params.chainId,
      blockNumber: targetBlockNumber,
    })
  } catch (error) {
    if (error instanceof PanopticError) throw error
    throw new PanopticError(
      'Failed to load the pool for temporary-loan recovery',
      error instanceof Error ? error : new Error(String(error)),
    )
  }
  const defaultLimits = tickLimits(pool.currentTick, params.slippageBps)
  const tickLimitLow = params.tickLimitLow ?? defaultLimits.low
  const tickLimitHigh = params.tickLimitHigh ?? defaultLimits.high
  if (tickLimitLow >= tickLimitHigh) {
    return {
      available: false,
      reason: 'invalid-tick-limits',
      detail: `tickLimitLow=${tickLimitLow} >= tickLimitHigh=${tickLimitHigh}`,
    }
  }

  const token0 = pool.collateralTracker0.token
  const token1 = pool.collateralTracker1.token
  const tokenIndexFor = (address: Address): 0n | 1n | null => {
    const normalized = address.toLowerCase()
    if (
      normalized === token0.toLowerCase() ||
      normalized === pool.collateralTracker0.address.toLowerCase()
    ) {
      return 0n
    }
    if (
      normalized === token1.toLowerCase() ||
      normalized === pool.collateralTracker1.address.toLowerCase()
    ) {
      return 1n
    }
    return null
  }

  const loanTokenIndex = tokenIndexFor(initialShortfall.tokenAddress)
  if (loanTokenIndex === null) {
    return {
      available: false,
      reason: 'unsupported-token',
      detail: `${initialShortfall.tokenAddress} is neither collateral token of ${params.poolAddress}`,
    }
  }
  const repaymentTokenIndex = loanTokenIndex === 0n ? 1n : 0n
  const loanToken = loanTokenIndex === 0n ? token0 : token1
  const repaymentToken = repaymentTokenIndex === 0n ? token0 : token1
  const collisionIds = Array.from(
    new Set([
      ...params.existingPositionIds,
      ...params.dispatch.positionIdList,
      ...params.dispatch.finalPositionIdList,
    ]),
  )

  for (let attempt = 0n; attempt < MAX_RECOVERY_ATTEMPTS; attempt += 1n) {
    if (loanAmount > MAX_UINT128) {
      return {
        available: false,
        reason: 'recovery-unavailable',
        detail: `required loan amount ${loanAmount} exceeds uint128`,
      }
    }
    const loan = buildUniqueLoan(
      pool.poolId,
      loanTokenIndex,
      loanTokenIndex,
      pool.currentTick,
      pool.tickSpacing,
      collisionIds,
      loanAmount,
    )
    const recoveredDispatch = buildTemporaryLoanRecoveryDispatch({
      dispatch: params.dispatch,
      loanTokenId: loan.tokenId,
      loanPositionSize: loan.adjustedSize,
      tickLimitLow,
      tickLimitHigh,
    })
    const simulation = await simulateDispatch({
      client: params.client,
      poolAddress: params.poolAddress,
      account: params.account,
      existingPositionIdList: params.existingPositionIds,
      ...recoveredDispatch,
      blockNumber: targetBlockNumber,
    })

    if (simulation.success && simulation.tokenFlow !== undefined) {
      const tokenFlow = simulation.tokenFlow
      return {
        available: true,
        quote: {
          loanToken,
          repaymentToken,
          loanTokenIndex,
          loanAmount,
          loanPositionSize: loan.adjustedSize,
          loanTokenId: loan.tokenId,
          slippageBps: params.slippageBps,
          netLoanTokenChange: loanTokenIndex === 0n ? tokenFlow.delta0 : tokenFlow.delta1,
          netRepaymentTokenChange: repaymentTokenIndex === 0n ? tokenFlow.delta0 : tokenFlow.delta1,
          dispatch: recoveredDispatch,
          simulation: { ...simulation, tokenFlow },
          tokenFlow,
          _meta: simulation._meta,
        },
      }
    }
    if (simulation.success) {
      return {
        available: false,
        reason: 'recovery-unavailable',
        detail: 'temporary-loan simulation returned no token flow',
      }
    }

    const shortfall = getNotEnoughTokensError(simulation.error)
    if (shortfall === null) {
      return {
        available: false,
        reason: 'recovery-unavailable',
        detail: `temporary-loan dispatch reverted: ${simulation.error.message}`,
        error: simulation.error,
      }
    }
    const shortfallIndex = tokenIndexFor(shortfall.tokenAddress)
    if (shortfallIndex !== loanTokenIndex) {
      return {
        available: false,
        reason: 'repayment-token-shortfall',
        detail: `repayment token ${shortfall.tokenAddress} requested ${shortfall.assetsRequested}, balance ${shortfall.assetBalance}`,
        error: simulation.error,
      }
    }

    const residual = shortfall.assetsRequested - shortfall.assetBalance
    // Collateral trackers compare shares internally, while NotEnoughTokens
    // reports asset amounts. Near a conversion boundary the revert can therefore
    // report assetBalance >= assetsRequested even though another share is needed.
    // Always make bounded forward progress; 5% avoids grossly over-borrowing
    // while converging quickly enough for an interactive quote.
    const geometricGrowth = (loanAmount + LOAN_GROWTH_DENOMINATOR - 1n) / LOAN_GROWTH_DENOMINATOR
    loanAmount += residual > geometricGrowth ? residual : geometricGrowth
  }

  return {
    available: false,
    reason: 'recovery-unavailable',
    detail: `temporary-loan recovery remained short after ${MAX_RECOVERY_ATTEMPTS} attempts`,
    error: new PanopticError('Could not size the temporary loan within the quote attempt limit'),
  }
}
