/**
 * Chunk types for tracking position data in storage.
 * @module v2/types/chunks
 */

import type { Address, Hash } from 'viem'

/**
 * Chunk spread represents a range of ticks being tracked.
 * Used to organize position data for efficient storage and retrieval.
 */
export interface ChunkSpread {
  /** Lower tick bound (inclusive) */
  tickLower: bigint
  /** Upper tick bound (exclusive) */
  tickUpper: bigint
  /** Pool address */
  poolAddress: Address
  /** Chain ID */
  chainId: bigint
}

/**
 * Chunk key for storage lookup.
 * Format: chain{chainId}:pool{poolAddress}:chunk{tickLower}:{tickUpper}
 */
export interface ChunkKey {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Lower tick bound */
  tickLower: bigint
  /** Upper tick bound */
  tickUpper: bigint
}

/**
 * Chunk data stored in persistent storage.
 */
export interface ChunkData {
  /** The chunk key */
  key: ChunkKey
  /** Token IDs in this chunk */
  tokenIds: bigint[]
  /** Last update block number */
  lastBlock: bigint
  /** Last update block hash */
  lastBlockHash: Hash
  /** Creation timestamp */
  createdAt: bigint
  /** Last update timestamp */
  updatedAt: bigint
}

/**
 * Chunk metadata for LRU eviction.
 */
export interface ChunkMetadata {
  /** The chunk key */
  key: ChunkKey
  /** Access count for frequency-based eviction */
  accessCount: bigint
  /** Last access timestamp */
  lastAccessedAt: bigint
  /** Size in bytes (approximate) */
  sizeBytes: bigint
}

/**
 * Chunk statistics for monitoring.
 */
export interface ChunkStats {
  /** Total number of chunks */
  totalChunks: bigint
  /** Total token IDs across all chunks */
  totalTokenIds: bigint
  /** Oldest chunk timestamp */
  oldestChunk: bigint
  /** Newest chunk timestamp */
  newestChunk: bigint
  /** Average chunk size */
  avgChunkSize: bigint
}
