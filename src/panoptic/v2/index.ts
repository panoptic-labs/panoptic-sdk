/**
 * Panoptic v2 SDK
 *
 * A viem-native TypeScript SDK for interacting with Panoptic v2 protocol.
 *
 * @module v2
 */

// ============================================================================
// Utilities
// ============================================================================
export {
  BPS_DENOMINATOR,
  MAX_TICK,
  MAX_TRACKED_CHUNKS,
  MIN_TICK,
  ORACLE_EPOCH_SECONDS,
  REORG_DEPTH,
  SCHEMA_VERSION,
  STORAGE_PREFIX,
  UTILIZATION_DENOMINATOR,
  // Constants
  WAD,
  ZERO_COLLATERAL,
  ZERO_VALUATION,
} from './utils'

// Factory utilities
export { type PanopticNFTMetadata, decodePanopticTokenURI } from './utils'

// Block interpolation
export { interpolateBlocks } from './utils'

// LeftRight decoding utilities
export { decodeLeftRightSigned, decodeLeftRightUnsigned } from './writes/utils'

// ============================================================================
// Errors
// ============================================================================
export type { ParsedError } from './errors'
export {
  // Contract errors
  AccountInsolventError,
  AlreadyInitializedError,
  BatchValidationError,
  BelowMinimumRedemptionError,
  CastingError,
  ChunkHasZeroLiquidityError,
  ChunkLimitError,
  CrossPoolError,
  DepositTooLargeError,
  DuplicateTokenIdError,
  EffectiveLiquidityAboveThresholdError,
  ExceedsMaximumRedemptionError,
  InputListFailError,
  InsufficientCreditLiquidityError,
  InvalidBuilderCodeError,
  InvalidHistoryRangeError,
  InvalidTickBoundError,
  InvalidTickError,
  InvalidTokenIdParameterError,
  InvalidUniswapCallbackError,
  isPanopticErrorType,
  LengthMismatchError,
  LiquidityTooHighError,
  LoanSlotExhaustedError,
  MaxRetriesExceededError,
  // SDK errors
  MissingPositionIdsError,
  NetLiquidityZeroError,
  NetworkMismatchError,
  NoLegsExercisableError,
  NotALongLegError,
  NotBuilderError,
  NotEnoughLiquidityInChunkError,
  NotEnoughTokensError,
  NotGuardianError,
  NotMarginCalledError,
  NotPanopticPoolError,
  OracleRateLimitedError,
  // Base
  PanopticError,
  PanopticHelperNotDeployedError,
  PanopticValidationError,
  // Error parsing
  parsePanopticError,
  PoolNotInitializedError,
  PositionCountNotZeroError,
  PositionNotOwnedError,
  PositionSnapshotNotFoundError,
  PositionTooLargeError,
  PriceBoundFailError,
  PriceImpactTooLargeError,
  ProviderLagError,
  ReentrancyError,
  RpcError,
  RpcResponseError,
  SafeModeError,
  StaleDataError,
  StaleOracleError,
  SwapTokenMismatchError,
  SyncTimeoutError,
  TokenIdHasZeroLegsError,
  TooManyLegsOpenError,
  TransferFailedError,
  UnauthorizedUniswapCallbackError,
  UnderOverFlowError,
  UnhealthyPoolError,
  WrongPoolIdError,
  WrongUniswapPoolError,
  ZeroAddressError,
  ZeroCollateralRequirementError,
} from './errors'

// ============================================================================
// Batch Dispatch (item-based mint/burn batching for PanopticPool.dispatch())
// ============================================================================
export type {
  BatchDiagnostic,
  BatchDiagnosticCode,
  BatchDispatchArgs,
  BatchOp,
  BatchOpBurn,
  BatchOpKind,
  BatchOpMint,
  BuildBatchDispatchArgsParams,
  BuildBatchDispatchArgsResult,
  ValidateBatchParams,
} from './batch'
export { buildBatchDispatchArgs, validateBatch } from './batch'

// ============================================================================
// Storage
// ============================================================================
export type { StorageAdapter } from './storage'
export {
  createFileStorage,
  // Adapters
  createMemoryStorage,
  getClosedPositionsKey,
  getPendingPositionsKey,
  getPoolMetaKey,
  getPoolPrefix,
  getPositionMetaKey,
  getPositionsKey,
  // Keys
  getSchemaVersionKey,
  getSyncCheckpointKey,
  getTrackedChunksKey,
  // Serializer
  jsonSerializer,
} from './storage'

