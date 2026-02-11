/**
 * Low-level TokenId encoding utilities for the Panoptic v2 SDK.
 * @module v2/tokenId/encoding
 */

import type { Address, Hex } from 'viem'

import {
  DEFAULT_VEGOID,
  LEG_BITS,
  LEG_MASKS,
  STRIKE_CONVERSION_FACTOR,
  TOKEN_ID_BITS,
} from './constants'

/**
 * Leg parameters for encoding.
 */
export interface EncodeLegParams {
  /** Leg index (0-3) */
  index: bigint
  /** Asset index (0 or 1) */
  asset: bigint
  /** Option ratio (1-127) */
  optionRatio: bigint
  /** Whether this is a long position (1n = long, 0n = short) */
  isLong: bigint
  /** Token type (0 or 1) */
  tokenType: bigint
  /** Risk partner leg index (0-3) */
  riskPartner: bigint
  /** Strike tick */
  strike: bigint
  /** Width in tick spacing units */
  width: bigint
}

/**
 * Convert a signed strike tick to unsigned representation for encoding.
 *
 * @param strike - The signed strike tick
 * @returns The unsigned representation
 */
export function convertStrikeToUnsigned(strike: bigint): bigint {
  if (strike < 0n) {
    return STRIKE_CONVERSION_FACTOR + strike
  }
  return strike
}

/**
 * Convert an unsigned encoded strike back to signed representation.
 *
 * @param encodedStrike - The unsigned encoded strike
 * @returns The signed strike tick
 */
export function convertStrikeToSigned(encodedStrike: bigint): bigint {
  // If the value is greater than max positive int24, it's negative
  if (encodedStrike > 2n ** 23n - 1n) {
    return encodedStrike - STRIKE_CONVERSION_FACTOR
  }
  return encodedStrike
}

/**
 * Get the bit offset for a leg at the given index.
 *
 * @param legIndex - The leg index (0-3)
 * @returns The bit offset from the start of the legs section
 */
export function getLegOffset(legIndex: bigint): bigint {
  return legIndex * TOKEN_ID_BITS.LEG_SIZE
}

/**
 * Encode a pool ID from a Uniswap V3 pool address.
 *
 * The encoded PoolId structure: [16-bit tickSpacing][8-bit vegoid][40-bit pool address]
 *
 * @param address - The Uniswap V3 pool address
 * @param tickSpacing - The tick spacing of the pool
 * @param vegoid - The vegoid value (defaults to 4)
 * @returns The encoded pool ID
 */
export function encodePoolId(
  address: Address,
  tickSpacing: bigint,
  vegoid: bigint = DEFAULT_VEGOID,
): bigint {
  // Remove 0x prefix and get first 10 hex chars (5 bytes = 40 bits)
  const addressHex = address.slice(2, 12).toLowerCase()

  // Convert to bytes array (big-endian), then reverse to little-endian
  const bytes: number[] = []
  for (let i = 0; i < 10; i += 2) {
    bytes.push(parseInt(addressHex.slice(i, i + 2), 16))
  }
  bytes.reverse()

  // Build poolId: pool address (5 bytes) + vegoid (1 byte) + tickSpacing (2 bytes)
  let poolId = 0n
  for (let i = 0; i < bytes.length; i++) {
    poolId |= BigInt(bytes[i]) << BigInt(i * 8)
  }

  // Add vegoid at bit 40
  poolId |= (vegoid & 0xffn) << TOKEN_ID_BITS.VEGOID_STARTING_BIT

  // Add tickSpacing at bit 48
  poolId |= (tickSpacing & 0xffffn) << TOKEN_ID_BITS.TICK_SPACING_STARTING_BIT

  return poolId
}

/**
 * Encode a pool ID from a Uniswap V4 pool ID (bytes32).
 *
 * @param poolIdHex - The V4 pool ID (bytes32 hex string)
 * @param tickSpacing - The tick spacing of the pool
 * @param vegoid - The vegoid value (defaults to 4)
 * @returns The encoded pool ID
 */
