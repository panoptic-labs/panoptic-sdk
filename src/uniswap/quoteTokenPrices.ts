import Decimal from 'decimal.js'

import { tickToPrice } from '../panoptic/v2/formatters/tick'

/** Prices tokens in a common quote asset, selecting the deepest quote-side virtual reserve. */
export function quoteTokenPrices(
  pools: readonly {
    id: string
    token0: { address: string; decimals: bigint }
    token1: { address: string; decimals: bigint }
    tick: bigint
    liquidity: bigint
  }[],
  quoteAddresses: readonly string[],
) {
  const quotes = new Set(quoteAddresses.map((address) => address.toLowerCase()))
  const best = new Map<string, { price: Decimal; depth: Decimal; poolId: string }>()
  for (const pool of pools) {
    if (pool.liquidity <= 0n || pool.tick < -887272n || pool.tick > 887272n) continue
    const quote0 = quotes.has(pool.token0.address.toLowerCase())
    const quote1 = quotes.has(pool.token1.address.toLowerCase())
    if (quote0 === quote1) continue
    const rawPrice = new Decimal(tickToPrice(pool.tick))
    if (!rawPrice.isFinite() || rawPrice.lte(0)) continue
    const price1Per0 = rawPrice.mul(
      new Decimal(10).pow((pool.token0.decimals - pool.token1.decimals).toString()),
    )
    const price = quote0 ? new Decimal(1).div(price1Per0) : price1Per0
    const sqrtPrice = rawPrice.sqrt()
    const liquidity = new Decimal(pool.liquidity.toString())
    const depth = (quote0 ? liquidity.div(sqrtPrice) : liquidity.mul(sqrtPrice)).div(
      new Decimal(10).pow((quote0 ? pool.token0.decimals : pool.token1.decimals).toString()),
    )
    const token = (quote0 ? pool.token1 : pool.token0).address.toLowerCase()
    const previous = best.get(token)
    if (
      previous === undefined ||
      depth.gt(previous.depth) ||
      (depth.eq(previous.depth) && pool.id < previous.poolId)
    ) {
      best.set(token, { price, depth, poolId: pool.id })
    }
  }
  return new Map([...best].map(([address, quote]) => [address, quote.price]))
}
