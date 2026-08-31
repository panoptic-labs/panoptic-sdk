/**
 * Simulation functions for the Panoptic v2 SDK.
 * @module v2/simulations
 */

export {
  type SimulateBatchDispatchParams,
  type SimulateBatchDispatchResult,
  simulateBatchDispatch,
} from './simulateBatchDispatch'
export { type SimulateClosePositionParams, simulateClosePosition } from './simulateClosePosition'
export { type SimulateDispatchParams, simulateDispatch } from './simulateDispatch'
export { type SimulateForceExerciseParams, simulateForceExercise } from './simulateForceExercise'
export { type SimulateLiquidateParams, simulateLiquidate } from './simulateLiquidate'
export { type SimulateOpenPositionParams, simulateOpenPosition } from './simulateOpenPosition'
export { type SimulateSettleParams, simulateSettle } from './simulateSettle'
export {
  type SettlePremiumBatchResult,
  type SettlePremiumBatchTargetResult,
  type SettleSequenceSimulation,
  type SimulateSettlePremiumBatchParams,
  type SimulateSettleSequenceParams,
  simulateSettlePremiumBatch,
  simulateSettleSequence,
} from './simulateSettlePremiumBatch'
export {
  type SimulateSettlePremiumFromParams,
  simulateSettlePremiumFrom,
} from './simulateSettlePremiumFrom'
export {
  type SimulateDepositParams,
  type SimulateWithdrawParams,
  simulateDeposit,
  simulateWithdraw,
} from './simulateVault'

// SFPM simulations (mintTokenizedPosition / burnTokenizedPosition)
export {
  type SFPMSimulationResult,
  type SimulateSFPMParams,
  encodePoolKeyBytes,
  encodeV3PoolKeyBytes,
  simulateSFPMBurn,
  simulateSFPMMint,
} from './sfpm'

// Swap simulations
export {
  type SimulateSwapExactInParams,
  type SimulateSwapExactOutParams,
  type SwapSimulation,
  simulateSwapExactIn,
  simulateSwapExactOut,
} from './simulateSwap'

// Token flow utilities (uses PanopticPool.multicall + getAssetsOf)
export {
  type PoolTokens,
  type SimulateWithTokenFlowParams,
  type SimulateWithTokenFlowResult,
  type TokenFlow,
  getPoolTokensForSimulation,
  simulateWithTokenFlow,
} from './tokenFlow'
// Credit-wrapped dispatches (collateral swaps inside a single dispatch)
export {
  type BuildCreditWrappedDispatchParams,
  type CreditWrapDirection,
  type CreditWrapPlacement,
  buildCreditWrappedDispatch,
} from './creditWrap'
export {
  type OneTokenFlowQuote,
  type OneTokenFlowQuoteParams,
  type OneTokenFlowResult,
  type OneTokenFlowUnavailableReason,
  DEFAULT_MIN_SWAP_RATIO_BPS,
  quoteOneTokenFlow,
} from './oneTokenFlow'
export {
  type BuildTemporaryLoanRecoveryDispatchParams,
  type TemporaryLoanRecoveryQuote,
  type TemporaryLoanRecoveryQuoteParams,
  type TemporaryLoanRecoveryResult,
  type TemporaryLoanRecoveryUnavailableReason,
  buildTemporaryLoanRecoveryDispatch,
  quoteTemporaryLoanRecovery,
} from './temporaryLoanRecovery'
export {
  type BuildTokenShortfallRecoveryDispatchParams,
  type DispatchIntent,
  type TokenShortfallRecoveryQuote,
  type TokenShortfallRecoveryQuoteParams,
  type TokenShortfallRecoveryResult,
  type TokenShortfallRecoveryUnavailableReason,
  buildTokenShortfallRecoveryDispatch,
  getNotEnoughTokensError,
  quoteTokenShortfallRecovery,
} from './tokenShortfallRecovery'