export function encodeV4PoolId(
  poolIdHex: Hex,
  tickSpacing: bigint,
  vegoid: bigint = DEFAULT_VEGOID,
): bigint {
  // Remove 0x prefix and get last 10 hex chars (5 bytes = 40 bits)
  const hex = poolIdHex.slice(2)
  const last5BytesHex = hex.slice(-10).toLowerCase()

  // Convert to bytes array (big-endian), then reverse to little-endian
  const bytes: number[] = []
  for (let i = 0; i < 10; i += 2) {
    bytes.push(parseInt(last5BytesHex.slice(i, i + 2), 16))
  }
  bytes.reverse()

  // Build encoded poolId
  let encodedPoolId = 0n
  for (let i = 0; i < bytes.length; i++) {
    encodedPoolId |= BigInt(bytes[i]) << BigInt(i * 8)
  }

  // Add vegoid at bit 40
  encodedPoolId |= (vegoid & 0xffn) << TOKEN_ID_BITS.VEGOID_STARTING_BIT

  // Add tickSpacing at bit 48
  encodedPoolId |= (tickSpacing & 0xffffn) << TOKEN_ID_BITS.TICK_SPACING_STARTING_BIT

  return encodedPoolId
}

/**
 * Decode the vegoid from a TokenId.
 *
 * @param tokenId - The TokenId to decode
 * @returns The vegoid value
 */
export function decodeVegoid(tokenId: bigint): bigint {
  const poolId = tokenId & ((1n << TOKEN_ID_BITS.POOL_ID_SIZE) - 1n)
  return (poolId >> TOKEN_ID_BITS.VEGOID_STARTING_BIT) & ((1n << TOKEN_ID_BITS.VEGOID_SIZE) - 1n)
}

/**
 * Decode the tick spacing from a TokenId.
 *
 * @param tokenId - The TokenId to decode
 * @returns The tick spacing
 */
export function decodeTickSpacing(tokenId: bigint): bigint {
  const poolId = tokenId & ((1n << TOKEN_ID_BITS.POOL_ID_SIZE) - 1n)
  return poolId >> TOKEN_ID_BITS.TICK_SPACING_STARTING_BIT
}

/**
 * Decode the pool ID portion from a TokenId.
 *
 * @param tokenId - The TokenId to decode
 * @returns The pool ID as a hex string
 */
export function decodePoolId(tokenId: bigint): Hex {
  const poolId = tokenId & ((1n << TOKEN_ID_BITS.POOL_ID_SIZE) - 1n)
  let hex = poolId.toString(16)
  // Pad to 16 characters (64 bits)
  while (hex.length < 16) {
    hex = '0' + hex
  }
  return `0x${hex}` as Hex
}

/**
 * Encode a single leg field.
 *
 * @param value - The value to encode
 * @param bitPosition - The bit position within the leg
 * @param legIndex - The leg index
 * @returns The encoded value shifted to the correct position
 */
function encodeLegField(value: bigint, bitPosition: bigint, legIndex: bigint): bigint {
  return value << (getLegOffset(legIndex) + bitPosition + TOKEN_ID_BITS.POOL_ID_SIZE)
}

/**
 * Encode a single leg into a TokenId.
 *
 * @param leg - The leg parameters
 * @returns The encoded leg value (to be ORed with existing TokenId)
 */
export function encodeLeg(leg: EncodeLegParams): bigint {
  const { index, asset, optionRatio, isLong, tokenType, riskPartner, strike, width } = leg

  return (
    encodeLegField(asset & LEG_MASKS.ASSET, LEG_BITS.ASSET_BIT, index) |
    encodeLegField(optionRatio & LEG_MASKS.RATIO, LEG_BITS.RATIO_BIT, index) |
    encodeLegField(isLong & LEG_MASKS.IS_LONG, LEG_BITS.IS_LONG_BIT, index) |
    encodeLegField(tokenType & LEG_MASKS.TOKEN_TYPE, LEG_BITS.TOKEN_TYPE_BIT, index) |
    encodeLegField(riskPartner & LEG_MASKS.RISK_PARTNER, LEG_BITS.RISK_PARTNER_BIT, index) |
    encodeLegField(convertStrikeToUnsigned(strike) & LEG_MASKS.STRIKE, LEG_BITS.STRIKE_BIT, index) |
    encodeLegField(width & LEG_MASKS.WIDTH, LEG_BITS.WIDTH_BIT, index)
  )
}

