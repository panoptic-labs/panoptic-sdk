/**
 * Pending position tracking for optimistic updates.
 * @module v2/sync/pendingPositions
 */

import type { Address, Hash } from 'viem'

import type { StorageAdapter } from '../storage'
import { getPendingPositionsKey, jsonSerializer } from '../storage'
import type { TokenIdLeg } from '../types'

/**
 * A pending position that has been submitted but not yet confirmed.
 */
export interface PendingPosition {
  /** The TokenId */
  tokenId: bigint
  /** Owner address */
  owner: Address
  /** Pool address */
  poolAddress: Address
  /** Position size (from simulation) */
  positionSize: bigint
  /** Decoded legs */
  legs: TokenIdLeg[]
  /** Transaction hash */
  txHash: Hash
  /** Block number when submitted */
  submittedAtBlock: bigint
  /** Timestamp when submitted */
  submittedAt: bigint
  /** Status */
  status: 'pending' | 'confirmed' | 'failed'
}

/**
 * Parameters for adding a pending position.
 */
export interface AddPendingPositionParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account (owner) */
  account: Address
  /** Storage adapter */
  storage: StorageAdapter
  /** Pending position data */
  position: PendingPosition
}

/**
 * Add a pending position for optimistic updates.
 *
 * Called when openPosition() submits a transaction.
 *
 * @param params - Parameters
 */
export async function addPendingPosition(params: AddPendingPositionParams): Promise<void> {
  const { chainId, poolAddress, account, storage, position } = params

  const key = getPendingPositionsKey(chainId, poolAddress, account)
  const existingData = await storage.get(key)

  let pending: PendingPosition[]
  if (existingData) {
    try {
      pending = jsonSerializer.parse(existingData) as PendingPosition[]
    } catch {
      pending = []
    }
  } else {
    pending = []
  }

  // Add new pending position
  pending.push(position)

  await storage.set(key, jsonSerializer.stringify(pending))
}

/**
 * Parameters for getting pending positions.
 */
export interface GetPendingPositionsParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account (owner) */
  account: Address
  /** Storage adapter */
  storage: StorageAdapter
}

/**
 * Get all pending positions for an account.
 *
 * @param params - Parameters
 * @returns Array of pending positions
 */
export async function getPendingPositions(
  params: GetPendingPositionsParams,
): Promise<PendingPosition[]> {
  const { chainId, poolAddress, account, storage } = params

  const key = getPendingPositionsKey(chainId, poolAddress, account)
  const data = await storage.get(key)

  if (!data) {
    return []
  }

  try {
    const pending = jsonSerializer.parse(data) as PendingPosition[]
    // Only return pending status
    return pending.filter((p) => p.status === 'pending')
  } catch {
    return []
  }
}

/**
 * Parameters for confirming a pending position.
 */
export interface ConfirmPendingPositionParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account (owner) */
  account: Address
  /** Storage adapter */
  storage: StorageAdapter
  /** Token ID to confirm */
  tokenId: bigint
}

/**
 * Mark a pending position as confirmed.
 *
 * Called when syncPositions() finds the OptionMinted event.
 *
 * @param params - Parameters
 */
export async function confirmPendingPosition(params: ConfirmPendingPositionParams): Promise<void> {
  const { chainId, poolAddress, account, storage, tokenId } = params

  const key = getPendingPositionsKey(chainId, poolAddress, account)
  const existingData = await storage.get(key)

  if (!existingData) {
    return
  }

  let pending: PendingPosition[]
  try {
    pending = jsonSerializer.parse(existingData) as PendingPosition[]
  } catch {
    return
  }

  // Find and update the position
  const updated = pending.map((p) =>
    p.tokenId === tokenId ? { ...p, status: 'confirmed' as const } : p,
  )

  // Remove confirmed positions (they're now in the main position list)
  const remaining = updated.filter((p) => p.status === 'pending')

  if (remaining.length === 0) {
    await storage.delete(key)
  } else {
    await storage.set(key, jsonSerializer.stringify(remaining))
  }
}

/**
 * Parameters for failing a pending position.
 */
export interface FailPendingPositionParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account (owner) */
  account: Address
  /** Storage adapter */
  storage: StorageAdapter
  /** Transaction hash that failed */
  txHash: Hash
}

/**
 * Mark a pending position as failed (transaction reverted).
 *
 * @param params - Parameters
 */
export async function failPendingPosition(params: FailPendingPositionParams): Promise<void> {
  const { chainId, poolAddress, account, storage, txHash } = params

  const key = getPendingPositionsKey(chainId, poolAddress, account)
  const existingData = await storage.get(key)

  if (!existingData) {
    return
  }

  let pending: PendingPosition[]
  try {
    pending = jsonSerializer.parse(existingData) as PendingPosition[]
  } catch {
    return
  }

  // Remove the failed position
  const remaining = pending.filter((p) => p.txHash !== txHash)

  if (remaining.length === 0) {
    await storage.delete(key)
  } else {
    await storage.set(key, jsonSerializer.stringify(remaining))
  }
}

/**
 * Clear all pending positions for an account.
 *
 * @param params - Parameters
 */
export async function clearPendingPositions(params: GetPendingPositionsParams): Promise<void> {
  const { chainId, poolAddress, account, storage } = params

  const key = getPendingPositionsKey(chainId, poolAddress, account)
  await storage.delete(key)
}

/**
 * Clean up stale pending positions.
 *
 * Removes pending positions older than the specified block threshold.
 * This handles cases where transactions were dropped from the mempool.
 *
 * @param params - Parameters
 * @param maxAgeBlocks - Maximum age in blocks (default: 100)
 * @param currentBlock - Current block number
 */
export async function cleanupStalePendingPositions(
  params: GetPendingPositionsParams,
  currentBlock: bigint,
  maxAgeBlocks: bigint = 100n,
): Promise<void> {
  const { chainId, poolAddress, account, storage } = params

  const key = getPendingPositionsKey(chainId, poolAddress, account)
  const existingData = await storage.get(key)

  if (!existingData) {
    return
  }

  let pending: PendingPosition[]
  try {
    pending = jsonSerializer.parse(existingData) as PendingPosition[]
  } catch {
    return
  }

  // Filter out stale positions
  const threshold = currentBlock - maxAgeBlocks
  const remaining = pending.filter((p) => p.status === 'pending' && p.submittedAtBlock > threshold)

  if (remaining.length === 0) {
    await storage.delete(key)
  } else if (remaining.length !== pending.length) {
    await storage.set(key, jsonSerializer.stringify(remaining))
  }
}
