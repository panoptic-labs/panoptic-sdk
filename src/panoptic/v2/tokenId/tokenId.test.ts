/**
 * Tests for TokenId utilities.
 * @module v2/tokenId/tokenId.test
 */

import { describe, expect, it } from 'vitest'

import { InvalidTokenIdParameterError } from '../errors'
import {
  convertStrikeToSigned,
  convertStrikeToUnsigned,
  countLegs,
  createTokenIdBuilder,
  decodeAllLegs,
  decodeLeg,
  decodePoolId,
  decodeTickSpacing,
  decodeTokenId,
  decodeVegoid,
  DEFAULT_VEGOID,
  encodeLeg,
  encodePoolId,
  getAssetIndex,
  hasCreditLeg,
  hasLoanLeg,
  hasLoanOrCredit,
  hasLongLeg,
  isCredit,
  isLoan,
  isShortOnly,
  isSpread,
  LEG_LIMITS,
  STANDARD_TICK_WIDTHS,
  TOKEN_ID_BITS,
} from './index'

const MOCK_POOL_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as const
const MOCK_POOL_ID = encodePoolId(MOCK_POOL_ADDRESS, 60n)

describe('TokenId Constants', () => {
  it('should have correct standard tick widths', () => {
    expect(STANDARD_TICK_WIDTHS['1H']).toBe(240n)
    expect(STANDARD_TICK_WIDTHS['1D']).toBe(720n)
    expect(STANDARD_TICK_WIDTHS['1W']).toBe(2400n)
    expect(STANDARD_TICK_WIDTHS['1M']).toBe(4800n)
    expect(STANDARD_TICK_WIDTHS['1Y']).toBe(15000n)
  })

  it('should have correct default vegoid', () => {
    expect(DEFAULT_VEGOID).toBe(4n)
  })

  it('should have correct bit sizes', () => {
    expect(TOKEN_ID_BITS.POOL_ID_SIZE).toBe(64n)
    expect(TOKEN_ID_BITS.LEG_SIZE).toBe(48n)
    expect(TOKEN_ID_BITS.MAX_LEGS).toBe(4n)
  })

  it('should have correct leg limits', () => {
    expect(LEG_LIMITS.MAX_RATIO).toBe(127n)
    expect(LEG_LIMITS.MAX_WIDTH).toBe(4095n)
  })
})

describe('Strike Conversion', () => {
  it('should convert positive strike unchanged', () => {
    expect(convertStrikeToUnsigned(100n)).toBe(100n)
    expect(convertStrikeToUnsigned(0n)).toBe(0n)
    expect(convertStrikeToUnsigned(8388607n)).toBe(8388607n)
  })

  it('should convert negative strike to unsigned', () => {
    expect(convertStrikeToUnsigned(-1n)).toBe(16777215n)
    expect(convertStrikeToUnsigned(-100n)).toBe(16777116n)
    expect(convertStrikeToUnsigned(-8388608n)).toBe(8388608n)
  })

  it('should convert unsigned back to signed', () => {
    expect(convertStrikeToSigned(100n)).toBe(100n)
    expect(convertStrikeToSigned(0n)).toBe(0n)
    expect(convertStrikeToSigned(16777215n)).toBe(-1n)
    expect(convertStrikeToSigned(16777116n)).toBe(-100n)
    expect(convertStrikeToSigned(8388608n)).toBe(-8388608n)
  })

  it('should round-trip strike values', () => {
    const testValues = [0n, 100n, -100n, 8388607n, -8388608n, 1000n, -1000n]
    for (const value of testValues) {
      const encoded = convertStrikeToUnsigned(value)
      const decoded = convertStrikeToSigned(encoded)
      expect(decoded).toBe(value)
    }
  })
})

