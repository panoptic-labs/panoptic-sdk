import { describe, expect, it } from 'vitest'

import { PanopticValidationError } from '../errors'
import { priceToTick, roundToTickSpacing } from '../formatters'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
import {
  type GenerateOverlappingTokenIdsParams,
  decodeAllLegs,
  encodePoolId,
  generateOverlappingTokenIds,
} from './index'

const POOL_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as const
const ASSET_DECIMALS = 18n
const QUOTE_DECIMALS = 6n

function params(
  overrides: Partial<GenerateOverlappingTokenIdsParams> = {},
): GenerateOverlappingTokenIdsParams {
  return {
    poolId: encodePoolId(POOL_ADDRESS, 60n),
    currentTick: priceToTick('2500', ASSET_DECIMALS, QUOTE_DECIMALS),
    timescale: '1W',
    strikePriceSpacing: '50',
    asset: 0n,
    assetDecimals: ASSET_DECIMALS,
    quoteDecimals: QUOTE_DECIMALS,
    legs: [{ optionType: 'call', optionRatio: 1n, isLong: false }],
    positionSize: 121n,
    ...overrides,
  }
}

function decodedStrikes(positionIdList: bigint[]): bigint[] {
  return positionIdList.map((tokenId) => {
    const leg = decodeAllLegs(tokenId)[0]
    if (leg === undefined) throw new Error('expected generated option leg')
    return leg.strike
  })
}

function expectedPriceGridStrikes(
  prices: bigint[],
  currentTick: bigint,
  tickSpacing: bigint,
  halfWidth: bigint,
): bigint[] {
  const strikes = prices
    .map((price) =>
      roundToTickSpacing(
        priceToTick(price.toString(), ASSET_DECIMALS, QUOTE_DECIMALS),
        tickSpacing,
      ),
    )
    .filter(
      (strike) =>
        strike - halfWidth >= MIN_TICK &&
        strike + halfWidth <= MAX_TICK &&
        strike - halfWidth < currentTick &&
        currentTick < strike + halfWidth,
    )
  return [...new Set(strikes)]
}

