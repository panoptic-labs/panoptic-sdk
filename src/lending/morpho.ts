import { type Address, getAddress } from 'viem'
import { z } from 'zod'

import { normalizeTokenDecimals, normalizeUnsignedBigInt } from './normalize'

const amount = z
  .union([
    z.string().regex(/^\d+$/),
    z
      .number()
      .int()
      .nonnegative()
      .safe()
      .transform((value) => value.toString()),
  ])
  .transform(normalizeUnsignedBigInt)
const asset = z.object({
  address: z.string().transform((value) => getAddress(value)),
  symbol: z.string(),
  decimals: z.union([z.number(), z.string()]).transform(normalizeTokenDecimals),
  price: z.object({ usd: z.number().finite().nonnegative().nullable() }).nullable(),
})
const responseSchema = z.object({
  data: z.object({
    marketPositions: z.object({
      items: z.array(
        z.object({
          market: z.object({
            marketId: z.string(),
            loanAsset: asset,
            collateralAsset: asset.nullable(),
          }),
          state: z.object({ supplyAssets: amount, borrowAssets: amount, collateral: amount }),
        }),
      ),
    }),
  }),
})

/** Indexed Morpho Blue balances; amounts include the indexer's accrued interest. */
export async function getMorphoHoldings(account: Address, chainId: number) {
  const holdings: {
    address: Address
    symbol: string
    decimals: number
    amount: bigint
    priceUsd: string | null
    marketId: string
    kind: 'supply' | 'collateral' | 'debt'
  }[] = []
  for (let skip = 0; skip < 10_000; skip += 100) {
    const response = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        query: `query Positions($account: [String!], $chains: [Int!], $skip: Int!) {
          marketPositions(first: 100, skip: $skip, where: {userAddress_in: $account, chainId_in: $chains}) {
            items { market { marketId loanAsset { address symbol decimals price { usd } }
              collateralAsset { address symbol decimals price { usd } } }
              state { supplyAssets borrowAssets collateral } }
          }
        }`,
        variables: { account: [account], chains: [chainId], skip },
      }),
    })
    if (!response.ok) throw new Error('Morpho positions unavailable')
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'errors' in body)
      throw new Error('Morpho query failed')
    const items = responseSchema.parse(body).data.marketPositions.items
    for (const { market, state } of items) {
      const legs = [
        { token: market.loanAsset, amount: state.supplyAssets, kind: 'supply' as const },
        { token: market.loanAsset, amount: -state.borrowAssets, kind: 'debt' as const },
        { token: market.collateralAsset, amount: state.collateral, kind: 'collateral' as const },
      ]
      for (const leg of legs) {
        if (leg.amount === 0n) continue
        if (leg.token === null) throw new Error('Missing Morpho collateral asset')
        holdings.push({
          ...leg.token,
          amount: leg.amount,
          kind: leg.kind,
          marketId: market.marketId,
          priceUsd: leg.token.price?.usd?.toString() ?? null,
        })
      }
    }
    if (items.length < 100) return holdings
  }
  throw new Error('Morpho position pagination limit exceeded')
}
