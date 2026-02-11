/**
 * Main position synchronization function.
 * @module v2/sync/syncPositions
 */

import type { Address, Hash, PublicClient } from 'viem'

import { isRetryableRpcError } from '../bot'
import { PositionSnapshotNotFoundError, ProviderLagError, SyncTimeoutError } from '../errors'
import { getPoolMetadata } from '../reads/pool'
import { getPositions } from '../reads/position'
import type { StorageAdapter } from '../storage'
import { getPoolMetaKey, getPositionMetaKey, getPositionsKey, jsonSerializer } from '../storage'
import type { StoredPoolMeta, StoredPositionData, SyncEvent } from '../types'
import { REORG_DEPTH } from '../utils/constants'
import { getPoolDeploymentBlock, reconstructFromEvents } from './eventReconstruction'
import { calculateResyncBlock, detectReorg, loadCheckpoint, saveCheckpoint } from './reorgHandling'
import { decodeDispatchCalldata, recoverSnapshot } from './snapshotRecovery'

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
    maxLogsPerQuery = 10000n,
    syncTimeout = 300000n, // 5 minutes
    onUpdate,
    minBlockNumber,
    snapshotTxHash,
  } = params

  const startTime = Date.now()

  // Track progress for timeout errors
  let lastProcessedBlock = 0n
  let targetBlockForTimeout = 0n

  // Check for timeout
  const checkTimeout = () => {
    const elapsed = BigInt(Date.now() - startTime)
    if (elapsed > syncTimeout) {
      const blocksRemaining =
        targetBlockForTimeout > lastProcessedBlock ? targetBlockForTimeout - lastProcessedBlock : 0n
      throw new SyncTimeoutError(elapsed, lastProcessedBlock, blocksRemaining)
    }
  }

  // Get latest block
  const latestBlock = await client.getBlockNumber()
  const toBlock = params.toBlock ?? latestBlock

  // Check for provider lag
  if (minBlockNumber !== undefined && latestBlock < minBlockNumber) {
    throw new ProviderLagError(minBlockNumber, latestBlock)
  }

  // Load existing checkpoint
  const checkpoint = await loadCheckpoint(storage, chainId, poolAddress, account)

  let positionIds: bigint[] = []
  let fromBlock: bigint
  let incremental = false
  let skipEventScan = false

  if (checkpoint) {
    // Check for reorg
    const reorgResult = await detectReorg({
      client,
      chainId,
      poolAddress,
      account,
      storage,
    })

    if (reorgResult.detected) {
      // Notify about reorg
      onUpdate?.({
        type: 'reorg-detected',
        blockNumber: reorgResult.reorgBlock ?? 0n,
      })

      // Roll back and resync from safe block
      fromBlock = calculateResyncBlock(checkpoint.lastBlock, REORG_DEPTH)
      positionIds = [] // Clear positions, will re-discover

      // If we rolled back to 0, do a full scan
      if (fromBlock === 0n) {
        const deploymentBlock = await getPoolDeploymentBlock(client, poolAddress)
        fromBlock = deploymentBlock ?? 0n
      }
    } else {
      // Incremental sync from last checkpoint
      fromBlock = checkpoint.lastBlock + 1n
      positionIds = [...checkpoint.positionIds]
      incremental = true
    }
  } else {
    // No checkpoint - need to do initial sync
    // First, quick check if account has ANY position events at all
    // This is fast because 'recipient' is indexed
    const hasAnyEvents = await accountHasPositionEvents({
      client,
      poolAddress,
      account,
      fromBlock: params.fromBlock,
      toBlock,
    })

    if (!hasAnyEvents) {
      // Account has never had any positions - short circuit
      // Save empty checkpoint at current block and return immediately
      const finalBlock = await client.getBlock({ blockNumber: toBlock })

      // Store pool metadata if not already stored
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

      const endTime = Date.now()
      return {
        lastSyncedBlock: toBlock,
        lastSyncedBlockHash: finalBlock.hash,
        positionCount: 0n,
        positionIds: [],
        incremental: false,
        durationMs: BigInt(endTime - startTime),
      }
    }

    // Try snapshot recovery first (finds most recent dispatch calldata)
    const snapshot = await recoverSnapshot({
      client,
      poolAddress,
      account,
      fromBlock: params.fromBlock,
      toBlock,
    })

    if (snapshot) {
      // Snapshot from the most recent dispatch is authoritative —
      // finalPositionIdList IS the current open position set.
      // No event scan needed since recoverSnapshot already searched
      // all events up to toBlock and found the most recent one.
      positionIds = snapshot.positionIds
      fromBlock = snapshot.blockNumber + 1n
      skipEventScan = true
    } else if (snapshotTxHash) {
      // Manual snapshot tx hash provided - decode via shared helper
      try {
        const tx = await client.getTransaction({ hash: snapshotTxHash })
        const decoded = decodeDispatchCalldata(tx.input)

        if (!decoded) {
          throw new PositionSnapshotNotFoundError()
        }

        positionIds = decoded.positionIds
        const block = await client.getBlock({
          blockNumber: tx.blockNumber ?? 0n,
        })
        fromBlock = (tx.blockNumber ?? 0n) + 1n

        // Save initial checkpoint from manual snapshot
        await saveCheckpoint({
          storage,
          chainId,
          poolAddress,
          account,
          lastBlock: tx.blockNumber ?? 0n,
          lastBlockHash: block.hash,
          positionIds,
        })
      } catch (error) {
        if (error instanceof PositionSnapshotNotFoundError) {
          throw error
        }
        throw new PositionSnapshotNotFoundError(error instanceof Error ? error : undefined)
      }
    } else {
      // No snapshot found - fall back to full event reconstruction
      const deploymentBlock =
        params.fromBlock ?? (await getPoolDeploymentBlock(client, poolAddress))
      fromBlock = deploymentBlock ?? 0n
    }
  }

  // If we need to sync (fromBlock <= toBlock) and snapshot wasn't already authoritative
  if (!skipEventScan && fromBlock <= toBlock) {
    // Update tracking for timeout errors
    targetBlockForTimeout = toBlock
    lastProcessedBlock = fromBlock

    checkTimeout()

    // Scan events incrementally
    const result = await reconstructFromEvents({
      client,
      poolAddress,
      account,
      fromBlock,
      toBlock,
      batchSize: maxLogsPerQuery,
      onProgress: (event: SyncEvent) => {
        lastProcessedBlock = event.currentBlock
        checkTimeout()
        onUpdate?.({
          type: 'progress',
          blockNumber: event.currentBlock,
          progress: {
            current: event.currentBlock - fromBlock,
            total: toBlock - fromBlock + 1n,
          },
        })
      },
    })

    // Merge with existing positions
    // Open positions: add new, keep existing that aren't in closed
    const closedSet = new Set(result.closedPositions.map((id) => id.toString()))

    // Filter out closed positions from existing
    positionIds = positionIds.filter((id) => !closedSet.has(id.toString()))

    // Add newly opened positions
    for (const newId of result.openPositions) {
      if (!positionIds.some((id) => id === newId)) {
        positionIds.push(newId)
        onUpdate?.({
          type: 'position-opened',
          tokenId: newId,
          blockNumber: result.lastBlock,
        })
      }
    }

    // Notify about closed positions
    for (const closedId of result.closedPositions) {
      onUpdate?.({
        type: 'position-closed',
        tokenId: closedId,
        blockNumber: result.lastBlock,
      })
    }
  }

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

    // Store each position's immutable data
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

  const endTime = Date.now()

  return {
    lastSyncedBlock: toBlock,
    lastSyncedBlockHash: finalBlock.hash,
    positionCount: BigInt(positionIds.length),
    positionIds,
    incremental,
    durationMs: BigInt(endTime - startTime),
  }
}

/**
 * Quick check if an account has ANY position events (OptionMinted or OptionBurnt).
 * This is fast because 'recipient' is indexed.
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

  // Query with limit: 1 to check existence quickly
  // Check OptionMinted events first (most common for accounts with positions)
  const [mintEvents, burnEvents] = await Promise.all([
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
  ])

  return mintEvents.length > 0 || burnEvents.length > 0
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

  // Parse tickSpacing and fee from poolKeyBytes
  const hex = metadata.poolKeyBytes.slice(2)
  const fee = BigInt(`0x${hex.slice(128, 192)}`)
  const tickSpacing = BigInt(`0x${hex.slice(192, 256)}`)

  const poolMeta: StoredPoolMeta = {
    tickSpacing,
    fee,
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