describe('Pool ID Encoding', () => {
  it('should encode pool ID with default vegoid', () => {
    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 60n)
    expect(poolId).toBeTypeOf('bigint')
    expect(poolId > 0n).toBe(true)
  })

  it('should encode pool ID with custom vegoid', () => {
    const poolId1 = encodePoolId(MOCK_POOL_ADDRESS, 60n, 4n)
    const poolId2 = encodePoolId(MOCK_POOL_ADDRESS, 60n, 5n)
    expect(poolId1).not.toBe(poolId2)
  })

  it('should encode different tick spacings', () => {
    const poolId60 = encodePoolId(MOCK_POOL_ADDRESS, 60n)
    const poolId200 = encodePoolId(MOCK_POOL_ADDRESS, 200n)
    expect(poolId60).not.toBe(poolId200)
  })

  it('should decode vegoid correctly', () => {
    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 60n, 7n)
    expect(decodeVegoid(poolId)).toBe(7n)
  })

  it('should decode tick spacing correctly', () => {
    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 200n)
    expect(decodeTickSpacing(poolId)).toBe(200n)
  })

  it('should decode pool ID as hex', () => {
    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 60n)
    const hex = decodePoolId(poolId)
    expect(hex.startsWith('0x')).toBe(true)
    expect(hex.length).toBe(18) // 0x + 16 hex chars
  })
})

describe('Leg Encoding/Decoding', () => {
  it('should encode and decode a basic leg', () => {
    const leg = encodeLeg({
      index: 0n,
      asset: 1n,
      optionRatio: 1n,
      isLong: 0n,
      tokenType: 1n,
      riskPartner: 0n,
      strike: 100n,
      width: 10n,
    })

    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 60n)
    const tokenId = poolId | leg

    const decoded = decodeLeg(tokenId, 0n)
    expect(decoded.asset).toBe(1n)
    expect(decoded.optionRatio).toBe(1n)
    expect(decoded.isLong).toBe(false)
    expect(decoded.tokenType).toBe(1n)
    expect(decoded.riskPartner).toBe(0n)
    expect(decoded.strike).toBe(100n)
    expect(decoded.width).toBe(10n)
  })

  it('should encode and decode a long leg', () => {
    const leg = encodeLeg({
      index: 0n,
      asset: 0n,
      optionRatio: 5n,
      isLong: 1n,
      tokenType: 0n,
      riskPartner: 0n,
      strike: -200n,
      width: 25n,
    })

    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 60n)
    const tokenId = poolId | leg

    const decoded = decodeLeg(tokenId, 0n)
    expect(decoded.asset).toBe(0n)
    expect(decoded.optionRatio).toBe(5n)
    expect(decoded.isLong).toBe(true)
    expect(decoded.tokenType).toBe(0n)
    expect(decoded.strike).toBe(-200n)
    expect(decoded.width).toBe(25n)
  })

  it('should encode multiple legs', () => {
    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 60n)

    const leg0 = encodeLeg({
      index: 0n,
      asset: 1n,
      optionRatio: 1n,
      isLong: 0n,
      tokenType: 1n,
      riskPartner: 0n,
      strike: 100n,
      width: 10n,
    })

    const leg1 = encodeLeg({
      index: 1n,
      asset: 0n,
      optionRatio: 2n,
      isLong: 1n,
      tokenType: 0n,
      riskPartner: 1n,
      strike: -50n,
      width: 20n,
    })

    const tokenId = poolId | leg0 | leg1

    const decoded0 = decodeLeg(tokenId, 0n)
    const decoded1 = decodeLeg(tokenId, 1n)

    expect(decoded0.optionRatio).toBe(1n)
    expect(decoded0.strike).toBe(100n)
    expect(decoded1.optionRatio).toBe(2n)
    expect(decoded1.strike).toBe(-50n)
  })

  it('should count legs correctly', () => {
    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 60n)

    const leg0 = encodeLeg({
      index: 0n,
      asset: 1n,
      optionRatio: 1n,
      isLong: 0n,
      tokenType: 1n,
      riskPartner: 0n,
      strike: 100n,
      width: 10n,
    })

    expect(countLegs(poolId)).toBe(0n)
    expect(countLegs(poolId | leg0)).toBe(1n)
  })

  it('should decode all legs', () => {
    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 60n)

    const leg0 = encodeLeg({
      index: 0n,
      asset: 1n,
      optionRatio: 1n,
      isLong: 0n,
      tokenType: 1n,
      riskPartner: 0n,
      strike: 100n,
      width: 10n,
    })

    const leg1 = encodeLeg({
      index: 1n,
      asset: 0n,
      optionRatio: 3n,
      isLong: 1n,
      tokenType: 0n,
      riskPartner: 1n,
      strike: -100n,
      width: 15n,
    })

    const tokenId = poolId | leg0 | leg1
    const legs = decodeAllLegs(tokenId)

    expect(legs.length).toBe(2)
    expect(legs[0].strike).toBe(100n)
    expect(legs[1].strike).toBe(-100n)
  })
})

