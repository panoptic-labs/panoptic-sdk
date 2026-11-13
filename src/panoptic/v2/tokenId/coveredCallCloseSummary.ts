import {
  getCoveredCallAdvance,
  isEarnCoveredCallTokenId,
  isUpfrontCoveredCallTokenId,
} from './coveredCall'
import { decodeTokenId } from './decode'

/** Native-token advance and lifetime premium totals, valued in the call's quote token. */
export function getEarnCoveredCallCloseSummary({
  tokenId,
  positionSize,
  accruedPremium0,
  accruedPremium1,
  settledPremium0,
  settledPremium1,
  currentTick,
}: {
  tokenId: bigint
  positionSize: bigint
  accruedPremium0: bigint
  accruedPremium1: bigint
  settledPremium0: bigint
  settledPremium1: bigint
  currentTick: bigint
}) {
  const loan = decodeTokenId(tokenId).legs.find((leg) => leg.width === 0n)
  if (
    !(isEarnCoveredCallTokenId(tokenId) || isUpfrontCoveredCallTokenId(tokenId)) ||
    !loan ||
    positionSize <= 0n
  )
    throw new RangeError('Expected an open Earn covered call')
  const assetIdx = loan.asset === 0n ? 0n : 1n
  const quoteTokenIndex = assetIdx === 0n ? 1n : 0n
  const advanceQuote = getCoveredCallAdvance(positionSize * loan.optionRatio, loan.strike, assetIdx)
  const premium0 = accruedPremium0 + settledPremium0
  const premium1 = accruedPremium1 + settledPremium1
  const premiumQuote =
    quoteTokenIndex === 0n
      ? premium0 + getCoveredCallAdvance(premium1, currentTick, 1n)
      : premium1 + getCoveredCallAdvance(premium0, currentTick, 0n)
  return {
    quoteTokenIndex,
    /** True when the width-0 leg is a credit returned at close rather than a loan to repay. */
    isCredit: loan.isLong,
    advance0: quoteTokenIndex === 0n ? advanceQuote : 0n,
    advance1: quoteTokenIndex === 1n ? advanceQuote : 0n,
    advanceQuote,
    premium0,
    premium1,
    premiumQuote,
  }
}
