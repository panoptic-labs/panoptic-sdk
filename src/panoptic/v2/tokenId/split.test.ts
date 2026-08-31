import { describe, expect, it } from 'vitest'

import { PanopticValidationError } from '../errors'
import {
  type EncodeLegParams,
  addLegToTokenId,
  createTokenIdBuilder,
  decodeAllLegs,
  encodePoolId,
  splitTokenIdByTimescale,
} from './index'

const POOL_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as const
const POOL_ID_10 = encodePoolId(POOL_ADDRESS, 10n)

function singleCall(poolId = POOL_ID_10, overrides: { strike?: bigint; width?: bigint } = {}) {
  return createTokenIdBuilder(poolId)
    .addCall({
      strike: overrides.strike ?? 0n,
      width: overrides.width ?? 480n,
      optionRatio: 1n,
      isLong: true,
    })
    .build()
}

function legBounds(tokenId: bigint) {
  const tickSpacing = (tokenId >> 48n) & 0xffffn
  const leg = decodeAllLegs(tokenId)[0]
  if (leg === undefined) throw new Error('expected a leg')
  const totalWidth = leg.width * tickSpacing
  return {
    lower: leg.strike - totalWidth / 2n,
    upper: leg.strike + (totalWidth + 1n) / 2n,
  }
}

