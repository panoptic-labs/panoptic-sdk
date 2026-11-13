import Decimal from 'decimal.js'

import { tickToSqrtPriceX96 } from '../formatters/tick'
import { getLegLiquidityRange, getLegTokenInventory } from '../greeks/legLiquidity'
import type { CollateralTracker, Pool } from '../types'
import { createTokenIdBuilder } from './builder'
import { decodeTokenId } from './decode'

const QuoteDecimal = Decimal.clone({ precision: 80 })

export function computeLoanStrikeForNotional({
  positionSize,
  targetNotional,
  assetIdx,
}: {
  positionSize: bigint
  targetNotional: bigint
  assetIdx: 0n | 1n
}) {
  if (positionSize <= 0n || targetNotional <= 0n) return undefined
  const signed = new QuoteDecimal(targetNotional.toString())
    .div(positionSize.toString())
    .ln()
    .div(new QuoteDecimal('1.0001').ln())
    .floor()
  const tick = BigInt(signed.toFixed(0)) * (assetIdx === 0n ? 1n : -1n)
  if (tick < -887272n || tick > 887272n) return undefined
  return tick
}

export function getCoveredCallAdvance(positionSize: bigint, loanStrike: bigint, assetIdx: 0n | 1n) {
  const sqrt = tickToSqrtPriceX96(assetIdx === 0n ? loanStrike : -loanStrike)
  return (positionSize * sqrt * sqrt) / (1n << 192n)
}

export function buildCoveredCallTokenId({
  poolId,
  assetIdx,
  strike,
  width,
  loanStrike,
}: {
  poolId: bigint
  assetIdx: 0n | 1n
  strike: bigint
  width: bigint
  loanStrike: bigint
}) {
  return createTokenIdBuilder(poolId)
    .addCall({ asset: assetIdx, optionRatio: 1n, isLong: false, strike, width })
    .addCredit({ asset: assetIdx, tokenType: assetIdx, strike })
    .addLoan({ asset: assetIdx, tokenType: assetIdx === 0n ? 1n : 0n, strike: loanStrike })
    .build()
}

/** A short call and its quote-token advance share one position and lifecycle. */
export function buildEarnCoveredCallTokenId(args: Parameters<typeof buildCoveredCallTokenId>[0]) {
  return createTokenIdBuilder(args.poolId)
    .addCall({
      asset: args.assetIdx,
      optionRatio: 1n,
      isLong: false,
      strike: args.strike,
      width: args.width,
    })
    .addLoan({
      asset: args.assetIdx,
      tokenType: args.assetIdx === 0n ? 1n : 0n,
      strike: args.loanStrike,
    })
    .build()
}

export function isEarnCoveredCallTokenId(tokenId: bigint): boolean {
  const { legs } = decodeTokenId(tokenId)
  const call = legs.find((leg) => leg.width > 0n)
  const loan = legs.find((leg) => leg.width === 0n)
  return (
    legs.length === 2 &&
    call !== undefined &&
    loan !== undefined &&
    !call.isLong &&
    call.tokenType === call.asset &&
    call.optionRatio === 1n &&
    !loan.isLong &&
    loan.asset === call.asset &&
    loan.tokenType !== call.asset &&
    loan.optionRatio === 1n
  )
}

/**
 * A short call whose mint-time surplus is locked as a quote-token credit until close.
 * Mint with a swap so the asset left over after funding the call's range buys the credit;
 * swap fees and commission are paid from collateral on top.
 */
