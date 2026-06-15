/**
 * CoW Protocol (CoW Swap) order-book swap path.
 * @module cow
 */

export {
  COW_API_URLS,
  COW_NATIVE_ETH,
  COW_SETTLEMENT,
  COW_VAULT_RELAYER,
  isCowSupportedChain,
} from './addresses'
export { approveErc20ForCow, checkCowApproval } from './approval'
export { type BestVenue, type PickBestVenueParams, type SwapVenue, pickBestVenue } from './compare'
export {
  APP_DATA_DOC,
  APP_DATA_HASH,
  COW_CANCELLATION_TYPES,
  COW_ORDER_TYPES,
  cowDomain,
} from './eip712'
export {
  CowApiError,
  CowNativeTokenError,
  CowOrderTooSmallError,
  CowUnsupportedChainError,
} from './errors'
export { cancelCowOrder, signAndSubmitCowOrder } from './order'
export { DEFAULT_VALID_FOR_SECONDS, quoteCowSwap } from './quote'
export { getCowOrderStatus } from './status'
export { type CowTokenInfo, type FindCowTokenParams, findCowToken } from './tokens'
export type {
  ApproveErc20ForCowParams,
  CancelCowOrderParams,
  CheckCowApprovalParams,
  CowApprovalStatus,
  CowOrderKind,
  CowOrderResult,
  CowOrderState,
  CowOrderStatus,
  CowQuote,
  GetCowOrderStatusParams,
  QuoteCowSwapParams,
  SignAndSubmitCowOrderParams,
} from './types'
export {
  type XstockWrapperInfo,
  type XstockWrapperRegistry,
  getXstockUnderlying,
  getXstockWrapper,
  isXstockUnderlying,
  isXstockWrapper,
  XSTOCK_WRAPPERS,
} from './xstockWrappers'
