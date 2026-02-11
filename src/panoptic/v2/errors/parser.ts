/**
 * Error parsing utilities for the Panoptic v2 SDK.
 *
 * Converts raw contract errors into typed SDK error classes.
 *
 * @module v2/errors/parser
 */

import { type Abi, decodeErrorResult } from 'viem'

import { collateralTrackerAbi, panopticPoolAbi, riskEngineAbi } from '../../../generated'
import { PanopticError } from './base'
import {
  // Solvency & Margin
  AccountInsolventError,
  AlreadyInitializedError,
  BelowMinimumRedemptionError,
  CastingError,
  // Liquidity
  ChunkHasZeroLiquidityError,
  DepositTooLargeError,
  DuplicateTokenIdError,
  EffectiveLiquidityAboveThresholdError,
  ExceedsMaximumRedemptionError,
  InputListFailError,
  InsufficientCreditLiquidityError,
  InvalidBuilderCodeError,
  InvalidTickBoundError,
  // Tick & Price
  InvalidTickError,
  // Position & TokenId
  InvalidTokenIdParameterError,
  InvalidUniswapCallbackError,
  LengthMismatchError,
  LiquidityTooHighError,
  NetLiquidityZeroError,
  // Exercise
  NoLegsExercisableError,
  NotALongLegError,
  NotBuilderError,
  NotEnoughLiquidityInChunkError,
  // Token & Collateral
  NotEnoughTokensError,
  NotGuardianError,
  NotMarginCalledError,
  // Authorization
  NotPanopticPoolError,
  // Pool & Initialization
  PoolNotInitializedError,
  PositionCountNotZeroError,
  PositionNotOwnedError,
  PositionTooLargeError,
  PriceBoundFailError,
  PriceImpactTooLargeError,
  // Reentrancy
  ReentrancyError,
  // Oracle & Safe Mode
  StaleOracleError,
  TokenIdHasZeroLegsError,
  TooManyLegsOpenError,
  // Transfer & Casting
  TransferFailedError,
  UnauthorizedUniswapCallbackError,
  UnderOverFlowError,
  WrongPoolIdError,
  WrongUniswapPoolError,
  // Other
  ZeroAddressError,
  ZeroCollateralRequirementError,
} from './contract'
import { panopticErrorsAbi } from './errorsAbi'

/**
 * Result of parsing a Panoptic error.
 */
export interface ParsedError {
  /** The parsed error instance */
  error: PanopticError
  /** The original error name from the contract */
  errorName: string
  /** The decoded error arguments */
  args: readonly unknown[]
}

/**
 * Combined ABI for error decoding.
 * Includes the dedicated errors ABI for complete coverage.
 */
const combinedAbi = [
  ...panopticPoolAbi,
  ...collateralTrackerAbi,
  ...riskEngineAbi,
  ...panopticErrorsAbi,
] as Abi

/**
 * Map of error names to error constructors.
 */
const errorConstructors: Record<
  string,
  (args: readonly unknown[], cause?: Error) => PanopticError
