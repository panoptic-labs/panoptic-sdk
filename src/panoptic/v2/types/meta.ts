/**
 * Block metadata types for the Panoptic v2 SDK.
 * @module v2/types/meta
 */

/**
 * Block metadata attached to all RPC responses.
 * Used for freshness checks and reorg detection.
 */
export interface BlockMeta {
  /** Block number when the data was fetched */
  blockNumber: bigint
  /** Block timestamp in Unix seconds */
  blockTimestamp: bigint
  /** Block hash for reorg detection */
  blockHash: `0x${string}`
  /** Whether the data is considered stale */
  isStale?: boolean
}
