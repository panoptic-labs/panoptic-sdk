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
  useInterestState,
  useIsLiquidatable,
  useLiquidationPrices,
  useMarginBuffer,
  useMaxPositionSize,
  useMaxWithdrawable,
  useMinePoolAddress,
  useNativeTokenPrice,
  useNetLiquidationValue,
  useNetLiquidationValues,
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
  usePreviewBorrow,
  usePreviewDeposit,
  usePreviewMint,
  usePreviewRedeem,
  usePreviewWithdraw,
  usePriceHistory,
  useRealizedPnL,
  useRequiredCreditForITM,
  useResolveUniswapV4PoolKey,
  useRiskParameters,
  useSafeMode,
  useScanChunks,
  useSimulateDeployNewPool,
  useStreamiaHistory,
  useSyncStatus,
  useTrackedPositionIds,
  useTradeHistory,
  useUniswapFeeHistory,
  useUniswapV3PoolInfo,
  useUniswapV3PoolLiquidities,
  useUniswapV4PoolBasicState,
  useUniswapV4PoolInfo,
  useUniswapV4PoolLiquidities,
  useUtilization,
  useValidateBuilderCode,
} from './reads'

// Write hooks
export {
  useApprove,
  useApprovePool,
  useBatchDispatch,
  useBorrow,
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
  useRepay,
  useRollPosition,
  useSettleAccumulatedPremia,
  useSmartRepay,
  useSupply,
  useSwapExactIn,
  useSwapExactOut,
  useUnsupply,
  useUnwrapWeth,
  useUnwrapXstock,
  useWithdraw,
  useWithdrawWithPositions,
  useWrapEth,
  useWrapXstock,
} from './writes'

// Simulation hooks
export {
  useSimulateBatchDispatch,
  useSimulateClosePosition,
  useSimulateDeposit,
  useSimulateDispatch,
  useSimulateForceExercise,
  useSimulateLiquidate,
  useSimulateOpenPosition,
  useSimulateSettle,
  useSimulateSFPMBurn,
  useSimulateSFPMMint,
  useSimulateSwapExactIn,
  useSimulateSwapExactOut,
  useSimulateWithdraw,
} from './simulations'

// Uniswap v4 router swap hooks
export {
  useApproveErc20ForPermit2,
  useApproveRouterViaPermit2,
  useCheckRouterApproval,
  useQuoteSwapExactInViaRouter,
  useQuoteSwapExactOutViaRouter,
  useSwapExactInViaRouter,
  useSwapExactOutViaRouter,
} from './uniswapRouter'

// CoW Swap order-book hooks
export {
  isCowSupportedChain,
  useApproveErc20ForCow,
  useCancelCowOrder,
  useCheckCowApproval,
  useCowOrderStatus,
  useQuoteCowSwap,
  useSubmitCowOrder,
} from './cowSwap'

// Sync hooks
export {
  useAddPendingPosition,
  useClearTrackedPositions,
  useConfirmPendingPosition,
  useFailPendingPosition,
  useSyncPositions,
} from './sync'

// Event hooks
export {
  useEventPoller,
  useEventSubscription,
  useTxEventConfirmation,
  useWatchEvents,
} from './events'