describe('splitTokenIdByTimescale', () => {
  it('splits a monthly option into two adjacent weekly positions', () => {
    const source = singleCall()
    const result = splitTokenIdByTimescale(source, 101n, '1W')

    expect(result.positionSizes).toEqual([51n, 50n])
    expect(result.positionIdList).toHaveLength(2)

    const [lowerLeg, upperLeg] = result.positionIdList.map((id) => decodeAllLegs(id)[0])
    expect(lowerLeg).toMatchObject({ strike: -1200n, width: 240n })
    expect(upperLeg).toMatchObject({ strike: 1200n, width: 240n })
    expect(result.positionIdList.every((id) => (id & ((1n << 64n) - 1n)) === POOL_ID_10)).toBe(true)
  })

  it('keeps an economic call/put straddle together without inventing risk pairing', () => {
    const source = createTokenIdBuilder(POOL_ID_10)
      .addCall({ strike: 0n, width: 480n, optionRatio: 2n, isLong: false })
      .addPut({ strike: 0n, width: 480n, optionRatio: 2n, isLong: false })
      .build()

    const result = splitTokenIdByTimescale(source, 100n, '1W')

    expect(result.positionIdList).toHaveLength(2)
    expect(result.positionSizes).toEqual([50n, 50n])
    for (const [index, tokenId] of result.positionIdList.entries()) {
      const legs = decodeAllLegs(tokenId)
      const expectedStrike = index === 0 ? -1200n : 1200n
      expect(legs).toHaveLength(2)
      expect(legs.map((leg) => leg.strike)).toEqual([expectedStrike, expectedStrike])
      expect(legs.map((leg) => leg.width)).toEqual([240n, 240n])
      expect(legs.map((leg) => leg.riskPartner)).toEqual([0n, 1n])
      expect(legs.map((leg) => leg.optionRatio)).toEqual([2n, 2n])
      expect(legs.map((leg) => leg.isLong)).toEqual([false, false])
    }
  })

  it('preserves mutual risk pairing within each straddle child', () => {
    const source = createTokenIdBuilder(POOL_ID_10)
      .addCall({
        strike: 0n,
        width: 480n,
        optionRatio: 1n,
        isLong: true,
        riskPartner: 1n,
      })
      .addPut({
        strike: 0n,
        width: 480n,
        optionRatio: 1n,
        isLong: true,
        riskPartner: 0n,
      })
      .build()

    const result = splitTokenIdByTimescale(source, 10n, '1W')
    for (const tokenId of result.positionIdList) {
      expect(decodeAllLegs(tokenId).map((leg) => leg.riskPartner)).toEqual([1n, 0n])
    }
  })

  it('keeps mutually partnered non-straddle option legs together', () => {
    const source = createTokenIdBuilder(POOL_ID_10)
      .addCall({
        strike: 0n,
        width: 480n,
        optionRatio: 1n,
        isLong: true,
        riskPartner: 1n,
      })
      .addCall({
        strike: 6000n,
        width: 480n,
        optionRatio: 1n,
        isLong: false,
        riskPartner: 0n,
      })
      .build()

    const result = splitTokenIdByTimescale(source, 11n, '1W')

    expect(result.positionSizes).toEqual([6n, 5n])
    expect(result.positionIdList.map(decodeAllLegs)).toEqual([
      [
        expect.objectContaining({ strike: -1200n, riskPartner: 1n }),
        expect.objectContaining({ strike: 4800n, riskPartner: 0n }),
      ],
      [
        expect.objectContaining({ strike: 1200n, riskPartner: 1n }),
        expect.objectContaining({ strike: 7200n, riskPartner: 0n }),
      ],
    ])
  })

  it('matches multiple straddles deterministically in source-leg order', () => {
    const source = createTokenIdBuilder(POOL_ID_10)
      .addCall({ strike: 0n, width: 480n, optionRatio: 1n, isLong: true })
      .addCall({ strike: 6000n, width: 480n, optionRatio: 1n, isLong: true })
      .addPut({ strike: 0n, width: 480n, optionRatio: 1n, isLong: true })
      .addPut({ strike: 6000n, width: 480n, optionRatio: 1n, isLong: true })
      .build()

    const result = splitTokenIdByTimescale(source, 20n, '1W')
    expect(result.positionSizes).toEqual([10n, 10n, 10n, 10n])
    expect(result.positionIdList.map((id) => decodeAllLegs(id).map((leg) => leg.strike))).toEqual([
      [-1200n, -1200n],
      [1200n, 1200n],
      [4800n, 4800n],
      [7200n, 7200n],
    ])
  })

  it('divides position size independently for each standalone option group', () => {
    const source = createTokenIdBuilder(POOL_ID_10)
      .addCall({ strike: 0n, width: 480n, optionRatio: 1n, isLong: true })
      .addCall({ strike: 6000n, width: 480n, optionRatio: 1n, isLong: true })
      .build()

    const result = splitTokenIdByTimescale(source, 5n, '1W')
    expect(result.positionIdList).toHaveLength(4)
    expect(result.positionSizes).toEqual([3n, 2n, 3n, 2n])
  })

  it('emits an exact narrower final band for a non-divisible split', () => {
    const poolId = encodePoolId(POOL_ADDRESS, 60n)
    const source = singleCall(poolId, { width: 40n })
    const result = splitTokenIdByTimescale(source, 10n, '1D')

    expect(result.positionSizes).toEqual([3n, 3n, 2n, 2n])
    expect(
      result.positionIdList.map((id) => {
        const leg = decodeAllLegs(id)[0]
        return { strike: leg?.strike, width: leg?.width }
      }),
    ).toEqual([
      { strike: -840n, width: 12n },
      { strike: -120n, width: 12n },
      { strike: 600n, width: 12n },
      { strike: 1080n, width: 4n },
    ])

    const sourceBounds = legBounds(source)
    const childrenBounds = result.positionIdList.map(legBounds)
    expect(childrenBounds[0]?.lower).toBe(sourceBounds.lower)
    expect(childrenBounds.at(-1)?.upper).toBe(sourceBounds.upper)
    for (let index = 1; index < childrenBounds.length; index++) {
      expect(childrenBounds[index - 1]?.upper).toBe(childrenBounds[index]?.lower)
    }
  })

  it('carries an already-shorter option through unchanged', () => {
    const source = singleCall(POOL_ID_10, { strike: -600n, width: 72n })
    expect(splitTokenIdByTimescale(source, 9n, '1W')).toEqual({
      positionIdList: [source],
      positionSizes: [9n],
    })
  })

  it('offsets children relative to a negative source strike', () => {
    const source = singleCall(POOL_ID_10, { strike: -600n })
    const result = splitTokenIdByTimescale(source, 8n, '1W')
    expect(result.positionIdList.map((id) => decodeAllLegs(id)[0]?.strike)).toEqual([-1800n, 600n])
  })

  it('separates self-partnered funding legs and appends funding last', () => {
    const source = createTokenIdBuilder(POOL_ID_10)
      .addCall({
        strike: 0n,
        width: 480n,
        optionRatio: 1n,
        isLong: true,
      })
      .addCredit({ asset: 0n, tokenType: 0n, strike: 0n })
      .build()

    const result = splitTokenIdByTimescale(source, 5n, '1W')
    expect(result.positionSizes).toEqual([3n, 2n, 5n])
    expect(result.positionIdList).toHaveLength(3)

    const optionChildren = result.positionIdList.slice(0, -1).map(decodeAllLegs)
    expect(optionChildren.every((legs) => legs[0]?.riskPartner === 0n)).toBe(true)

    const fundingLegs = decodeAllLegs(result.positionIdList.at(-1) ?? 0n)
    expect(fundingLegs).toHaveLength(1)
    expect(fundingLegs[0]).toMatchObject({ width: 0n, riskPartner: 0n, isLong: true })
  })

  it('rejects mutual risk pairs spanning option and funding outputs', () => {
    const source = createTokenIdBuilder(POOL_ID_10)
      .addCall({
        strike: 0n,
        width: 480n,
        optionRatio: 1n,
        isLong: true,
        riskPartner: 1n,
      })
      .addCredit({ asset: 0n, tokenType: 0n, strike: 0n, riskPartner: 0n })
      .build()

    expect(() => splitTokenIdByTimescale(source, 5n, '1W')).toThrow(PanopticValidationError)
  })

  it('combines funding-only positions without changing their size', () => {
    const source = createTokenIdBuilder(POOL_ID_10)
      .addLoan({ asset: 0n, tokenType: 0n, strike: -10n, riskPartner: 1n })
      .addCredit({ asset: 0n, tokenType: 0n, strike: 10n, riskPartner: 0n })
      .build()

    expect(splitTokenIdByTimescale(source, 17n, '1D')).toEqual({
      positionIdList: [source],
      positionSizes: [17n],
    })
  })

  it.each([
    ['empty tokenId', POOL_ID_10, 1n],
    ['zero position size', singleCall(), 0n],
    ['oversized position size', singleCall(), 1n << 128n],
  ])('rejects %s', (_label, tokenId, positionSize) => {
    expect(() => splitTokenIdByTimescale(tokenId, positionSize, '1W')).toThrow(
      PanopticValidationError,
    )
  })

  it('rejects non-contiguous active legs', () => {
    const leg: EncodeLegParams = {
      index: 1n,
      asset: 0n,
      optionRatio: 1n,
      isLong: 1n,
      tokenType: 0n,
      riskPartner: 1n,
      strike: 0n,
      width: 480n,
    }
    const source = addLegToTokenId(POOL_ID_10, leg)
    expect(() => splitTokenIdByTimescale(source, 10n, '1W')).toThrow(PanopticValidationError)
  })

  it('rejects non-mutual and inactive risk partners', () => {
    const nonMutual = createTokenIdBuilder(POOL_ID_10)
      .addCall({
        strike: 0n,
        width: 480n,
        optionRatio: 1n,
        isLong: true,
        riskPartner: 1n,
      })
      .addPut({ strike: 0n, width: 480n, optionRatio: 1n, isLong: true })
      .build()
    const inactive = createTokenIdBuilder(POOL_ID_10)
      .addCall({
        strike: 0n,
        width: 480n,
        optionRatio: 1n,
        isLong: true,
        riskPartner: 1n,
      })
      .build()

    expect(() => splitTokenIdByTimescale(nonMutual, 10n, '1W')).toThrow(PanopticValidationError)
    expect(() => splitTokenIdByTimescale(inactive, 10n, '1W')).toThrow(PanopticValidationError)
  })

  it('rejects zero tick spacing and sizes too small for the child count', () => {
    const zeroSpacing = singleCall(encodePoolId(POOL_ADDRESS, 0n))
    expect(() => splitTokenIdByTimescale(zeroSpacing, 10n, '1W')).toThrow(PanopticValidationError)
    expect(() => splitTokenIdByTimescale(singleCall(), 1n, '1W')).toThrow(PanopticValidationError)
  })

  it('rejects generated child strikes outside int24', () => {
    const source = singleCall(POOL_ID_10, { strike: 8388607n })
    expect(() => splitTokenIdByTimescale(source, 10n, '1W')).toThrow(PanopticValidationError)
  })
})
