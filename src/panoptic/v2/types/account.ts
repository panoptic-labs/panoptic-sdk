/**
 * Account types for the Panoptic v2 SDK.
 * @module v2/types/account
 */

import type { Address } from 'viem'

import type { BlockMeta } from './meta'
import type { Pool, PoolHealthStatus } from './pool'
import type { Position, PositionGreeks } from './position'

/**
 * Collateral data for a single token.
 */
export interface TokenCollateral {
  /** Total assets deposited (in underlying token) */
  assets: bigint
  /** Collateral shares owned */
  shares: bigint
  /** Available (unlocked) assets */
  availableAssets: bigint
  /** Locked assets (used as collateral for positions) */
  lockedAssets: bigint
}

/**
 * Account collateral data for both tokens.
 */
export interface AccountCollateral {
  /** Account address */
  account: Address
  /** Pool address */
  poolAddress: Address
  /** Token 0 collateral */
  token0: TokenCollateral
  /** Token 1 collateral */
  token1: TokenCollateral
  /** Number of open position legs */
  legCount: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Base account summary for UI dashboards.
 *
 * This shape contains non-helper-dependent data only.
 */
export interface AccountSummaryBasic {
  /** Account address */
  account: Address
  /** Pool data */
  pool: Pool
  /** Collateral data */
  collateral: AccountCollateral
  /** Open positions */
  positions: Position[]
  /** Health status of the pool */
  healthStatus: PoolHealthStatus
  /** Whether wallet is on wrong network */
  networkMismatch: boolean
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Risk-focused account summary for UI dashboards and bots.
 *
 * Includes everything in AccountSummaryBasic plus helper-dependent risk fields.
 */
export interface AccountSummaryRisk extends AccountSummaryBasic {
  /** Total position greeks */
  totalGreeks: PositionGreeks
  /** Net liquidation value for token 0 */
  netLiquidationValue0: bigint
  /** Net liquidation value for token 1 */
  netLiquidationValue1: bigint
  /** Maintenance margin required for token 0 */
  maintenanceMargin0: bigint
  /** Maintenance margin required for token 1 */
  maintenanceMargin1: bigint
  /** Margin excess (positive) or deficit (negative) for token 0 */
  marginExcess0: bigint
  /** Margin excess (positive) or deficit (negative) for token 1 */
  marginExcess1: bigint
  /** Margin shortfall for token 0 (positive shortfall, negative excess) */
  marginShortfall0: bigint
  /** Margin shortfall for token 1 (positive shortfall, negative excess) */
  marginShortfall1: bigint
  /** Current margin (collateral balance) for token 0 */
  currentMargin0: bigint
  /** Current margin (collateral balance) for token 1 */
  currentMargin1: bigint
  /** Whether the account is liquidatable */
  isLiquidatable: boolean
  /** Liquidation price bounds */
  liquidationPrices: LiquidationPrices
}

/**
 * Net liquidation value result.
 */
export interface NetLiquidationValue {
  /** Net liquidation value for token 0 */
  value0: bigint
  /** Net liquidation value for token 1 */
  value1: bigint
  /** Tick used for calculation */
  atTick: bigint
  /** Whether pending premium was included */
  includedPendingPremium: boolean
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Liquidation prices result.
 */
export interface LiquidationPrices {
  /** Lower liquidation tick (null if position is safe at MIN_TICK) */
  lowerTick: bigint | null
  /** Upper liquidation tick (null if position is safe at MAX_TICK) */
  upperTick: bigint | null
  /** Whether the account is currently liquidatable */
  isLiquidatable: boolean
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Collateral estimate for a potential position.
 */
export interface CollateralEstimate {
  /** Required collateral for token 0 */
  required0: bigint
  /** Required collateral for token 1 */
  required1: bigint
  /** Post-position margin excess for token 0 */
  postMarginExcess0: bigint
  /** Post-position margin excess for token 1 */
  postMarginExcess1: bigint
  /** Whether the position would be openable */
  canOpen: boolean
  /** Block metadata */
  _meta: BlockMeta
}
