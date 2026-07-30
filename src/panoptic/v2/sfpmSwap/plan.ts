/**
 * Build an SFPM off-venue swap plan (tokenId + per-call tick limits).
 * @module v2/sfpmSwap/plan
 */
import { encodeAbiParameters } from 'viem'

import { PanopticError } from '../errors'
import { createTokenIdBuilder } from '../tokenId'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
import type { SfpmSwapPlan, SfpmSwapPlanParams } from './types'

/** Wide, non-inverted band for the paired (non-swapping) call — never triggers a swap. */
const WIDE_LIMITS: [number, number] = [Number(MIN_TICK) + 1, Number(MAX_TICK) - 1]

/**
 * Convert a slippage tolerance in bps to a conservative Uniswap tick distance.
 *
 * Ticks are 1.0001^tick, so each tick ≈ 1 bps. This walks up powers of 1.0001
 * until the cumulative price move covers `slippageBps`, matching the hedger-bot's
 * dispatch-path helper so both swap paths agree on band width.
 */
export function slippageBpsToTickDistance(slippageBps: bigint): bigint {
  if (slippageBps < 0n || slippageBps > 1000n) {
    throw new PanopticError(`slippage bps ${slippageBps} out of bounds (0..1000)`)
  }
  if (slippageBps === 0n) return 0n
  let numerator = 1n
  let denominator = 1n
  let ticks = 0n
  while (numerator * 10_000n < denominator * (10_000n + slippageBps)) {
    numerator *= 10_001n
    denominator *= 10_000n
    ticks += 1n
  }
  return ticks
}

/**
 * Build the swap plan.
 *
 * Mechanism (verified in the Phase 0 fork test):
 * - A single-leg **loan** tokenId (width=0, isLong=false, `asset == tokenType`) moves
 *   exactly `positionSize` of the `tokenType` token when its call carries inverted
 *   tick limits (`low > high`); the paired call uses a wide band and moves nothing.
 * - `exactIn`: swap on the **mint**; `tokenType` = the **input** token index.
 * - `exactOut`: swap on the **burn** (isLong flips → exact-output); `tokenType` = the
 *   **output** token index.
 *
 * The inverted band is centered on `currentTick` at ±`slippageBpsToTickDistance`,
 * which the SFPM re-sorts and enforces as an open interval on the post-swap tick.
 */
export function buildSfpmSwapPlan(params: SfpmSwapPlanParams): SfpmSwapPlan {
  const { sfpmAddress, poolAddress, poolId, kind, zeroForOne, amount, currentTick, slippageBps } =
    params

  if (amount <= 0n) throw new PanopticError(`swap amount must be positive (got ${amount})`)

  const distance = slippageBpsToTickDistance(slippageBps)
  if (distance < 1n) {
    // low > high must hold strictly to trigger the swap, and the post-swap tick
    // check is an open interval — a zero-width band can never pass.
    throw new PanopticError(
      `slippageBps ${slippageBps} yields a zero-width tick band; use a larger tolerance`,
    )
  }

  // exactIn → tokenType = input token; exactOut → tokenType = output token.
  const tokenType = kind === 'exactIn' ? (zeroForOne ? 0n : 1n) : zeroForOne ? 1n : 0n

  const tokenId = createTokenIdBuilder(poolId)
    .addLoan({ asset: tokenType, tokenType, strike: 0n })
    .build()

  const d = Number(distance)
  // Inverted (swap-triggering) band: low > high, clamped to the valid tick range
  // so an extreme tolerance near a range extreme can't produce an unrepresentable
  // limit.
  const low = Math.min(Number(MAX_TICK), currentTick + d)
  const high = Math.max(Number(MIN_TICK), currentTick - d)
  if (low <= high) {
    throw new PanopticError(
      `slippageBps ${slippageBps} at tick ${currentTick} yields a non-inverted band after clamping`,
    )
  }
  const invertedLimits: [number, number] = [low, high]
  const swapOn: 'mint' | 'burn' = kind === 'exactIn' ? 'mint' : 'burn'

  return {
    sfpmAddress,
    poolAddress,
    poolKey: encodeAbiParameters([{ type: 'address' }], [poolAddress]),
    tokenId,
    positionSize: amount,
    mintTickLimits: swapOn === 'mint' ? invertedLimits : WIDE_LIMITS,
    burnTickLimits: swapOn === 'burn' ? invertedLimits : WIDE_LIMITS,
    swapOn,
    kind,
  }
}