> = {
  // Solvency & Margin
  AccountInsolvent: (args, cause) =>
    new AccountInsolventError(args[0] as bigint, args[1] as bigint, cause),
  NotMarginCalled: (_args, cause) => new NotMarginCalledError(cause),

  // Token & Collateral
  NotEnoughTokens: (args, cause) =>
    new NotEnoughTokensError(args[0] as `0x${string}`, args[1] as bigint, args[2] as bigint, cause),
  NotEnoughLiquidityInChunk: (_args, cause) => new NotEnoughLiquidityInChunkError(cause),
  InsufficientCreditLiquidity: (_args, cause) => new InsufficientCreditLiquidityError(cause),
  DepositTooLarge: (_args, cause) => new DepositTooLargeError(cause),
  BelowMinimumRedemption: (_args, cause) => new BelowMinimumRedemptionError(cause),
  ExceedsMaximumRedemption: (_args, cause) => new ExceedsMaximumRedemptionError(cause),
  ZeroCollateralRequirement: (_args, cause) => new ZeroCollateralRequirementError(cause),

  // Position & TokenId
  InvalidTokenIdParameter: (args, cause) =>
    new InvalidTokenIdParameterError(args[0] as bigint, cause),
  PositionNotOwned: (_args, cause) => new PositionNotOwnedError(cause),
  PositionTooLarge: (_args, cause) => new PositionTooLargeError(cause),
  PositionCountNotZero: (_args, cause) => new PositionCountNotZeroError(cause),
  DuplicateTokenId: (_args, cause) => new DuplicateTokenIdError(cause),
  TokenIdHasZeroLegs: (_args, cause) => new TokenIdHasZeroLegsError(cause),
  TooManyLegsOpen: (_args, cause) => new TooManyLegsOpenError(cause),
  InputListFail: (_args, cause) => new InputListFailError(cause),

  // Tick & Price
  InvalidTick: (_args, cause) => new InvalidTickError(cause),
  InvalidTickBound: (_args, cause) => new InvalidTickBoundError(cause),
  PriceBoundFail: (args, cause) => new PriceBoundFailError(args[0] as bigint, cause),
  PriceImpactTooLarge: (_args, cause) => new PriceImpactTooLargeError(cause),

  // Liquidity
  ChunkHasZeroLiquidity: (_args, cause) => new ChunkHasZeroLiquidityError(cause),
  LiquidityTooHigh: (_args, cause) => new LiquidityTooHighError(cause),
  NetLiquidityZero: (_args, cause) => new NetLiquidityZeroError(cause),
  EffectiveLiquidityAboveThreshold: (_args, cause) =>
    new EffectiveLiquidityAboveThresholdError(cause),

  // Oracle & Safe Mode
  StaleOracle: (_args, cause) => new StaleOracleError(cause),

  // Exercise
  NoLegsExercisable: (_args, cause) => new NoLegsExercisableError(cause),
  NotALongLeg: (_args, cause) => new NotALongLegError(cause),

  // Pool & Initialization
  PoolNotInitialized: (_args, cause) => new PoolNotInitializedError(cause),
  AlreadyInitialized: (_args, cause) => new AlreadyInitializedError(cause),
  WrongPoolId: (_args, cause) => new WrongPoolIdError(cause),
  WrongUniswapPool: (_args, cause) => new WrongUniswapPoolError(cause),

  // Authorization
  NotPanopticPool: (_args, cause) => new NotPanopticPoolError(cause),
  NotGuardian: (_args, cause) => new NotGuardianError(cause),
  NotBuilder: (_args, cause) => new NotBuilderError(cause),
  InvalidBuilderCode: (_args, cause) => new InvalidBuilderCodeError(cause),
  InvalidUniswapCallback: (_args, cause) => new InvalidUniswapCallbackError(cause),
  UnauthorizedUniswapCallback: (_args, cause) => new UnauthorizedUniswapCallbackError(cause),

  // Transfer & Casting
  TransferFailed: (args, cause) =>
    new TransferFailedError(
      args[0] as `0x${string}`,
      args[1] as `0x${string}`,
      args[2] as bigint,
      args[3] as bigint,
      cause,
    ),
  CastingError: (_args, cause) => new CastingError(cause),
  UnderOverFlow: (_args, cause) => new UnderOverFlowError(cause),

  // Reentrancy
  Reentrancy: (_args, cause) => new ReentrancyError(cause),

  // Other
  ZeroAddress: (_args, cause) => new ZeroAddressError(cause),
  LengthMismatch: (_args, cause) => new LengthMismatchError(cause),
}

