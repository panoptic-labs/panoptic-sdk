/**
 * Simulation functions for the Panoptic v2 SDK.
 * @module v2/simulations
 */

export { type SimulateClosePositionParams, simulateClosePosition } from './simulateClosePosition'
export { type SimulateDispatchParams, simulateDispatch } from './simulateDispatch'
export { type SimulateForceExerciseParams, simulateForceExercise } from './simulateForceExercise'
export { type SimulateLiquidateParams, simulateLiquidate } from './simulateLiquidate'
export { type SimulateOpenPositionParams, simulateOpenPosition } from './simulateOpenPosition'
export { type SimulateSettleParams, simulateSettle } from './simulateSettle'
export {
  type SimulateDepositParams,
  type SimulateWithdrawParams,
  simulateDeposit,
  simulateWithdraw,
} from './simulateVault'

// Token flow utilities (uses PanopticPool.multicall + getAssetsOf)
export {
  type PoolTokens,
  type SimulateWithTokenFlowParams,
  type SimulateWithTokenFlowResult,
  type TokenFlow,
  getPoolTokensForSimulation,
  simulateWithTokenFlow,
} from './tokenFlow'
