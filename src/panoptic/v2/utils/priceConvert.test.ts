import { describe, expect, it } from 'vitest'

import { PanopticError } from '../errors'
import { convert0to1, convert1to0, convertToTokenIndex } from './priceConvert'

/** 2^96 — price 1.0, where both conversions are the identity. */
const Q96 = 79228162514264337593543950336n

describe('priceConvert', () => {
  it('round-trips at price 1.0', () => {
    expect(convert0to1(1_000n, Q96)).toBe(1_000n)
    expect(convert1to0(1_000n, Q96)).toBe(1_000n)
  })

  it('converts in opposite directions', () => {
    // price 4.0 (sqrt = 2)
    const sqrt = Q96 * 2n
    expect(convert0to1(1_000n, sqrt)).toBe(4_000n)
    expect(convert1to0(4_000n, sqrt)).toBe(1_000n)
  })

  it('leaves an amount alone when the indices match', () => {
    expect(convertToTokenIndex(1_000n, 0n, 0n, Q96 * 2n)).toBe(1_000n)
  })

  it('routes by index', () => {
    const sqrt = Q96 * 2n
    expect(convertToTokenIndex(1_000n, 0n, 1n, sqrt)).toBe(convert0to1(1_000n, sqrt))
    expect(convertToTokenIndex(4_000n, 1n, 0n, sqrt)).toBe(convert1to0(4_000n, sqrt))
  })

  // convert1to0 divides by the price, so zero would surface as a RangeError from
  // inside the arithmetic rather than a typed SDK error.
  it.each([0n, -1n])('rejects a non-positive price (%s)', (bad) => {
    expect(() => convert0to1(1_000n, bad)).toThrow(PanopticError)
    expect(() => convert1to0(1_000n, bad)).toThrow(PanopticError)
  })
})