describe('TokenId Builder', () => {
  it('should create a builder with pool address', () => {
    const builder = createTokenIdBuilder(MOCK_POOL_ID)
    expect(builder.legCount()).toBe(0n)
  })

  it('should add a leg', () => {
    const builder = createTokenIdBuilder(MOCK_POOL_ID)
    builder.addLeg({
      asset: 1n,
      optionRatio: 1n,
      isLong: false,
      tokenType: 1n,
      strike: 100n,
      width: 10n,
    })
    expect(builder.legCount()).toBe(1n)
  })

  it('should add call leg with correct defaults', () => {
    // Call: tokenType === asset
    // Default asset=0, so tokenType=0
    const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
      })
      .build()

    const decoded = decodeTokenId(tokenId)
    expect(decoded.legs[0].tokenType).toBe(0n) // Call: tokenType === asset
    expect(decoded.legs[0].asset).toBe(0n)
  })

  it('should allow overriding asset in addCall', () => {
    // Call with asset=1: tokenType should also be 1
    const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
        asset: 1n,
      })
      .build()

    const decoded = decodeTokenId(tokenId)
    expect(decoded.legs[0].tokenType).toBe(1n) // Call: tokenType === asset
    expect(decoded.legs[0].asset).toBe(1n)
  })

  it('should add put leg with correct defaults', () => {
    // Put: tokenType !== asset
    // Default asset=0, so tokenType=1
    const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
      .addPut({
        optionRatio: 1n,
        isLong: false,
        strike: -100n,
        width: 10n,
      })
      .build()

    const decoded = decodeTokenId(tokenId)
    expect(decoded.legs[0].tokenType).toBe(1n) // Put: tokenType !== asset
    expect(decoded.legs[0].asset).toBe(0n)
  })

  it('should allow overriding asset in addPut', () => {
    // Put with asset=1: tokenType should be 0 (opposite)
    const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
      .addPut({
        optionRatio: 1n,
        isLong: false,
        strike: -100n,
        width: 10n,
        asset: 1n,
      })
      .build()

    const decoded = decodeTokenId(tokenId)
    expect(decoded.legs[0].tokenType).toBe(0n) // Put: tokenType !== asset
    expect(decoded.legs[0].asset).toBe(1n)
  })

  it('should chain multiple legs', () => {
    const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
      })
      .addPut({
        optionRatio: 1n,
        isLong: false,
        strike: -100n,
        width: 10n,
      })
      .build()

    const decoded = decodeTokenId(tokenId)
    expect(decoded.legCount).toBe(2n)
  })

  it('should throw when building with no legs', () => {
    const builder = createTokenIdBuilder(MOCK_POOL_ID)
    expect(() => builder.build()).toThrow(InvalidTokenIdParameterError)
  })

  it('should throw when adding more than 4 legs', () => {
    const builder = createTokenIdBuilder(MOCK_POOL_ID)
    for (let i = 0; i < 4; i++) {
      builder.addCall({
        optionRatio: 1n,
        isLong: false,
        strike: BigInt(100 * (i + 1)),
        width: 10n,
      })
    }
    expect(() =>
      builder.addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 500n,
        width: 10n,
      }),
    ).toThrow(InvalidTokenIdParameterError)
  })

  it('should throw for invalid option ratio', () => {
    const builder = createTokenIdBuilder(MOCK_POOL_ID)
    expect(() =>
      builder.addCall({
        optionRatio: 0n,
        isLong: false,
        strike: 100n,
        width: 10n,
      }),
    ).toThrow(InvalidTokenIdParameterError)

    expect(() =>
      builder.addCall({
        optionRatio: 128n,
        isLong: false,
        strike: 100n,
        width: 10n,
      }),
    ).toThrow(InvalidTokenIdParameterError)
  })

  it('should throw for negative width', () => {
    const builder = createTokenIdBuilder(MOCK_POOL_ID)
    expect(() =>
      builder.addLeg({
        asset: 0n,
        optionRatio: 1n,
        isLong: false,
        tokenType: 0n,
        strike: 100n,
        width: -1n,
      }),
    ).toThrow(InvalidTokenIdParameterError)
  })

  it('should throw for width exceeding max', () => {
    const builder = createTokenIdBuilder(MOCK_POOL_ID)
    expect(() =>
      builder.addLeg({
        asset: 0n,
        optionRatio: 1n,
        isLong: false,
        tokenType: 0n,
        strike: 100n,
        width: 4096n, // MAX_WIDTH is 4095
      }),
    ).toThrow(InvalidTokenIdParameterError)
  })

  it('should reset the builder', () => {
    const builder = createTokenIdBuilder(MOCK_POOL_ID)
    builder.addCall({
      optionRatio: 1n,
      isLong: false,
      strike: 100n,
      width: 10n,
    })
    expect(builder.legCount()).toBe(1n)

    builder.reset()
    expect(builder.legCount()).toBe(0n)
  })

  it('should set risk partner correctly', () => {
    const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
        riskPartner: 1n, // Partner with leg 1
      })
      .addCall({
        optionRatio: 1n,
        isLong: true,
        strike: 200n,
        width: 10n,
        riskPartner: 0n, // Partner with leg 0
      })
      .build()

    const decoded = decodeTokenId(tokenId)
    expect(decoded.legs[0].riskPartner).toBe(1n)
    expect(decoded.legs[1].riskPartner).toBe(0n)
  })
})

