/**
 * Event reconstruction for full position history scan.
 * @module v2/sync/eventReconstruction
 */

import type { Address, Hash, PublicClient } from 'viem'
import { getAbiItem } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import type { SyncEvent } from '../types'

type EventReconstructionClient = Pick<PublicClient, 'getBlock' | 'getLogs'>

/**
 * Parameters for event reconstruction.
 */
export interface EventReconstructionParams {
  /** viem public client */
  client: EventReconstructionClient
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
  const totalBlocks = toBlock - fromBlock + 1n
  const safeBatchSize = batchSize > 0n ? batchSize : 10000n

  const scanRange = async (rangeFromBlock: bigint, rangeToBlock: bigint) => {
    const [mints, burns] = await Promise.all([
      client.getLogs({
        address: poolAddress,
        event: OPTION_MINTED_EVENT,
        args: { recipient: account },
        fromBlock: rangeFromBlock,
        toBlock: rangeToBlock,
      }),
      client.getLogs({
        address: poolAddress,
        event: OPTION_BURNT_EVENT,
        args: { recipient: account },
        fromBlock: rangeFromBlock,
        toBlock: rangeToBlock,
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

    const blocksProcessed = rangeToBlock - fromBlock + 1n
    const progress = totalBlocks > 0n ? (blocksProcessed * 100n) / totalBlocks : 100n
    onProgress?.({
      currentBlock: rangeToBlock,
      targetBlock: toBlock,
      positionsFound: BigInt(mintEvents.length),
      progress: progress > 100n ? 100n : progress,
    })
  }

  // Account and pool topics make this query selective enough for providers that
  // permit wide eth_getLogs ranges. This keeps the fallback practical on mainnet.
  // Providers with an explicit range cap fall back to bounded requests.
  try {
    await scanRange(fromBlock, toBlock)
  } catch (error) {
    if (!isRangeLimitError(error)) throw error

    let currentBlock = fromBlock
    while (currentBlock <= toBlock) {
      const endBlock =
        currentBlock + safeBatchSize - 1n > toBlock ? toBlock : currentBlock + safeBatchSize - 1n
      await scanRange(currentBlock, endBlock)
      currentBlock = endBlock + 1n
    }
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

const OPTION_MINTED_EVENT = getAbiItem({ abi: panopticPoolV2Abi, name: 'OptionMinted' })
const OPTION_BURNT_EVENT = getAbiItem({ abi: panopticPoolV2Abi, name: 'OptionBurnt' })

function isRangeLimitError(error: unknown): boolean {
  const messages: string[] = []
  let current: unknown = error
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth += 1) {
    if ('message' in current && typeof current.message === 'string') {
      messages.push(current.message)
    }
    if ('details' in current && typeof current.details === 'string') {
      messages.push(current.details)
    }
    current = 'cause' in current ? current.cause : undefined
  }
  if (typeof error === 'string') messages.push(error)

  const message = messages.join(' ').toLowerCase()
  return (
    message.includes('block range') ||
    message.includes('range is too large') ||
    message.includes('range too large') ||
    message.includes('query returned more than') ||
    message.includes('too many results') ||
    message.includes('log response size exceeded') ||
    message.includes('exceeds the limit') ||
    (message.includes('range') && message.includes('limit'))
  )
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
