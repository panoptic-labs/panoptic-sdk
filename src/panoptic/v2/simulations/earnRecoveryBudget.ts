import { tickToSqrtPriceX96 } from '../formatters/tick'
import { getLegTokenInventory } from '../greeks/legLiquidity'
import { isEarnCoveredCallTokenId } from '../tokenId/coveredCall'
import { decodeTokenId } from '../tokenId/decode'
import type { DispatchIntent } from './creditWrap'

export function getEarnMintCalls(
  dispatch: DispatchIntent,
  existingPositionIds: readonly bigint[],
  tokenOutIndex: 0n | 1n,
) {
  const calls = dispatch.positionIdList.flatMap((tokenId, index) => {
    const positionSize = dispatch.positionSizes[index]
    if (
      !positionSize ||
      positionSize <= 0n ||
      existingPositionIds.includes(tokenId) ||
      !isEarnCoveredCallTokenId(tokenId)
    )
      return []
    const leg = decodeTokenId(tokenId).legs.find((leg) => leg.width > 0n)
    return leg && leg.asset !== tokenOutIndex ? [{ leg, positionSize }] : []
  })
  return calls.length > 0 && calls.length === dispatch.positionIdList.length ? calls : undefined
}

/** Bound the input for new Earn mints across the reviewed execution-price range. */
export function getEarnRecoveryInputBudget({
  dispatch,
  existingPositionIds,
  tokenOutIndex,
  currentTick,
  sqrtPriceX96,
  tickSpacing,
  tickLimitLow,
  tickLimitHigh,
  estimatedAmountIn,
  estimatedAmountOut,
  slippageBps,
}: {
  dispatch: DispatchIntent
  existingPositionIds: readonly bigint[]
  tokenOutIndex: 0n | 1n
  currentTick: bigint
  sqrtPriceX96: bigint
  tickSpacing: bigint
  tickLimitLow: bigint
  tickLimitHigh: bigint
  estimatedAmountIn: bigint
  estimatedAmountOut: bigint
  slippageBps: bigint
}) {
  if (
    estimatedAmountIn <= 0n ||
    estimatedAmountOut <= 0n ||
    sqrtPriceX96 <= 0n ||
    slippageBps <= 0n ||
    tickLimitLow >= tickLimitHigh ||
    currentTick < tickLimitLow ||
    currentTick > tickLimitHigh ||
    dispatch.positionIdList.length === 0
  )
    return estimatedAmountIn

  // Contract price limits compare floored ticks, including the upper tick's price interval.
  const upperPriceTick = tickLimitHigh < 887272n ? tickLimitHigh + 1n : tickLimitHigh
  const currentUpperTick = currentTick < 887272n ? currentTick + 1n : currentTick
  const calls = getEarnMintCalls(dispatch, existingPositionIds, tokenOutIndex)
  if (!calls) return estimatedAmountIn
  let additionalOutput = 0n
  for (const { leg: call, positionSize } of calls) {
    const inventory = (tick: bigint) =>
      getLegTokenInventory(call, tick, positionSize, tickSpacing, tokenOutIndex)
    const atCurrent = inventory(currentTick)
    const atCurrentUpper = inventory(currentUpperTick)
    const minimumCurrent = atCurrent < atCurrentUpper ? atCurrent : atCurrentUpper
    const atLow = inventory(tickLimitLow)
    const atHigh = inventory(upperPriceTick)
    const maximumOutput = atLow > atHigh ? atLow : atHigh
    if (maximumOutput > minimumCurrent) additionalOutput += maximumOutput - minimumCurrent
  }

  const currentPriceSquared = sqrtPriceX96 * sqrtPriceX96
  const lowSqrt = tickToSqrtPriceX96(tickLimitLow)
  const highSqrt = tickToSqrtPriceX96(upperPriceTick)
  const numeratorPrice = tokenOutIndex === 1n ? currentPriceSquared : highSqrt * highSqrt
  const denominatorPrice = tokenOutIndex === 1n ? lowSqrt * lowSqrt : currentPriceSquared
  const numerator =
    estimatedAmountIn *
    (estimatedAmountOut + additionalOutput) *
    numeratorPrice *
    (10_000n + slippageBps)
  const denominator = estimatedAmountOut * denominatorPrice * 10_000n
  return (numerator + denominator - 1n) / denominator
}
