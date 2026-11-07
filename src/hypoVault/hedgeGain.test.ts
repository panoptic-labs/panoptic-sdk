import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import { getLegTokenInventory } from '../panoptic/v2/greeks/legLiquidity'
import { positionValueTicks } from '../panoptic/v2/reads/positionValueCurve'
import { createTokenIdBuilder } from '../panoptic/v2/tokenId/builder'
import { decodeTokenId } from '../panoptic/v2/tokenId/decode'
import fixture from './fixtures/hedgeGain'
import {
  type FrozenHedgeBook,
  estimateProtectedHedgeGain,
  getProtectedHedgeGasBudget,
  valueFrozenHedgeBook,
} from './hedgeGain'

const D = Decimal.clone({ precision: 110 })
const Q96 = 1n << 96n
const Q192 = 1n << 192n
const usd = (amount: number) => BigInt(amount) * 1_000_000n
const eth = (amount: number) => BigInt(amount) * 10n ** 18n
const sqrt = (price: number) =>
  BigInt(new D(10).pow(12).div(price).sqrt().mul(Q96.toString()).floor().toFixed(0))
const curve = [
  { tick: 180000n, value0: 0n, value1: 0n },
  { tick: 220000n, value0: 0n, value1: 0n },
]
const before: FrozenHedgeBook = {
  curve,
  balances: [usd(1000), eth(10)],
  numeraireIndex: 0n,
  sqrtPriceX96: sqrt(2700),
}
const anchor = { sqrtPriceX96: sqrt(2300), actualValue: usd(24000) }
const after: FrozenHedgeBook = { ...before, balances: [usd(28000), 0n] }
const estimate = (changes: Partial<Parameters<typeof estimateProtectedHedgeGain>[0]> = {}) =>
  estimateProtectedHedgeGain({ before, after, anchor, roundingReserve: 10000n, ...changes })

describe('protected hedge gain', () => {
  it('counts earned price protection rather than sale proceeds or deposited principal', () => {
    const result = estimate()
    expect(result.valid).toBe(true)
    expect(result.protectedGain >= usd(3999) && result.protectedGain <= usd(4000) - 10000n).toBe(
      true,
    )
    expect(
      estimate({
        anchor: { ...anchor, sqrtPriceX96: before.sqrtPriceX96, actualValue: usd(28000) },
      }).protectedGain,
    ).toBe(0n)
    expect(
      estimate({
        before: { ...before, balances: [usd(11000), eth(10)] },
        after: { ...after, balances: [usd(38000), 0n] },
      }).protectedGain,
    ).toBe(result.protectedGain)
  })

  it('deducts negative carry while excluding positive carry from the earned gain', () => {
    const base = estimate().protectedGain
    const negative = estimate({ anchor: { ...anchor, actualValue: usd(24500) } })
    expect(negative.protectedGain - base + usd(500)).toBeLessThanOrEqual(1n)
    expect(negative.protectedGain - base + usd(500)).toBeGreaterThanOrEqual(0n)
    expect(estimate({ anchor: { ...anchor, actualValue: usd(23000) } }).protectedGain).toBe(base)
  })

  it('does not let a partial hedge claim all gains, and rejects unbounded tails', () => {
    expect(estimate({ after: { ...after, balances: [usd(14500), eth(5)] } }).protectedGain).toBe(0n)
    expect(estimate({ after: { ...after, balances: [usd(30700), -eth(1)] } })).toMatchObject({
      valid: false,
      protectedGain: 0n,
    })
    expect(estimate({ anchor: undefined })).toMatchObject({ valid: false, protectedGain: 0n })
  })

  it('checks interior minima and rejects an unfunded increase in post-trade value', () => {
    const low = -13864n
    const price = new D(Q192.toString()).div(new D(tickToSqrtPriceX96(low).toString()).pow(2))
    const x = price.sqrt()
    const curved: FrozenHedgeBook = {
      curve: [
        {
          tick: low,
          value0: BigInt(new D(1000).minus(x.mul(500)).floor().toFixed(0)),
          value1: BigInt(new D(400).minus(new D(500).div(x)).floor().toFixed(0)),
        },
        { tick: 0n, value0: 500n, value1: -100n },
      ],
      balances: [0n, 0n],
      numeraireIndex: 0n,
      sqrtPriceX96: Q96,
    }
    const flat: FrozenHedgeBook = {
      ...curved,
      curve: curved.curve.map(({ tick }) => ({ tick, value0: 0n, value1: 0n })),
      balances: [400n, 0n],
    }
    const result = estimateProtectedHedgeGain({
      before: flat,
      after: curved,
      anchor: { sqrtPriceX96: Q96, actualValue: 400n },
      roundingReserve: 1n,
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.floorAfter).toBeGreaterThanOrEqual(370n)
      expect(result.floorAfter).toBeLessThan(400n)
    }
    expect(estimate({ after: { ...after, balances: [usd(29000), 0n] } })).toMatchObject({
      valid: false,
      protectedGain: 0n,
    })
  })

  it('handles the archived multi-leg book in both token orderings', () => {
    const book: FrozenHedgeBook = {
      curve: fixture.curve.map((point) => ({
        tick: BigInt(point.tick),
        value0: BigInt(point.value0),
        value1: BigInt(point.value1),
      })),
      balances: [BigInt(fixture.balances[0]), BigInt(fixture.balances[1])],
      numeraireIndex: 0n,
      sqrtPriceX96: BigInt(fixture.sqrtPriceX96),
    }
    const reversed: FrozenHedgeBook = {
      curve: book.curve
        .map((point) => ({ tick: -point.tick, value0: point.value1, value1: point.value0 }))
        .reverse(),
      balances: [book.balances[1], book.balances[0]],
      numeraireIndex: 1n,
      sqrtPriceX96: Q192 / book.sqrtPriceX96,
    }
    for (const price of [1000, 2300, 2500, 2700, 5000]) {
      const forward = valueFrozenHedgeBook(book, sqrt(price))
      const reverse = valueFrozenHedgeBook(reversed, Q192 / sqrt(price))
      expect(forward > reverse ? forward - reverse : reverse - forward).toBeLessThanOrEqual(1n)
    }
  })

  it('values mixed-asset multi-leg curves against independently computed token inventory', () => {
    const tokenId = createTokenIdBuilder(10n << 48n)
      .addLeg({
        asset: 0n,
        tokenType: 0n,
        isLong: true,
        optionRatio: 1n,
        strike: 200000n,
        width: 100n,
      })
      .addLeg({
        asset: 1n,
        tokenType: 1n,
        isLong: true,
        optionRatio: 1n,
        strike: 200000n,
        width: 100n,
      })
      .build()
    const positionSize = 10n ** 12n
    const positions = [{ tokenId, positionSize }]
    const { legs, tickSpacing } = decodeTokenId(tokenId)
    const inventory = (tick: bigint, index: 0n | 1n) =>
      legs.reduce(
        (sum, leg) => sum + getLegTokenInventory(leg, tick, positionSize, tickSpacing, index),
        0n,
      )
    const mixed: FrozenHedgeBook = {
      curve: positionValueTicks(positions).map((tick) => ({
        tick,
        value0: inventory(tick, 0n),
        value1: inventory(tick, 1n),
      })),
      balances: [10n ** 18n, 10n ** 24n],
      numeraireIndex: 0n,
      sqrtPriceX96: tickToSqrtPriceX96(200000n),
    }
    for (const tick of [199400n, 199750n, 200000n, 200250n, 200600n]) {
      const s = tickToSqrtPriceX96(tick)
      const expected =
        mixed.balances[0] +
        inventory(tick, 0n) +
        ((mixed.balances[1] + inventory(tick, 1n)) * Q192) / s ** 2n
      const actual = valueFrozenHedgeBook(mixed, s)
      expect(actual > expected ? actual - expected : expected - actual).toBeLessThan(100n)
    }
  })
})

