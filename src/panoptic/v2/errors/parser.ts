/**
 * Error parsing utilities for the Panoptic v2 SDK.
 *
 * Converts raw contract errors into typed SDK error classes.
 *
 * @module v2/errors/parser
 */

import { type Abi, BaseError, decodeErrorResult, toFunctionSelector } from 'viem'

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
  CreateFailError,
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

  // Factory
  CreateFail: (_args, cause) => new CreateFailError(cause),

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
  // Strategy 1: Check if viem already decoded the error (ContractFunctionRevertedError.data)
  const viemDecoded = extractViemDecodedError(error)
  if (viemDecoded) {
    return buildParsedError(viemDecoded.errorName, viemDecoded.args, error)
  }

  // Strategy 2: Extract raw hex data and decode ourselves
  const errorData = extractErrorData(error)
  if (!errorData) return null

  try {
    const decoded = decodeErrorResult({
      abi: combinedAbi,
      data: errorData,
    })

    return buildParsedError(decoded.errorName, decoded.args ?? [], error)
  } catch {
    // decodeErrorResult failed — possibly we only have the 4-byte selector
    // (e.g. from a multicall error message). Try matching the selector manually.
    if (errorData.length >= 10) {
      const selector = errorData.slice(0, 10) as `0x${string}`
      const match = matchSelectorToErrorName(selector)
      if (match) {
        return buildParsedError(match, [], error)
      }
    }
    return null
  }
}

/**
 * Walk the cause chain looking for a viem ContractFunctionRevertedError
 * that already has decoded `.data` (an object with `errorName` and `args`).
 * This happens when the ABI passed to simulateContract includes the error definitions.
 */
function extractViemDecodedError(
  error: unknown,
): { errorName: string; args: readonly unknown[] } | null {
  if (!error || typeof error !== 'object') return null

  // Use BaseError.walk if available
  if (error instanceof BaseError) {
    let found: { errorName: string; args: readonly unknown[] } | null = null
    error.walk((e) => {
      if (found) return false
      const node = e as Record<string, unknown>
      if (
        node.data &&
        typeof node.data === 'object' &&
        'errorName' in (node.data as object) &&
        typeof (node.data as Record<string, unknown>).errorName === 'string'
      ) {
        const data = node.data as { errorName: string; args?: readonly unknown[] }
        found = { errorName: data.errorName, args: data.args ?? [] }
        return true
      }
      return false
    })
    return found
  }

  // Manual walk for non-viem errors
  let current: Record<string, unknown> | null = error as Record<string, unknown>
  for (let i = 0; i < 10 && current; i++) {
    if (
      current.data &&
      typeof current.data === 'object' &&
      'errorName' in (current.data as object) &&
      typeof (current.data as Record<string, unknown>).errorName === 'string'
    ) {
      const data = current.data as { errorName: string; args?: readonly unknown[] }
      return { errorName: data.errorName, args: data.args ?? [] }
    }
    current =
      current.cause && typeof current.cause === 'object'
        ? (current.cause as Record<string, unknown>)
        : null
  }

  return null
}

/**
 * Build a ParsedError from a decoded error name and args.
 */
function buildParsedError(
  errorName: string,
  args: readonly unknown[],
  originalError: unknown,
): ParsedError {
  const constructor = errorConstructors[errorName]
  const cause = originalError instanceof Error ? originalError : undefined

  if (!constructor) {
    const unknownError = new PanopticError(`Unknown contract error: ${errorName}`)
    unknownError.errorName = errorName
    return { error: unknownError, errorName, args }
  }

  const typedError = constructor(args, cause)
  typedError.errorName = errorName
  return { error: typedError, errorName, args }
}

/**
 * Match a 4-byte selector against the panoptic errors ABI.
 * Used as fallback when we only have the selector (no encoded args).
 */
function matchSelectorToErrorName(selector: `0x${string}`): string | null {
  for (const item of panopticErrorsAbi) {
    if (item.type !== 'error') continue
    const computed = toFunctionSelector(
      `${item.name}(${item.inputs.map((i: { type: string }) => i.type).join(',')})`,
    )
    if (computed === selector) {
      return item.name
    }
  }
  return null
}

/**
 * Extract error data from various error formats.
 *
 * Strategy:
 * 1. Use viem's BaseError.walk() to traverse the full cause chain and find
 *    hex data on any node (handles arbitrary nesting depth for multicall etc.)
 * 2. Fall back to manual cause-chain walk for non-viem errors
 * 3. Last resort: extract selector from error message (loses args)
 */
function extractErrorData(error: unknown): `0x${string}` | null {
  if (!error) return null

  // Direct hex data
  if (typeof error === 'string' && error.startsWith('0x')) {
    return error as `0x${string}`
  }

  if (typeof error !== 'object') return null

  // Strategy 1: Use viem's BaseError.walk() — traverses the full cause chain
  if (error instanceof BaseError) {
    let foundData: `0x${string}` | null = null

    error.walk((e) => {
      if (foundData) return false
      const node = e as Record<string, unknown>

      // Check .data as hex string (full revert bytes on RPC errors)
      if (node.data && typeof node.data === 'string' && node.data.startsWith('0x')) {
        foundData = node.data as `0x${string}`
        return true
      }

      // Check .data.data (some RPC providers nest: { data: { data: '0x...' } })
      if (node.data && typeof node.data === 'object') {
        const nested = node.data as Record<string, unknown>
        if (nested.data && typeof nested.data === 'string' && nested.data.startsWith('0x')) {
          foundData = nested.data as `0x${string}`
          return true
        }
      }

      return false
    })

    if (foundData) return foundData

    // Also check .signature on walked nodes (viem stores raw selector here
    // when it can't decode against the provided ABI)
    error.walk((e) => {
      if (foundData) return false
      const node = e as Record<string, unknown>
      if (node.signature && typeof node.signature === 'string' && node.signature.startsWith('0x')) {
        foundData = node.signature as `0x${string}`
        return true
      }
      return false
    })

    if (foundData) return foundData
  }

  // Strategy 2: Manual cause-chain walk for non-viem errors
  let current: Record<string, unknown> | null = error as Record<string, unknown>
  const maxDepth = 10
  for (let i = 0; i < maxDepth && current; i++) {
    if (current.data && typeof current.data === 'string' && current.data.startsWith('0x')) {
      return current.data as `0x${string}`
    }

    if (current.data && typeof current.data === 'object') {
      const nested = current.data as Record<string, unknown>
      if (nested.data && typeof nested.data === 'string' && nested.data.startsWith('0x')) {
        return nested.data as `0x${string}`
      }
    }

    if (current.error && typeof current.error === 'object') {
      const rpcError = current.error as Record<string, unknown>
      if (rpcError.data && typeof rpcError.data === 'string' && rpcError.data.startsWith('0x')) {
        return rpcError.data as `0x${string}`
      }
    }

    current =
      current.cause && typeof current.cause === 'object'
        ? (current.cause as Record<string, unknown>)
        : null
  }

  // Strategy 3: Extract from error message (last resort — may only have 4-byte selector)
  const obj = error as Record<string, unknown>
  if (obj.message && typeof obj.message === 'string') {
    const signatureMatch = obj.message.match(/signature:\s*(0x[a-fA-F0-9]{8,})/i)
    if (signatureMatch) {
      return signatureMatch[1] as `0x${string}`
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
