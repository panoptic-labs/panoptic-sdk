import { describe, expect, it } from 'vitest'

import { singleSwapExitFees } from './singleSwapExitFees'

describe('singleSwapExitFees', () => {
  const leg = { tickLower: 100, tickUpper: 300, liquidity: 10n ** 20n, isLong: false }

  it.each([false, true])('values both swap directions in quote token0=%s', (quoteIsToken0) => {
    const lower = 1.0001 ** 50
    const upper = 1.0001 ** 150
    const current = 1.0001 ** 75
    const fees = singleSwapExitFees(leg, 150, 0.003, quoteIsToken0, 18)
    const token1 = 100 * (upper - current) * 0.003
    const token0 = 100 * (1 / lower - 1 / current) * 0.003
    expect(fees.up).toBeCloseTo(quoteIsToken0 ? token1 / upper ** 2 : token1, 10)
    expect(fees.down).toBeCloseTo(quoteIsToken0 ? token0 : token0 * lower ** 2, 10)
    const long = singleSwapExitFees({ ...leg, isLong: true }, 150, 0.003, quoteIsToken0, 18)
    expect(long.up).toBe(-fees.up)
    expect(long.down).toBe(-fees.down)
  })

  it('preserves quote values when token ordering and ticks are inverted', () => {
    const original = singleSwapExitFees(leg, 150, 0.003, false, 18)
    const inverted = singleSwapExitFees(
      { ...leg, tickLower: -300, tickUpper: -100 },
      -150,
      0.003,
      true,
      18,
    )
    expect(inverted.up).toBeCloseTo(original.down, 12)
    expect(inverted.down).toBeCloseTo(original.up, 12)
  })

  it('returns zero outside the range or without liquidity', () => {
    expect(singleSwapExitFees(leg, 0, 0.003, false, 18)).toEqual({ up: 0, down: 0 })
    expect(singleSwapExitFees({ ...leg, liquidity: 0n }, 150, 0.003, false, 18)).toEqual({
      up: 0,
      down: 0,
    })
  })
})
