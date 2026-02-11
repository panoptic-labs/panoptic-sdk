/**
 * Pool types for the Panoptic v2 SDK.
 * @module v2/types/pool
 */

import type { Address } from 'viem'

import type { BlockMeta } from './meta'

/**
 * Pool health status.
 */
export type PoolHealthStatus = 'active' | 'low_liquidity' | 'paused'

/**
 * Collateral tracker information.
 */
export interface CollateralTracker {
  /** Address of the collateral tracker contract */
  address: Address
  /** Address of the underlying token */
  token: Address
  /** Token symbol */
  symbol: string
  /** Token decimals */
  decimals: bigint
  /** Total assets deposited */
  totalAssets: bigint
  /** Assets currently inside the AMM (deployed as liquidity) */
  insideAMM: bigint
  /** Credited shares (shares owed to liquidity providers) */
  creditedShares: bigint
  /** Total shares outstanding */
  totalShares: bigint
  /** Current utilization (0-10000 bps) */
  utilization: bigint
  /** Current borrow rate (annualized, in WAD) */
  borrowRate: bigint
  /** Current supply rate (annualized, in WAD) */
  supplyRate: bigint
}

/**
 * Risk engine information.
 */
export interface RiskEngine {
  /** Address of the risk engine contract */
  address: Address
  /** Collateral requirement factor (in bps) */
  collateralRequirement: bigint
  /** Maintenance margin factor (in bps) */
  maintenanceMargin: bigint
  /** Commission rate (in bps) */
  commissionRate: bigint
}

/**
 * Uniswap V4 pool key.
 */
export interface PoolKey {
  /** Token 0 address */
  currency0: Address
  /** Token 1 address */
  currency1: Address
  /** Fee tier */
  fee: bigint
  /** Tick spacing */
  tickSpacing: bigint
  /** Hook address (if any) */
  hooks: Address
}

/**
 * Pool data returned by getPool().
 */
export interface Pool {
  /** Address of the PanopticPool contract */
  address: Address
  /** Chain ID */
  chainId: bigint
  /** Encoded pool ID (64-bit) */
  poolId: bigint
  /** Uniswap V4 pool key */
  poolKey: PoolKey
  /** Token 0 collateral tracker */
  collateralTracker0: CollateralTracker
  /** Token 1 collateral tracker */
  collateralTracker1: CollateralTracker
  /** Risk engine */
  riskEngine: RiskEngine
  /** Current tick */
  currentTick: bigint
  /** Current sqrt price (Q64.96) */
  sqrtPriceX96: bigint
  /** Pool health status */
  healthStatus: PoolHealthStatus
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Utilization data for both tokens.
 */
export interface Utilization {
  /** Token 0 utilization (0-10000 bps) */
  utilization0: bigint
  /** Token 1 utilization (0-10000 bps) */
  utilization1: bigint
  /** Block metadata */
  _meta: BlockMeta
}
