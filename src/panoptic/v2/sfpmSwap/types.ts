/**
 * Types for the SFPM off-venue swap module.
 * @module v2/sfpmSwap/types
 */
import type { Address, Hex } from 'viem'

/** Exact-input or exact-output swap. */
export type SfpmSwapKind = 'exactIn' | 'exactOut'

/**
 * Inputs for {@link buildSfpmSwapPlan}.
 *
 * The swap is executed in a **Uniswap v3** pool via the SemiFungiblePositionManager
 * (SFPM) `multicall([mint, burn])` of a single-leg loan tokenId. See the module
 * README / plan for the mechanism.
 */
export interface SfpmSwapPlanParams {
  /** SFPM (v3) contract address. */
  sfpmAddress: Address
  /** Underlying Uniswap v3 pool the swap runs in (the SFPM poolKey). */
  poolAddress: Address
  /**
   * The `uint64` SFPM poolId for {@link poolAddress}, as registered via
   * `initializeAMMPool` — also the low 64 bits of the tokenId. Resolve on-chain
   * with {@link fetchSfpmV3PoolId}; do not trust an offline-encoded value (the
   * SFPM can collision-increment the id).
   */
  poolId: bigint
  /** Exact-in or exact-out. */
  kind: SfpmSwapKind
  /**
   * Swap direction: `true` sells token0 for token1, `false` sells token1 for token0.
   * (token0/token1 are the Uniswap pool's ordering, i.e. by address.)
   */
  zeroForOne: boolean
  /**
   * The exact amount, in the fixed token: for `exactIn` this is the input amount
   * (in the token being sold); for `exactOut` the output amount (token being bought).
   */
  amount: bigint
  /** Current tick of the Uniswap pool (from slot0), used to center the slippage band. */
  currentTick: number
  /** Slippage tolerance in bps (bounds the pool's post-swap tick). */
  slippageBps: bigint
}

/**
 * A fully-resolved swap plan: the tokenId + per-call tick limits ready to encode.
 */
export interface SfpmSwapPlan {
  sfpmAddress: Address
  poolAddress: Address
  /** `abi.encode(address)` of {@link poolAddress}. */
  poolKey: Hex
  /** Single-leg loan tokenId (width=0, isLong=false, asset==tokenType). */
  tokenId: bigint
  /** `positionSize` passed to both mint and burn (== {@link SfpmSwapPlanParams.amount}). */
  positionSize: bigint
  /** `[tickLimitLow, tickLimitHigh]` for the mint call. */
  mintTickLimits: [number, number]
  /** `[tickLimitLow, tickLimitHigh]` for the burn call. */
  burnTickLimits: [number, number]
  /** Which of the two calls carries the inverted (swap-triggering) limits. */
  swapOn: 'mint' | 'burn'
  kind: SfpmSwapKind
}

/** Result of quoting a plan against live pool state. */
export interface SfpmSwapQuote {
  /** Amount of the input token pulled from the caller. */
  amountIn: bigint
  /** Amount of the output token delivered to the caller. */
  amountOut: bigint
  /** Pool tick after the swap. */
  finalTick: number
}
