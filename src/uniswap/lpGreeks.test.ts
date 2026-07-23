import { describe, expect, it } from 'vitest'

import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import { getAmountsForLiquidity, getLpGreeks } from './lpGreeks'

const Q192 = 1n << 192n

describe('getAmountsForLiquidity', () => {
  const L = 10n ** 18n
  const sqrtLower = tickToSqrtPriceX96(-1000n)
  const sqrtUpper = tickToSqrtPriceX96(1000n)

  it('is all token0 below the range, all token1 above', () => {
    const below = getAmountsForLiquidity(tickToSqrtPriceX96(-5000n), sqrtLower, sqrtUpper, L)
    expect(below.amount0 > 0n).toBe(true)
    expect(below.amount1).toBe(0n)

    const above = getAmountsForLiquidity(tickToSqrtPriceX96(5000n), sqrtLower, sqrtUpper, L)
    expect(above.amount0).toBe(0n)
    expect(above.amount1 > 0n).toBe(true)
  })

  it('holds both tokens in range', () => {
    const inRange = getAmountsForLiquidity(tickToSqrtPriceX96(0n), sqrtLower, sqrtUpper, L)
    expect(inRange.amount0 > 0n).toBe(true)
    expect(inRange.amount1 > 0n).toBe(true)
  })

  it('is symmetric at the geometric midpoint of a symmetric range', () => {
    // Range centered on tick 0 → equal token0/token1 value at tick 0.
    const { amount0, amount1 } = getAmountsForLiquidity(
      tickToSqrtPriceX96(0n),
      sqrtLower,
      sqrtUpper,
      L,
    )
    // At tick 0, price ≈ 1, so amount0 ≈ amount1 (within rounding).
    const diff = amount0 > amount1 ? amount0 - amount1 : amount1 - amount0
    expect(diff < amount0 / 1_000_000n + 2n).toBe(true)
  })

  it('reorders A/B when passed inverted', () => {
    const normal = getAmountsForLiquidity(tickToSqrtPriceX96(0n), sqrtLower, sqrtUpper, L)
    const inverted = getAmountsForLiquidity(tickToSqrtPriceX96(0n), sqrtUpper, sqrtLower, L)
    expect(inverted).toEqual(normal)
  })
})

describe('getLpGreeks', () => {
  const base = {
    liquidity: 10n ** 18n,
    tickLower: -2000n,
    tickUpper: 2000n,
    currentTick: 0n,
  } as const

  it('delta equals the asset-token amount held', () => {
    const sqrtP = tickToSqrtPriceX96(base.currentTick)
    const amounts = getAmountsForLiquidity(
      sqrtP,
      tickToSqrtPriceX96(base.tickLower),
      tickToSqrtPriceX96(base.tickUpper),
      base.liquidity,
    )
    expect(getLpGreeks({ ...base, assetIndex: 0 }).delta).toBe(amounts.amount0)
    expect(getLpGreeks({ ...base, assetIndex: 1 }).delta).toBe(amounts.amount1)
  })

  it('is short gamma in range and zero gamma out of range', () => {
    expect(getLpGreeks({ ...base, assetIndex: 0 }).gamma < 0n).toBe(true)
    expect(getLpGreeks({ ...base, assetIndex: 1 }).gamma < 0n).toBe(true)

    const outLow = getLpGreeks({ ...base, currentTick: -5000n, assetIndex: 0 })
    const outHigh = getLpGreeks({ ...base, currentTick: 5000n, assetIndex: 0 })
    expect(outLow.gamma).toBe(0n)
    expect(outHigh.gamma).toBe(0n)
  })

  // Delta = dV/dP: compare the closed-form delta to a numerical derivative of value.
  // Work in the token1/asset=token0 frame and bump the price by a small tick step.
  it('delta matches the numerical derivative of value (asset=token0)', () => {
    const step = 1n // 1 tick
    const priceAt = (tick: bigint) => {
      const s = tickToSqrtPriceX96(tick)
      return { sqrtP: s, P: (s * s * 10n ** 18n) / Q192 } // P scaled by 1e18 for precision
    }
    const valueAt = (tick: bigint) =>
      getLpGreeks({ ...base, currentTick: tick, assetIndex: 0 }).value

    const up = priceAt(base.currentTick + step)
    const down = priceAt(base.currentTick - step)
    const dV = valueAt(base.currentTick + step) - valueAt(base.currentTick - step)
    const dP = up.P - down.P // scaled by 1e18

    // numericalDelta ≈ dV/dP (both scaled by 1e18 in dP cancels the numeraire scale)
    const numericalDelta = (dV * 10n ** 18n) / dP
    const closed = getLpGreeks({ ...base, assetIndex: 0 }).delta

    // within 0.5% of the closed form
    const diff = numericalDelta > closed ? numericalDelta - closed : closed - numericalDelta
    expect(diff * 200n < (closed > 0n ? closed : -closed)).toBe(true)
  })
})
