/**
 * Bot utilities for the Panoptic v2 SDK.
 *
 * Assertion functions for validating preconditions before executing operations.
 * These throw typed errors on failure, making bot code cleaner and failures explicit.
 *
 * @module v2/bot
 */

import { SafeModeError, StaleDataError, UnhealthyPoolError } from '../errors'
import type { BlockMeta, Pool, SafeModeState } from '../types'

/**
 * Data with block metadata (anything returned by SDK read functions).
 */
export interface DataWithMeta {
  _meta: BlockMeta
}

/**
 * Assert that data is fresh (not stale).
 *
 * Throws StaleDataError if the data's block timestamp is older than maxAgeSeconds.
 *
 * @param data - Any SDK data with _meta field
 * @param maxAgeSeconds - Maximum allowed age in seconds
 * @param currentTimestamp - Current timestamp (defaults to Date.now() / 1000)
 * @throws StaleDataError if data is stale
 *
 * @example
 * ```typescript
 * const pool = await getPool({ client, poolAddress })
 * assertFresh(pool, 60) // Must be < 60 seconds old
 * ```
 */
export function assertFresh(
  data: DataWithMeta,
  maxAgeSeconds: bigint | number,
  currentTimestamp?: bigint | number,
): void {
  const maxAge = BigInt(maxAgeSeconds)
  const now =
    currentTimestamp !== undefined
      ? BigInt(currentTimestamp)
      : BigInt(Math.floor(Date.now() / 1000))
  const blockTimestamp = data._meta.blockTimestamp
  const age = now - blockTimestamp

  if (age > maxAge) {
    throw new StaleDataError(blockTimestamp, now, age)
  }
}

/**
 * Assert that a pool is healthy.
 *
 * Throws UnhealthyPoolError if the pool health status is not 'active'.
 *
 * @param pool - Pool data from getPool()
 * @throws UnhealthyPoolError if pool is unhealthy (low_liquidity or paused)
 *
 * @example
 * ```typescript
 * const pool = await getPool({ client, poolAddress })
 * assertHealthy(pool) // Throws if pool is paused or has low liquidity
 * ```
 */
export function assertHealthy(pool: Pool): void {
  if (pool.healthStatus !== 'active') {
    throw new UnhealthyPoolError(pool.healthStatus)
  }
}

/**
 * Assert that trading is allowed on a pool.
 *
 * Checks both pool health and safe mode status. Throws appropriate errors
 * if trading is restricted.
 *
 * @param pool - Pool data from getPool()
 * @param safeMode - Optional SafeModeState from getSafeMode()
 * @throws UnhealthyPoolError if pool is unhealthy
 * @throws SafeModeError if pool is in restricted or emergency safe mode
 *
 * @example
 * ```typescript
 * const pool = await getPool({ client, poolAddress })
 * const safeMode = await getSafeMode({ client, poolAddress })
 * assertTradeable(pool, safeMode)
 * ```
 */
export function assertTradeable(pool: Pool, safeMode?: SafeModeState): void {
  // First check pool health
  assertHealthy(pool)

  // Then check safe mode if provided
  if (safeMode && safeMode.mode !== 'normal') {
    throw new SafeModeError(safeMode.mode, safeMode.reason ?? 'Trading restricted')
  }
}

/**
 * Assert that minting is allowed.
 *
 * @param safeMode - SafeModeState from getSafeMode()
 * @throws SafeModeError if minting is not allowed
 *
 * @example
 * ```typescript
 * const safeMode = await getSafeMode({ client, poolAddress })
 * assertCanMint(safeMode)
 * await openPosition({ ... })
 * ```
 */
export function assertCanMint(safeMode: SafeModeState): void {
  if (!safeMode.canMint) {
    throw new SafeModeError(safeMode.mode, safeMode.reason ?? 'Minting not allowed')
  }
}

/**
 * Assert that burning is allowed.
 *
 * @param safeMode - SafeModeState from getSafeMode()
 * @throws SafeModeError if burning is not allowed
 */
export function assertCanBurn(safeMode: SafeModeState): void {
  if (!safeMode.canBurn) {
    throw new SafeModeError(safeMode.mode, safeMode.reason ?? 'Burning not allowed')
  }
}

/**
 * Assert that liquidations are allowed.
 *
 * @param safeMode - SafeModeState from getSafeMode()
 * @throws SafeModeError if liquidations are not allowed
 */
