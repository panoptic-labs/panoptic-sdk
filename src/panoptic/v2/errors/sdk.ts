/**
 * SDK-specific errors not derived from contract Errors.sol.
 * @module v2/errors/sdk
 */

import type { Address } from 'viem'

import type { BatchDiagnostic } from '../batch/types'
import type { SafeMode } from '../types/oracle'
import type { PoolHealthStatus } from '../types/pool'
import { PanopticError } from './base'

// ─────────────────────────────────────────────────────────────
// Configuration & Network Errors
// ─────────────────────────────────────────────────────────────

/**
 * Wallet is connected to a different network than the config expects.
 * Thrown on write operations when wallet chain !== config chain.
 */
export class NetworkMismatchError extends PanopticError {
  override readonly name = 'NetworkMismatchError'

  constructor(
    public readonly walletChainId: bigint,
    public readonly expectedChainId: bigint,
    cause?: Error,
  ) {
    super(
      `Network mismatch: wallet on chain ${walletChainId}, expected chain ${expectedChainId}`,
      cause,
    )
  }
}

/**
 * Cross-pool operation attempted (query for different pool than configured).
 */
export class CrossPoolError extends PanopticError {
  override readonly name = 'CrossPoolError'

  constructor(
    public readonly requestedPool: Address,
    public readonly configuredPool: Address,
    cause?: Error,
  ) {
    super(`Cross-pool error: requested ${requestedPool}, configured ${configuredPool}`, cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Sync & Position Tracking Errors
// ─────────────────────────────────────────────────────────────

/**
 * Position sync timed out.
 */
export class SyncTimeoutError extends PanopticError {
  override readonly name = 'SyncTimeoutError'

  constructor(
    public readonly elapsedMs: bigint,
    public readonly blocksProcessed: bigint,
    public readonly blocksRemaining: bigint,
    cause?: Error,
  ) {
    super(
      `Sync timeout after ${elapsedMs}ms: processed ${blocksProcessed} blocks, ${blocksRemaining} remaining`,
      cause,
    )
  }
}

/**
 * Snapshot recovery from dispatch() calldata failed.
 */
export class PositionSnapshotNotFoundError extends PanopticError {
  override readonly name = 'PositionSnapshotNotFoundError'

  constructor(cause?: Error) {
    super('Position snapshot not found in dispatch() calldata history', cause)
  }
}

/**
 * Provider is behind the expected block number.
 * Thrown when minBlockNumber option is specified and provider is lagging.
 */
export class ProviderLagError extends PanopticError {
  override readonly name = 'ProviderLagError'

  constructor(
    public readonly providerBlock: bigint,
    public readonly expectedBlock: bigint,
    cause?: Error,
  ) {
    super(`Provider behind: at block ${providerBlock}, expected at least ${expectedBlock}`, cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Multicall Errors
// ─────────────────────────────────────────────────────────────

/**
 * Multicall3 returned fewer results than the number of calls submitted.
 */
export class MulticallResultMissingError extends PanopticError {
  override readonly name = 'MulticallResultMissingError'

  constructor(
    public readonly label: string,
    public readonly index: number,
    cause?: Error,
  ) {
    super(`Missing Multicall3 result for ${label} (index ${index})`, cause)
  }
}

/**
 * Multicall3 sub-call reverted (success=false in the result tuple).
 */
export class MulticallResultFailedError extends PanopticError {
  override readonly name = 'MulticallResultFailedError'

  constructor(
    public readonly label: string,
    public readonly index: number,
    cause?: Error,
  ) {
    super(`Multicall3 result failed for ${label} (index ${index})`, cause)
  }
}

/**
 * eth_call to Multicall3 returned no data (provider-level failure).
 */
export class MulticallNoDataError extends PanopticError {
  override readonly name = 'MulticallNoDataError'

  constructor(
    public readonly functionName: string,
    cause?: Error,
  ) {
    super(`Multicall3.${functionName} returned no data`, cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Chunk Tracking Errors
// ─────────────────────────────────────────────────────────────

/**
 * Exceeded the maximum number of tracked chunks (1000 per pool).
 */
export class ChunkLimitError extends PanopticError {
  override readonly name = 'ChunkLimitError'

  constructor(
    public readonly currentCount: bigint,
    public readonly attemptedAdd: bigint,
    cause?: Error,
  ) {
    super(
      `Chunk limit exceeded: ${currentCount} tracked, attempted to add ${attemptedAdd} (max 1000)`,
      cause,
    )
  }
}

// ─────────────────────────────────────────────────────────────
// Pool Health Errors
// ─────────────────────────────────────────────────────────────

/**
 * Pool is in safe mode and trading is restricted.
 */
export class SafeModeError extends PanopticError {
  override readonly name = 'SafeModeError'

  constructor(
    public readonly level: SafeMode,
    public readonly reason: string,
    cause?: Error,
  ) {
    super(`Pool in safe mode (${level}): ${reason}`, cause)
  }
}

/**
 * Data is stale (too old based on block timestamp).
 */
export class StaleDataError extends PanopticError {
  override readonly name = 'StaleDataError'

  constructor(
    public readonly blockTimestamp: bigint,
    public readonly currentTimestamp: bigint,
    public readonly stalenessSeconds: bigint,
    cause?: Error,
  ) {
    super(
      `Data stale: block timestamp ${blockTimestamp}, current ${currentTimestamp}, stale by ${stalenessSeconds}s`,
      cause,
    )
  }
}

/**
 * Pool is in an unhealthy state (low liquidity or paused).
 */
export class UnhealthyPoolError extends PanopticError {
  override readonly name = 'UnhealthyPoolError'

  constructor(
    public readonly healthStatus: PoolHealthStatus,
    cause?: Error,
  ) {
    super(`Pool unhealthy: ${healthStatus}`, cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Oracle Errors
// ─────────────────────────────────────────────────────────────

/**
 * Cannot poke oracle because less than 64 seconds since last update.
 */
export class OracleRateLimitedError extends PanopticError {
  override readonly name = 'OracleRateLimitedError'

  constructor(
    public readonly lastUpdate: bigint,
    public readonly currentTime: bigint,
    cause?: Error,
  ) {
    const elapsed = currentTime - lastUpdate
    super(`Oracle rate limited: last update ${elapsed}s ago, must wait 64s between updates`, cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Helper Contract Errors
// ─────────────────────────────────────────────────────────────

/**
 * PanopticHelper contract is not deployed.
 * Functions requiring the helper will throw this error.
 */
export class PanopticHelperNotDeployedError extends PanopticError {
  override readonly name = 'PanopticHelperNotDeployedError'

  constructor(cause?: Error) {
    super(
      'PanopticHelper contract not deployed. This function requires the helper contract.',
      cause,
    )
  }
}

// ─────────────────────────────────────────────────────────────
// RPC Errors
// ─────────────────────────────────────────────────────────────

/**
 * RPC request failed after all retries.
 */
export class RpcError extends PanopticError {
  override readonly name = 'RpcError'

  constructor(
    public readonly method: string,
    public readonly retriesAttempted: bigint,
    cause?: Error,
  ) {
    super(`RPC ${method} failed after ${retriesAttempted} retries`, cause)
  }
}

/**
 * RPC returned an error response.
 */
export class RpcResponseError extends PanopticError {
  override readonly name = 'RpcResponseError'

  constructor(
    public readonly code: bigint,
    public readonly rpcMessage: string,
    cause?: Error,
  ) {
    super(`RPC error ${code}: ${rpcMessage}`, cause)
  }
}

/**
 * Thrown when required data is not found in storage.
 * This usually means syncPositions() needs to be called first.
 */
export class StorageDataNotFoundError extends PanopticError {
  override readonly name = 'StorageDataNotFoundError'

  constructor(
    public readonly dataType: 'poolMeta' | 'positions' | 'positionMeta',
    public readonly key: string,
  ) {
    super(
      `${dataType} not found in storage (key: ${key}). ` +
        'Call syncPositions() first to populate storage.',
    )
  }
}

/**
 * Position ID list was not provided and could not be resolved from storage.
 *
 * Either pass `existingPositionIds` / `positionIdList` explicitly, or provide
 * `storage` + `chainId` so the SDK can read tracked positions automatically.
 */
export class MissingPositionIdsError extends PanopticError {
  override readonly name = 'MissingPositionIdsError'

  constructor() {
    super(
      'Either existingPositionIds/positionIdList must be provided, or storage + chainId for auto-resolution.',
    )
  }
}

/**
 * History range parameters are invalid (e.g. startBlock > endBlock, points < 0).
 */
export class InvalidHistoryRangeError extends PanopticError {
  override readonly name = 'InvalidHistoryRangeError'
}

/**
 * Tick limits are invalid for the given operation.
 *
 * tickLimitLow must be <= tickLimitHigh regardless of swapAtMint.
 * The SDK handles reordering internally based on the swapAtMint flag.
 */
/**
 * Generic validation error for public SDK functions.
 * Thrown when input parameters fail validation checks.
 */
export class PanopticValidationError extends PanopticError {
  override readonly name = 'PanopticValidationError'
}

export class InvalidTickLimitsError extends PanopticError {
  override readonly name = 'InvalidTickLimitsError'

  constructor(
    public readonly tickLimitLow: bigint,
    public readonly tickLimitHigh: bigint,
  ) {
    super(
      `Invalid tick limits: tickLimitLow (${tickLimitLow}) must be <= tickLimitHigh (${tickLimitHigh}). ` +
        'The SDK reorders limits based on swapAtMint — always pass them in ascending order.',
    )
  }
}

/**
 * No loan positions found for the given token.
 */
export class NoLoanPositionsError extends PanopticError {
  override readonly name = 'NoLoanPositionsError'

  constructor(public readonly token: Address) {
    super(`No loan positions found for token ${token}`)
  }
}

/**
 * All loan tokenId slots are in use — no unique tokenId could be generated.
 */
export class LoanSlotExhaustedError extends PanopticError {
  override readonly name = 'LoanSlotExhaustedError'

  constructor() {
    super('Could not build unique loan tokenId — all slots in use')
  }
}

/**
 * Maximum retry attempts exceeded for the given operation.
 */
export class MaxRetriesExceededError extends PanopticError {
  override readonly name = 'MaxRetriesExceededError'

  constructor(public readonly operation: string) {
    super(`${operation}: max retries exceeded`)
  }
}

/**
 * Batch dispatch validation failed.
 *
 * Thrown by `executeBatchDispatch` when the batch contains invalid items
 * (mint of an existing tokenId, burn of a position not held, duplicate tokenIds,
 * cross-pool ops, etc.). The `diagnostics` array carries one entry per failure.
 */
export class BatchValidationError extends PanopticError {
  override readonly name = 'BatchValidationError'

  constructor(public readonly diagnostics: BatchDiagnostic[]) {
    super(
      `Batch dispatch validation failed (${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}): ` +
        diagnostics.map((d) => `[${d.code}] ${d.message}`).join('; '),
    )
  }
}

/**
 * Thrown when a swap token address doesn't match either token in the pool.
 */
export class SwapTokenMismatchError extends PanopticError {
  override readonly name = 'SwapTokenMismatchError'

  constructor(
    public readonly tokenAddress: Address,
    public readonly token0: Address,
    public readonly token1: Address,
  ) {
    super(
      `Token ${tokenAddress} does not match either pool token: token0=${token0}, token1=${token1}`,
    )
  }
}
