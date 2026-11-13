import { describe, expect, it } from 'vitest'

import { tickToSqrtPriceX96 } from '../formatters/tick'
import { getLegTokenInventory } from '../greeks/legLiquidity'
import { buildEarnCoveredCallTokenId } from '../tokenId/coveredCall'
import { decodeTokenId } from '../tokenId/decode'
import { getEarnRecoveryInputBudget } from './earnRecoveryBudget'

function params(assetIdx: 0n | 1n) {
  const currentTick = assetIdx === 0n ? -210180n : 210180n
  const tokenId = buildEarnCoveredCallTokenId({
    poolId: 1n,
    assetIdx,
    strike: currentTick,
    width: 24n,
    loanStrike: assetIdx === 0n ? -250000n : 250000n,
  })
  return {
    dispatch: {
      positionIdList: [tokenId],
      finalPositionIdList: [tokenId],
      positionSizes: [10n ** 15n],
      tickAndSpreadLimits: [[currentTick - 30n, currentTick + 30n, 0n] as const],
      usePremiaAsCollateral: false,
      builderCode: 0n,
    },
    existingPositionIds: [] as bigint[],
    tokenOutIndex: assetIdx === 0n ? (1n as const) : (0n as const),
    currentTick,
    sqrtPriceX96: tickToSqrtPriceX96(currentTick),
    tickSpacing: 5n,
    tickLimitLow: currentTick - 30n,
    tickLimitHigh: currentTick + 30n,
    estimatedAmountIn: 600000000000000n,
    estimatedAmountOut: 450000n,
    slippageBps: 30n,
  }
}

describe('Earn funding input budgets', () => {
  it.each([0n, 1n] as const)(
    'covers narrow-call inventory movement in mixed 18/6-decimal frame %s',
    (assetIdx) => {
      const input = params(assetIdx)
      const budget = getEarnRecoveryInputBudget(input)
      expect(budget).toBeGreaterThan((input.estimatedAmountIn * 13n) / 10n)
      const leg = decodeTokenId(input.dispatch.positionIdList[0] ?? 0n).legs.find(
        (leg) => leg.width > 0n,
      )
      if (!leg) throw new Error('Missing call')
      const inventory = (tick: bigint) =>
        getLegTokenInventory(
          leg,
          tick,
          input.dispatch.positionSizes[0] ?? 0n,
          input.tickSpacing,
          input.tokenOutIndex,
        )
      const initial = inventory(input.currentTick)
      for (const move of [-25n, -5n, 0n, 5n, 25n]) {
        const tick = input.currentTick + move
        const output = input.estimatedAmountOut + inventory(tick) - initial
        const currentPrice = input.sqrtPriceX96 ** 2n
        const futurePrice = tickToSqrtPriceX96(tick) ** 2n
        const numerator =
          input.estimatedAmountIn * output * (assetIdx === 0n ? currentPrice : futurePrice)
        const denominator =
          input.estimatedAmountOut * (assetIdx === 0n ? futurePrice : currentPrice)
        const repricedInput = (numerator + denominator - 1n) / denominator
        expect(repricedInput).toBeLessThanOrEqual(budget)
      }
    },
  )
  it('uses similar budgets when the same market is inverted', () => {
    const left = getEarnRecoveryInputBudget(params(0n))
    const right = getEarnRecoveryInputBudget(params(1n))
    const difference = left > right ? left - right : right - left
    expect(difference * 1000n).toBeLessThan(left)
  })
  it('accounts for every covered call in a multi-position mint', () => {
    const input = params(0n)
    const extraId = buildEarnCoveredCallTokenId({
      poolId: 1n,
      assetIdx: 0n,
      strike: input.currentTick + 5n,
      width: 24n,
      loanStrike: -250000n,
    })
    const combined = getEarnRecoveryInputBudget({
      ...input,
      dispatch: {
        ...input.dispatch,
        positionIdList: [...input.dispatch.positionIdList, extraId],
        finalPositionIdList: [...input.dispatch.finalPositionIdList, extraId],
        positionSizes: [...input.dispatch.positionSizes, 10n ** 15n],
        tickAndSpreadLimits: [
          ...input.dispatch.tickAndSpreadLimits,
          input.dispatch.tickAndSpreadLimits[0] ?? [0n, 1n, 0n],
        ],
      },
    })
    expect(combined).toBeGreaterThan(getEarnRecoveryInputBudget(input))
  })
  it('does not expand budgets for burns, resizing, mixed assets or other strategies', () => {
    const input = params(0n)
    for (const override of [
      { existingPositionIds: input.dispatch.positionIdList },
      { dispatch: { ...input.dispatch, positionSizes: [0n] } },
      { dispatch: { ...input.dispatch, positionIdList: [1n] } },
      { tokenOutIndex: 0n as const },
      { slippageBps: 0n },
    ])
      expect(getEarnRecoveryInputBudget({ ...input, ...override })).toBe(input.estimatedAmountIn)
  })
})