describe('TokenId Decoding', () => {
  it('should decode a complete TokenId', () => {
    const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
      })
      .build()

    const decoded = decodeTokenId(tokenId)

    expect(decoded.tokenId).toBe(tokenId)
    expect(decoded.tickSpacing).toBe(60n)
    expect(decoded.vegoid).toBe(DEFAULT_VEGOID)
    expect(decoded.legCount).toBe(1n)
    expect(decoded.legs.length).toBe(1)
    expect(decoded.legs[0].strike).toBe(100n)
    expect(decoded.legs[0].width).toBe(10n)
  })

  it('should calculate tick bounds correctly', () => {
    const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 0n,
        width: 10n, // 10 * 60 = 600 tick width
      })
      .build()

    const decoded = decodeTokenId(tokenId)
    const leg = decoded.legs[0]

    // halfWidth = (10 * 60) / 2 = 300
    expect(leg.tickLower).toBe(-300n)
    expect(leg.tickUpper).toBe(300n)
  })
})

describe('TokenId Helpers', () => {
  it('should detect long legs', () => {
    const shortOnly = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
      })
      .build()

    const hasLong = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: true,
        strike: 100n,
        width: 10n,
      })
      .build()

    expect(hasLongLeg(shortOnly)).toBe(false)
    expect(hasLongLeg(hasLong)).toBe(true)
  })

  it('should detect short-only positions', () => {
    const shortOnly = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
      })
      .addPut({
        optionRatio: 1n,
        isLong: false,
        strike: -100n,
        width: 10n,
      })
      .build()

    const mixed = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
      })
      .addCall({
        optionRatio: 1n,
        isLong: true,
        strike: 200n,
        width: 10n,
      })
      .build()

    expect(isShortOnly(shortOnly)).toBe(true)
    expect(isShortOnly(mixed)).toBe(false)
  })

  it('should detect spreads', () => {
    const noSpread = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
      })
      .build()

    const spread = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
        riskPartner: 1n,
      })
      .addCall({
        optionRatio: 1n,
        isLong: true,
        strike: 200n,
        width: 10n,
        riskPartner: 0n,
      })
      .build()

    expect(isSpread(noSpread)).toBe(false)
    expect(isSpread(spread)).toBe(true)
  })

  it('should get asset index', () => {
    // Both addCall and addPut default to asset: 0n (risky asset, e.g., WETH)
    const callToken = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
      })
      .build()

    const putToken = createTokenIdBuilder(MOCK_POOL_ID)
      .addPut({
        optionRatio: 1n,
        isLong: false,
        strike: -100n,
        width: 10n,
      })
      .build()

    expect(getAssetIndex(callToken)).toBe(0n)
    expect(getAssetIndex(putToken)).toBe(0n)
  })

  it('should get asset index with override', () => {
    const callToken = createTokenIdBuilder(MOCK_POOL_ID)
      .addCall({
        optionRatio: 1n,
        isLong: false,
        strike: 100n,
        width: 10n,
        asset: 1n, // Override to token1
      })
      .build()

    expect(getAssetIndex(callToken)).toBe(1n)
  })

  it('should return undefined for empty TokenId', () => {
    const poolId = encodePoolId(MOCK_POOL_ADDRESS, 60n)
    expect(getAssetIndex(poolId)).toBeUndefined()
  })
})