describe('two-thirds gas budget', () => {
  const parameters = {
    protectedGain: usd(3000),
    gasAlreadyPaid: 0n,
    numeraireIndex: 0n as const,
    gasAssetIndex: 1n as const,
    sqrtPriceLowerX96: 20000n * Q96,
    sqrtPriceUpperX96: 20000n * Q96,
  }
  it('authorizes $2,000 on $3,000 protected gain and subtracts already-paid gas', () => {
    expect(getProtectedHedgeGasBudget(parameters)).toEqual({
      allowance: usd(2000),
      remaining: usd(2000),
      maxTransactionGasCost: 800_000_000_000_000_000n,
    })
    expect(
      getProtectedHedgeGasBudget({ ...parameters, gasAlreadyPaid: usd(500) }).maxTransactionGasCost,
    ).toBe(600_000_000_000_000_000n)
    expect(getProtectedHedgeGasBudget({ ...parameters, gasAlreadyPaid: usd(2001) }).remaining).toBe(
      0n,
    )
  })

  it('converts at the worst permitted ETH price in both token orderings', () => {
    const bounds = { sqrtPriceLowerX96: sqrt(2700), sqrtPriceUpperX96: sqrt(2300) }
    const forward = getProtectedHedgeGasBudget({ ...parameters, ...bounds })
    const reverse = getProtectedHedgeGasBudget({
      ...parameters,
      numeraireIndex: 1n,
      gasAssetIndex: 0n,
      sqrtPriceLowerX96: Q192 / bounds.sqrtPriceUpperX96,
      sqrtPriceUpperX96: Q192 / bounds.sqrtPriceLowerX96,
    })
    expect(forward.maxTransactionGasCost).toBeLessThanOrEqual(800_000_000_000_000_000n)
    expect(
      forward.maxTransactionGasCost > reverse.maxTransactionGasCost
        ? forward.maxTransactionGasCost - reverse.maxTransactionGasCost
        : reverse.maxTransactionGasCost - forward.maxTransactionGasCost,
    ).toBeLessThanOrEqual(1n)
  })

  it('retains the absolute ceiling and rounds small or invalid budgets safely', () => {
    expect(
      getProtectedHedgeGasBudget({ ...parameters, protectedGain: usd(6000) }).maxTransactionGasCost,
    ).toBe((1_250_000_000_000_000_000n * 8n) / 9n)
    expect(
      getProtectedHedgeGasBudget({ ...parameters, protectedGain: 1n }).maxTransactionGasCost,
    ).toBe(0n)
    expect(() => getProtectedHedgeGasBudget({ ...parameters, gasAlreadyPaid: -1n })).toThrow()
  })
})
