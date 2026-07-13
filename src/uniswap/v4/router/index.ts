/**
 * Uniswap v4 Universal Router exact-in and exact-out swap paths.
 * @module uniswap/v4/router
 */

export {
  type BuildV4ExactOutSwapCalldataArgs,
  type BuildV4SwapCalldataArgs,
  buildV4ExactOutSwapExecuteArgs,
  buildV4ExactOutSwapExecuteCalldata,
  buildV4SwapExecuteArgs,
  buildV4SwapExecuteCalldata,
  SETTLE_ALL,
  SWAP_EXACT_IN_SINGLE,
  SWAP_EXACT_OUT_SINGLE,
  SWEEP,
  TAKE_ALL,
  V4_SWAP,
} from './encodeSwap'
export {
  AmountExceedsUint128Error,
  InvalidSwapTokenError,
  MissingSweepRecipientError,
  QuoterUnavailableError,
  UnsupportedChainError,
} from './errors'
export {
  approveErc20ForPermit2,
  approveErc20ForPermit2AndWait,
  approveRouterViaPermit2,
  approveRouterViaPermit2AndWait,
  checkRouterApproval,
} from './permit2'
export { quoteSwapExactInViaRouter, quoteSwapExactOutViaRouter } from './quote'
export {
  type QuoteV4ExactInByPoolKeyParams,
  type V4ExactInQuote,
  quoteV4ExactInByPoolKey,
} from './quoteByPoolKey'
export {
  type ResolvedSwapRoute,
  type ResolveSwapRouteParams,
  resolveSwapRoute,
} from './resolvePoolKey'
export {
  swapExactInViaRouter,
  swapExactInViaRouterAndWait,
  swapExactOutViaRouter,
  swapExactOutViaRouterAndWait,
} from './swap'
export type {
  ApproveErc20ForPermit2Params,
  ApproveRouterViaPermit2Params,
  CheckRouterApprovalParams,
  QuoteSwapExactInViaRouterParams,
  QuoteSwapExactOutViaRouterParams,
  RouterApprovalStatus,
  SwapExactInQuote,
  SwapExactInViaRouterParams,
  SwapExactOutQuote,
  SwapExactOutViaRouterParams,
} from './types'
