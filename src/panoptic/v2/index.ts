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
// Storage
// ============================================================================
export type { StorageAdapter } from './storage'
export {
  createFileStorage,
  // Adapters
  createMemoryStorage,
  getClosedPositionsKey,
  getPendingPositionsKey,
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
  useApprovePool,
  useChunkSpreads,
  useClearTrackedPositions,
  useClosedPositions,
  useClosePosition as useClosePositionHook,
  useCollateralData,
  useConfirmPendingPosition,
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
  usePreviewDeposit,
  usePreviewMint,
  usePreviewRedeem,
  usePreviewWithdraw,
  usePriceHistory,
  useRealizedPnL,
  useRedeem as useRedeemHook,
  useRiskParameters,
  useRollPosition as useRollPositionHook,
  useSafeMode,
  useSettleAccumulatedPremia as useSettleAccumulatedPremiaHook,
  // Hooks — simulations
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
  useSimulateWithdraw,
  useStreamiaHistory,
  useSyncPositions,
  useSyncStatus,
  useTrackedPositionIds,
  useTradeHistory,
  useUniswapFeeHistory,
  useUtilization,
  useWatchEvents,
  useWithdraw as useWithdrawHook,
  useWithdrawWithPositions as useWithdrawWithPositionsHook,
} from './react'

// ============================================================================
// Client Utilities
// ============================================================================
export type {
  GetBlockMetaParams,
  MulticallContract,
  MulticallReadParams,
  ResolveBlockNumbersParams,
} from './clients'
export { getBlockMeta, multicallRead, resolveBlockNumbers } from './clients'

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
  GetPoolMetadataParams,
  MinePoolAddressParams,
  MinePoolAddressResult,
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
  CollateralAcrossTicks,
  CollateralDataPoint,
  DeltaHedgeResult,
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
  // Collateral read params
  GetCollateralDataParams,
  GetCurrentRatesParams,
  // Delta hedge params
  GetDeltaHedgeParamsInput,
  GetLiquidationPricesParams,
  // Margin buffer params
  GetMarginBufferParams,
  GetMaxPositionSizeParams,
  GetMaxWithdrawableParams,
  GetNativeTokenPriceParams,
  GetNetLiquidationValueParams,
  // Open position preview params
  GetOpenPositionPreviewParams,
  GetOracleStateParams,
  // Pool liquidity params
  GetPoolLiquiditiesParams,
  // Pool read params
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
} from './reads'
export {
  getFactoryConstructMetadata,
  getFactoryOwnerOf,
  getFactoryTokenURI,
  getPanopticPoolAddress,
  getPoolMetadata,
  minePoolAddress,
  simulateDeployNewPool,
} from './reads'
export {
  // Collateral share price
  type CollateralSharePriceData,
  calculateAccountGreeksPure,
  checkCollateralAcrossTicks,
  convertToAssets,
  convertToShares,
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
  // Collateral reads
  getCollateralAddresses,
  getCollateralData,
  getCollateralSharePrices,
  // Collateral total assets
  getCollateralTotalAssetsBatch,
  getCurrentRates,
  // Delta hedging
  getDeltaHedgeParams,
  getLiquidationPrices,
  // Margin buffer
  getMarginBuffer,
  getMaxPositionSize,
  getMaxWithdrawable,
  getNativeTokenPrice,
  getNetLiquidationValue,
  // Open position preview
  getOpenPositionPreview,
  getOracleState,
  // Pool reads
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
  optimizeTokenIdRiskPartners,
  // ERC4626 vault previews
  previewDeposit,
  previewMint,
  previewRedeem,
  previewWithdraw,
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
  CancelParams,
  CheckApprovalParams,
  ClosePositionParams,
  DeployNewPoolParams,
  DepositParams,
  DispatchParams,
  ForceExerciseParams,
  LiquidateParams,
  MintParams,
  OpenPositionParams,
  PokeOracleParams,
  PositionStorageParams,
  RedeemParams,
  RollPositionParams,
  SettleParams,
  SpeedUpParams,
  TickAndSpreadLimits,
  WithdrawParams,
  WithdrawWithPositionsParams,
  WriteConfig,
} from './writes'
export {
  // Approval
  approve,
  approveAndWait,
  approvePool,
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
  // Force exercise
  forceExercise,
  forceExerciseAndWait,
  // Liquidation
  liquidate,
  liquidateAndWait,
  mint,
  mintAndWait,
  // Position operations
  openPosition,
  openPositionAndWait,
  // Oracle
  pokeOracle,
  pokeOracleAndWait,
  // Broadcaster
  publicBroadcaster,
  redeem,
  redeemAndWait,
  rollPosition,
  rollPositionAndWait,
  // Settlement
  settleAccumulatedPremia,
  settleAccumulatedPremiaAndWait,
  // Transaction management
  speedUpTransaction,
  withdraw,
  withdrawAndWait,
  withdrawWithPositions,
  withdrawWithPositionsAndWait,
} from './writes'

// ============================================================================
// Simulation Functions
// ============================================================================
export type {
  SFPMSimulationResult,
  SimulateClosePositionParams,
  SimulateDepositParams,
  SimulateDispatchParams,
  SimulateForceExerciseParams,
  SimulateLiquidateParams,
  SimulateOpenPositionParams,
  SimulateSettleParams,
  SimulateSFPMParams,
  SimulateWithdrawParams,
} from './simulations'
export {
  encodePoolKeyBytes,
  simulateClosePosition,
  simulateDeposit,
  simulateDispatch,
  simulateForceExercise,
  simulateLiquidate,
  simulateOpenPosition,
  simulateSettle,
  simulateSFPMBurn,
  simulateSFPMMint,
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
  // Swap-aware delta
  calculatePositionDeltaWithSwap,
  calculatePositionGamma,
  calculatePositionGreeks,
  // Position-level greeks
  calculatePositionValue,
  getLegDelta,
  getLegGamma,
  // Leg-level greeks
  getLegValue,
  // Loan helpers
  getLoanEffectiveDelta,
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
} from './types'
