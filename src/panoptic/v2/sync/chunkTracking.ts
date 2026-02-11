/**
 * Chunk spread tracking for volatility surface data.
 * @module v2/sync/chunkTracking
 */

import type { Address, PublicClient } from 'viem'

import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients/blockMeta'
import { ChunkLimitError } from '../errors'
import type { StorageAdapter } from '../storage'
import { getTrackedChunksKey, jsonSerializer } from '../storage'
import type { BlockMeta } from '../types'
import { MAX_TRACKED_CHUNKS, WAD } from '../utils/constants'

/**
 * Key for identifying a liquidity chunk.
 * A chunk is a unique combination of (tokenType, tickLower, tickUpper).
 */
export interface LiquidityChunkKey {
  /** Token type: 0n = token0 (put), 1n = token1 (call) */
  tokenType: 0n | 1n
  /** Lower tick bound */
  tickLower: bigint
  /** Upper tick bound */
  tickUpper: bigint
}

/**
 * Full chunk data with spread calculation.
 */
export interface LiquidityChunkSpread extends LiquidityChunkKey {
  /** Liquidity currently deployed in Uniswap */
  netLiquidity: bigint
  /** Liquidity borrowed by option buyers */
  removedLiquidity: bigint
  /** Computed spread: (1 + (1/VEGOID) * removed/net) * 1e18 */
  spreadWad: bigint
}

/**
 * Parameters for adding tracked chunks.
 */
export interface AddTrackedChunksParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Storage adapter */
  storage: StorageAdapter
  /** Chunks to add */
  chunks: LiquidityChunkKey[]
}

/**
 * Serialize a chunk key to a string for storage/comparison.
 */
function serializeChunkKey(chunk: LiquidityChunkKey): string {
  return `${chunk.tokenType}:${chunk.tickLower}:${chunk.tickUpper}`
}

/**
 * Deserialize a chunk key from a string.
 */
function deserializeChunkKey(key: string): LiquidityChunkKey {
  const [tokenType, tickLower, tickUpper] = key.split(':')
  return {
    tokenType: BigInt(tokenType) as 0n | 1n,
    tickLower: BigInt(tickLower),
    tickUpper: BigInt(tickUpper),
  }
}

/**
 * Add chunks to tracking.
 *
 * @param params - Parameters
 * @throws ChunkLimitError if adding would exceed 1000 chunks
 */
export async function addTrackedChunks(params: AddTrackedChunksParams): Promise<void> {
  const { chainId, poolAddress, storage, chunks } = params

  const key = getTrackedChunksKey(chainId, poolAddress)
  const existingData = await storage.get(key)

  let trackedKeys: Set<string>
  if (existingData) {
    try {
      const keys = jsonSerializer.parse(existingData) as string[]
      trackedKeys = new Set(keys)
    } catch {
      trackedKeys = new Set()
    }
  } else {
    trackedKeys = new Set()
  }

  // Add new chunks
  for (const chunk of chunks) {
    const serialized = serializeChunkKey(chunk)
    trackedKeys.add(serialized)
  }

  // Check limit
  if (trackedKeys.size > MAX_TRACKED_CHUNKS) {
    const attemptedAdd = BigInt(chunks.length)
    throw new ChunkLimitError(BigInt(trackedKeys.size - chunks.length), attemptedAdd)
  }

  await storage.set(key, jsonSerializer.stringify([...trackedKeys]))
}

/**
 * Parameters for removing tracked chunks.
 */
export interface RemoveTrackedChunksParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Storage adapter */
  storage: StorageAdapter
  /** Chunks to remove */
  chunks: LiquidityChunkKey[]
}

/**
 * Remove chunks from tracking.
 *
 * @param params - Parameters
 */
