/**
 * React hooks barrel export for the Panoptic v2 SDK.
 * @module v2/react/hooks
 */

// Read hooks
export {
  type QueryOptions,
  useAccountCollateral,
  useAccountGreeks,
  useAccountPremia,
  useAccountSummaryBasic,
  useAccountSummaryRisk,
  useChunkSpreads,
  useClosedPositions,
  useCollateralData,
  useCurrentRates,
  useEstimateCollateralRequired,
  useIsLiquidatable,
  useLiquidationPrices,
  useMarginBuffer,
  useMaxPositionSize,
  useNetLiquidationValue,
  useOracleState,
  usePool,
  usePoolLiquidities,
  usePosition,
  usePositionGreeks,
  usePositions,
  usePositionsWithPremia,
  usePreviewDeposit,
  usePreviewMint,
  usePreviewRedeem,
  usePreviewWithdraw,
  useRealizedPnL,
  useRiskParameters,
  useSafeMode,
  useSyncStatus,
  useTrackedPositionIds,
  useTradeHistory,
  useUtilization,
} from './reads'

// Write hooks
export {
  useApprove,
  useApprovePool,
  useClosePosition,
  useDeposit,
  useDispatch,
  useForceExercise,
  useLiquidate,
  useMintShares,
  useOpenPosition,
  usePokeOracle,
  useRedeem,
  useRollPosition,
  useSettleAccumulatedPremia,
  useWithdraw,
  useWithdrawWithPositions,
} from './writes'

// Simulation hooks
export {
  useSimulateClosePosition,
  useSimulateDeposit,
  useSimulateDispatch,
  useSimulateForceExercise,
  useSimulateLiquidate,
  useSimulateOpenPosition,
  useSimulateSettle,
  useSimulateWithdraw,
} from './simulations'

// Sync hooks
export {
  useAddPendingPosition,
  useClearTrackedPositions,
  useConfirmPendingPosition,
  useFailPendingPosition,
  useSyncPositions,
} from './sync'

// Event hooks
export { useEventPoller, useEventSubscription, useWatchEvents } from './events'
