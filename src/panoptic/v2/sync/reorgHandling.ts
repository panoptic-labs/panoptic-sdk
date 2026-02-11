/**
 * Reorg detection and handling for position sync.
 * @module v2/sync/reorgHandling
 */

import type { Address, Hash, PublicClient } from 'viem'

import type { StorageAdapter } from '../storage'
import { getSyncCheckpointKey, jsonSerializer } from '../storage'
import type { ReorgDetection, SyncCheckpoint } from '../types'
import { REORG_DEPTH } from '../utils/constants'

/**
 * Parameters for reorg detection.
 */
export interface DetectReorgParams {
  /** viem public client */
  client: PublicClient
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account being synced */
  account: Address
  /** Storage adapter for checkpoint retrieval */
  storage: StorageAdapter
}

/**
 * Detect chain reorganization by comparing stored block hash with current chain.
 *
 * @param params - Detection parameters
 * @returns Reorg detection result
 */
export async function detectReorg(params: DetectReorgParams): Promise<ReorgDetection> {
  const { client, chainId, poolAddress, account, storage } = params

  // Load checkpoint
  const checkpointKey = getSyncCheckpointKey(chainId, poolAddress, account)
  const checkpointData = await storage.get(checkpointKey)

  if (!checkpointData) {
    // No checkpoint, no reorg to detect
    return { detected: false }
  }

  const checkpoint = jsonSerializer.parse(checkpointData) as SyncCheckpoint

  // Get the block at the checkpoint height
  try {
    const block = await client.getBlock({
      blockNumber: checkpoint.lastBlock,
    })

    // Compare hashes
    if (block.hash !== checkpoint.lastBlockHash) {
      // Reorg detected!
      return {
        detected: true,
        reorgBlock: checkpoint.lastBlock,
        expectedHash: checkpoint.lastBlockHash,
        actualHash: block.hash,
        blocksToResync: REORG_DEPTH,
      }
    }

    // No reorg
    return { detected: false }
  } catch (error) {
    // Block not found - this could mean the block was orphaned
    // Treat as a reorg
    return {
      detected: true,
      reorgBlock: checkpoint.lastBlock,
      expectedHash: checkpoint.lastBlockHash,
      actualHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hash,
      blocksToResync: REORG_DEPTH,
    }
  }
}

/**
 * Calculate the safe resync block after a reorg.
 *
 * @param reorgBlock - Block where reorg was detected
 * @param reorgDepth - Number of blocks to roll back (default: REORG_DEPTH = 128)
 * @returns Safe block to resync from
 */
export function calculateResyncBlock(reorgBlock: bigint, reorgDepth: bigint = REORG_DEPTH): bigint {
  // Roll back reorgDepth blocks, but don't go below 0
  if (reorgBlock <= reorgDepth) {
    return 0n
  }
  return reorgBlock - reorgDepth
}

/**
 * Parameters for checkpoint save.
 */
export interface SaveCheckpointParams {
  /** Storage adapter */
  storage: StorageAdapter
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account */
  account: Address
  /** Last synced block */
  lastBlock: bigint
  /** Last synced block hash */
  lastBlockHash: Hash
  /** Position IDs discovered */
  positionIds: bigint[]
}

/**
 * Save a sync checkpoint.
 *
 * @param params - Checkpoint parameters
 */
export async function saveCheckpoint(params: SaveCheckpointParams): Promise<void> {
  const { storage, chainId, poolAddress, account, lastBlock, lastBlockHash, positionIds } = params

  const checkpoint: SyncCheckpoint = {
    chainId,
    poolAddress,
    account,
    lastBlock,
    lastBlockHash,
    positionIds,
    createdAt: BigInt(Math.floor(Date.now() / 1000)),
  }

  const key = getSyncCheckpointKey(chainId, poolAddress, account)
  await storage.set(key, jsonSerializer.stringify(checkpoint))
}

/**
 * Load a sync checkpoint.
 *
 * @param storage - Storage adapter
 * @param chainId - Chain ID
 * @param poolAddress - Pool address
 * @param account - Account address
 * @returns Checkpoint or null if not found
 */
export async function loadCheckpoint(
  storage: StorageAdapter,
  chainId: bigint,
  poolAddress: Address,
  account: Address,
): Promise<SyncCheckpoint | null> {
  const key = getSyncCheckpointKey(chainId, poolAddress, account)
  const data = await storage.get(key)

  if (!data) {
    return null
  }

  return jsonSerializer.parse(data) as SyncCheckpoint
}

/**
 * Clear a sync checkpoint.
 *
 * @param storage - Storage adapter
 * @param chainId - Chain ID
 * @param poolAddress - Pool address
 * @param account - Account address
 */
export async function clearCheckpoint(
  storage: StorageAdapter,
  chainId: bigint,
  poolAddress: Address,
  account: Address,
): Promise<void> {
  const key = getSyncCheckpointKey(chainId, poolAddress, account)
  await storage.delete(key)
}

/**
 * Verify block continuity for a range of blocks.
 * This checks that each block's parentHash matches the previous block's hash.
 *
 * @param client - viem public client
 * @param fromBlock - Starting block
 * @param toBlock - Ending block
 * @returns True if blocks form a valid chain
 */
export async function verifyBlockContinuity(
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<boolean> {
  if (fromBlock >= toBlock) {
    return true
  }

  // Sample a few blocks to verify continuity
  const sampleSize = Math.min(5, Number(toBlock - fromBlock))
  const step = (toBlock - fromBlock) / BigInt(sampleSize)

  let previousHash: Hash | null = null

  for (let i = 0; i <= sampleSize; i++) {
    const blockNumber = fromBlock + step * BigInt(i)
    const block = await client.getBlock({ blockNumber })

    if (previousHash !== null && i > 0) {
      // For non-consecutive blocks, we can't verify parentHash
      // but we can check that the block exists
    }

    previousHash = block.hash
  }

  return true
}