export async function removeTrackedChunks(params: RemoveTrackedChunksParams): Promise<void> {
  const { chainId, poolAddress, storage, chunks } = params

  const key = getTrackedChunksKey(chainId, poolAddress)
  const existingData = await storage.get(key)

  if (!existingData) {
    return
  }

  let trackedKeys: Set<string>
  try {
    const keys = jsonSerializer.parse(existingData) as string[]
    trackedKeys = new Set(keys)
  } catch {
    return
  }

  // Remove chunks
  for (const chunk of chunks) {
    const serialized = serializeChunkKey(chunk)
    trackedKeys.delete(serialized)
  }

  if (trackedKeys.size === 0) {
    await storage.delete(key)
  } else {
    await storage.set(key, jsonSerializer.stringify([...trackedKeys]))
  }
}

/**
 * Parameters for getting tracked chunks.
 */
export interface GetTrackedChunksParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Storage adapter */
  storage: StorageAdapter
}

/**
 * Get all tracked chunk keys.
 *
 * @param params - Parameters
 * @returns Array of tracked chunk keys
 */
export async function getTrackedChunks(
  params: GetTrackedChunksParams,
): Promise<LiquidityChunkKey[]> {
  const { chainId, poolAddress, storage } = params

  const key = getTrackedChunksKey(chainId, poolAddress)
  const data = await storage.get(key)

  if (!data) {
    return []
  }

  try {
    const keys = jsonSerializer.parse(data) as string[]
    return keys.map(deserializeChunkKey)
  } catch {
    return []
  }
}

/**
 * Parameters for getting chunk spreads (legacy manual tracking).
 * @deprecated Use scanChunks() for automatic chunk discovery
 */
export interface GetChunkSpreadsParams {
  /** viem public client */
  client: PublicClient
  /** Chain ID */
  chainId: bigint
  /** Pool address (PanopticPool) */
  poolAddress: Address
  /** SFPM address */
  sfpmAddress: Address
  /** Storage adapter */
  storage: StorageAdapter
  /** Optional filter by token type */
  tokenType?: 0n | 1n
  /** VEGOID constant (default: 4n) */
  vegoid?: bigint
}

/**
 * Get spread data for all tracked chunks (legacy).
 *
 * @deprecated Use scanChunks() for automatic chunk discovery with on-chain data.
 * This function only returns manually tracked chunks.
 *
 * @param params - Parameters
 * @returns Array of chunk spreads with liquidity data
 */
export async function getChunkSpreads(
  params: GetChunkSpreadsParams,
): Promise<LiquidityChunkSpread[]> {
  const { chainId, poolAddress, storage, tokenType } = params

  // Get tracked chunks
  let chunks = await getTrackedChunks({ chainId, poolAddress, storage })

  // Apply filter
  if (tokenType !== undefined) {
    chunks = chunks.filter((c) => c.tokenType === tokenType)
  }

  if (chunks.length === 0) {
    return []
  }

  // Return tracked chunks without liquidity data
  // Use scanChunks() for on-chain liquidity data
  return chunks.map((chunk) => ({
    ...chunk,
    netLiquidity: 0n,
    removedLiquidity: 0n,
    spreadWad: WAD,
  }))
}

/**
 * Calculate spread from liquidity values.
 *
 * spread = 1 + (1/VEGOID) * removedLiquidity / netLiquidity
 *
 * @param netLiquidity - Liquidity in Uniswap
 * @param removedLiquidity - Liquidity borrowed by buyers
 * @param vegoid - VEGOID constant (default: 4n)
 * @returns Spread in WAD (1e18 = 1.0x)
 */
export function calculateSpreadWad(
  netLiquidity: bigint,
  removedLiquidity: bigint,
  vegoid: bigint = 4n,
): bigint {
  if (netLiquidity === 0n) {
    return WAD // 1.0x spread if no liquidity
  }

  // spread = WAD + (WAD / vegoid) * removedLiquidity / netLiquidity
  // = WAD + (WAD * removedLiquidity) / (vegoid * netLiquidity)
  const bonus = (WAD * removedLiquidity) / (vegoid * netLiquidity)
  return WAD + bonus
}

