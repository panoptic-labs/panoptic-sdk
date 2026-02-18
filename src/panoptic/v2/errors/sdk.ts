/**
 * SDK-specific errors not derived from contract Errors.sol.
 * @module v2/errors/sdk
 */

import type { Address } from 'viem'

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
 * Tick limits are invalid for the given operation.
 *
 * tickLimitLow must be <= tickLimitHigh regardless of swapAtMint.
 * The SDK handles reordering internally based on the swapAtMint flag.
 */
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