export function buildUpfrontCoveredCallTokenId({
  poolId,
  assetIdx,
  strike,
  width,
  tickSpacing,
  positionSize,
  currentTick,
}: {
  poolId: bigint
  assetIdx: 0n | 1n
  strike: bigint
  width: bigint
  tickSpacing: bigint
  positionSize: bigint
  currentTick: bigint
}) {
  const quoteIdx = assetIdx === 0n ? 1n : 0n
  const call = {
    asset: assetIdx,
    optionRatio: 1n,
    isLong: false,
    tokenType: assetIdx,
    strike,
    width,
  }
  const assetSurplus = -getLegTokenInventory(call, currentTick, positionSize, tickSpacing, assetIdx)
  const quoteOwed = getLegTokenInventory(call, currentTick, positionSize, tickSpacing, quoteIdx)
  const targetNotional = getCoveredCallAdvance(assetSurplus, currentTick, assetIdx) - quoteOwed
  const creditStrike = computeLoanStrikeForNotional({ positionSize, targetNotional, assetIdx })
  if (creditStrike === undefined)
    throw new RangeError(
      'Upfront covered calls cannot be minted while the call is fully out of the money',
    )
  return {
    tokenId: createTokenIdBuilder(poolId)
      .addCall({ asset: assetIdx, optionRatio: 1n, isLong: false, strike, width })
      .addCredit({ asset: assetIdx, tokenType: quoteIdx, strike: creditStrike })
      .build(),
    creditStrike,
    upfrontQuote: getCoveredCallAdvance(positionSize, creditStrike, assetIdx),
  }
}

export function isUpfrontCoveredCallTokenId(tokenId: bigint): boolean {
  const { legs } = decodeTokenId(tokenId)
  const call = legs.find((leg) => leg.width > 0n)
  const credit = legs.find((leg) => leg.width === 0n)
  return (
    legs.length === 2 &&
    call !== undefined &&
    credit !== undefined &&
    !call.isLong &&
    call.tokenType === call.asset &&
    call.optionRatio === 1n &&
    credit.isLong &&
    credit.asset === call.asset &&
    credit.tokenType !== call.asset &&
    credit.optionRatio === 1n
  )
}

type FundingTracker = Pick<CollateralTracker, 'totalAssets' | 'insideAMM' | 'symbol' | 'decimals'>

/** Quote reserves needed to fund the call's LP inventory and withdraw its linked advance. */
export function getEarnCoveredCallLiquidity({
  pool,
  tokenId,
  positionSize,
}: {
  pool: Pick<Pool, 'currentTick' | 'tickSpacing'> & {
    collateralTracker0: FundingTracker
    collateralTracker1: FundingTracker
  }
  tokenId: bigint
  positionSize: bigint
}) {
  const { legs } = decodeTokenId(tokenId)
  const call = legs.find((leg) => leg.width > 0n)
  const loan = legs.find((leg) => leg.width === 0n)
  if (!isEarnCoveredCallTokenId(tokenId) || !call || !loan || positionSize <= 0n)
    throw new RangeError('Expected a positive Earn covered call position')
  const assetIdx = call.asset === 0n ? 0n : 1n
  const quoteIndex = assetIdx === 0n ? 1n : 0n
  const tracker = quoteIndex === 0n ? pool.collateralTracker0 : pool.collateralTracker1
  const inventory = getLegTokenInventory(
    call,
    pool.currentTick,
    positionSize,
    pool.tickSpacing,
    quoteIndex,
  )
  const advance = getCoveredCallAdvance(positionSize, loan.strike, assetIdx)
  // Reserve one raw unit for Uniswap's upward mint rounding.
  const requiredQuote = inventory + 1n + advance
  // Each tracker starts with one virtual asset that cannot fund a swap or withdrawal.
  const idle = tracker.totalAssets - tracker.insideAMM - 1n
  const availableQuote = idle > 0n ? idle : 0n
  return {
    requiredQuote,
    availableQuote,
    shortfall: requiredQuote > availableQuote ? requiredQuote - availableQuote : 0n,
    symbol: tracker.symbol,
    decimals: tracker.decimals,
  }
}

/** Separate positions allow the call to zap at mint while the advance remains in quote tokens. */
export function buildCoveredCallPositions({
  poolId,
  assetIdx,
  strike,
  width,
  loanStrike,
}: {
  poolId: bigint
  assetIdx: 0n | 1n
  strike: bigint
  width: bigint
  loanStrike: bigint
}) {
  return {
    tokenId: createTokenIdBuilder(poolId)
      .addCall({ asset: assetIdx, optionRatio: 1n, isLong: false, strike, width })
      .build(),
    loanTokenId: createTokenIdBuilder(poolId)
      .addLoan({ asset: assetIdx, tokenType: assetIdx === 0n ? 1n : 0n, strike: loanStrike })
      .build(),
  }
}

