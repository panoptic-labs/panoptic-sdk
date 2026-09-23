import { afterEach, describe, expect, it, vi } from 'vitest'

import { getMorphoHoldings } from './morpho'

const account = '0x0000000000000000000000000000000000000001'
const token = { address: account, decimals: 18, symbol: 'WETH', price: { usd: 2000 } }
const position = {
  market: { marketId: 'market', loanAsset: token, collateralAsset: token },
  state: {
    supplyAssets: '1000000000000000001',
    borrowAssets: '2000000000000000002',
    collateral: '3000000000000000003',
  },
}
const response = (items: unknown[]) =>
  new Response(JSON.stringify({ data: { marketPositions: { items } } }))
afterEach(() => vi.unstubAllGlobals())

describe('Morpho Blue holdings', () => {
  it('preserves bigint precision and signs debt separately from supplied assets and collateral', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([position])))
    const holdings = await getMorphoHoldings(account, 1)
    expect(holdings.map((holding) => holding.amount)).toEqual([
      1000000000000000001n,
      -2000000000000000002n,
      3000000000000000003n,
    ])
    expect(holdings.map((holding) => holding.kind)).toEqual(['supply', 'debt', 'collateral'])
  })
  it('paginates rather than truncating accounts at 100 markets', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(Array.from({ length: 100 }, () => position)))
      .mockResolvedValueOnce(response([]))
    vi.stubGlobal('fetch', fetch)
    expect(await getMorphoHoldings(account, 1)).toHaveLength(300)
    expect(JSON.parse(fetch.mock.calls[1][1].body).variables.skip).toBe(100)
  })
  it('does not interpret GraphQL partial failures as zero debt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ message: 'Unavailable' }],
            data: { marketPositions: { items: [] } },
          }),
        ),
      ),
    )
    await expect(getMorphoHoldings(account, 1)).rejects.toThrow('Morpho query failed')
  })
  it('normalizes safe numeric and string amounts to bigint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response([
          {
            ...position,
            market: {
              ...position.market,
              loanAsset: { ...position.market.loanAsset, decimals: '18' },
            },
            state: { supplyAssets: 0, borrowAssets: 40478421591, collateral: '251000001' },
          },
        ]),
      ),
    )

    const holdings = await getMorphoHoldings(account, 1)
    expect(holdings.map((holding) => holding.amount)).toEqual([-40478421591n, 251000001n])
    expect(holdings.map((holding) => holding.kind)).toEqual(['debt', 'collateral'])
    expect(holdings.map((holding) => holding.decimals)).toEqual([18, 18])
  })
  it('rejects unsafe numeric amounts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response([
          {
            ...position,
            state: { ...position.state, borrowAssets: Number.MAX_SAFE_INTEGER + 1 },
          },
        ]),
      ),
    )
    await expect(getMorphoHoldings(account, 1)).rejects.toThrow()
  })
  it('keeps unpriced debt instead of hiding it', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response([
            { ...position, market: { ...position.market, loanAsset: { ...token, price: null } } },
          ]),
        ),
    )
    expect((await getMorphoHoldings(account, 1))[1]).toMatchObject({
      amount: -2000000000000000002n,
      priceUsd: null,
    })
  })
})