// ============================================================================
// React Integration
// ============================================================================
export type {
  MutationEffectParams,
  MutationType,
  PanopticContextValue,
  PanopticProviderProps,
  PriceHistoryTimeRange,
  QueryOptions,
} from './react'
export {
  isCowSupportedChain,
  mutationEffects,
  PanopticProvider,
  queryKeys,
  // Hooks — reads
  useAccountCollateral,
  useAccountGreeks,
  useAccountPremia,
  useAccountSummaryBasic,
  useAccountSummaryRisk,
  // Hooks — sync
  useAddPendingPosition,
  // Hooks — writes
  useApprove,
  // Hooks — swaps
  useApproveErc20ForCow,
  useApproveErc20ForPermit2,
  useApprovePool,
  useApproveRouterViaPermit2,
  useBatchDispatch as useBatchDispatchHook,
  useBorrow as useBorrowHook,
  useCancelCowOrder,
  useCheckCowApproval,
  useCheckRouterApproval,
  useChunkSpreads,
  useClearTrackedPositions,
  useClosedPositions,
  useClosePosition as useClosePositionHook,
  useCollateralData,
  useConfirmPendingPosition,
  useCowOrderStatus,
  useCurrentRates,
  useDeployNewPool as useDeployNewPoolHook,
  useDeposit as useDepositHook,
  useDispatch as useDispatchHook,
  useEstimateCollateralRequired,
  // Hooks — events
  useEventPoller,
  useEventSubscription,
  useFactoryConstructMetadata,
  useFactoryOwnerOf,
  useFactoryTokenURI,
  useFailPendingPosition,
  useForceExercise as useForceExerciseHook,
  useInterestState,
  useIsLiquidatable,
  useLiquidate as useLiquidateHook,
  useLiquidationPrices,
  useMarginBuffer,
  useMaxPositionSize,
  useMaxWithdrawable,
  useMinePoolAddress as useMinePoolAddressHook,
  useMintShares,
  useNativeTokenPrice,
  useNetLiquidationValue,
  useNetLiquidationValues,
  useOpenPosition as useOpenPositionHook,
  useOpenPositionPreview,
  useOptimizeRiskPartners,
  useOracleState,
  usePanopticContext,
  usePanopticPoolAddress,
  usePokeOracle as usePokeOracleHook,
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
  useQuoteCowSwap,
  useQuoteSwapExactInViaRouter,
  useQuoteSwapExactOutViaRouter,
  useRealizedPnL,
  useRedeem as useRedeemHook,
  useRepay as useRepayHook,
  useResolveUniswapV4PoolKey,
  useRiskParameters,
  useRollPosition as useRollPositionHook,
  useSafeMode,
  useSettleAccumulatedPremia as useSettleAccumulatedPremiaHook,
  // Hooks — simulations
  useSimulateBatchDispatch,
  useSimulateClosePosition,
  useSimulateDeployNewPool,
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
  useSmartRepay as useSmartRepayHook,
  useStreamiaHistory,
  useSubmitCowOrder,
  useSupply as useSupplyHook,
  useSwapExactIn,
  useSwapExactInViaRouter,
  useSwapExactOut,
  useSwapExactOutViaRouter,
  useSyncPositions,
  useSyncStatus,
  useTrackedPositionIds,
  useTradeHistory,
  useTxEventConfirmation,
  useUniswapFeeHistory,
  useUniswapV3PoolInfo,
  useUniswapV3PoolLiquidities,
  useUniswapV4PoolBasicState,
  useUniswapV4PoolInfo,
  useUniswapV4PoolLiquidities,
  useUnsupply as useUnsupplyHook,
  useUnwrapWeth,
  useUnwrapXstock,
  useUtilization,
  useValidateBuilderCode,
  useWatchEvents,
  useWithdraw as useWithdrawHook,
  useWithdrawWithPositions as useWithdrawWithPositionsHook,
  useWrapEth,
  useWrapXstock,
} from './react'

// ============================================================================
// Client Utilities
// ============================================================================
export type {
  EstimateBlockNumbersParams,
  GetBlockMetaParams,
  MulticallContract,
  MulticallReadParams,
  ResolveBlockNumbersParams,
} from './clients'
export { estimateBlockNumbers, getBlockMeta, multicallRead, resolveBlockNumbers } from './clients'