/**
 * Clear all tracked chunks for a pool.
 *
 * @param params - Parameters
 */
export async function clearTrackedChunks(params: GetTrackedChunksParams): Promise<void> {
  const { chainId, poolAddress, storage } = params

  const key = getTrackedChunksKey(chainId, poolAddress)
  await storage.delete(key)
}

// ============================================================================
// PanopticQuery-based chunk functions (recommended)
// ============================================================================

/**
 * Scanned chunk with liquidity data from PanopticQuery.scanChunks().
 */
export interface ScannedChunk {
  /** Strike tick (center of the chunk) */
  strike: bigint
  /** Token type 0 net liquidity */
  netLiquidity0: bigint
  /** Token type 1 net liquidity */
  netLiquidity1: bigint
  /** Token type 0 removed liquidity */
  removedLiquidity0: bigint
  /** Token type 1 removed liquidity */
  removedLiquidity1: bigint
  /** Computed spread for token type 0 */
  spreadWad0: bigint
  /** Computed spread for token type 1 */
  spreadWad1: bigint
  /** Token type 0 settled tokens (LeftRightUnsigned: left=token1, right=token0) */
  settledTokens0: bigint
  /** Token type 1 settled tokens (LeftRightUnsigned: left=token1, right=token0) */
  settledTokens1: bigint
}

/**
 * Result of scanning chunks in a tick range.
 */
export interface ScanChunksResult {
  /** Array of scanned chunks with liquidity data */
  chunks: ScannedChunk[]
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for scanChunks().
 */
export interface ScanChunksParams {
  /** viem public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** PanopticQuery contract address */
  queryAddress: Address
  /** Lower tick bound of range to scan */
  tickLower: bigint
  /** Upper tick bound of range to scan */
  tickUpper: bigint
  /** Width of chunks to scan (tickUpper - tickLower for each chunk) */
  width: bigint
  /** VEGOID constant for spread calculation (default: 4n) */
  vegoid?: bigint
  /** Optional block number for historical queries */
  blockNumber?: bigint
}

/**
 * Scan for non-empty liquidity chunks in a tick range.
 *
 * Uses PanopticQuery.scanChunks() to discover chunks with liquidity.
 * Returns only non-empty chunks, making it efficient for large ranges.
 *
 * ## Same-Block Guarantee
 * All data is fetched at a single block.
 *
 * @param params - Parameters
 * @returns Scanned chunks with liquidity data and block metadata
 *
 * @example
 * ```typescript
 * const result = await scanChunks({
 *   client,
 *   poolAddress: '0x...',
 *   queryAddress: '0x...',
 *   tickLower: -1000n,
 *   tickUpper: 1000n,
 *   width: 100n,  // 100 tick wide chunks
 * })
 *
 * for (const chunk of result.chunks) {
 *   console.log(`Strike ${chunk.strike}: spread0=${chunk.spreadWad0}, spread1=${chunk.spreadWad1}`)
 * }
 * ```
 */
export async function scanChunks(params: ScanChunksParams): Promise<ScanChunksResult> {
  const {
    client,
    poolAddress,
    queryAddress,
    tickLower,
    tickUpper,
    width,
    vegoid = 4n,
    blockNumber,
  } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'scanChunks',
      args: [poolAddress, Number(tickLower), Number(tickUpper), Number(width)],
      blockNumber: targetBlockNumber,
    }),
    getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [strikes, netLiquidities, removedLiquidities, settledTokens] = result

  const chunks: ScannedChunk[] = strikes.map((strike, i) => {
    const net0 = netLiquidities[i][0]
    const net1 = netLiquidities[i][1]
    const removed0 = removedLiquidities[i][0]
    const removed1 = removedLiquidities[i][1]

    return {
      strike: BigInt(strike),
      netLiquidity0: net0,
      netLiquidity1: net1,
      removedLiquidity0: removed0,
      removedLiquidity1: removed1,
      spreadWad0: calculateSpreadWad(net0, removed0, vegoid),
      spreadWad1: calculateSpreadWad(net1, removed1, vegoid),
      settledTokens0: settledTokens[i][0],
      settledTokens1: settledTokens[i][1],
    }
  })

  return { chunks, _meta }
}

