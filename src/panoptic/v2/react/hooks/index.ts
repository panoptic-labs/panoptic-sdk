/**
 * React hooks barrel export for the Panoptic v2 SDK.
 * @module v2/react/hooks
 */

// Read hooks
export {
  type PriceHistoryTimeRange,
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
  useFactoryConstructMetadata,
  useFactoryOwnerOf,
  useFactoryTokenURI,
  useIsLiquidatable,
  useLiquidationPrices,
  useMarginBuffer,
  useMaxPositionSize,
  useMaxWithdrawable,
  useMinePoolAddress,
  useNativeTokenPrice,
  useNetLiquidationValue,
  useOpenPositionPreview,
  useOptimizeRiskPartners,
  useOracleState,
  usePanopticPoolAddress,
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
  usePriceHistory,
  useRealizedPnL,
  useRequiredCreditForITM,
  useRiskParameters,
  useSafeMode,
  useSimulateDeployNewPool,
  useStreamiaHistory,
  useSyncStatus,
  useTrackedPositionIds,
  useTradeHistory,
  useUniswapFeeHistory,
  useUtilization,
} from './reads'

// Write hooks
export {
  useApprove,
  useApprovePool,
  useClosePosition,
  useDeployNewPool,
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
  useSimulateSFPMBurn,
  useSimulateSFPMMint,
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
