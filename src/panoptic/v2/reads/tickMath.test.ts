import { describe, expect, it } from 'vitest'

import { tickToSqrtPriceX96 } from '../formatters/tick'
import { MAX_TICK, MIN_TICK } from '../utils/constants'

// Canonical TickMath constants from Uniswap V3 core
const MIN_SQRT_RATIO = 4295128739n
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n
const Q96 = 2n ** 96n

describe('tickToSqrtPriceX96 (Uniswap V3 TickMath)', () => {
  it('returns 2^96 at tick 0', () => {
    expect(tickToSqrtPriceX96(0n)).toBe(Q96)
  })

  it('matches MIN_SQRT_RATIO at MIN_TICK', () => {
    expect(tickToSqrtPriceX96(MIN_TICK)).toBe(MIN_SQRT_RATIO)
  })

  it('matches MAX_SQRT_RATIO at MAX_TICK', () => {
    expect(tickToSqrtPriceX96(MAX_TICK)).toBe(MAX_SQRT_RATIO)
  })

  it('throws on out-of-range tick', () => {
    expect(() => tickToSqrtPriceX96(MIN_TICK - 1n)).toThrow(RangeError)
    expect(() => tickToSqrtPriceX96(MAX_TICK + 1n)).toThrow(RangeError)
  })
})