/**
 * Add a leg to an existing TokenId.
 *
 * @param tokenId - The existing TokenId (can be just poolId or partial TokenId)
 * @param leg - The leg parameters to add
 * @returns The TokenId with the leg added
 */
export function addLegToTokenId(tokenId: bigint, leg: EncodeLegParams): bigint {
  return tokenId | encodeLeg(leg)
}

/**
 * Decoded leg data.
 */
export interface DecodedLeg {
  /** Leg index (0-3) */
  index: bigint
  /** Asset index (0 or 1) */
  asset: bigint
  /** Option ratio (1-127) */
  optionRatio: bigint
  /** Whether this is a long position */
  isLong: boolean
  /** Token type (0 or 1) */
  tokenType: bigint
  /** Risk partner leg index */
  riskPartner: bigint
  /** Strike tick (signed) */
  strike: bigint
  /** Width in tick spacing units */
  width: bigint
}

/**
 * Decode a single leg from a TokenId.
 *
 * @param tokenId - The TokenId to decode
 * @param legIndex - The leg index (0-3)
 * @returns The decoded leg data
 */
export function decodeLeg(tokenId: bigint, legIndex: bigint): DecodedLeg {
  const offset = getLegOffset(legIndex) + TOKEN_ID_BITS.POOL_ID_SIZE
  const leg = (tokenId >> offset) & LEG_MASKS.LEG

  const asset = leg & LEG_MASKS.ASSET
  const optionRatio = (leg >> LEG_BITS.RATIO_BIT) & LEG_MASKS.RATIO
  const isLong = ((leg >> LEG_BITS.IS_LONG_BIT) & LEG_MASKS.IS_LONG) === 1n
  const tokenType = (leg >> LEG_BITS.TOKEN_TYPE_BIT) & LEG_MASKS.TOKEN_TYPE
  const riskPartner = (leg >> LEG_BITS.RISK_PARTNER_BIT) & LEG_MASKS.RISK_PARTNER
  const encodedStrike = (leg >> LEG_BITS.STRIKE_BIT) & LEG_MASKS.STRIKE
  const strike = convertStrikeToSigned(encodedStrike)
  const width = (leg >> LEG_BITS.WIDTH_BIT) & LEG_MASKS.WIDTH

  return {
    index: legIndex,
    asset,
    optionRatio,
    isLong,
    tokenType,
    riskPartner,
    strike,
    width,
  }
}

/**
 * Count the number of active legs in a TokenId.
 * A leg is active if its optionRatio > 0.
 *
 * @param tokenId - The TokenId to check
 * @returns The number of active legs
 */
export function countLegs(tokenId: bigint): bigint {
  let count = 0n
  for (let i = 0n; i < TOKEN_ID_BITS.MAX_LEGS; i++) {
    const leg = decodeLeg(tokenId, i)
    if (leg.optionRatio > 0n) {
      count++
    }
  }
  return count
}

/**
 * Decode all active legs from a TokenId.
 *
 * @param tokenId - The TokenId to decode
 * @returns Array of decoded legs (only active legs with optionRatio > 0)
 */
export function decodeAllLegs(tokenId: bigint): DecodedLeg[] {
  const legs: DecodedLeg[] = []
  for (let i = 0n; i < TOKEN_ID_BITS.MAX_LEGS; i++) {
    const leg = decodeLeg(tokenId, i)
    if (leg.optionRatio > 0n) {
      legs.push(leg)
    }
  }
  return legs
}
