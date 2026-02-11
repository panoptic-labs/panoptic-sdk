/**
 * Event reconstruction for full position history scan.
 * @module v2/sync/eventReconstruction
 */

import type { Address, Hash, PublicClient } from 'viem'

import type { SyncEvent } from '../types'

/**
 * Parameters for event reconstruction.
 */
export interface EventReconstructionParams {
  /** viem public client */
  client: PublicClient
  /** Pool address */
  poolAddress: Address
  /** Account to reconstruct positions for */
  account: Address
  /** Starting block for event scan */
  fromBlock: bigint
  /** Ending block for event scan */
  toBlock: bigint
  /** Batch size for log queries (default: 10000) */
  batchSize?: bigint
  /** Progress callback */
  onProgress?: (event: SyncEvent) => void
}

/**
 * Event reconstruction result.
 */
export interface EventReconstructionResult {
  /** Position IDs that are currently open */
  openPositions: bigint[]
  /** Position IDs that have been closed */
  closedPositions: bigint[]
  /** Number of blocks scanned */
  blocksScanned: bigint
  /** Last scanned block number */
  lastBlock: bigint
  /** Last scanned block hash */
  lastBlockHash: Hash
}

/**
 * Mint event from reconstruction.
 */
interface MintEvent {
  tokenId: bigint
  positionSize: bigint
  blockNumber: bigint
  blockHash: Hash
  transactionHash: Hash
  logIndex: number
}

/**
 * Burn event from reconstruction.
 */
interface BurnEvent {
  tokenId: bigint
  positionSize: bigint
  blockNumber: bigint
  blockHash: Hash
  transactionHash: Hash
  logIndex: number
}

/**
 * Reconstruct position history from events.
 * This is the fallback method when snapshot recovery fails.
 * It scans all OptionMinted and OptionBurnt events to build the position set.
 *
 * @param params - Reconstruction parameters
 * @returns Reconstruction result with open and closed positions
 */
export async function reconstructFromEvents(
  params: EventReconstructionParams,
): Promise<EventReconstructionResult> {
  const {
    client,
    poolAddress,
    account,
    fromBlock,
    toBlock,
    batchSize = 10000n,
    onProgress,
  } = params

  const mintEvents: MintEvent[] = []
  const burnEvents: BurnEvent[] = []

  let currentBlock = fromBlock
  const totalBlocks = toBlock - fromBlock

  // Scan in batches
  while (currentBlock <= toBlock) {
    const endBlock =
      currentBlock + batchSize - 1n > toBlock ? toBlock : currentBlock + batchSize - 1n

    // Fetch mint events for this batch
    const [mints, burns] = await Promise.all([
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
        fromBlock: currentBlock,
        toBlock: endBlock,
      }),
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
        fromBlock: currentBlock,
        toBlock: endBlock,
      }),
    ])

    // Process mint events
    for (const mint of mints) {
      // Decode position size from balanceData (first 128 bits)
      const balanceData = mint.args.balanceData as bigint
      const positionSize = balanceData & ((1n << 128n) - 1n)

      mintEvents.push({
        tokenId: mint.args.tokenId as bigint,
        positionSize,
        blockNumber: mint.blockNumber,
        blockHash: mint.blockHash,
        transactionHash: mint.transactionHash,
        logIndex: mint.logIndex,
      })
    }

    // Process burn events
    for (const burn of burns) {
      burnEvents.push({
        tokenId: burn.args.tokenId as bigint,
        positionSize: burn.args.positionSize as bigint,
        blockNumber: burn.blockNumber,
        blockHash: burn.blockHash,
        transactionHash: burn.transactionHash,
        logIndex: burn.logIndex,
      })
    }

    // Report progress
    if (onProgress) {
      const blocksProcessed = endBlock - fromBlock + 1n
      const progress = totalBlocks > 0n ? (blocksProcessed * 100n) / totalBlocks : 100n

      onProgress({
        currentBlock: endBlock,
        targetBlock: toBlock,
        positionsFound: BigInt(mintEvents.length),
        progress,
      })
    }

    currentBlock = endBlock + 1n
  }

  // Build position map: tokenId -> net position size
  const positionMap = new Map<bigint, bigint>()

  // Sort all events by block and log index
  const allEvents = [
    ...mintEvents.map((e) => ({ ...e, type: 'mint' as const })),
    ...burnEvents.map((e) => ({ ...e, type: 'burn' as const })),
  ].sort((a, b) => {
    const blockDiff = Number(a.blockNumber - b.blockNumber)
    if (blockDiff !== 0) return blockDiff
    return a.logIndex - b.logIndex
  })

  // Process events in order
  for (const event of allEvents) {
    const current = positionMap.get(event.tokenId) ?? 0n

    if (event.type === 'mint') {
      positionMap.set(event.tokenId, current + event.positionSize)
    } else {
      positionMap.set(event.tokenId, current - event.positionSize)
    }
  }

  // Separate open and closed positions
  const openPositions: bigint[] = []
  const closedPositions: bigint[] = []

  for (const [tokenId, size] of positionMap) {
    if (size > 0n) {
      openPositions.push(tokenId)
    } else {
      closedPositions.push(tokenId)
    }
  }

  // Get the last block hash
  const lastBlock = await client.getBlock({ blockNumber: toBlock })

  return {
    openPositions,
    closedPositions,
    blocksScanned: toBlock - fromBlock + 1n,
    lastBlock: toBlock,
    lastBlockHash: lastBlock.hash,
  }
}

/**
 * Get the deployment block for a pool.
 * This searches for the first PoolInitialized event.
 *
 * @param client - viem public client
 * @param poolAddress - Pool address
 * @returns Deployment block number or null if not found
 */
export async function getPoolDeploymentBlock(
  client: PublicClient,
  poolAddress: Address,
): Promise<bigint | null> {
  // Search for the first event from this pool
  // We use a binary search approach to find the deployment block

  const currentBlock = await client.getBlockNumber()
  let low = 0n
  let high = currentBlock
  let foundBlock: bigint | null = null

  // Binary search with scan windows to find the deployment block.
  // Each iteration checks [mid, mid + scanRange] for logs.
  const scanRange = 10000n

  while (low <= high) {
    const mid = (low + high) / 2n
    const rangeEnd = mid + scanRange > high ? high : mid + scanRange

    try {
      const logs = await client.getLogs({
        address: poolAddress,
        fromBlock: mid,
        toBlock: rangeEnd,
      })

      if (logs.length > 0) {
        // Found logs — record earliest and search before it
        const earliest = logs[0].blockNumber
        if (foundBlock === null || earliest < foundBlock) {
          foundBlock = earliest
        }
        high = earliest - 1n
      } else {
        // No logs in [mid, rangeEnd] — skip the entire checked range
        low = rangeEnd + 1n
      }
    } catch {
      // Range too large for RPC — halve the search space
      high = mid + (rangeEnd - mid) / 2n
    }
  }

  return foundBlock
}
