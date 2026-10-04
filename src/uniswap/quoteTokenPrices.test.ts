import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { quoteTokenPrices } from './quoteTokenPrices'

const native = { address: 'native', decimals: 18n }
const token = { address: 'token', decimals: 6n }
const pool = {
  id: 'pool',
  token0: token,
  token1: native,
  tick: 0n,
  liquidity: 1000000000000000000n,
}

describe('quoteTokenPrices', () => {
  it('handles both token orderings and different decimals', () => {
    const forward = quoteTokenPrices([pool], ['native']).get('token')
    const reverse = quoteTokenPrices([{ ...pool, token0: native, token1: token }], ['native']).get(
      'token',
    )
    expect(forward?.eq('0.000000000001')).toBe(true)
    expect(reverse?.eq('0.000000000001')).toBe(true)
  })

  it('inverts nonzero ticks with the token ordering', () => {
    const a = quoteTokenPrices([{ ...pool, tick: 10000n }], ['native']).get('token')
    const b = quoteTokenPrices(
      [{ ...pool, token0: native, token1: token, tick: -10000n }],
      ['native'],
    ).get('token')
    expect(a?.div(b ?? NaN).toNumber()).toBeCloseTo(1, 12)
  })

  it('compares native-side depth instead of raw liquidity across mixed-asset pools', () => {
    const deep = { ...pool, id: 'deep', tick: 100000n, liquidity: 100n }
    const shallow = { ...pool, id: 'shallow', tick: -100000n, liquidity: 1000n }
    const expected = quoteTokenPrices([deep], ['native']).get('token')
    const prices = quoteTokenPrices([shallow, deep], ['native'])
    expect(prices.get('token')?.eq(expected ?? NaN)).toBe(true)
  })

  it('aliases native/wrapped addresses and normalizes token addresses', () => {
    const prices = quoteTokenPrices(
      [{ ...pool, token0: { ...token, address: 'TOKEN' }, token1: { ...native, address: 'WETH' } }],
      ['native', 'weth'],
    )
    expect(prices.get('token')).toEqual(new Decimal('0.000000000001'))
  })

  it('omits missing routes, empty pools, invalid ticks, and quote/quote pairs', () => {
    expect(quoteTokenPrices([pool], ['other']).size).toBe(0)
    expect(quoteTokenPrices([{ ...pool, liquidity: 0n }], ['native']).size).toBe(0)
    expect(quoteTokenPrices([{ ...pool, tick: 887273n }], ['native']).size).toBe(0)
    expect(quoteTokenPrices([pool], ['native', 'token']).size).toBe(0)
  })
})