describe('generateOverlappingTokenIds', () => {
  it('generates the complete weekly $50 lattice in ascending quote-price order', () => {
    const input = params()
    const result = generateOverlappingTokenIds(input)
    const strikes = decodedStrikes(result.positionIdList)
    const candidatePrices = Array.from({ length: 25 }, (_, index) => 1900n + BigInt(index) * 50n)
    const expectedStrikes = expectedPriceGridStrikes(candidatePrices, input.currentTick, 60n, 1200n)

    expect(strikes).toEqual(expectedStrikes)
    expect(strikes).toContain(
      roundToTickSpacing(priceToTick('2500', ASSET_DECIMALS, QUOTE_DECIMALS), 60n),
    )
    expect(strikes.every((strike) => strike % 60n === 0n)).toBe(true)
    expect(result.positionSizes.reduce((sum, size) => sum + size, 0n)).toBe(121n)
    const lowerSize = result.positionSizes[0]
    const upperSize = result.positionSizes.at(-1)
    if (lowerSize === undefined || upperSize === undefined) {
      throw new Error('expected generated position sizes')
    }
    expect(lowerSize).toBe(upperSize + 1n)
  })

  it.each([
    ['1D', 60n, 12n],
    ['1W', 60n, 40n],
    ['1M', 60n, 80n],
    ['1D', 10n, 72n],
    ['1W', 10n, 240n],
    ['1M', 10n, 480n],
  ] as const)('derives %s width from tick spacing %s', (timescale, tickSpacing, expectedWidth) => {
    const result = generateOverlappingTokenIds(
      params({
        poolId: encodePoolId(POOL_ADDRESS, tickSpacing),
        timescale,
        strikePriceSpacing: timescale === '1D' ? '25' : '50',
        positionSize: 10_000n,
      }),
    )

    expect(decodeAllLegs(result.positionIdList[0] ?? 0n)[0]?.width).toBe(expectedWidth)
  })

  it('builds configured co-strike legs and preserves mutual risk partners', () => {
    const result = generateOverlappingTokenIds(
      params({
        legs: [
          { optionType: 'call', optionRatio: 2n, isLong: false, riskPartner: 1n },
          { optionType: 'put', optionRatio: 2n, isLong: false, riskPartner: 0n },
        ],
      }),
    )

    for (const tokenId of result.positionIdList) {
      const legs = decodeAllLegs(tokenId)
      expect(legs).toHaveLength(2)
      expect(legs.map((leg) => leg.strike)).toEqual([legs[0]?.strike, legs[0]?.strike])
      expect(legs.map((leg) => leg.width)).toEqual([40n, 40n])
      expect(legs.map((leg) => leg.optionRatio)).toEqual([2n, 2n])
      expect(legs.map((leg) => leg.riskPartner)).toEqual([1n, 0n])
      expect(legs.map((leg) => leg.tokenType)).toEqual([0n, 1n])
    }
  })

  it('produces more fixed-$50 monthly strikes at $4000 than at $1000', () => {
    const at1000 = generateOverlappingTokenIds(
      params({
        currentTick: priceToTick('1000', ASSET_DECIMALS, QUOTE_DECIMALS),
        timescale: '1M',
        positionSize: 10_000n,
      }),
    )
    const at4000 = generateOverlappingTokenIds(
      params({
        currentTick: priceToTick('4000', ASSET_DECIMALS, QUOTE_DECIMALS),
        timescale: '1M',
        positionSize: 10_000n,
      }),
    )

    expect(at4000.positionIdList.length).toBeGreaterThan(at1000.positionIdList.length)
  })

  it('orders token1 asset strikes by ascending inverse quote price', () => {
    const result = generateOverlappingTokenIds(
      params({
        currentTick: -priceToTick('2500', ASSET_DECIMALS, QUOTE_DECIMALS),
        asset: 1n,
      }),
    )
    const strikes = decodedStrikes(result.positionIdList)

    expect(strikes.length).toBeGreaterThan(1)
    for (let index = 1; index < strikes.length; index += 1) {
      expect(strikes[index]).toBeLessThan(strikes[index - 1] ?? 0n)
    }
  })

  it('deduplicates fine price steps that snap to the same valid strike', () => {
    const result = generateOverlappingTokenIds(
      params({ timescale: '1D', strikePriceSpacing: '0.01', positionSize: 10_000n }),
    )
    const strikes = decodedStrikes(result.positionIdList)

    expect(strikes.length).toBeGreaterThan(1)
    expect(new Set(strikes).size).toBe(strikes.length)
    expect(strikes.length).toBeLessThanOrEqual(12)
  })

  it('assigns size remainder units to lower quote strikes first', () => {
    const baseline = generateOverlappingTokenIds(params({ positionSize: 10_000n }))
    const count = BigInt(baseline.positionIdList.length)
    const result = generateOverlappingTokenIds(params({ positionSize: count * 3n + 2n }))

    expect(result.positionSizes.slice(0, 2)).toEqual([4n, 4n])
    expect(result.positionSizes.slice(2).every((size) => size === 3n)).toBe(true)
  })

  it('rejects a price lattice with no overlapping strike', () => {
    expect(() =>
      generateOverlappingTokenIds(params({ timescale: '1D', strikePriceSpacing: '10000' })),
    ).toThrow(PanopticValidationError)
  })

  it('rejects sizes that would create zero-sized positions', () => {
    expect(() => generateOverlappingTokenIds(params({ positionSize: 1n }))).toThrow(
      PanopticValidationError,
    )
  })

  it.each([
    ['zero tick spacing', { poolId: encodePoolId(POOL_ADDRESS, 0n) }],
    ['out-of-range current tick', { currentTick: MAX_TICK + 1n }],
    ['invalid asset', { asset: 2n }],
    ['zero price spacing', { strikePriceSpacing: '0' }],
    ['excess price precision', { strikePriceSpacing: '0.0000001' }],
    ['empty legs', { legs: [] }],
    ['invalid ratio', { legs: [{ optionType: 'call', optionRatio: 0n, isLong: false }] }],
    [
      'non-mutual partners',
      {
        legs: [
          { optionType: 'call', optionRatio: 1n, isLong: false, riskPartner: 1n },
          { optionType: 'put', optionRatio: 1n, isLong: false },
        ],
      },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      generateOverlappingTokenIds(params(overrides as Partial<GenerateOverlappingTokenIdsParams>)),
    ).toThrow(PanopticValidationError)
  })
})
