/**
 * Oracle and safe mode types for the Panoptic v2 SDK.
 * @module v2/types/oracle
 */

import type { BlockMeta } from './meta'
import type { MintBufferRatio } from './mintBuffer'

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
  /**
   * Live pool tick returned by getOracleTicks (legacy alias for currentTick).
   * @deprecated Use currentTick for the live tick or oracleReferenceTick for the packed reference.
   */
  referenceTick: bigint
  /** Live pool tick returned by getOracleTicks */
  currentTick: bigint
  /** Reference tick used to encode the OraclePack residual queue */
  oracleReferenceTick: bigint
  /** Latest observation stored in the queue */
  latestTick: bigint
  /** TWAP tick returned by PanopticPool.getTWAP() */
  twapTick: bigint
  /** Spot EMA tick */
  spotEMA: bigint
  /** Fast EMA tick */
  fastEMA: bigint
  /** Slow EMA tick */
  slowEMA: bigint
  /** Eons EMA tick */
  eonsEMA: bigint
  /** Guardian lock mode (0 = unlocked, 3 = close-only lock) */
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
  /** Raw additive SafeMode value returned by PanopticPool.isSafeMode(). */
  level: bigint
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
  /** Whether swapAtMint is allowed (false for NO_SWAP level 2+) */
  canSwapAtMint: boolean
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
  /**
   * `RiskEngine.BP_DECREASE_BUFFER` and `RiskEngine.DECIMALS` — the live
   * mint-time margin buffer, as the ratio `applyMintBuffer` consumes. Read
   * from the same block as the rest of these parameters.
   */
  mintBuffer: MintBufferRatio
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Current interest rates from the CollateralTrackers.
 */
export interface CurrentRates {
  /** Token 0 borrow rate (per-second, WAD-scaled) */
  borrowRate0: bigint
  /** Token 0 supply rate (per-second, WAD-scaled) */
  supplyRate0: bigint
  /** Token 1 borrow rate (per-second, WAD-scaled) */
  borrowRate1: bigint
  /** Token 1 supply rate (per-second, WAD-scaled) */
  supplyRate1: bigint
  /** Block metadata */
  _meta: BlockMeta
}
