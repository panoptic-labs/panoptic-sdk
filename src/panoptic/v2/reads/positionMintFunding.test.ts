import { describe, expect, it } from 'vitest'

import { tickToSqrtPriceX96 } from '../formatters/tick'
import { type LegConfig, createTokenIdBuilder } from '../tokenId/builder'
import { getPositionMintFunding } from './positionMintFunding'

const Q96 = 1n << 96n
const call: LegConfig = {
  asset: 1n,
  tokenType: 1n,
  isLong: true,
  optionRatio: 1n,
  strike: 197680n,
  width: 480n,
}
function position(legs: LegConfig[]) {
  const builder = createTokenIdBuilder(10n << 48n)
  for (const leg of legs) builder.addLeg(leg)
  return builder.build()
}
const input = {
  tokenId: position([call]),
  positionSize: 100n * 10n ** 18n,
  sqrtPriceX96: tickToSqrtPriceX96(198490n),
  valuationSqrtPriceX96: tickToSqrtPriceX96(198490n),
  swapAtMint: true,
  commissionRate: 0n,
  swapFee: 0n,
  slippageBps: 0n,
  required0: 2500n * 10n ** 6n,
  required1: 0n,
}

describe('getPositionMintFunding', () => {
  it('includes the mint payment above margin for the 100 ETH long call', () => {
    const zap = getPositionMintFunding(input)
    const cover = getPositionMintFunding({ ...input, swapAtMint: false })
    expect(cover.paid0).toBeLessThan(-60_000n * 10n ** 6n)
    expect(cover.paid1).toBeGreaterThan(25n * 10n ** 18n)
    expect(zap.paid0).toBe(0n)
    expect(zap.paid1).toBeGreaterThan(1n * 10n ** 18n)
    expect(zap.paid1).toBeLessThan(4n * 10n ** 18n)
    expect(zap.requiredValue0).toBeGreaterThan(5000n * 10n ** 6n)
    expect(cover.requiredValue0).toBeGreaterThan(60_000n * 10n ** 6n)
    expect(cover.requiredValue0).toBeGreaterThan(zap.requiredValue0)
  })

  it('mirrors calls and puts in both token orderings without reinterpreting size', () => {
    for (const tokenType of [0n, 1n]) {
      for (const swapAtMint of [false, true]) {
        const original = getPositionMintFunding({
          ...input,
          tokenId: position([{ ...call, tokenType }]),
          swapAtMint,
        })
        const mirrored = getPositionMintFunding({
          ...input,
          tokenId: position([
            { ...call, asset: 0n, tokenType: 1n - tokenType, strike: -call.strike },
          ]),
          sqrtPriceX96: tickToSqrtPriceX96(-198490n),
          valuationSqrtPriceX96: tickToSqrtPriceX96(-198490n),
          required0: input.required1,
          required1: input.required0,
          swapAtMint,
        })
        // Liquidity construction and reciprocal prices have independent integer rounding.
        expect(Number(mirrored.requiredValue1) / Number(original.requiredValue0)).toBeCloseTo(1, 8)
        expect(Number(mirrored.requiredValue0) / Number(original.requiredValue1)).toBeCloseTo(1, 8)
      }
    }
  })

  it('does not add received tokens on top of the post-mint margin', () => {
    const result = getPositionMintFunding({
      ...input,
      tokenId: position([
        { ...call, strike: 0n, asset: 0n, tokenType: 0n, width: 0n, isLong: false },
      ]),
      positionSize: 1000n,
      sqrtPriceX96: Q96,
      valuationSqrtPriceX96: Q96,
      swapAtMint: false,
      required0: 1500n,
      required1: 0n,
    })
    expect(result.paid0).toBe(-1000n)
    expect(result.requiredValue0).toBe(500n)
  })

  it('nets mixed-asset, multi-leg payments before applying upfront funding constraints', () => {
    const legs = [call, { ...call, asset: 0n, strike: 198910n, isLong: false }]
    const combined = getPositionMintFunding({
      ...input,
      tokenId: position(legs),
      swapAtMint: false,
    })
    const singles = legs.map((leg) =>
      getPositionMintFunding({
        ...input,
        tokenId: position([leg]),
        swapAtMint: false,
      }),
    )
    expect(combined.paid0).toBe(singles.reduce((sum, value) => sum + value.paid0, 0n))
    expect(combined.paid1).toBe(singles.reduce((sum, value) => sum + value.paid1, 0n))
    expect(combined.requiredValue0).toBeLessThan(
      singles.reduce((sum, value) => sum + value.requiredValue0, 0n),
    )
  })

  it('nets both ITM slots before the Zap swap and follows the first leg asset', () => {
    const legs = [
      { ...call, asset: 0n, tokenType: 0n, strike: 0n, width: 20n },
      { ...call, asset: 1n, tokenType: 1n, strike: 20n, width: 20n },
    ]
    const params = { ...input, sqrtPriceX96: Q96, valuationSqrtPriceX96: Q96 }
    const cover = getPositionMintFunding({ ...params, tokenId: position(legs), swapAtMint: false })
    const token0First = getPositionMintFunding({ ...params, tokenId: position(legs) })
    const token1First = getPositionMintFunding({
      ...params,
      tokenId: position([...legs].reverse()),
    })
    expect(token0First.paid0 + token0First.paid1).toBe(cover.paid0 + cover.paid1)
    expect(token1First.paid0 + token1First.paid1).toBe(cover.paid0 + cover.paid1)
    expect(token0First.paid0).not.toBe(token1First.paid0)
  })

  it('charges fees and slippage on the gross Zap swap, not just its small net payment', () => {
    const base = getPositionMintFunding(input)
    const withCosts = getPositionMintFunding({
      ...input,
      commissionRate: 3n,
      swapFee: 500n,
      slippageBps: 50n,
    })
    expect(withCosts.paid1).toBeGreaterThan(base.paid1)
    expect(withCosts.requiredValue0).toBeGreaterThan(base.requiredValue0)
    expect(withCosts.requiredValue0 - base.requiredValue0).toBeGreaterThan(300n * 10n ** 6n)
  })

  it('budgets the swap that sources Cover payment from a numeraire-only deposit', () => {
    const covered = { ...input, swapAtMint: false }
    const base = getPositionMintFunding(covered)
    const buffered = getPositionMintFunding({ ...covered, swapFee: 500n, slippageBps: 50n })
    expect(buffered.paid0).toBe(base.paid0)
    expect(buffered.paid1).toBe(base.paid1)
    expect(buffered.requiredValue0).toBeGreaterThan(base.requiredValue0)
    expect(buffered.requiredValue1).toBe(base.requiredValue1)
  })

  it('leaves out-of-range OTM longs at margin plus commission', () => {
    const otm = { ...input, sqrtPriceX96: tickToSqrtPriceX96(201000n) }
    const noFees = getPositionMintFunding(otm)
    expect(noFees.paid0).toBe(0n)
    expect(noFees.paid1).toBe(0n)
    expect(noFees.requiredValue0).toBe(input.required0)
    expect(getPositionMintFunding({ ...otm, commissionRate: 3n }).requiredValue0).toBeGreaterThan(
      input.required0,
    )
  })
})
