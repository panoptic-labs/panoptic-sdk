/**
 * Shared construction for dispatches wrapped in a temporary width=0 **credit**
 * leg, used to move token flow from one collateral token to the other inside a
 * single `dispatch()`.
 *
 * A credit rather than a loan: a credit pays into the pool instead of borrowing
 * from it, so it requires zero buying power, never touches `s_assetsInAMM`, and
 * can never be capped by a collateral tracker's utilization.
 *
 * @module v2/simulations/creditWrap
 */

import type { BatchDispatchArgs } from '../batch/types'
import type { TickAndSpreadLimits } from '../writes/position'

/**
 * Pre-encoded `dispatch()` arguments a credit wrap is applied to.
 *
 * Alias of {@link BatchDispatchArgs} — the two are the same concept.
 */
export type DispatchIntent = BatchDispatchArgs

/**
 * Which side of the swap is exact.
 *
 * - `exact-out`: the credit **sources** a known amount of its token, paying a
 *   swapped amount of the counter-token. Mint carries `swapAtMint=true`.
 * - `exact-in`: the credit **sells** a known amount of its token, receiving a
 *   swapped amount of the counter-token. Burn carries `swapAtMint=true`.
 */
export type CreditWrapDirection = 'exact-in' | 'exact-out'

/**
 * Where the two credit legs sit relative to the user's own operations.
 *
 * - `straddle`: mint first, user ops, burn last. Required for `exact-out`, where
 *   the sourced token must be available while the user's ops run.
 * - `prepend`: both legs before the user's ops. Used by bootstrap recovery when
 *   the account can sell one collateral token but holds none of the token it needs.
 * - `append`: both legs after the user's ops, for flows where the token being
 *   sold does not exist until those operations run.
 */
export type CreditWrapPlacement = 'append' | 'prepend' | 'straddle'

export interface BuildCreditWrappedDispatchParams {
  dispatch: DispatchIntent
  /** The temporary width=0 credit leg. */
  creditTokenId: bigint
  /** Size of the mint leg. The burn leg always passes `0n` (= burn all). */
  creditPositionSize: bigint
  tickLimitLow: bigint
  tickLimitHigh: bigint
  direction: CreditWrapDirection
  placement: CreditWrapPlacement
}

/**
 * Wrap a dispatch with a temporary credit leg that is opened and closed in the
 * same transaction, netting to a swap.
 *
 * `swapAtMint` is not a calldata flag — it is the ORDER of the tick-limit pair:
 * descending `[high, low]` turns the swap on, ascending `[low, high]` leaves it
 * off. Exactly one of the two legs carries it, and which one is what makes the
 * swap exact-in vs exact-out.
 */
export function buildCreditWrappedDispatch(
  params: BuildCreditWrappedDispatchParams,
): DispatchIntent {
  const { dispatch, creditTokenId, creditPositionSize, direction, placement } = params
  const low =
    params.tickLimitLow <= params.tickLimitHigh ? params.tickLimitLow : params.tickLimitHigh
  const high =
    params.tickLimitLow <= params.tickLimitHigh ? params.tickLimitHigh : params.tickLimitLow

  const swapping: TickAndSpreadLimits = [high, low, 0n]
  const notSwapping: TickAndSpreadLimits = [low, high, 0n]
  const mintLimits = direction === 'exact-out' ? swapping : notSwapping
  const burnLimits = direction === 'exact-out' ? notSwapping : swapping

  const positionIdList =
    placement === 'straddle'
      ? [creditTokenId, ...dispatch.positionIdList, creditTokenId]
      : placement === 'prepend'
        ? [creditTokenId, creditTokenId, ...dispatch.positionIdList]
        : [...dispatch.positionIdList, creditTokenId, creditTokenId]
  const positionSizes =
    placement === 'straddle'
      ? [creditPositionSize, ...dispatch.positionSizes, 0n]
      : placement === 'prepend'
        ? [creditPositionSize, 0n, ...dispatch.positionSizes]
        : [...dispatch.positionSizes, creditPositionSize, 0n]
  const tickAndSpreadLimits =
    placement === 'straddle'
      ? [mintLimits, ...dispatch.tickAndSpreadLimits, burnLimits]
      : placement === 'prepend'
        ? [mintLimits, burnLimits, ...dispatch.tickAndSpreadLimits]
        : [...dispatch.tickAndSpreadLimits, mintLimits, burnLimits]

  const wrapped: DispatchIntent = {
    positionIdList,
    finalPositionIdList: [...dispatch.finalPositionIdList],
    positionSizes,
    tickAndSpreadLimits,
    usePremiaAsCollateral: dispatch.usePremiaAsCollateral,
    builderCode: dispatch.builderCode,
  }
  return wrapped
}