export function assertCanLiquidate(safeMode: SafeModeState): void {
  if (!safeMode.canLiquidate) {
    throw new SafeModeError(safeMode.mode, safeMode.reason ?? 'Liquidations not allowed')
  }
}

/**
 * Assert that force exercise is allowed.
 *
 * @param safeMode - SafeModeState from getSafeMode()
 * @throws SafeModeError if force exercise is not allowed
 */
export function assertCanForceExercise(safeMode: SafeModeState): void {
  if (!safeMode.canForceExercise) {
    throw new SafeModeError(safeMode.mode, safeMode.reason ?? 'Force exercise not allowed')
  }
}

// --- RPC Error Classification ---

/**
 * Common retryable RPC error codes.
 */
const RETRYABLE_RPC_CODES = new Set([
  -32000, // Server error (generic)
  -32001, // Resource not found (can be transient)
  -32002, // Resource unavailable
  -32003, // Transaction rejected (can retry with new nonce)
  -32005, // Limit exceeded (rate limit)
  -32097, // Rate limit
  -32098, // Request timeout
  -32099, // Internal error
])

/**
 * Common retryable error message patterns.
 */
const RETRYABLE_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /rate limit/i,
  /too many requests/i,
  /429/i,
  /503/i,
  /504/i,
  /502/i,
  /connection refused/i,
  /connection reset/i,
  /network error/i,
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /socket hang up/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /server error/i,
  /internal error/i,
  /nonce too low/i, // Can retry with correct nonce
  /replacement transaction underpriced/i, // Can retry with higher gas
  /already known/i, // Transaction already in mempool
]

/**
 * Check if an error is a retryable RPC error.
 *
 * Returns true for transient errors that may succeed on retry:
 * - Timeouts
 * - Rate limits
 * - Connection errors
 * - Server errors (5xx)
 * - Nonce errors (recoverable with correct nonce)
 *
 * @param error - The error to check
 * @returns True if the error is likely retryable
 *
 * @example
 * ```typescript
 * try {
 *   await openPosition({ ... })
 * } catch (error) {
 *   if (isRetryableRpcError(error)) {
 *     // Wait and retry
 *     await sleep(1000)
 *     await openPosition({ ... })
 *   } else {
 *     throw error // Non-retryable, propagate
 *   }
 * }
 * ```
 */
export function isRetryableRpcError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false
  }

  // Check for RPC error code
  if (typeof error === 'object') {
    const errorObj = error as Record<string, unknown>

    // Check code property (standard JSON-RPC error)
    if (typeof errorObj.code === 'number' && RETRYABLE_RPC_CODES.has(errorObj.code)) {
      return true
    }

    // Check nested cause
    if (errorObj.cause && isRetryableRpcError(errorObj.cause)) {
      return true
    }

    // Check details object (viem style)
    if (errorObj.details && typeof errorObj.details === 'object') {
      const details = errorObj.details as Record<string, unknown>
      if (typeof details.code === 'number' && RETRYABLE_RPC_CODES.has(details.code)) {
        return true
      }
    }
  }

  // Check error message patterns
  const message = getErrorMessage(error)
  if (message) {
    for (const pattern of RETRYABLE_PATTERNS) {
      if (pattern.test(message)) {
        return true
      }
    }
  }

  return false
}

/**
 * Extract error message from various error types.
 */
function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>
    if (typeof errorObj.message === 'string') {
      return errorObj.message
    }
    if (typeof errorObj.shortMessage === 'string') {
      return errorObj.shortMessage
    }
  }
  return undefined
}

/**
 * Check if an error is a nonce-related error that can be recovered.
 *
 * @param error - The error to check
 * @returns True if this is a nonce error
 */
export function isNonceError(error: unknown): boolean {
  const message = getErrorMessage(error)
  if (!message) return false

  return (
    /nonce too low/i.test(message) ||
    /nonce too high/i.test(message) ||
    /already known/i.test(message)
  )
}

/**
 * Check if an error is a gas-related error that can be recovered.
 *
 * @param error - The error to check
 * @returns True if this is a gas error
 */
export function isGasError(error: unknown): boolean {
  const message = getErrorMessage(error)
  if (!message) return false

  return (
    /replacement transaction underpriced/i.test(message) ||
    /gas too low/i.test(message) ||
    /intrinsic gas too low/i.test(message) ||
    /max fee per gas less than block base fee/i.test(message)
  )
}