// ============================================================================
// TokenId Utilities
// ============================================================================
export type {
  DecodedLeg,
  DecodedTokenId,
  EncodeLegParams,
  LegConfig,
  Timescale,
  TokenIdBuilder,
} from './tokenId'
export {
  addLegToTokenId,
  countLegs,
  // Builder
  createTokenIdBuilder,
  decodeAllLegs,
  decodeLeg,
  decodePoolId,
  decodeTickSpacing,
  // Decoder
  decodeTokenId,
  decodeVegoid,
  DEFAULT_MAX_SPREAD,
  DEFAULT_VEGOID,
  encodeLeg,
  // Low-level encoding
  encodePoolId,
  encodeV4PoolId,
  getAssetIndex,
  hasLoanOrCredit,
  hasLongLeg,
  isCredit,
  isCreditLeg,
  isLoan,
  isLoanLeg,
  isShortOnly,
  isSpread,
  LEG_BITS,
  LEG_LIMITS,
  LEG_MASKS,
  // Constants
  STANDARD_TICK_WIDTHS,
  TOKEN_ID_BITS,
  validatePoolId,
} from './tokenId'

// ============================================================================
// Read Functions
// ============================================================================
export type {
  GetFactoryConstructMetadataParams,
  GetFactoryOwnerOfParams,
  GetFactoryTokenURIParams,
  GetPanopticPoolAddressParams,
  GetPanopticPoolFromPoolIdParams,
  GetPoolMetadataParams,
  MinePoolAddressParams,
  MinePoolAddressResult,
  ResolvePanopticPoolFromPoolIdParams,
  ResolvePanopticPoolFromPoolIdResult,
  SimulateDeployNewPoolParams,
} from './reads'
export type {
  // Account buying power params
  AccountBuyingPower,
  AccountGreeksCurveResult,
  AccountGreeksResult,
  AccountPremia,
  CalculateAccountGreeksPureParams,
  CheckCollateralAcrossTicksParams,
  ChunkInput,
  ChunkLiquidityResult,
  CollateralAcrossTicks,
  CollateralDataPoint,
  DeltaHedgeResult,
  // Pool read params
  EnforcedTickLimits,
  // ERC4626 params
  ERC4626PreviewParams,
  ERC4626PreviewResult,
  EstimateCollateralRequiredParams,
  // fetchPoolId params/result
  FetchPoolIdParams,
  FetchPoolIdResult,
  GetAccountBuyingPowerParams,
  // Account read params
  GetAccountCollateralParams,
  // Account greeks params
  GetAccountGreeksParams,
  // Premia params
  GetAccountPremiaParams,
  GetAccountSummaryBasicParams,
  GetAccountSummaryRiskParams,
  // Chunk liquidity params
  GetChunkLiquiditiesParams,
  GetChunkLiquiditiesResult,
  // Collateral read params
  GetCollateralDataParams,
  GetCurrentRatesParams,
  // Delta hedge params
  GetDeltaHedgeParamsInput,
  GetEnforcedTickLimitsParams,
  GetInterestStateParams,
  GetLiquidationPricesParams,
  // Margin buffer params
  GetMarginBufferParams,
  GetMaxPositionSizeParams,
  GetMaxWithdrawableParams,
  GetNativeTokenPriceParams,
  GetNetLiquidationValueParams,
  GetNetLiquidationValuesParams,
  // Open position preview params
  GetOpenPositionPreviewParams,
  GetOracleStateParams,
  // Pool liquidity params
  GetPoolLiquiditiesParams,
  GetPoolParams,
  // PanopticQuery params
  GetPortfolioValueParams,
  // Enrichment params
  GetPositionEnrichmentDataParams,
  GetPositionEnrichmentDataResult,
  GetPositionGreeksParams,
  // Position read params
  GetPositionParams,
  GetPositionsParams,
  GetPositionsWithPremiaParams,
  // Collateral estimation params
  GetRequiredCreditForITMParams,
  GetRiskParametersParams,
  // Safe mode params
  GetSafeModeParams,
  GetUtilizationParams,
  InterestState,
  IrmCurrent,
  IrmMarketStateInputs,
  IrmPoint,
  // Check params
  IsLiquidatableParams,
  LiquidationCheck,
  MarginBuffer,
  MaxPositionSize,
  OpenPositionPreview,
  OptimizeTokenIdRiskPartnersParams,
  PoolLiquidities,
  // Pool metadata
  PoolMetadata,
  PortfolioValue,
  PositionEnrichmentResult,
  PositionInput,
  PositionsWithPremiaResult,
  PositionWithPremia,
  RequiredCreditForITM,
  TokenInterestState,
} from './reads'
export {
  getFactoryConstructMetadata,
  getFactoryOwnerOf,
  getFactoryTokenURI,
  getPanopticPoolAddress,
  getPanopticPoolFromPoolId,
  getPoolMetadata,
  minePoolAddress,
  resolvePanopticPoolFromPoolId,
  simulateDeployNewPool,
} from './reads'
export {
  // Collateral share price
  type CollateralSharePriceData,
  // Collateral reads
  BORROW_INDEX_BITS,
  BPS_SCALE,
  calculateAccountGreeksPure,
  checkCollateralAcrossTicks,
  convertToAssets,
  convertToShares,
  deriveSupplyRatePerSecWad,
  estimateCollateralRequired,
  // Pool ID fetch
  fetchPoolId,
  // Account buying power
  getAccountBuyingPower,
  // Account reads
  getAccountCollateral,
  // Account greeks
  getAccountGreeks,
  // Account trade history
  getAccountHistory,
  // Premia
  getAccountPremia,
  getAccountSummaryBasic,
  getAccountSummaryRisk,
  // Chunk liquidity breakdown (via SFPM)
  getChunkLiquidities,
  // Collateral reads
  getCollateralAddresses,
  getCollateralData,
  getCollateralSharePrices,
  // Collateral total assets
  getCollateralTotalAssetsBatch,
  getCurrentRates,
  // Delta hedging
  getDeltaHedgeParams,
  // Pool reads
  getEnforcedTickLimits,
  getInterestState,
  getIrmCurrent,
  getIrmCurve,
  getLiquidationPrices,
  // Margin buffer
  getMarginBuffer,
  getMaxPositionSize,
  getMaxWithdrawable,
  getNativeTokenPrice,
  getNetLiquidationValue,
  getNetLiquidationValues,
  // Open position preview
  getOpenPositionPreview,
  getOracleState,
  getPool,
  // Pool liquidity
  getPoolLiquidities,
  // PanopticQuery utilities
  getPortfolioValue,
  // Position reads
  getPosition,
  // Position enrichment
  getPositionEnrichmentData,
  getPositionGreeks,
  getPositions,
  getPositionsWithPremia,
  // Collateral estimation
  getRequiredCreditForITM,
  getRiskParameters,
  // Safe mode
  getSafeMode,
  getUtilization,
  // Checks
  isLiquidatable,
  MARKET_EPOCH_BITS,
  MARKET_EPOCH_SHIFT,
  optimizeTokenIdRiskPartners,
  packMarketState,
  // ERC4626 vault previews
  previewDeposit,
  previewMint,
  previewRedeem,
  previewWithdraw,
  RATE_AT_TARGET_BITS,
  ratePerSecWadToAprPct,
  SECONDS_PER_YEAR,
  UNREALIZED_INTEREST_BITS,
  utilizationBpsToWad,
  utilizationPctToWad,
  validateBuilderCode,
} from './reads'

