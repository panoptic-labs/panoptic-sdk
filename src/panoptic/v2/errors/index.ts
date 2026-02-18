/**
 * Error types for the Panoptic v2 SDK.
 * @module v2/errors
 */

// Base error class
export { PanopticError } from './base'

// Contract errors (from Errors.sol)
export {
  // Solvency & Margin
  AccountInsolventError,
  AlreadyInitializedError,
  BelowMinimumRedemptionError,
  CastingError,
  // Liquidity
  ChunkHasZeroLiquidityError,
  DepositTooLargeError,
  DuplicateTokenIdError,
  EffectiveLiquidityAboveThresholdError,
  ExceedsMaximumRedemptionError,
  InputListFailError,
  InsufficientCreditLiquidityError,
  InvalidBuilderCodeError,
  InvalidTickBoundError,
  // Tick & Price
  InvalidTickError,
  // Position & TokenId
  InvalidTokenIdParameterError,
  InvalidUniswapCallbackError,
  LengthMismatchError,
  LiquidityTooHighError,
  NetLiquidityZeroError,
  // Exercise
  NoLegsExercisableError,
  NotALongLegError,
  NotBuilderError,
  NotEnoughLiquidityInChunkError,
  // Token & Collateral
  NotEnoughTokensError,
  NotGuardianError,
  NotMarginCalledError,
  // Authorization
  NotPanopticPoolError,
  // Pool & Initialization
  PoolNotInitializedError,
  PositionCountNotZeroError,
  PositionNotOwnedError,
  PositionTooLargeError,
  PriceBoundFailError,
  PriceImpactTooLargeError,
  // Reentrancy
  ReentrancyError,
  // Oracle & Safe Mode
  StaleOracleError,
  TokenIdHasZeroLegsError,
  TooManyLegsOpenError,
  // Transfer & Casting
  TransferFailedError,
  UnauthorizedUniswapCallbackError,
  UnderOverFlowError,
  WrongPoolIdError,
  WrongUniswapPoolError,
  // Other
  ZeroAddressError,
  ZeroCollateralRequirementError,
} from './contract'

// SDK-specific errors
export {
  // Chunk Tracking
  ChunkLimitError,
  CrossPoolError,
  // Validation
  InvalidTickLimitsError,
  MissingPositionIdsError,
  // Configuration & Network
  NetworkMismatchError,
  // Oracle
  OracleRateLimitedError,
  // Helper Contract
  PanopticHelperNotDeployedError,
  PositionSnapshotNotFoundError,
  ProviderLagError,
  // RPC
  RpcError,
  RpcResponseError,
  // Pool Health
  SafeModeError,
  StaleDataError,
  // Storage
  StorageDataNotFoundError,
  // Sync & Position Tracking
  SyncTimeoutError,
  UnhealthyPoolError,
} from './sdk'

// Error parsing utilities
export { type ParsedError, isPanopticErrorType, parsePanopticError } from './parser'

// Error ABI for custom decoding
export { panopticErrorsAbi } from './errorsAbi'
