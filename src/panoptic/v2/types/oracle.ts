/**
 * Oracle and safe mode types for the Panoptic v2 SDK.
 * @module v2/types/oracle
 */

import type { BlockMeta } from './meta'

/**
 * Safe mode level from the RiskEngine.
 */
export type SafeMode = 'normal' | 'restricted' | 'emergency'

/**
 * Oracle state from the PanopticPool.
 */
export interface OracleState {
  /** Last update epoch (64-second intervals) */
  epoch: bigint
  /** Last update timestamp */
  lastUpdateTimestamp: bigint
  /** Reference tick */
  referenceTick: bigint
  /** Spot EMA tick */
  spotEMA: bigint
  /** Fast EMA tick */
  fastEMA: bigint
  /** Slow EMA tick */
  slowEMA: bigint
  /** Eons EMA tick */
  eonsEMA: bigint
  /** Lock mode (0 = unlocked, 1 = spot locked, 2 = full locked) */
  lockMode: bigint
  /** Median tick from sorted observations */
  medianTick: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Safe mode state from the RiskEngine.
 */
export interface SafeModeState {
  /** Current safe mode level */
  mode: SafeMode
  /** Whether minting new positions is allowed */
  canMint: boolean
  /** Whether burning positions is allowed */
  canBurn: boolean
  /** Whether force exercise is allowed */
  canForceExercise: boolean
  /** Whether liquidations are allowed */
  canLiquidate: boolean
  /** Reason for current safe mode (if not normal) */
  reason?: string
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Risk parameters from the RiskEngine.
 */
export interface RiskParameters {
  /** Collateral requirement multiplier (in bps, e.g., 10000 = 100%) */
  collateralRequirement: bigint
  /** Maintenance margin requirement (in bps) */
  maintenanceMargin: bigint
  /** Commission rate (in bps) */
  commissionRate: bigint
  /** Target pool utilization (in bps) */
  targetUtilization: bigint
  /** Saturated pool utilization threshold (in bps) */
  saturatedUtilization: bigint
  /** ITM spread multiplier */
  itmSpreadMultiplier: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Current interest rates from the CollateralTrackers.
 */
export interface CurrentRates {
  /** Token 0 borrow rate (annualized, in WAD) */
  borrowRate0: bigint
  /** Token 0 supply rate (annualized, in WAD) */
  supplyRate0: bigint
  /** Token 1 borrow rate (annualized, in WAD) */
  borrowRate1: bigint
  /** Token 1 supply rate (annualized, in WAD) */
  supplyRate1: bigint
  /** Block metadata */
  _meta: BlockMeta
}
