/**
 * Storage key generation for the Panoptic v2 SDK.
 * @module v2/storage/keys
 */

import type { Address } from 'viem'

import { SCHEMA_VERSION, STORAGE_PREFIX } from '../utils/constants'

/**
 * Get the schema version key.
 */
export function getSchemaVersionKey(): string {
  return `${STORAGE_PREFIX}:schemaVersion`
}

/**
 * Get the base prefix for a specific pool.
 */
export function getPoolPrefix(chainId: bigint, poolAddress: Address): string {
  return `${STORAGE_PREFIX}:v${SCHEMA_VERSION}:chain${chainId}:pool${poolAddress.toLowerCase()}`
}

/**
 * Get the key for tracked position IDs.
 */
export function getPositionsKey(chainId: bigint, poolAddress: Address, account: Address): string {
  return `${getPoolPrefix(chainId, poolAddress)}:positions:${account.toLowerCase()}`
}

/**
 * Get the key for position mint metadata.
 */
export function getPositionMetaKey(chainId: bigint, poolAddress: Address, tokenId: bigint): string {
  return `${getPoolPrefix(chainId, poolAddress)}:positionMeta:${tokenId.toString()}`
}

/**
 * Get the key for sync checkpoint.
 */
export function getSyncCheckpointKey(
  chainId: bigint,
  poolAddress: Address,
  account: Address,
): string {
  return `${getPoolPrefix(chainId, poolAddress)}:sync:${account.toLowerCase()}`
}

/**
 * Get the key for closed positions.
 */
export function getClosedPositionsKey(
  chainId: bigint,
  poolAddress: Address,
  account: Address,
): string {
  return `${getPoolPrefix(chainId, poolAddress)}:closed:${account.toLowerCase()}`
}

/**
 * Get the key for tracked chunks.
 */
export function getTrackedChunksKey(chainId: bigint, poolAddress: Address): string {
  return `${getPoolPrefix(chainId, poolAddress)}:chunks`
}

/**
 * Get the key for pending positions.
 */
export function getPendingPositionsKey(
  chainId: bigint,
  poolAddress: Address,
  account: Address,
): string {
  return `${getPoolPrefix(chainId, poolAddress)}:pending:${account.toLowerCase()}`
}

/**
 * Get the key for pool metadata (tickSpacing, etc.).
 */
export function getPoolMetaKey(chainId: bigint, poolAddress: Address): string {
  return `${getPoolPrefix(chainId, poolAddress)}:poolMeta`
}
