/**
 * Get synchronization status for an account.
 * @module v2/sync/getSyncStatus
 */

import type { Address, PublicClient } from 'viem'

import type { StorageAdapter } from '../storage'
import { loadCheckpoint } from './reorgHandling'

/**
 * Parameters for getSyncStatus.
 */
export interface GetSyncStatusParams {
  /** viem public client */
  client: PublicClient
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account to check */
  account: Address
  /** Storage adapter */
  storage: StorageAdapter
}

/**
 * Sync status result.
 */
export interface SyncStatusResult {
  /** Last synced block number (0n if never synced) */
  lastSyncedBlock: bigint
  /** Whether the account is fully synced to current block */
  isSynced: boolean
  /** Number of blocks behind (0n if synced) */
  blocksBehind: bigint
  /** Number of positions tracked */
  positionCount: bigint
  /** Whether a checkpoint exists */
  hasCheckpoint: boolean
}

/**
 * Get the synchronization status for an account.
 *
 * This function checks the stored checkpoint and compares against
 * the current chain head to determine sync status.
 *
 * @param params - Status parameters
 * @returns Sync status information
 */
export async function getSyncStatus(params: GetSyncStatusParams): Promise<SyncStatusResult> {
  const { client, chainId, poolAddress, account, storage } = params

  // Get current block
  const currentBlock = await client.getBlockNumber()

  // Load checkpoint
  const checkpoint = await loadCheckpoint(storage, chainId, poolAddress, account)

  if (!checkpoint) {
    return {
      lastSyncedBlock: 0n,
      isSynced: false,
      blocksBehind: currentBlock,
      positionCount: 0n,
      hasCheckpoint: false,
    }
  }

  const blocksBehind = currentBlock - checkpoint.lastBlock
  const isSynced = blocksBehind <= 0n

  return {
    lastSyncedBlock: checkpoint.lastBlock,
    isSynced,
    blocksBehind: blocksBehind > 0n ? blocksBehind : 0n,
    positionCount: BigInt(checkpoint.positionIds.length),
    hasCheckpoint: true,
  }
}
