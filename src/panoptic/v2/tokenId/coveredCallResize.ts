/**
 * Resizing a Panoptic covered call without a same-tokenId size change.
 *
 * dispatch() reads a held tokenId with an unchanged size as a premium settle and any other
 * size as a full burn, so a covered call is never resized in place. Collecting fees and
 * adding to the position both burn the held tokenId and mint a replacement in one dispatch.
 *
 * The replacement is minted FIRST: burning a short leg first can revert with
 * NotEnoughLiquidityInChunk when part of that liquidity has been bought. Minting first
 * needs a tokenId distinct from the held one, so the replacement is a sibling: the same
 * call with its credit leg's strike nudged by a tick. That keeps the two-leg covered call
 * shape (and its ratio-89 fingerprint), unlike deriveUniqueTokenId's extra leg, and moves
 * the credit notional by about 0.01%.
 *
 * @module v2/tokenId/coveredCallResize
 */

import { PanopticError } from '../errors'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
import { isUpfrontCoveredCallTokenId } from './coveredCall'
import { addLegToTokenId, decodeAllLegs } from './encoding'

const POOL_ID_MASK = (1n << 64n) - 1n

/** Tick limits and spread limit for one dispatch entry: `[low, high, spread]` (or swapped). */
export type DispatchTickLimits = readonly [bigint, bigint, bigint]

/**
 * The covered call's sibling: identical legs except the credit leg's strike, nudged one tick
 * at a time until the tokenId is not in `taken`. Throws when `tokenId` is not an upfront
 * covered call.
 */
export function coveredCallSiblingTokenId(tokenId: bigint, taken: readonly bigint[] = []): bigint {
  if (!isUpfrontCoveredCallTokenId(tokenId))
    throw new PanopticError('coveredCallSiblingTokenId: expected an upfront covered call tokenId')
  const legs = decodeAllLegs(tokenId)
  const avoid = new Set([tokenId, ...taken])
  const build = (delta: bigint) => {
    let out = tokenId & POOL_ID_MASK
    for (const leg of legs) {
      out = addLegToTokenId(out, {
        index: leg.index,
        asset: leg.asset,
        tokenType: leg.tokenType,
        optionRatio: leg.optionRatio,
        isLong: leg.isLong ? 1n : 0n,
        riskPartner: leg.riskPartner,
        strike: leg.width === 0n ? leg.strike + delta : leg.strike,
        width: leg.width,
      })
    }
    return out
  }
  const credit = legs.find((leg) => leg.width === 0n)
  if (!credit) throw new PanopticError('coveredCallSiblingTokenId: missing credit leg')
  for (let step = 1n; step <= 64n; step++) {
    for (const delta of [-step, step]) {
      const strike = credit.strike + delta
      if (strike <= MIN_TICK || strike >= MAX_TICK) continue
      const candidate = build(delta)
      if (!avoid.has(candidate)) return candidate
    }
  }
  throw new PanopticError('coveredCallSiblingTokenId: no free sibling strike')
}

export interface CoveredCallResizeDispatchParams {
  /** The account's open positions before the dispatch (must include `tokenId`). */
  existingPositionIds: readonly bigint[]
  /** Held covered call to replace. */
  tokenId: bigint
  /** Replacement tokenId (must differ from every held id). */
  newTokenId: bigint
  /** Size of the replacement. */
  newPositionSize: bigint
  /** Tick limits for the mint (swap-at-mint order when the upfront credit is bought). */
  mintLimits: DispatchTickLimits
  /** Tick limits for the burn. */
  burnLimits: DispatchTickLimits
  /**
   * The risk engine's MAX_OPEN_LEGS. When minting first would briefly hold more legs than
   * this, the held position is burned first instead; the final count must still fit.
   */
  maxLegs?: bigint
}

export interface CoveredCallResizeDispatch {
  positionIdList: bigint[]
  finalPositionIdList: bigint[]
  positionSizes: bigint[]
  tickAndSpreadLimits: DispatchTickLimits[]
}

const legCount = (tokenId: bigint) => BigInt(decodeAllLegs(tokenId).length)

/**
 * dispatch() arguments that mint `newTokenId` first, then burn `tokenId` (size 0 marks the
 * burn: any size other than the stored one closes a held position). At the leg limit the
 * burn goes first, so the account never holds more than `maxLegs` mid-dispatch.
 */
export function buildCoveredCallResizeDispatch(
  params: CoveredCallResizeDispatchParams,
): CoveredCallResizeDispatch {
  const { existingPositionIds, tokenId, newTokenId, newPositionSize } = params
  if (!existingPositionIds.includes(tokenId))
    throw new PanopticError('buildCoveredCallResizeDispatch: tokenId is not an open position')
  if (existingPositionIds.includes(newTokenId) || newTokenId === tokenId)
    throw new PanopticError('buildCoveredCallResizeDispatch: newTokenId is already held')
  if (newPositionSize <= 0n)
    throw new PanopticError('buildCoveredCallResizeDispatch: newPositionSize must be > 0')
  const finalPositionIdList = [...existingPositionIds.filter((id) => id !== tokenId), newTokenId]
  const { maxLegs } = params
  if (maxLegs !== undefined) {
    const held = existingPositionIds.reduce((sum, id) => sum + legCount(id), 0n)
    const final = held - legCount(tokenId) + legCount(newTokenId)
    if (final > maxLegs)
      throw new PanopticError(
        `buildCoveredCallResizeDispatch: the resized account would hold ${final} legs (max ${maxLegs})`,
      )
    if (held + legCount(newTokenId) > maxLegs)
      return {
        positionIdList: [tokenId, newTokenId],
        finalPositionIdList,
        positionSizes: [0n, newPositionSize],
        tickAndSpreadLimits: [params.burnLimits, params.mintLimits],
      }
  }
  return {
    positionIdList: [newTokenId, tokenId],
    finalPositionIdList,
    positionSizes: [newPositionSize, 0n],
    tickAndSpreadLimits: [params.mintLimits, params.burnLimits],
  }
}

/**
 * Collect a covered call's fees: re-mint the same position (as its sibling) at the same
 * size, then burn the old one, realizing the accumulated premium into collateral.
 */
export function buildCoveredCallCollectDispatch(
  params: Omit<CoveredCallResizeDispatchParams, 'newTokenId' | 'newPositionSize'> & {
    positionSize: bigint
  },
): CoveredCallResizeDispatch & { newTokenId: bigint } {
  const newTokenId = coveredCallSiblingTokenId(params.tokenId, params.existingPositionIds)
  return {
    ...buildCoveredCallResizeDispatch({
      ...params,
      newTokenId,
      newPositionSize: params.positionSize,
    }),
    newTokenId,
  }
}

/**
 * Grow a covered call: mint the larger replacement first, then burn the old position.
 * `newTokenId` is normally a freshly built upfront covered call at the new size (its credit
 * strike re-priced at the current tick); when it collides with a held id, its sibling is used.
 */
export function buildCoveredCallIncreaseDispatch(
  params: CoveredCallResizeDispatchParams & { positionSize: bigint },
): CoveredCallResizeDispatch & { newTokenId: bigint } {
  if (params.newPositionSize <= params.positionSize)
    throw new PanopticError(
      'buildCoveredCallIncreaseDispatch: newPositionSize must exceed the current size',
    )
  const held = [...params.existingPositionIds]
  const newTokenId = held.includes(params.newTokenId)
    ? coveredCallSiblingTokenId(params.newTokenId, held)
    : params.newTokenId
  return { ...buildCoveredCallResizeDispatch({ ...params, newTokenId }), newTokenId }
}