// Streamia History
export type {
  GetStreamiaHistoryParams,
  SettledEvent,
  StreamiaHistoryResult,
  StreamiaLeg,
  StreamiaSnapshot,
} from './reads'
export { getStreamiaHistory } from './reads'

// Uniswap Fee History (standalone, no Panoptic pool required)
export type {
  GetUniswapFeeHistoryParams,
  UniswapFeeHistoryResult,
  UniswapFeeSnapshot,
} from './reads'
export { getUniswapFeeHistory } from './reads'

// Price History (historical tick + sqrtPriceX96)
export type { GetPriceHistoryParams, PriceHistoryResult, PriceSnapshot } from './reads'
export { getPriceHistory } from './reads'

// SFPM reads (poolId resolution)
export type { GetUniswapV3PoolFromIdParams, GetUniswapV4PoolKeyFromIdParams } from './reads'
export { getUniswapV3PoolFromId, getUniswapV4PoolKeyFromId } from './reads'

// Direct Uniswap V3/V4 pool reads (no Panoptic deployment required)
export type {
  GetUniswapV3PoolInfoParams,
  GetUniswapV3PoolLiquiditiesParams,
  GetUniswapV4PoolInfoParams,
  GetUniswapV4PoolLiquiditiesParams,
  ResolveUniswapV4PoolKeyParams,
  UniswapV3Liquidities,
  UniswapV3PoolInfo,
  UniswapV3PoolToken,
  UniswapV4PoolInfo,
  UniswapV4PoolKey,
} from './reads'
export type { GetUniswapV4PoolBasicStateParams, UniswapV4PoolBasicState } from './reads'
export {
  computeV4PoolId,
  getUniswapV3PoolInfo,
  getUniswapV3PoolLiquidities,
  getUniswapV4PoolBasicState,
  getUniswapV4PoolInfo,
  getUniswapV4PoolLiquidities,
  resolveUniswapV4PoolKey,
} from './reads'

