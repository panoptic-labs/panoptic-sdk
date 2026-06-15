/**
 * Main position synchronization function.
 * @module v2/sync/syncPositions
 */

import type { Address, Hash, PublicClient } from 'viem'

import { isRetryableRpcError } from '../bot'
import { ProviderLagError, SyncTimeoutError } from '../errors'
import { getPoolMetadata } from '../reads/pool'
import { getPositions } from '../reads/position'
import type { StorageAdapter } from '../storage'
import { getPoolMetaKey, getPositionMetaKey, getPositionsKey, jsonSerializer } from '../storage'
import type { StoredPoolMeta, StoredPositionData } from '../types'
import { getOpenPositionIds } from './getTrackedPositionIds'
import { detectReorg, loadCheckpoint, saveCheckpoint } from './reorgHandling'

/**
 * Parameters for syncPositions.
 */
export interface SyncPositionsParams {
  /** viem public client */
  client: PublicClient
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account to sync */
  account: Address
  /** Storage adapter for persistence */
  storage: StorageAdapter
  /** Starting block for sync (defaults to pool deployment block) */
  fromBlock?: bigint
  /** Ending block for sync (defaults to latest) */
  toBlock?: bigint
  /** Max block range per eth_getLogs call (default: 10000n) */
  maxLogsPerQuery?: bigint
  /** Max sync duration in ms (default: 300000n = 5 min) */
  syncTimeout?: bigint
  /** Optional callback for sync progress */
  onUpdate?: (event: SyncProgressEvent) => void
  /** If provider is behind this block, throw ProviderLagError */
  minBlockNumber?: bigint
  /** Manual snapshot tx hash for recovery when automatic fails */
  snapshotTxHash?: Hash
}

/**
 * Sync progress event for callbacks.
 */
export interface SyncProgressEvent {
  /** Event type */
  type: 'position-opened' | 'position-closed' | 'progress' | 'reorg-detected'
  /** TokenId for position events */
  tokenId?: bigint
  /** Current block being processed */
  blockNumber: bigint
  /** Progress info */
  progress?: {
    /** Current block */
    current: bigint
    /** Total blocks to process */
    total: bigint
  }
}

/**
 * Result of syncPositions.
 */
export interface SyncPositionsResult {
  /** Last synced block number */
  lastSyncedBlock: bigint
  /** Last synced block hash */
  lastSyncedBlockHash: Hash
  /** Number of open positions */
  positionCount: bigint
  /** Position IDs discovered */
  positionIds: bigint[]
  /** Whether this was an incremental sync (vs full) */
  incremental: boolean
  /** Duration in milliseconds */
  durationMs: bigint
}

/**
 * Synchronize positions for an account.
 *
 * This function:
 * 1. Checks for existing checkpoint
 * 2. If no checkpoint: recovers from dispatch() calldata or falls back to full event scan
 * 3. If checkpoint exists: detects reorgs and syncs incrementally
 * 4. Persists positions and checkpoint to storage
 *
 * @param params - Sync parameters
 * @returns Sync result with position count and sync metadata
 * @throws SyncTimeoutError if sync exceeds timeout
 * @throws ProviderLagError if provider is behind minBlockNumber
 * @throws PositionSnapshotNotFoundError if no positions found and no snapshot available
 */
