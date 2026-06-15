/**
 * Write functions for the Panoptic v2 SDK.
 * @module v2/writes
 */

// Broadcaster and nonce management
export {
  type WriteConfig,
  createNonceManager,
  createPublicBroadcaster,
  publicBroadcaster,
} from './broadcaster'

// Utilities
export {
  type BaseWriteParams,
  type SubmitWriteParams,
  createTxResult,
  executeWrite,
  executeWriteAndWait,
  parsePanopticEvents,
  submitWrite,
} from './utils'

// Approval functions
export {
  type ApprovalStatus,
  type ApproveParams,
  type ApprovePoolParams,
  type CheckApprovalParams,
  approve,
  approveAndWait,
  approvePool,
  checkApproval,
} from './approve'

// ERC4626 vault operations
export {
  type DepositParams,
  type MintParams,
  type RedeemParams,
  type WithdrawParams,
  type WithdrawWithPositionsParams,
  deposit,
  depositAndWait,
  mint,
  mintAndWait,
  redeem,
  redeemAndWait,
  withdraw,
  withdrawAndWait,
  withdrawWithPositions,
  withdrawWithPositionsAndWait,
} from './vault'

// Position operations
export {
  type ClosePositionParams,
  type OpenPositionParams,
  type PositionStorageParams,
  type RollPositionParams,
  type TickAndSpreadLimits,
  buildOpenPositionCalldata,
  closePosition,
  closePositionAndWait,
  openPosition,
  openPositionAndWait,
  rollPosition,
  rollPositionAndWait,
} from './position'

// Raw dispatch
export { type DispatchParams, dispatch, dispatchAndWait } from './dispatch'

// Item-based batch dispatch
export {
  type ExecuteBatchDispatchParams,
  executeBatchDispatch,
  executeBatchDispatchAndWait,
} from './executeBatchDispatch'

// Liquidation
export { type LiquidateParams, liquidate, liquidateAndWait } from './liquidate'

// Force exercise
export { type ForceExerciseParams, forceExercise, forceExerciseAndWait } from './forceExercise'

// Settlement
export {
  type SettleParams,
  settleAccumulatedPremia,
  settleAccumulatedPremiaAndWait,
} from './settle'

// Oracle
export { type PokeOracleParams, pokeOracle, pokeOracleAndWait } from './pokeOracle'

// Factory deployment
export {
  type DeployNewPoolParams,
  type DeployNewPoolV3Params,
  type DeployNewPoolV4Params,
  deployNewPool,
  deployNewPoolAndWait,
} from './factory'

// Transaction management
export {
  type CancelParams,
  type SpeedUpParams,
  cancelTransaction,
  speedUpTransaction,
} from './txManagement'

// Swap operations
export {
  type SwapExactInParams,
  type SwapExactOutParams,
  swapExactIn,
  swapExactInAndWait,
  swapExactOut,
  swapExactOutAndWait,
} from './swap'

// xStock wrap / unwrap (ERC4626 wrapper) operations
export {
  type PreviewWrapParams,
  type UnwrapXstockParams,
  type WrapXstockParams,
  previewUnwrap,
  previewWrap,
  unwrapXstock,
  unwrapXstockAndWait,
  wrapXstock,
  wrapXstockAndWait,
  xstockWrapperAbi,
} from './wrap'

// Loan utilities
export { buildUniqueLoan, isInputListFailError, resolveTokenIndex } from './loanUtils'

// Lending operations
export {
  type BorrowParams,
  type PreviewBorrowParams,
  type PreviewBorrowResult,
  type RepayParams,
  type SmartRepayParams,
  type SupplyParams,
  type UnsupplyParams,
  borrow,
  borrowAndWait,
  previewBorrow,
  repay,
  repayAndWait,
  smartRepay,
  smartRepayAndWait,
  supply,
  supplyAndWait,
  unsupply,
  unsupplyAndWait,
} from './lending'