// ============================================================================
// Position Tracking & Sync
// ============================================================================
export type {
  AddPendingPositionParams,
  AddTrackedChunksParams,
  ConfirmPendingPositionParams,
  DetectReorgParams,
  DispatchCalldata,
  EventReconstructionParams,
  EventReconstructionResult,
  FailPendingPositionParams,
  GetChunkSpreadsParams,
  GetOpenPositionIdsParams,
  GetPendingPositionsParams,
  GetPositionChunkDataParams,
  GetPositionChunkDataResult,
  GetRealizedPnLParams,
  GetSyncStatusParams,
  GetTrackedChunksParams,
  GetTrackedPositionIdsParams,
  GetTradeHistoryParams,
  LegChunkData,
  LiquidityChunkKey,
  LiquidityChunkSpread,
  PendingPosition,
  PositionChunkData,
  RecoverSnapshotFromTxParams,
  RecoverSnapshotParams,
  RemoveTrackedChunksParams,
  SaveCheckpointParams,
  SaveClosedPositionParams,
  ScanChunksParams,
  ScanChunksResult,
  ScannedChunk,
  SnapshotRecoveryResult,
  SyncPositionsParams,
  SyncPositionsResult,
  SyncProgressEvent,
  SyncStatusResult,
} from './sync'
export {
  addPendingPosition,
  addTrackedChunks,
  calculateResyncBlock,
  calculateSpreadWad,
  cleanupStalePendingPositions,
  clearCheckpoint,
  clearPendingPositions,
  clearTrackedChunks,
  clearTrackedPositions,
  clearTradeHistory,
  confirmPendingPosition,
  decodeDispatchCalldata,
  detectReorg,
  failPendingPosition,
  getChunkSpreads,
  getClosedPositions,
  getOpenPositionIds,
  getPendingPositions,
  getPoolDeploymentBlock,
  getPositionChunkData,
  getRealizedPnL,
  getSyncStatus,
  getTrackedChunks,
  getTrackedPositionIds,
  getTradeHistory,
  isPositionTracked,
  loadCheckpoint,
  reconstructFromEvents,
  recoverSnapshot,
  recoverSnapshotFromTx,
  removeTrackedChunks,
  saveCheckpoint,
  saveClosedPosition,
  scanChunks,
  syncPositions,
  verifyBlockContinuity,
} from './sync'

