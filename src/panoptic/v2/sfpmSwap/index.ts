/**
 * SFPM off-venue swap module.
 *
 * Swaps in a cheaper Uniswap **v3** pool via the SemiFungiblePositionManager,
 * by `multicall([mint, burn])` of a single-leg loan tokenId with inverted tick
 * limits on exactly one call. Used by the hedger-bot to route the hedge-netting
 * swap through a 5bps pool instead of the 30bps Panoptic pool.
 *
 * v3 only — v4 SFPM requires balances resident in the PoolManager when used directly.
 *
 * @module v2/sfpmSwap
 */
export { type SfpmSwapCalldata, buildSfpmSwapCalldata } from './calldata'
export {
  type EnsureSfpmV3PoolInitializedParams,
  type EnsureSfpmV3PoolInitializedResult,
  type FetchSfpmV3PoolIdParams,
  ensureSfpmV3PoolInitialized,
  fetchSfpmV3PoolId,
} from './init'
export { buildSfpmSwapPlan, slippageBpsToTickDistance } from './plan'
export { type QuoteSfpmSwapParams, quoteSfpmSwap } from './quote'
export type { SfpmSwapKind, SfpmSwapPlan, SfpmSwapPlanParams, SfpmSwapQuote } from './types'
