/**
 * Get tracked position IDs from local cache.
 * @module v2/sync/getTrackedPositionIds
 */

import type { Address, Hash, PublicClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import type { StorageAdapter } from '../storage'
import { getPositionsKey, jsonSerializer } from '../storage'
import {
  type SnapshotRecoveryResult,
  recoverSnapshot,
  recoverSnapshotFromTx,
} from './snapshotRecovery'

/**
 * Verify that a recovered position-id list still matches the account's current
 * on-chain state. `getFullPositionsData` reverts when the list contains a
 * tokenId the account no longer holds, so a successful call is proof the list
 * is live. Returns `false` on revert so the caller can fall back to an
 * authoritative event scan instead of trusting a stale checkpoint.
 */
async function isPositionListLive(params: {
  client: PublicClient
  poolAddress: Address
  account: Address
  positionIds: bigint[]
  blockNumber?: bigint
}): Promise<boolean> {
  const { client, poolAddress, account, positionIds, blockNumber } = params
  // An empty list is always a valid (positionless) state — no need to probe.
  if (positionIds.length === 0) return true
  try {
    await client.readContract({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      functionName: 'getFullPositionsData',
      args: [account, false, positionIds],
      blockNumber,
    })
    return true
  } catch {
    return false
  }
}

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

/**
 * Parameters for getOpenPositionIds.
 */
export interface GetOpenPositionIdsParams {
  /** viem PublicClient */
  client: PublicClient
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account to get positions for */
  account: Address
  /** Storage adapter (used to update local cache with the authoritative list) */
  storage?: StorageAdapter
  /**
   * Transaction hash of a known dispatch() call. When provided, the position
   * list is decoded directly from this tx's calldata (O(1)) instead of
   * scanning events to find the most recent dispatch.
   */
  lastDispatchTxHash?: Hash
  /**
   * Starting block for event scanning in recoverSnapshot.
   * When set, limits the getLogs window to [fromBlock, latest] instead of
   * scanning from block 0. Use the checkpoint's lastBlock for incremental syncs.
   */
  fromBlock?: bigint
  /** Upper bound for fallback event recovery. */
  toBlock?: bigint
  /** Expected Zodiac Roles wrapper for a bot-relayed Safe dispatch. */
  rolesContext?: {
    modifier: Address
    member: Address
    roleKey: Hash
  }
}

/**
 * Get the authoritative list of open position IDs from the chain.
 *
 * Recovers the `finalPositionIdList` from the account's most recent
 * `dispatch()` transaction calldata. This is the on-chain–validated set of
 * open positions (verified against `s_positionsHash` by the contract) and
 * requires only a few RPC calls regardless of account history length.
 *
 * This is the recommended way to get position IDs for `existingPositionIds`
 * (openPosition) and `positionIdList` (closePosition).
 *
 * If `storage` is provided, the local cache is updated with the result.
 *
 * @param params - Query parameters
 * @returns Array of currently open position token IDs, or null if no snapshot was found
 */
export async function getOpenPositionIds(
  params: GetOpenPositionIdsParams,
): Promise<bigint[] | null> {
  const {
    client,
    chainId,
    poolAddress,
    account,
    storage,
    lastDispatchTxHash,
    fromBlock,
    toBlock,
    rolesContext,
  } = params

  // Fast path: decode directly from a known tx hash (O(1), no event scanning).
  // The tx's finalPositionIdList only reflects state as of THAT dispatch — if
  // positions changed afterwards (e.g. a dispatch this caller never recorded),
  // the list is stale and would revert downstream reads. So we validate the
  // recovered list against current on-chain state and fall through to the
  // authoritative event scan when it no longer matches.
  let snapshot: SnapshotRecoveryResult | null = null
  if (lastDispatchTxHash) {
    try {
      const candidate = await recoverSnapshotFromTx({
        client,
        transactionHash: lastDispatchTxHash,
        account,
        pool: poolAddress,
        rolesContext,
      })
      if (
        candidate &&
        (await isPositionListLive({
          client,
          poolAddress,
          account,
          positionIds: candidate.positionIds,
          blockNumber: toBlock,
        }))
      ) {
        snapshot = candidate
      }
    } catch {
      // Fast path failed (e.g. RPC error, validation mismatch); fall through to slow-path
      snapshot = null
    }
  }

  if (!snapshot) {
    snapshot = await recoverSnapshot({ client, poolAddress, account, fromBlock, toBlock })
  }

  if (!snapshot) {
    return null
  }

  // Update local cache if storage provided
  if (storage) {
    const key = getPositionsKey(chainId, poolAddress, account)
    await storage.set(key, jsonSerializer.stringify(snapshot.positionIds))
  }

  return snapshot.positionIds
}
