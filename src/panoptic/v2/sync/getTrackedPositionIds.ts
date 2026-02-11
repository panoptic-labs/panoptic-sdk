/**
 * Get tracked position IDs from local cache.
 * @module v2/sync/getTrackedPositionIds
 */

import type { Address } from 'viem'

import type { StorageAdapter } from '../storage'
import { getPositionsKey, jsonSerializer } from '../storage'

/**
 * Parameters for getTrackedPositionIds.
 */
export interface GetTrackedPositionIdsParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account to get positions for */
  account: Address
  /** Storage adapter */
  storage: StorageAdapter
}

/**
 * Get all tracked position IDs for an account from local cache.
 *
 * This function reads from the storage adapter without making RPC calls.
 * The positions returned may include closed positions if the cache is stale.
 * Use `getPositions()` for authoritative on-chain data.
 *
 * @param params - Query parameters
 * @returns Array of position token IDs
 */
export async function getTrackedPositionIds(
  params: GetTrackedPositionIdsParams,
): Promise<bigint[]> {
  const { chainId, poolAddress, account, storage } = params

  const key = getPositionsKey(chainId, poolAddress, account)
  const data = await storage.get(key)

  if (!data) {
    return []
  }

  try {
    const positionIds = jsonSerializer.parse(data) as bigint[]
    return positionIds
  } catch {
    // Corrupted data, return empty
    return []
  }
}

/**
 * Check if a specific position ID is tracked.
 *
 * @param params - Query parameters
 * @param tokenId - Token ID to check
 * @returns Whether the position is tracked
 */
export async function isPositionTracked(
  params: GetTrackedPositionIdsParams,
  tokenId: bigint,
): Promise<boolean> {
  const positionIds = await getTrackedPositionIds(params)
  return positionIds.some((id) => id === tokenId)
}

/**
 * Clear all tracked positions for an account.
 *
 * @param params - Query parameters
 */
export async function clearTrackedPositions(params: GetTrackedPositionIdsParams): Promise<void> {
  const { chainId, poolAddress, account, storage } = params

  const key = getPositionsKey(chainId, poolAddress, account)
  await storage.delete(key)
}