export function getCoveredCallOutcome({
  positionSize,
  assetIdx,
  strike,
  width,
  tickSpacing,
  atTick,
  outstandingAdvance = 0n,
  contributedAsset = positionSize,
}: {
  positionSize: bigint
  assetIdx: 0n | 1n
  strike: bigint
  width: bigint
  tickSpacing: bigint
  atTick: bigint
  outstandingAdvance?: bigint
  contributedAsset?: bigint
}) {
  if (
    positionSize < 0n ||
    contributedAsset < 0n ||
    outstandingAdvance < 0n ||
    width <= 0n ||
    tickSpacing <= 0n
  )
    throw new RangeError('Invalid covered call inputs')
  const leg = {
    asset: assetIdx,
    optionRatio: 1n,
    strike,
    width,
    tokenType: assetIdx,
    isLong: false,
  }
  const range = getLegLiquidityRange(leg, positionSize, tickSpacing)
  const base =
    contributedAsset + getLegTokenInventory(leg, atTick, positionSize, tickSpacing, assetIdx)
  const quote = getLegTokenInventory(
    leg,
    atTick,
    positionSize,
    tickSpacing,
    assetIdx === 0n ? 1n : 0n,
  )
  const netQuote = quote - outstandingAdvance
  return { base, quote, netQuote, repayment: netQuote < 0n ? -netQuote : 0n, ...range }
}

/** Same range-derived premium model used by the trade UI, in quote smallest units. */
export function estimateCoveredCallPremium({
  positionSize,
  assetIdx,
  currentTick,
  strike,
  width,
  tickSpacing,
}: {
  positionSize: bigint
  assetIdx: 0n | 1n
  currentTick: bigint
  strike: bigint
  width: bigint
  tickSpacing: bigint
}) {
  if (positionSize <= 0n || width <= 0n || tickSpacing <= 0n) return 0n
  const tickBase = new QuoteDecimal('1.0001')
  const sign = assetIdx === 0n ? 1n : -1n
  const price = tickBase.pow((sign * currentTick).toString())
  const strikePrice = tickBase.pow((sign * strike).toString())
  const r = tickBase.pow(new QuoteDecimal((width * tickSpacing).toString()).div(4))
  const ivSqrtT = new QuoteDecimal('1.25').mul('2.50662827463').mul(r.minus(1)).div(r.plus(1))
  const d1 = price.div(strikePrice).ln().plus(ivSqrtT.pow(2).div(2)).div(ivSqrtT)
  const theta = price.mul(d1.pow(2).div(-2).exp()).mul(ivSqrtT).div(2).div('2.50662827463')
  return BigInt(
    new QuoteDecimal(positionSize.toString())
      .mul(theta.plus(price.div(1000)))
      .floor()
      .toFixed(0),
  )
}

/** Recognizes short-call strategy shapes; collateral coverage is an account-level constraint. */
export function isCoveredCallTokenId(tokenId: bigint): boolean {
  if (isEarnCoveredCallTokenId(tokenId) || isUpfrontCoveredCallTokenId(tokenId)) return true
  const { legs } = decodeTokenId(tokenId)
  if (legs.length !== 1 && legs.length !== 3) return false
  const call = legs.find((leg) => leg.width > 0n)
  if (!call || call.isLong || call.tokenType !== call.asset || call.optionRatio !== 1n) return false
  if (legs.length === 1) return true
  const credit = legs.find((leg) => leg.width === 0n && leg.isLong)
  const loan = legs.find((leg) => leg.width === 0n && !leg.isLong)
  return (
    credit !== undefined &&
    loan !== undefined &&
    credit.asset === call.asset &&
    credit.tokenType === call.asset &&
    credit.optionRatio === 1n &&
    loan.asset === call.asset &&
    loan.tokenType !== call.asset &&
    loan.optionRatio === 1n
  )
}