describe('Loan/Credit TokenIds', () => {
  describe('Builder', () => {
    it('should create a loan with width=0 and isLong=false', () => {
      const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
        .addLoan({
          asset: 0n,
          tokenType: 0n,
          strike: 100n,
        })
        .build()

      const decoded = decodeTokenId(tokenId)
      expect(decoded.legCount).toBe(1n)
      expect(decoded.legs[0].width).toBe(0n)
      expect(decoded.legs[0].isLong).toBe(false)
      expect(decoded.legs[0].tokenType).toBe(0n)
      expect(decoded.legs[0].asset).toBe(0n)
      expect(decoded.legs[0].strike).toBe(100n)
    })

    it('should create a credit with width=0 and isLong=true', () => {
      const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
        .addCredit({
          asset: 0n,
          tokenType: 1n,
          strike: -50n,
        })
        .build()

      const decoded = decodeTokenId(tokenId)
      expect(decoded.legCount).toBe(1n)
      expect(decoded.legs[0].width).toBe(0n)
      expect(decoded.legs[0].isLong).toBe(true)
      expect(decoded.legs[0].tokenType).toBe(1n)
      expect(decoded.legs[0].asset).toBe(0n)
      expect(decoded.legs[0].strike).toBe(-50n)
    })

    it('should create loan with custom optionRatio', () => {
      const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
        .addLoan({
          asset: 0n,
          tokenType: 0n,
          strike: 100n,
          optionRatio: 5n,
        })
        .build()

      const decoded = decodeTokenId(tokenId)
      expect(decoded.legs[0].optionRatio).toBe(5n)
    })

    it('should set asset equal to tokenType for loans', () => {
      const tokenId0 = createTokenIdBuilder(MOCK_POOL_ID)
        .addLoan({ asset: 0n, tokenType: 0n, strike: 100n })
        .build()

      const tokenId1 = createTokenIdBuilder(MOCK_POOL_ID)
        .addLoan({ asset: 1n, tokenType: 1n, strike: 100n })
        .build()

      const decoded0 = decodeTokenId(tokenId0)
      const decoded1 = decodeTokenId(tokenId1)

      expect(decoded0.legs[0].asset).toBe(0n)
      expect(decoded1.legs[0].asset).toBe(1n)
    })

    it('should allow combining loans with regular options', () => {
      const tokenId = createTokenIdBuilder(MOCK_POOL_ID)
        .addCall({
          optionRatio: 1n,
          isLong: false,
          strike: 100n,
          width: 10n,
        })
        .addLoan({
          asset: 0n,
          tokenType: 0n,
          strike: 200n,
        })
        .build()

      const decoded = decodeTokenId(tokenId)
      expect(decoded.legCount).toBe(2n)
      expect(decoded.legs[0].width).toBe(10n) // Regular option
      expect(decoded.legs[1].width).toBe(0n) // Loan
    })
  })

  describe('Helpers', () => {
    it('should detect pure loan tokenId', () => {
      const loanId = createTokenIdBuilder(MOCK_POOL_ID)
        .addLoan({ asset: 0n, tokenType: 0n, strike: 100n })
        .build()

      expect(isLoan(loanId)).toBe(true)
      expect(isCredit(loanId)).toBe(false)
      expect(hasLoanLeg(loanId)).toBe(true)
      expect(hasCreditLeg(loanId)).toBe(false)
      expect(hasLoanOrCredit(loanId)).toBe(true)
    })

    it('should detect pure credit tokenId', () => {
      const creditId = createTokenIdBuilder(MOCK_POOL_ID)
        .addCredit({ asset: 1n, tokenType: 1n, strike: -100n })
        .build()

      expect(isLoan(creditId)).toBe(false)
      expect(isCredit(creditId)).toBe(true)
      expect(hasLoanLeg(creditId)).toBe(false)
      expect(hasCreditLeg(creditId)).toBe(true)
      expect(hasLoanOrCredit(creditId)).toBe(true)
    })

    it('should detect mixed loan/credit tokenId', () => {
      const mixedId = createTokenIdBuilder(MOCK_POOL_ID)
        .addLoan({ asset: 0n, tokenType: 0n, strike: 100n })
        .addCredit({ asset: 0n, tokenType: 1n, strike: -100n })
        .build()

      // Not pure loan or credit (has both)
      expect(isLoan(mixedId)).toBe(false)
      expect(isCredit(mixedId)).toBe(false)
      // But has both types
      expect(hasLoanLeg(mixedId)).toBe(true)
      expect(hasCreditLeg(mixedId)).toBe(true)
      expect(hasLoanOrCredit(mixedId)).toBe(true)
    })

    it('should not detect loan/credit on regular options', () => {
      const optionId = createTokenIdBuilder(MOCK_POOL_ID)
        .addCall({
          optionRatio: 1n,
          isLong: false,
          strike: 100n,
          width: 10n,
        })
        .build()

      expect(isLoan(optionId)).toBe(false)
      expect(isCredit(optionId)).toBe(false)
      expect(hasLoanLeg(optionId)).toBe(false)
      expect(hasCreditLeg(optionId)).toBe(false)
      expect(hasLoanOrCredit(optionId)).toBe(false)
    })

    it('should detect loan/credit in mixed option+loan tokenId', () => {
      const mixedId = createTokenIdBuilder(MOCK_POOL_ID)
        .addCall({
          optionRatio: 1n,
          isLong: false,
          strike: 100n,
          width: 10n,
        })
        .addLoan({ asset: 0n, tokenType: 0n, strike: 200n })
        .build()

      // Not pure loan (has regular option)
      expect(isLoan(mixedId)).toBe(false)
      // But has a loan leg
      expect(hasLoanLeg(mixedId)).toBe(true)
      expect(hasLoanOrCredit(mixedId)).toBe(true)
    })
  })
})
