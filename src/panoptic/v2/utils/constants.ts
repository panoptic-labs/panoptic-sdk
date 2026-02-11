/**
 * Constants for the Panoptic v2 SDK.
 * @module v2/utils/constants
 */

/**
 * WAD constant (10^18) used for fixed-point arithmetic.
 * Commonly used for spread calculations and other WAD-scaled values.
 */
export const WAD = 10n ** 18n

/**
 * Zero collateral object for guest mode.
 * Returns safe defaults when no wallet is connected.
 */
export const ZERO_COLLATERAL = {
  token0: {
    assets: 0n,
    shares: 0n,
    availableAssets: 0n,
    lockedAssets: 0n,
  },
  token1: {
    assets: 0n,
    shares: 0n,
    availableAssets: 0n,
    lockedAssets: 0n,
  },
} as const

/**
 * Zero valuation object for guest mode.
 * Returns safe defaults when no wallet is connected.
 */
export const ZERO_VALUATION = {
  netLiquidationValue0: 0n,
  netLiquidationValue1: 0n,
  maintenanceMargin0: 0n,
  maintenanceMargin1: 0n,
  marginExcess0: 0n,
  marginExcess1: 0n,
} as const

/**
 * Storage schema version for the SDK.
 * Increment when storage format changes (triggers migration or clear).
 */
export const SCHEMA_VERSION = 1

/**
 * Storage key prefix for all SDK data.
 */
export const STORAGE_PREFIX = 'panoptic-v2-sdk'

/**
 * Maximum number of chunks that can be tracked per pool.
 * Exceeding this limit throws ChunkLimitError.
 */
export const MAX_TRACKED_CHUNKS = 1000

/**
 * Default reorg depth for chain reorganization handling.
 * On reorg detection, rollback this many blocks and re-sync.
 */
export const REORG_DEPTH = 128n

/**
 * Oracle epoch duration in seconds (64 seconds per epoch).
 */
export const ORACLE_EPOCH_SECONDS = 64n

/**
 * Minimum tick value for Uniswap v3/v4 pools.
 */
export const MIN_TICK = -887272n

/**
 * Maximum tick value for Uniswap v3/v4 pools.
 */
export const MAX_TICK = 887272n

/**
 * Basis points denominator (100% = 10000 bps).
 */
export const BPS_DENOMINATOR = 10000n

/**
 * Utilization denominator (100% = 10000).
 */
export const UTILIZATION_DENOMINATOR = 10000n
