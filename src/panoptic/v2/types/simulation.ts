/**
 * Simulation types for the Panoptic v2 SDK.
 * @module v2/types/simulation
 */

import type { PanopticError } from '../errors'
import type { BlockMeta } from './meta'
import type { Position, PositionGreeks } from './position'

/**
 * Token flow data from simulation.
 * Measures collateral asset changes via getAssetsOf-dispatch-getAssetsOf pattern
 * using PanopticPool.multicall.
 */
export interface TokenFlow {
  /** Token 0 collateral change (negative = user deposits, positive = user receives) */
  delta0: bigint
  /** Token 1 collateral change (negative = user deposits, positive = user receives) */
  delta1: bigint
  /** Collateral assets in token 0 before the call */
  balanceBefore0: bigint
  /** Collateral assets in token 1 before the call */
  balanceBefore1: bigint
  /** Collateral assets in token 0 after the call */
  balanceAfter0: bigint
  /** Collateral assets in token 1 after the call */
  balanceAfter1: bigint
}

/**
 * Simulation result discriminated union.
 * Success case returns data, failure case returns error.
 *
 * Note: tokenFlow is optional because some simulations (deposit/withdraw)
 * don't use the PanopticPool.multicall token flow measurement.
 */
export type SimulationResult<T> =
  | { success: true; data: T; gasEstimate: bigint; tokenFlow?: TokenFlow; _meta: BlockMeta }
  | { success: false; error: PanopticError; _meta: BlockMeta }

/**
 * Open position simulation result data.
 */
export interface OpenPositionSimulation {
  /** The position that would be created */
  position: Position
  /** Post-trade greeks */
  greeks: PositionGreeks
  /** Token 0 amount required */
  amount0Required: bigint
  /** Token 1 amount required */
  amount1Required: bigint
  /** Post-trade collateral for token 0 */
  postCollateral0: bigint
  /** Post-trade collateral for token 1 */
  postCollateral1: bigint
  /** Post-trade margin excess for token 0 (null if PanopticQuery unavailable) */
  postMarginExcess0: bigint | null
  /** Post-trade margin excess for token 1 (null if PanopticQuery unavailable) */
  postMarginExcess1: bigint | null
  /** Commission paid for token 0 (null: embedded in contract logic, not extractable from token flow) */
  commission0: bigint | null
  /** Commission paid for token 1 (null: embedded in contract logic, not extractable from token flow) */
  commission1: bigint | null
}

/**
 * Close position simulation result data.
 */
export interface ClosePositionSimulation {
  /** Token 0 amount received */
  amount0Received: bigint
  /** Token 1 amount received */
  amount1Received: bigint
  /** Premia collected for token 0 (null: requires pre-close premia snapshot) */
  premiaCollected0: bigint | null
  /** Premia collected for token 1 (null: requires pre-close premia snapshot) */
  premiaCollected1: bigint | null
  /** Post-trade collateral for token 0 */
  postCollateral0: bigint
  /** Post-trade collateral for token 1 */
  postCollateral1: bigint
  /** Realized PnL for token 0 (null: requires open position cost basis) */
  realizedPnL0: bigint | null
  /** Realized PnL for token 1 (null: requires open position cost basis) */
  realizedPnL1: bigint | null
}

/**
 * Force exercise simulation result data.
 */
export interface ForceExerciseSimulation {
  /** Exercise fee for token 0 (positive = received, negative = paid) */
  exerciseFee0: bigint
  /** Exercise fee for token 1 */
  exerciseFee1: bigint
  /** Whether the exercise would succeed */
  canExercise: boolean
  /** Reason if cannot exercise */
  reason?: string
}

/**
 * Liquidation simulation result data.
 */
export interface LiquidateSimulation {
  /** Bonus received for token 0 */
  bonus0: bigint
  /** Bonus received for token 1 */
  bonus1: bigint
  /** Positions that would be closed */
  positionsClosed: bigint[]
  /** Whether the account is liquidatable */
  isLiquidatable: boolean
  /** Shortfall for token 0 (if liquidatable) */
  shortfall0: bigint
  /** Shortfall for token 1 (if liquidatable) */
  shortfall1: bigint
}

/**
 * Settle premia simulation result data.
 */
export interface SettleSimulation {
  /** Premia received for token 0 */
  premiaReceived0: bigint
  /** Premia received for token 1 */
  premiaReceived1: bigint
  /** Post-settle collateral for token 0 */
  postCollateral0: bigint
  /** Post-settle collateral for token 1 */
  postCollateral1: bigint
}

/**
 * Deposit simulation result data.
 */
export interface DepositSimulation {
  /** Shares that would be minted */
  sharesMinted: bigint
  /** Post-deposit assets */
  postAssets: bigint
  /** Post-deposit shares */
  postShares: bigint
}

/**
 * Withdraw simulation result data.
 */
export interface WithdrawSimulation {
  /** Shares that would be burned */
  sharesBurned: bigint
  /** Assets that would be received */
  assetsReceived: bigint
  /** Post-withdraw assets */
  postAssets: bigint
  /** Post-withdraw shares */
  postShares: bigint
  /** Whether the withdrawal is possible */
  canWithdraw: boolean
  /** Reason if cannot withdraw */
  reason?: string
}

/**
 * Dispatch simulation result data.
 */
export interface DispatchSimulation {
  /** Token 0 net change */
  netAmount0: bigint
  /** Token 1 net change */
  netAmount1: bigint
  /** Positions created */
  positionsCreated: bigint[]
  /** Positions closed */
  positionsClosed: bigint[]
  /** Post-dispatch collateral for token 0 */
  postCollateral0: bigint
  /** Post-dispatch collateral for token 1 */
  postCollateral1: bigint
  /** Post-dispatch margin excess for token 0 (null if PanopticQuery unavailable) */
  postMarginExcess0: bigint | null
  /** Post-dispatch margin excess for token 1 (null if PanopticQuery unavailable) */
  postMarginExcess1: bigint | null
}
