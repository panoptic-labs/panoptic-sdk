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
  InvalidTickBoundError,
  InvalidTickError,
  InvalidTokenIdParameterError,
  InvalidUniswapCallbackError,
  isPanopticErrorType,
  LengthMismatchError,
  LiquidityTooHighError,
  NetLiquidityZeroError,
  // SDK errors
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
export type { MutationEffectParams, MutationType } from './react'
export { mutationEffects, queryKeys } from './react'

// ============================================================================
// Client Utilities
// ============================================================================
export type { GetBlockMetaParams, MulticallContract, MulticallReadParams } from './clients'
export { getBlockMeta } from './clients'

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
  createTokenIdBuilderV4,
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
  hasLongLeg,
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
  GetNetLiquidationValueParams,
  GetOracleStateParams,
  // Pool liquidity params
  GetPoolLiquiditiesParams,
  // Pool read params
  GetPoolParams,
  // PanopticQuery params
  GetPortfolioValueParams,
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
  OptimizeTokenIdRiskPartnersParams,
  PoolLiquidities,
  PortfolioValue,
  PositionsWithPremiaResult,
  PositionWithPremia,
  RequiredCreditForITM,
} from './reads'
export {
  calculateAccountGreeksPure,
  checkCollateralAcrossTicks,
  convertToAssets,
  convertToShares,
  estimateCollateralRequired,
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
  getCollateralData,
  getCurrentRates,
  // Delta hedging
  getDeltaHedgeParams,
  getLiquidationPrices,
  // Margin buffer
  getMarginBuffer,
  getMaxPositionSize,
  getNetLiquidationValue,
  getOracleState,
  // Pool reads
  getPool,
  // Pool liquidity
  getPoolLiquidities,
  // PanopticQuery utilities
  getPortfolioValue,
  // Position reads
  getPosition,
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
  DepositParams,
  DispatchParams,
  ForceExerciseParams,
  LiquidateParams,
  MintParams,
  OpenPositionParams,
  PokeOracleParams,
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
  SimulateClosePositionParams,
  SimulateDepositParams,
  SimulateDispatchParams,
  SimulateForceExerciseParams,
  SimulateLiquidateParams,
  SimulateOpenPositionParams,
  SimulateSettleParams,
  SimulateWithdrawParams,
} from './simulations'
export {
  simulateClosePosition,
  simulateDeposit,
  simulateDispatch,
  simulateForceExercise,
  simulateLiquidate,
  simulateOpenPosition,
  simulateSettle,
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
export type { PoolFormatterConfig, PoolFormatters } from './formatters'
export {
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
  WithdrawEvent,
  WithdrawSimulation,
} from './types'