export async function syncPositions(params: SyncPositionsParams): Promise<SyncPositionsResult> {
  const {
    client,
    chainId,
    poolAddress,
    account,
    storage,
    syncTimeout = 300000n, // 5 minutes
    onUpdate,
    minBlockNumber,
    snapshotTxHash,
  } = params

  const startTime = Date.now()

  const checkTimeout = () => {
    const elapsed = BigInt(Date.now() - startTime)
    if (elapsed > syncTimeout) {
      throw new SyncTimeoutError(elapsed, toBlock, 0n)
    }
  }

  // Get latest block
  const latestBlock = await client.getBlockNumber()
  const toBlock = params.toBlock ?? latestBlock

  // Check for provider lag
  if (minBlockNumber !== undefined && latestBlock < minBlockNumber) {
    throw new ProviderLagError(minBlockNumber, latestBlock)
  }

  // Reorg detection using existing checkpoint
  const checkpoint = await loadCheckpoint(storage, chainId, poolAddress, account)
  if (checkpoint) {
    const reorgResult = await detectReorg({
      client,
      chainId,
      poolAddress,
      account,
      storage,
    })

    if (reorgResult.detected) {
      onUpdate?.({
        type: 'reorg-detected',
        blockNumber: reorgResult.reorgBlock ?? 0n,
      })
    }
  }

  checkTimeout()

  // Get authoritative position IDs from latest dispatch calldata.
  // When resuming from a checkpoint, narrow the event scan window to avoid
  // re-scanning the entire chain history on every incremental sync.
  // Returns null when no dispatch event was found in the scanned range,
  // or [] when a dispatch was found with an empty position list.
  const snapshotResult = await getOpenPositionIds({
    client,
    chainId,
    poolAddress,
    account,
    storage,
    lastDispatchTxHash: snapshotTxHash,
    fromBlock: checkpoint?.lastBlock ?? params.fromBlock,
  })

  // If no dispatch events were found in the scanned range (null) but the
  // checkpoint had positions, the user simply hasn't traded since the last
  // sync — keep the cached list. An explicit empty array means a dispatch
  // was found that authoritatively shows zero open positions.
  let positionIds: bigint[]
  if (snapshotResult === null && checkpoint && checkpoint.positionIds.length > 0) {
    positionIds = checkpoint.positionIds
  } else {
    positionIds = snapshotResult ?? []
  }

  // If no positions and no history, save empty checkpoint and return early
  if (positionIds.length === 0) {
    const hasAnyEvents = await accountHasPositionEvents({
      client,
      poolAddress,
      account,
      fromBlock: params.fromBlock,
      toBlock,
    })

    if (!hasAnyEvents) {
      const finalBlock = await client.getBlock({ blockNumber: toBlock })

      const poolMetaKey = getPoolMetaKey(chainId, poolAddress)
      const existingPoolMeta = await storage.get(poolMetaKey)
      if (!existingPoolMeta) {
        await fetchAndStorePoolMeta(client, poolAddress, poolMetaKey, storage)
      }

      await saveCheckpoint({
        storage,
        chainId,
        poolAddress,
        account,
        lastBlock: toBlock,
        lastBlockHash: finalBlock.hash,
        positionIds: [],
      })

      const positionsKey = getPositionsKey(chainId, poolAddress, account)
      await storage.set(positionsKey, jsonSerializer.stringify([]))

      return {
        lastSyncedBlock: toBlock,
        lastSyncedBlockHash: finalBlock.hash,
        positionCount: 0n,
        positionIds: [],
        incremental: false,
        durationMs: BigInt(Date.now() - startTime),
      }
    }
  }

  checkTimeout()

  // Get final block info
  const finalBlock = await client.getBlock({ blockNumber: toBlock })

  // Fetch and store pool metadata if not already stored
  const poolMetaKey = getPoolMetaKey(chainId, poolAddress)
  const existingPoolMeta = await storage.get(poolMetaKey)
  if (!existingPoolMeta) {
    await fetchAndStorePoolMeta(client, poolAddress, poolMetaKey, storage)
  }

  // Fetch and store position data for all positions
  if (positionIds.length > 0) {
    const { positions } = await getPositions({
      client,
      poolAddress,
      owner: account,
      tokenIds: positionIds,
      blockNumber: toBlock,
    })

    for (const pos of positions) {
      const positionMetaKey = getPositionMetaKey(chainId, poolAddress, pos.tokenId)
      const storedData: StoredPositionData = {
        tokenId: pos.tokenId,
        positionSize: pos.positionSize,
        legs: pos.legs,
        tickAtMint: pos.tickAtMint,
        poolUtilization0AtMint: pos.poolUtilization0AtMint,
        poolUtilization1AtMint: pos.poolUtilization1AtMint,
        timestampAtMint: pos.timestampAtMint,
        blockNumberAtMint: pos.blockNumberAtMint,
        swapAtMint: pos.swapAtMint,
      }
      await storage.set(positionMetaKey, jsonSerializer.stringify(storedData))
    }
  }

  // Save checkpoint
  await saveCheckpoint({
    storage,
    chainId,
    poolAddress,
    account,
    lastBlock: toBlock,
    lastBlockHash: finalBlock.hash,
    positionIds,
  })

  // Save positions to storage
  const positionsKey = getPositionsKey(chainId, poolAddress, account)
  await storage.set(positionsKey, jsonSerializer.stringify(positionIds))

  return {
    lastSyncedBlock: toBlock,
    lastSyncedBlockHash: finalBlock.hash,
    positionCount: BigInt(positionIds.length),
    positionIds,
    incremental: !!checkpoint,
    durationMs: BigInt(Date.now() - startTime),
  }
}

