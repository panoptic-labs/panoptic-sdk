import { describe, expect, it } from 'vitest'

import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import { addLegToTokenId } from '../panoptic/v2/tokenId'
import {
  getLpDepositAmounts,
  getLpDepositBreakdown,
  getLpFundingDeposit,
  getLpPositionFunding,
  getMaxLpPositionSize,
} from './lpDeposit'
import { getAmountsForLiquidity } from './lpGreeks'

describe('LP mint deposits', () => {
  it.each([-200000, 200000])('values both token orderings at tick %s', (tick) => {
    const range = { tickLower: tick - 600, tickUpper: tick + 600, liquidity: 10n ** 18n }
    const price = tickToSqrtPriceX96(BigInt(tick))
    const principal = getAmountsForLiquidity(
      price,
      tickToSqrtPriceX96(BigInt(range.tickLower)),
      tickToSqrtPriceX96(BigInt(range.tickUpper)),
      range.liquidity,
    )
    const deposit = getLpDepositAmounts([range], price)
    for (const key of ['amount0', 'amount1'] as const) {
      expect(deposit[key]).toBeGreaterThanOrEqual((principal[key] * 105n + 99n) / 100n)
      expect(deposit[key]).toBeLessThanOrEqual((principal[key] * 105n + 99n) / 100n + 2n)
    }
  })
  it('only requires token0 below range and token1 above range', () => {
    const range = { tickLower: -60, tickUpper: 60, liquidity: 100000n }
    expect(getLpDepositAmounts([range], tickToSqrtPriceX96(-100n)).amount1).toBe(0n)
    expect(getLpDepositAmounts([range], tickToSqrtPriceX96(100n)).amount0).toBe(0n)
  })
  it('sums multiple differently sized legs before buffering and rounds dust upward', () => {
    const ranges = [1n, 3n].map((liquidity) => ({ tickLower: -60, tickUpper: 60, liquidity }))
    expect(getLpDepositAmounts(ranges, 1n << 96n)).toEqual({ amount0: 3n, amount1: 3n })
    expect(getLpDepositAmounts([], 1n << 96n)).toEqual({ amount0: 0n, amount1: 0n })
  })
})

const leg = (asset: bigint, index = 0n, strike = 0n) => ({
  index,
  asset,
  strike,
  width: 20n,
  optionRatio: index + 1n,
  isLong: 0n,
  tokenType: index % 2n,
  riskPartner: index,
})
const fundingParams = (tokenId: bigint, tick = 0n, quoteTokenIndex: 0 | 1 = 1) => ({
  tokenId,
  tickSpacing: 60n,
  sqrtPriceX96: tickToSqrtPriceX96(tick),
  valuationSqrtPriceX96: tickToSqrtPriceX96(tick),
  quoteTokenIndex,
})

