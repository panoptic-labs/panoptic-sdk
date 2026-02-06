import type { Address, Hex } from 'viem'
import { describe, expect, test } from 'vitest'

import {
  type LegParams,
  decodePosition,
  decodeTickSpacing,
  decodeVegoid,
  decodeVegoidFromPoolId,
  encodePoolId,
  encodePosition,
  encodeV4PoolId,
  padHexWithZeros,
  vegoid,
} from './option-encoding-v2'

const usdcEth05PoolAddr: Address = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640'

const mockLegs: LegParams[] = [
  {
    index: 0,
    width: 10n,
    optionRatio: 1n,
    asset: 0n,
    strike: 100n,
    isLong: 0n,
    tokenType: 0n,
    riskPartner: 0n,
  },
  {
    index: 1,
    width: 10n,
    optionRatio: 1n,
    asset: 1n,
    strike: -100n,
    isLong: 0n,
    tokenType: 1n,
    riskPartner: 1n,
  },
]

describe('option-encoding-v2', () => {
  test('Vegoid constant should be 4', () => {
    expect(BigInt(vegoid)).toBe(4n)
  })

  test('Encode poolId with vegoid', () => {
    const tickSpacing = 60n
    const vegoidValue = 4n
    const encodedPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing, vegoidValue)

    // Verify vegoid is encoded correctly
    const decodedVegoid = decodeVegoidFromPoolId(encodedPoolId)
    expect(decodedVegoid).toBe(vegoidValue)

    // Verify tickSpacing is encoded correctly
    const decodedTickSpacing = encodedPoolId >> 48n
    expect(decodedTickSpacing).toBe(tickSpacing)
  })

  test('Encode poolId with default vegoid', () => {
    const tickSpacing = 60n
    const encodedPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing)

    // Verify default vegoid (4) is used
    const decodedVegoid = decodeVegoidFromPoolId(encodedPoolId)
    expect(decodedVegoid).toBe(BigInt(vegoid))
  })

  test('Encode poolId with custom vegoid', () => {
    const tickSpacing = 60n
    const customVegoid = 42n
    const encodedPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing, customVegoid)

    // Verify custom vegoid is encoded correctly
    const decodedVegoid = decodeVegoidFromPoolId(encodedPoolId)
    expect(decodedVegoid).toBe(customVegoid)
  })

  test('Decode vegoid from TokenId', () => {
    const tickSpacing = 60n
    const vegoidValue = 4n
    const encodedPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing, vegoidValue)

    // Create a TokenId with legs
    const tokenId = encodePosition(encodedPoolId, mockLegs)

    // Decode vegoid from TokenId
    const decodedVegoid = decodeVegoid(tokenId)
    expect(decodedVegoid).toBe(vegoidValue)
  })

  test('Decode tickSpacing from TokenId', () => {
    const tickSpacing = 60n
    const vegoidValue = 4n
    const encodedPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing, vegoidValue)

    // Create a TokenId with legs
    const tokenId = encodePosition(encodedPoolId, mockLegs)

    // Decode tickSpacing from TokenId
    const decodedTickSpacing = decodeTickSpacing(tokenId)
    expect(decodedTickSpacing).toBe(tickSpacing)
  })

  test('Encode and decode position with vegoid', () => {
    const tickSpacing = 60n
    const vegoidValue = 4n
    const encodedPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing, vegoidValue)

    // Encode position
    const tokenId = encodePosition(encodedPoolId, mockLegs)

    // Decode position
    const decodedPosition = decodePosition(tokenId)

    // Verify vegoid is preserved
    const decodedVegoid = decodeVegoid(tokenId)
    expect(decodedVegoid).toBe(vegoidValue)

    // Verify legs are decoded correctly
    expect(decodedPosition.legs.length).toBe(2)

    // Verify first leg
    expect(mockLegs[0].width).toBe(decodedPosition.legs[0].width)
    expect(mockLegs[0].optionRatio).toBe(decodedPosition.legs[0].optionRatio)
    expect(mockLegs[0].asset).toBe(decodedPosition.legs[0].asset)
    expect(mockLegs[0].strike).toBe(decodedPosition.legs[0].strike)
    expect(mockLegs[0].isLong).toBe(decodedPosition.legs[0].isLong)
    expect(mockLegs[0].tokenType).toBe(decodedPosition.legs[0].tokenType)
    expect(mockLegs[0].riskPartner).toBe(decodedPosition.legs[0].riskPartner)

    // Verify second leg
    expect(mockLegs[1].width).toBe(decodedPosition.legs[1].width)
    expect(mockLegs[1].optionRatio).toBe(decodedPosition.legs[1].optionRatio)
    expect(mockLegs[1].asset).toBe(decodedPosition.legs[1].asset)
    expect(mockLegs[1].strike).toBe(decodedPosition.legs[1].strike)
    expect(mockLegs[1].isLong).toBe(decodedPosition.legs[1].isLong)
    expect(mockLegs[1].tokenType).toBe(decodedPosition.legs[1].tokenType)
    expect(mockLegs[1].riskPartner).toBe(decodedPosition.legs[1].riskPartner)
  })

  test('Encode V4 poolId with vegoid', () => {
    // Create a mock V4 pool ID (bytes32)
    const v4PoolIdHex: Hex = '0x1234567890123456789012345678901234567890123456789012345678901234'
    const tickSpacing = 60n
    const vegoidValue = 4n

    const encodedPoolId = encodeV4PoolId(v4PoolIdHex, tickSpacing, vegoidValue)

    // Verify vegoid is encoded correctly
    const decodedVegoid = decodeVegoidFromPoolId(encodedPoolId)
    expect(decodedVegoid).toBe(vegoidValue)

    // Verify tickSpacing is encoded correctly
    const decodedTickSpacing = encodedPoolId >> 48n
    expect(decodedTickSpacing).toBe(tickSpacing)
  })

  test('Real-world scenario: 2-leg strangle position', () => {
    // Simulate a real pool setup similar to TokenIdRealWorldExample.t.sol
    const poolAddress: Address = '0x1234567890123456789012345678901234567890'
    const tickSpacing = 60n
    const vegoidValue = 4n

    // Construct poolId
    const poolId = encodePoolId(poolAddress, tickSpacing, vegoidValue)

    // Create a 2-leg strangle position
    const strangleLegs: LegParams[] = [
      {
        index: 0,
        optionRatio: 1n,
        asset: 0n,
        isLong: 0n,
        tokenType: 0n,
        riskPartner: 0n,
        strike: 100n,
        width: 10n,
      },
      {
        index: 1,
        optionRatio: 1n,
        asset: 1n,
        isLong: 0n,
        tokenType: 0n,
        riskPartner: 1n,
        strike: -100n,
        width: 10n,
      },
    ]

    // Encode position
    const tokenId = encodePosition(poolId, strangleLegs)

    // Verify structure
    const decodedVegoid = decodeVegoid(tokenId)
    expect(decodedVegoid).toBe(vegoidValue)

    const decodedTickSpacing = decodeTickSpacing(tokenId)
    expect(decodedTickSpacing).toBe(tickSpacing)

    // Decode position
    const decodedPosition = decodePosition(tokenId)
    expect(decodedPosition.legs.length).toBe(2)

    // Verify leg details
    expect(decodedPosition.legs[0].strike).toBe(100n)
    expect(decodedPosition.legs[1].strike).toBe(-100n)
    expect(decodedPosition.legs[0].width).toBe(10n)
    expect(decodedPosition.legs[1].width).toBe(10n)
    expect(decodedPosition.legs[0].asset).toBe(0n)
    expect(decodedPosition.legs[1].asset).toBe(1n)
  })

  test('Vegoid extraction from poolId with different values', () => {
    const tickSpacing = 60n

    // Test with vegoid = 0
    let encodedPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing, 0n)
    let decodedVegoid = decodeVegoidFromPoolId(encodedPoolId)
    expect(decodedVegoid).toBe(0n)

    // Test with vegoid = 255 (max uint8)
    encodedPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing, 255n)
    decodedVegoid = decodeVegoidFromPoolId(encodedPoolId)
    expect(decodedVegoid).toBe(255n)

    // Test with vegoid = 42
    encodedPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing, 42n)
    decodedVegoid = decodeVegoidFromPoolId(encodedPoolId)
    expect(decodedVegoid).toBe(42n)
  })

  test('Round-trip encoding: encode then decode should preserve all values', () => {
    const tickSpacing = 60n
    const vegoidValue = 4n
    const originalPoolId = encodePoolId(usdcEth05PoolAddr, tickSpacing, vegoidValue)

    // Create position with multiple legs
    const complexLegs: LegParams[] = [
      {
        index: 0,
        width: 20n,
        optionRatio: 2n,
        asset: 0n,
        strike: 195270n,
        isLong: 1n,
        tokenType: 1n,
        riskPartner: 0n,
      },
      {
        index: 1,
        width: 15n,
        optionRatio: 1n,
        asset: 1n,
        strike: -195270n,
        isLong: 0n,
        tokenType: 0n,
        riskPartner: 1n,
      },
    ]

    const encodedTokenId = encodePosition(originalPoolId, complexLegs)
    const decodedPosition = decodePosition(encodedTokenId)

    // Verify poolId components
    const decodedVegoid = decodeVegoid(encodedTokenId)
    expect(decodedVegoid).toBe(vegoidValue)

    const decodedTickSpacing = decodeTickSpacing(encodedTokenId)
    expect(decodedTickSpacing).toBe(tickSpacing)

    // Verify all leg values are preserved
    for (let i = 0; i < complexLegs.length; i++) {
      expect(complexLegs[i].width).toBe(decodedPosition.legs[i].width)
      expect(complexLegs[i].optionRatio).toBe(decodedPosition.legs[i].optionRatio)
      expect(complexLegs[i].asset).toBe(decodedPosition.legs[i].asset)
      expect(complexLegs[i].strike).toBe(decodedPosition.legs[i].strike)
      expect(complexLegs[i].isLong).toBe(decodedPosition.legs[i].isLong)
      expect(complexLegs[i].tokenType).toBe(decodedPosition.legs[i].tokenType)
      expect(complexLegs[i].riskPartner).toBe(decodedPosition.legs[i].riskPartner)
    }
  })

  test('padHexWithZeros pads correctly', () => {
    expect(padHexWithZeros('0x1', 4)).toBe('0x01')
    expect(padHexWithZeros('0x1', 6)).toBe('0x0001')
    expect(padHexWithZeros('0xabc', 8)).toBe('0x000abc')
    expect(padHexWithZeros('0x123456', 8)).toBe('0x123456')
  })

  test('padHexWithZeros throws for non-hex strings', () => {
    expect(() => padHexWithZeros('abc', 8)).toThrow('do not use padHexWithZeros on non-hex strings')
  })
})