/**
 * Quick check if an account has ANY position events.
 * Checks OptionMinted, OptionBurnt, ForcedExercised (user), and AccountLiquidated (liquidatee).
 * All checked fields are indexed so this is fast.
 *
 * **Warning:** RPC index lag can cause false negatives for recently minted positions.
 * If the RPC node's event index is behind the chain tip, this function may return
 * `false` even though the account has just minted a position. Callers should either
 * wait a few blocks after minting before calling syncPositions, or skip this
 * optimization (by providing a `snapshotTxHash`) when freshness is critical.
 *
 * @param params - Check parameters
 * @returns true if account has any position events, false otherwise
 */
async function accountHasPositionEvents(params: {
  client: PublicClient
  poolAddress: Address
  account: Address
  fromBlock?: bigint
  toBlock: bigint
}): Promise<boolean> {
  const { client, poolAddress, account, fromBlock = 0n, toBlock } = params

  const [mintEvents, burnEvents, forceExerciseEvents, liquidationEvents] = await Promise.all([
    withRetry(() =>
      client.getLogs({
        address: poolAddress,
        event: {
          type: 'event',
          name: 'OptionMinted',
          inputs: [
            { type: 'address', name: 'recipient', indexed: true },
            { type: 'uint256', name: 'tokenId', indexed: true },
            { type: 'uint256', name: 'balanceData', indexed: false },
          ],
        },
        args: {
          recipient: account,
        },
        fromBlock,
        toBlock,
      }),
    ),
    withRetry(() =>
      client.getLogs({
        address: poolAddress,
        event: {
          type: 'event',
          name: 'OptionBurnt',
          inputs: [
            { type: 'address', name: 'recipient', indexed: true },
            { type: 'uint256', name: 'tokenId', indexed: true },
            { type: 'uint256', name: 'positionSize', indexed: false },
            { type: 'int256[4]', name: 'premiaByLeg', indexed: false },
          ],
        },
        args: {
          recipient: account,
        },
        fromBlock,
        toBlock,
      }),
    ),
    withRetry(() =>
      client.getLogs({
        address: poolAddress,
        event: {
          type: 'event',
          name: 'ForcedExercised',
          inputs: [
            { type: 'address', name: 'exercisor', indexed: true },
            { type: 'address', name: 'user', indexed: true },
            { type: 'uint256', name: 'tokenId', indexed: true },
            { type: 'int256', name: 'exerciseFee', indexed: false },
          ],
        },
        args: {
          user: account,
        },
        fromBlock,
        toBlock,
      }),
    ),
    withRetry(() =>
      client.getLogs({
        address: poolAddress,
        event: {
          type: 'event',
          name: 'AccountLiquidated',
          inputs: [
            { type: 'address', name: 'liquidator', indexed: true },
            { type: 'address', name: 'liquidatee', indexed: true },
            { type: 'int256', name: 'bonusAmounts', indexed: false },
          ],
        },
        args: {
          liquidatee: account,
        },
        fromBlock,
        toBlock,
      }),
    ),
  ])

  return (
    mintEvents.length > 0 ||
    burnEvents.length > 0 ||
    forceExerciseEvents.length > 0 ||
    liquidationEvents.length > 0
  )
}

/**
 * Fetch full pool metadata and store it.
 * Uses getPoolMetadata to fetch all immutable pool data in minimal RPC calls.
 */
async function fetchAndStorePoolMeta(
  client: PublicClient,
  poolAddress: Address,
  poolMetaKey: string,
  storage: StorageAdapter,
): Promise<void> {
  const metadata = await getPoolMetadata({ client, poolAddress })

  const poolMeta: StoredPoolMeta = {
    tickSpacing: metadata.tickSpacing,
    fee: metadata.fee,
    poolId: metadata.poolId,
    collateralToken0Address: metadata.collateralToken0Address,
    collateralToken1Address: metadata.collateralToken1Address,
    riskEngineAddress: metadata.riskEngineAddress,
    token0Asset: metadata.token0Asset,
    token1Asset: metadata.token1Asset,
    token0Symbol: metadata.token0Symbol,
    token1Symbol: metadata.token1Symbol,
    token0Decimals: metadata.token0Decimals,
    token1Decimals: metadata.token1Decimals,
  }

  await storage.set(poolMetaKey, jsonSerializer.stringify(poolMeta))
}

/**
 * Retry helper with exponential backoff for transient RPC errors.
 *
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @returns The result of the function
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < maxRetries && isRetryableRpcError(error)) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
        continue
      }
      throw error
    }
  }
  throw lastError
}
