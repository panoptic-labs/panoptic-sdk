import { describe, expect, it } from 'vitest'

import { pickBestVenue } from './compare'

describe('pickBestVenue', () => {
  it('exact-in: higher output wins', () => {
    expect(
      pickBestVenue({ kind: 'sell', uniswap: { amountOut: 100n }, cow: { buyAmount: 101n } }),
    ).toEqual({ winner: 'cow', advantageBps: 100n })
    expect(
      pickBestVenue({ kind: 'sell', uniswap: { amountOut: 102n }, cow: { buyAmount: 101n } }),
    ).toMatchObject({ winner: 'uniswap' })
  })

  it('exact-out: lower input wins', () => {
    expect(
      pickBestVenue({ kind: 'buy', uniswap: { amountIn: 100n }, cow: { sellAmountTotal: 99n } }),
    ).toMatchObject({ winner: 'cow' })
    expect(
      pickBestVenue({ kind: 'buy', uniswap: { amountIn: 99n }, cow: { sellAmountTotal: 100n } }),
    ).toMatchObject({ winner: 'uniswap', advantageBps: 101n })
  })

  it('single usable quote wins', () => {
    expect(pickBestVenue({ kind: 'sell', cow: { buyAmount: 100n } })).toEqual({ winner: 'cow' })
    expect(pickBestVenue({ kind: 'sell', uniswap: { amountOut: 100n } })).toEqual({
      winner: 'uniswap',
    })
  })

  it('ties and no-quote default to uniswap', () => {
    expect(
      pickBestVenue({ kind: 'sell', uniswap: { amountOut: 100n }, cow: { buyAmount: 100n } }),
    ).toEqual({ winner: 'uniswap', advantageBps: 0n })
    expect(pickBestVenue({ kind: 'buy' })).toEqual({ winner: 'uniswap' })
  })

  it('zero amounts are not usable quotes', () => {
    expect(
      pickBestVenue({ kind: 'sell', uniswap: { amountOut: 0n }, cow: { buyAmount: 100n } }),
    ).toEqual({ winner: 'cow' })
  })
})