// ============================================================================
// Write Functions
// ============================================================================
export type {
  ApprovalStatus,
  ApproveParams,
  ApprovePoolParams,
  BorrowParams,
  CancelParams,
  CheckApprovalParams,
  ClosePositionParams,
  DeployNewPoolParams,
  DepositParams,
  DispatchParams,
  ExecuteBatchDispatchParams,
  ForceExerciseParams,
  LiquidateParams,
  MintParams,
  OpenPositionParams,
  PokeOracleParams,
  PositionStorageParams,
  PreviewBorrowParams,
  PreviewBorrowResult,
  PreviewWrapParams,
  RedeemParams,
  RepayParams,
  RollPositionParams,
  SettleParams,
  SmartRepayParams,
  SpeedUpParams,
  SupplyParams,
  SwapExactInParams,
  SwapExactOutParams,
  TickAndSpreadLimits,
  UnsupplyParams,
  UnwrapWethParams,
  UnwrapXstockParams,
  WithdrawParams,
  WithdrawWithPositionsParams,
  WrapEthParams,
  WrapXstockParams,
  WriteConfig,
} from './writes'
export {
  // Approval
  approve,
  approveAndWait,
  approvePool,
  // Lending
  borrow,
  borrowAndWait,
  // Position operations
  buildOpenPositionCalldata,
  // Loan utilities
  buildUniqueLoan,
  cancelTransaction,
  checkApproval,
  closePosition,
  closePositionAndWait,
  createNonceManager,
  // Factory deployment
  deployNewPool,
  deployNewPoolAndWait,
  // Vault operations
  deposit,
  depositAndWait,
  // Dispatch
  dispatch,
  dispatchAndWait,
  // Item-based batch dispatch
  executeBatchDispatch,
  executeBatchDispatchAndWait,
  // Force exercise
  forceExercise,
  forceExerciseAndWait,
  isInputListFailError,
  // Liquidation
  liquidate,
  liquidateAndWait,
  mint,
  mintAndWait,
  openPosition,
  openPositionAndWait,
  // Oracle
  pokeOracle,
  pokeOracleAndWait,
  previewBorrow,
  previewUnwrap,
  previewWrap,
  // Broadcaster
  publicBroadcaster,
  redeem,
  redeemAndWait,
  repay,
  repayAndWait,
  resolveTokenIndex,
  rollPosition,
  rollPositionAndWait,
  // Settlement
  settleAccumulatedPremia,
  settleAccumulatedPremiaAndWait,
  smartRepay,
  smartRepayAndWait,
  // Transaction management
  speedUpTransaction,
  supply,
  supplyAndWait,
  // Swap
  swapExactIn,
  swapExactInAndWait,
  swapExactOut,
  swapExactOutAndWait,
  unsupply,
  unsupplyAndWait,
  // ETH/WETH wrap / unwrap
  unwrapWeth,
  unwrapWethAndWait,
  // xStock wrap / unwrap
  unwrapXstock,
  unwrapXstockAndWait,
  wethWrapAbi,
  withdraw,
  withdrawAndWait,
  withdrawWithPositions,
  withdrawWithPositionsAndWait,
  wrapEth,
  wrapEthAndWait,
  wrapXstock,
  wrapXstockAndWait,
  xstockWrapperAbi,
} from './writes'

// ============================================================================
// Simulation Functions
// ============================================================================
export type {
  SFPMSimulationResult,
  SimulateBatchDispatchParams,
  SimulateBatchDispatchResult,
  SimulateClosePositionParams,
  SimulateDepositParams,
  SimulateDispatchParams,
  SimulateForceExerciseParams,
  SimulateLiquidateParams,
  SimulateOpenPositionParams,
  SimulateSettleParams,
  SimulateSFPMParams,
  SimulateSwapExactInParams,
  SimulateSwapExactOutParams,
  SimulateWithdrawParams,
  SwapSimulation,
} from './simulations'
export {
  encodePoolKeyBytes,
  encodeV3PoolKeyBytes,
  simulateBatchDispatch,
  simulateClosePosition,
  simulateDeposit,
  simulateDispatch,
  simulateForceExercise,
  simulateLiquidate,
  simulateOpenPosition,
  simulateSettle,
  simulateSFPMBurn,
  simulateSFPMMint,
  simulateSwapExactIn,
  simulateSwapExactOut,
  simulateWithdraw,
} from './simulations'

// ============================================================================
// Events
// ============================================================================
export type {
  CreateEventPollerParams,
  CreateEventSubscriptionParams,
  EventPoller,
  EventSubscriptionHandle,
  ReconnectConfig,
  WatchEventsParams,
} from './events'
export {
  // HTTP polling alternative
  createEventPoller,
  // Resilient subscription with auto-reconnect
  createEventSubscription,
  DEFAULT_RECONNECT_CONFIG,
  parseCollateralLog,
  // Internal utilities (for advanced use)
  parsePoolLog,
  // Simple WebSocket watching
  watchEvents,
} from './events'