describe('LP position funding', () => {
  it('caps MAX by a higher protocol requirement without reducing full LP funding', () => {
    const params = fundingParams(addLegToTokenId(1n, leg(0n)))
    const max = getMaxLpPositionSize({
      ...params,
      availableInQuote: 10000n,
      minimumRequirement: { referenceSize: 1000n, requiredInQuote: 10000n },
    })
    expect(max).toBe(1000n)
    expect(getLpPositionFunding({ ...params, positionSize: max }).totalInQuote).toBeLessThan(10000n)
  })
  it.each([0, 1] as const)(
    'funds only the shortfall in any token mix with quote token %s',
    (quoteTokenIndex) => {
      const params = fundingParams(addLegToTokenId(1n, leg(0n)), 0n, quoteTokenIndex)
      const funding = getLpPositionFunding({ ...params, positionSize: 1000000n })
      const availableInQuote = funding.totalInQuote / 2n
      for (const quotePercent of [0n, 50n, 100n]) {
        const deposit = getLpFundingDeposit({ ...params, funding, availableInQuote, quotePercent })
        expect(deposit.amount0 + deposit.amount1 + availableInQuote).toBe(funding.totalInQuote)
        expect(deposit.shortfallInQuote).toBe(funding.totalInQuote - availableInQuote)
      }
      const funded = getLpFundingDeposit({
        ...params,
        funding,
        availableInQuote: funding.totalInQuote,
      })
      expect(funded.amount0).toBe(0n)
      expect(funded.amount1).toBe(0n)
      const additional = getLpFundingDeposit({
        ...params,
        funding,
        availableInQuote,
        minimumInQuote: funding.totalInQuote * 2n,
      })
      expect(additional.requiredInQuote).toBe(funding.totalInQuote * 2n)
      expect(additional.amount0 + additional.amount1).toBeGreaterThanOrEqual(
        additional.shortfallInQuote,
      )
    },
  )
  it.each([0n, 1n])('requires the full range value for asset %s', (asset) => {
    const tokenId = addLegToTokenId(1n, leg(asset))
    const result = getLpPositionFunding({ ...fundingParams(tokenId), positionSize: 10n ** 18n })
    expect(result.principal.amount0).toBeGreaterThan(0n)
    expect(result.principal.amount1).toBeGreaterThan(0n)
    expect(result.totalInQuote).toBeGreaterThan(10n ** 18n)
    expect(result.totalInQuote).toBe(result.principalInQuote + result.bufferInQuote)
    expect(result.bufferInQuote * 100n).toBeGreaterThanOrEqual(result.principalInQuote * 5n)
  })

  it.each([-200000n, 200000n])(
    'handles mixed asset frames and both quote tokens at tick %s',
    (tick) => {
      const first = addLegToTokenId(1n, leg(0n, 0n, tick))
      const second = addLegToTokenId(1n, { ...leg(1n, 1n, tick), index: 0n })
      const combined = addLegToTokenId(first, leg(1n, 1n, tick))
      for (const quoteTokenIndex of [0, 1] as const) {
        const params = {
          positionSize: 10n ** 18n,
          ...fundingParams(combined, tick, quoteTokenIndex),
        }
        const total = getLpPositionFunding(params)
        const a = getLpPositionFunding({ ...params, tokenId: first })
        const b = getLpPositionFunding({ ...params, tokenId: second })
        expect(total.principal.amount0).toBe(a.principal.amount0 + b.principal.amount0)
        expect(total.principal.amount1).toBe(a.principal.amount1 + b.principal.amount1)
        expect(total.totalInQuote).toBeGreaterThan(0n)
      }
    },
  )

  it.each([-601n, -600n, 600n, 601n])('is one-sided at or beyond the range boundary %s', (tick) => {
    const tokenId = addLegToTokenId(1n, leg(0n))
    const result = getLpPositionFunding({
      ...fundingParams(tokenId, tick),
      positionSize: 10n ** 18n,
    })
    expect(tick < 0n ? result.principal.amount1 : result.principal.amount0).toBe(0n)
  })

  it.each([0, 1] as const)(
    'MAX fits and the next raw unit does not, quoted in token %s',
    (quoteTokenIndex) => {
      const tokenId = addLegToTokenId(addLegToTokenId(1n, leg(0n)), leg(1n, 1n))
      const params = fundingParams(tokenId, 0n, quoteTokenIndex)
      const availableInQuote = 1000000n
      const max = getMaxLpPositionSize({ ...params, availableInQuote })
      expect(
        getLpPositionFunding({ ...params, positionSize: max }).totalInQuote,
      ).toBeLessThanOrEqual(availableInQuote)
      expect(
        getLpPositionFunding({ ...params, positionSize: max + 1n }).totalInQuote,
      ).toBeGreaterThan(availableInQuote)
      expect(getMaxLpPositionSize({ ...params, availableInQuote: 0n })).toBe(0n)
    },
  )

  it('exposes the buffer without changing the legacy deposit result', () => {
    const ranges = [{ tickLower: -60, tickUpper: 60, liquidity: 1n }]
    const result = getLpDepositBreakdown(ranges, 1n << 96n)
    expect(result.total).toEqual(getLpDepositAmounts(ranges, 1n << 96n))
    expect(result.principal).toEqual({ amount0: 1n, amount1: 1n })
    expect(result.buffer).toEqual({ amount0: 1n, amount1: 1n })
  })

  it('rejects long, credit, loan, and empty positions', () => {
    for (const config of [
      { ...leg(0n), isLong: 1n },
      { ...leg(0n), width: 0n },
      { ...leg(0n), width: 0n, isLong: 1n },
    ]) {
      expect(() =>
        getLpPositionFunding({ ...fundingParams(addLegToTokenId(1n, config)), positionSize: 1n }),
      ).toThrow('AMM Liquidity')
    }
    expect(() => getLpPositionFunding({ ...fundingParams(1n), positionSize: 1n })).toThrow(
      'AMM Liquidity',
    )
  })
})