/**
 * Parse a raw contract error into a typed SDK error.
 *
 * This function attempts to decode the error data from a failed contract call
 * and return a typed error instance with extracted parameters.
 *
 * @param error - The raw error from a failed contract call
 * @returns Parsed error with typed error instance, or null if parsing fails
 *
 * @example
 * ```typescript
 * try {
 *   await contract.openPosition(...)
 * } catch (rawError) {
 *   const parsed = parsePanopticError(rawError)
 *   if (parsed) {
 *     console.log('Error:', parsed.errorName)
 *     if (parsed.error instanceof AccountInsolventError) {
 *       console.log('Solvent value:', parsed.error.solvent)
 *     }
 *   }
 * }
 * ```
 */
export function parsePanopticError(error: unknown): ParsedError | null {
  // Extract error data from various error formats
  const errorData = extractErrorData(error)
  if (!errorData) return null

  try {
    // Decode the error using combined ABIs
    const decoded = decodeErrorResult({
      abi: combinedAbi,
      data: errorData,
    })

    const constructor = errorConstructors[decoded.errorName]
    if (!constructor) {
      // Unknown error - return generic PanopticError
      return {
        error: new PanopticError(`Unknown contract error: ${decoded.errorName}`),
        errorName: decoded.errorName,
        args: decoded.args ?? [],
      }
    }

    // Create typed error instance
    const cause = error instanceof Error ? error : undefined
    const typedError = constructor(decoded.args ?? [], cause)

    return {
      error: typedError,
      errorName: decoded.errorName,
      args: decoded.args ?? [],
    }
  } catch {
    // Failed to decode - return null
    return null
  }
}

/**
 * Extract error data from various error formats.
 */
function extractErrorData(error: unknown): `0x${string}` | null {
  if (!error) return null

  // Direct hex data
  if (typeof error === 'string' && error.startsWith('0x')) {
    return error as `0x${string}`
  }

  // Error object with data property
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>

    // viem ContractFunctionExecutionError - check cause chain
    if (obj.cause && typeof obj.cause === 'object') {
      const cause = obj.cause as Record<string, unknown>
      if (cause.data && typeof cause.data === 'string' && cause.data.startsWith('0x')) {
        return cause.data as `0x${string}`
      }
      // Check cause.cause (nested causes)
      if (cause.cause && typeof cause.cause === 'object') {
        const nestedCause = cause.cause as Record<string, unknown>
        if (
          nestedCause.data &&
          typeof nestedCause.data === 'string' &&
          nestedCause.data.startsWith('0x')
        ) {
          return nestedCause.data as `0x${string}`
        }
      }
    }

    // Direct data property
    if (obj.data && typeof obj.data === 'string' && obj.data.startsWith('0x')) {
      return obj.data as `0x${string}`
    }

    // Nested error property
    if (obj.error && typeof obj.error === 'object') {
      const nestedError = obj.error as Record<string, unknown>
      if (
        nestedError.data &&
        typeof nestedError.data === 'string' &&
        nestedError.data.startsWith('0x')
      ) {
        return nestedError.data as `0x${string}`
      }
    }

    // Extract from error message - look for signature pattern "0x" followed by 8 hex chars
    if (obj.message && typeof obj.message === 'string') {
      const signatureMatch = obj.message.match(/signature:\s*(0x[a-fA-F0-9]{8})/i)
      if (signatureMatch) {
        return signatureMatch[1] as `0x${string}`
      }
    }
  }

  return null
}

/**
 * Check if an error is a specific Panoptic error type.
 *
 * @param error - The error to check
 * @param errorClass - The error class to check against
 * @returns True if the error is an instance of the specified class
 *
 * @example
 * ```typescript
 * const parsed = parsePanopticError(error)
 * if (parsed && isPanopticErrorType(parsed.error, AccountInsolventError)) {
 *   console.log('Account is insolvent!')
 * }
 * ```
 */
export function isPanopticErrorType<T extends PanopticError>(
  error: PanopticError,
  errorClass: new (...args: unknown[]) => T,
): error is T {
  return error instanceof errorClass
}