// ============================================================================
// Formatters
// ============================================================================
export type { PoolFormatterConfig, PoolFormatters, TickLimitsResult } from './formatters'
export {
  annualizePerSecondRateWad,
  // Pool-bound formatters
  createPoolFormatters,
  formatBlockNumber,
  // Percentages
  formatBps,
  formatCompact,
  formatDatetime,
  formatDuration,
  formatDurationSeconds,
  formatFeeTier,
  formatGas,
  formatGwei,
  formatPerSecondRateWadAsAprPct,
  formatPerSecondRateWadAsApyPct,
  formatPoolIdHex,
  formatPriceRange,
  formatRateWad,
  formatRatioPercent,
  formatTick,
  formatTickRange,
  formatTimestamp,
  formatTimestampLocale,
  // Token amounts
  formatTokenAmount,
  formatTokenAmountSigned,
  formatTokenDelta,
  formatTokenFlow,
  formatTokenIdHex,
  formatTokenIdShort,
  formatTxHash,
  formatUtilization,
  // WAD
  formatWad,
  formatWadPercent,
  formatWadSigned,
  formatWei,
  getPoolDisplayId,
  getPricesAtTick,
  getTickSpacing,
  // Token list utilities
  getTokenListId,
  parseBps,
  parseTokenAmount,
  parseTokenListId,
  parseWad,
  priceToTick,
  roundToTickSpacing,
  sqrtPriceX96ToPriceDecimalScaled,
  sqrtPriceX96ToTick,
  tickLimits,
  // Tick and price
  tickToPrice,
  tickToPriceDecimalScaled,
  tickToSqrtPriceX96,
  // Display formatters
  truncateAddress,
} from './formatters'

// ============================================================================
// Greeks (Client-side)
// ============================================================================
export type { PositionGreeksInput, PositionGreeksResult } from './greeks'
export {
  calculatePositionDelta,
  calculatePositionDeltaWithSwap,
  calculatePositionGamma,
  calculatePositionGreeks,
  // Position-level greeks
  calculatePositionValue,
  getLegDelta,
  getLegGamma,
  // Leg-level greeks
  getLegValue,
  // Helpers
  isCall,
  isDefinedRisk,
} from './greeks'

// ============================================================================
// Bot Utilities
// ============================================================================
export type { DataWithMeta } from './bot'
export {
  assertCanBurn,
  assertCanForceExercise,
  assertCanLiquidate,
  assertCanMint,
  // Assertions
  assertFresh,
  assertHealthy,
  assertTradeable,
  isGasError,
  isNonceError,
  // RPC error classification
  isRetryableRpcError,
} from './bot'

// ============================================================================
// Types
// ============================================================================
export type {
  AccountCollateral,
  AccountLiquidatedEvent,
  AccountSummaryBasic,
  AccountSummaryRisk,
  BaseEvent,
  // Meta
  BlockMeta,
  ChunkData,
  ChunkKey,
  ChunkMetadata,
  // Chunk types
  ChunkSpread,
  ChunkStats,
  ClosedPosition,
  ClosePositionSimulation,
  CollateralEstimate,
  CollateralTracker,
  CurrentRates,
  DepositEvent,
  DepositSimulation,
  DispatchCall,
  DispatchSimulation,
  EventSubscription,
  ForcedExercisedEvent,
  ForceExerciseSimulation,
  LegGreeksParams,
  LegUpdate,
  LiquidateSimulation,
  LiquidationPrices,
  NetLiquidationValue,
  NetLiquidationValues,
  NonceManager,
  OpenPositionSimulation,
  OptionBurntEvent,
  OptionMintedEvent,
  OracleState,
  PanopticEvent,
  // Event types
  PanopticEventType,
  // Pool types
  Pool,
  PoolHealthStatus,
  PoolKey,
  // Pool config (V3/V4)
  PoolVersionConfig,
  // Position types
  Position,
  PositionGreeks,
  PremiumSettledEvent,
  RealizedPnL,
  ReorgDetection,
  RiskEngine,
  RiskParameters,
  // Oracle types
  SafeMode,
  SafeModeState,
  SettleSimulation,
  // Simulation types
  SimulationResult,
  SyncCheckpoint,
  SyncEvent,
  SyncOptions,
  SyncResult,
  SyncState,
  // Sync types
  SyncStatus,
  // Account types
  TokenCollateral,
  TokenFlow,
  TokenIdLeg,
  TxBroadcaster,
  TxOverrides,
  TxReceipt,
  // Transaction types
  TxResult,
  TxResultWithReceipt,
  Utilization,
  V3PoolConfig,
  V4PoolConfig,
  WithdrawEvent,
  WithdrawSimulation,
} from './types/index'