/**
 * Chunk data for a single leg of a position.
 */
export interface LegChunkData {
  /** Leg index (0-3) */
  legIndex: number
  /** Net liquidity (liquidity in Uniswap) */
  netLiquidity: bigint
  /** Removed liquidity (borrowed by option buyers) */
  removedLiquidity: bigint
  /** Computed spread */
  spreadWad: bigint
}

/**
 * Chunk data for a position (all legs).
 */
export interface PositionChunkData {
  /** TokenId of the position */
  tokenId: bigint
  /** Chunk data for each leg */
  legs: LegChunkData[]
}

/**
 * Result of getting position chunk data.
 */
export interface GetPositionChunkDataResult {
  /** Array of position chunk data */
  positions: PositionChunkData[]
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for getPositionChunkData().
 */
export interface GetPositionChunkDataParams {
  /** viem public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** PanopticQuery contract address */
  queryAddress: Address
  /** Array of tokenIds to query */
  tokenIds: bigint[]
  /** VEGOID constant for spread calculation (default: 4n) */
  vegoid?: bigint
  /** Optional block number for historical queries */
  blockNumber?: bigint
}

/**
 * Get chunk data (liquidity) for specific positions.
 *
 * Uses PanopticQuery.getChunkData() to fetch net and removed liquidity
 * for each leg of the given positions.
 *
 * ## Same-Block Guarantee
 * All data is fetched at a single block.
 *
 * @param params - Parameters
 * @returns Position chunk data with liquidity for each leg
 *
 * @example
 * ```typescript
 * const result = await getPositionChunkData({
 *   client,
 *   poolAddress: '0x...',
 *   queryAddress: '0x...',
 *   tokenIds: [tokenId1, tokenId2],
 * })
 *
 * for (const pos of result.positions) {
 *   console.log(`Position ${pos.tokenId}:`)
 *   for (const leg of pos.legs) {
 *     console.log(`  Leg ${leg.legIndex}: net=${leg.netLiquidity}, removed=${leg.removedLiquidity}`)
 *   }
 * }
 * ```
 */
export async function getPositionChunkData(
  params: GetPositionChunkDataParams,
): Promise<GetPositionChunkDataResult> {
  const { client, poolAddress, queryAddress, tokenIds, vegoid = 4n, blockNumber } = params

  if (tokenIds.length === 0) {
    const _meta = await getBlockMeta({ client, blockNumber })
    return { positions: [], _meta }
  }

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())

  const [chunkData, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getChunkData',
      args: [poolAddress, tokenIds],
      blockNumber: targetBlockNumber,
    }),
    getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // chunkData is uint256[2][4][] - [positionIndex][legIndex][0=net, 1=removed]
  const positions: PositionChunkData[] = tokenIds.map((tokenId, posIndex) => {
    const positionData = chunkData[posIndex]
    const legs: LegChunkData[] = []

    // Each position has up to 4 legs
    for (let legIndex = 0; legIndex < 4; legIndex++) {
      const legData = positionData[legIndex]
      const netLiquidity = legData[0]
      const removedLiquidity = legData[1]

      // Only include legs with data (non-zero liquidity indicates active leg)
      if (netLiquidity > 0n || removedLiquidity > 0n) {
        legs.push({
          legIndex,
          netLiquidity,
          removedLiquidity,
          spreadWad: calculateSpreadWad(netLiquidity, removedLiquidity, vegoid),
        })
      }
    }

    return { tokenId, legs }
  })

  return { positions, _meta }
}
