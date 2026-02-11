/**
 * Sync types for position synchronization.
 * @module v2/types/sync
 */

import type { Address, Hash } from 'viem'

/**
 * Sync status enum.
 */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'complete'

/**
 * Sync state for tracking synchronization progress.
 */
export interface SyncState {
  /** Current sync status */
  status: SyncStatus
  /** Last synced block number */
  lastSyncedBlock: bigint
  /** Last synced block hash */
  lastSyncedBlockHash: Hash
  /** Target block to sync to */
  targetBlock: bigint
  /** Number of positions found during sync */
  positionsFound: bigint
  /** Progress percentage (0-100) */
  progress: bigint
  /** Error message if status is 'error' */
  errorMessage?: string
  /** Timestamp when sync started */
  startedAt: bigint
  /** Timestamp when sync completed (or errored) */
  completedAt?: bigint
}

/**
 * Sync checkpoint for resumable syncs.
 */
export interface SyncCheckpoint {
  /** Chain ID */
  chainId: bigint
  /** Pool address being synced */
  poolAddress: Address
  /** Account address being synced */
  account: Address
  /** Last processed block */
  lastBlock: bigint
  /** Last processed block hash */
  lastBlockHash: Hash
  /** Positions discovered so far */
  positionIds: bigint[]
  /** Checkpoint creation timestamp */
  createdAt: bigint
}

/**
 * Sync options for customizing sync behavior.
 */
export interface SyncOptions {
  /** Starting block for sync (defaults to pool deployment block) */
  fromBlock?: bigint
  /** Ending block for sync (defaults to latest) */
  toBlock?: bigint
  /** Batch size for event fetching */
  batchSize?: bigint
  /** Whether to use checkpoints for resumable syncs */
  useCheckpoints?: boolean
  /** Progress callback */
  onProgress?: (state: SyncState) => void
}

/**
 * Sync result after completion.
 */
export interface SyncResult {
  /** Whether sync completed successfully */
  success: boolean
  /** Final sync state */
  state: SyncState
  /** Position IDs discovered */
  positionIds: bigint[]
  /** Number of blocks processed */
  blocksProcessed: bigint
  /** Duration in milliseconds */
  durationMs: bigint
}

/**
 * Reorg detection result.
 */
export interface ReorgDetection {
  /** Whether a reorg was detected */
  detected: boolean
  /** Block number where reorg started (if detected) */
  reorgBlock?: bigint
  /** Expected block hash */
  expectedHash?: Hash
  /** Actual block hash */
  actualHash?: Hash
  /** Number of blocks to resync */
  blocksToResync?: bigint
}
