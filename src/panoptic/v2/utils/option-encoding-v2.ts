import type { Address, Hex } from 'viem'

export const vegoid = 4

export interface LegParams {
  index: number
  width: bigint
  optionRatio: bigint
  asset: bigint
  strike: bigint
  isLong: bigint // 0 if short, 1 if long
  tokenType: bigint // Which token (0|1 in underlying pool) is being moved
  riskPartner: bigint
}

export const areLegsEqual = (leg1: LegParams, leg2: LegParams): boolean => {
  return (
    leg1.width === leg2.width &&
    leg1.optionRatio === leg2.optionRatio &&
    leg1.asset === leg2.asset &&
    leg1.strike === leg2.strike &&
    leg1.isLong === leg2.isLong &&
    leg1.tokenType === leg2.tokenType &&
    leg1.riskPartner === leg2.riskPartner
  )
}

export const stringifyLeg = (leg: LegParams): string => {
  return `Index: ${leg.index} | Width: ${leg.width.toString()} | OptionRatio: ${leg.optionRatio.toString()} | Asset: ${leg.asset.toString()} | Strike: ${leg.strike.toString()} | IsLong?: ${leg.isLong.toString()} | Token Type: ${leg.tokenType.toString()} | Risk Partner: ${leg.riskPartner.toString()}`
}

// Synthetic TokenIds padding constant
export const SYNTH_TOKENID_PADDING = BigInt(
  '115792089237316195423570985007226406215939081747436879206741300988257197096960',
)

const POOL_ID_SIZE = 64n
const VEGOID_STARTING_BIT = 40n
const VEGOID_SIZE = 8n
const TICK_SPACING_STARTING_BIT = 48n
const ASSET_STARTING_BIT = 0n
const ASSET_SIZE = 1n
const RATIO_STARTING_BIT = ASSET_STARTING_BIT + ASSET_SIZE // 0 + 1
const RATIO_SIZE = 7n
const IS_LONG_STARTING_BIT = RATIO_STARTING_BIT + RATIO_SIZE // 1 + 7
const IS_LONG_SIZE = 1n
const TOKEN_TYPE_STARTING_BIT = IS_LONG_STARTING_BIT + IS_LONG_SIZE // 8 + 1
const TOKEN_TYPE_SIZE = 1n
const RISK_PARTNER_STARTING_BIT = TOKEN_TYPE_STARTING_BIT + TOKEN_TYPE_SIZE // 9 + 1
const RISK_PARTNER_SIZE = 2n
const STRIKE_STARTING_BIT = RISK_PARTNER_STARTING_BIT + RISK_PARTNER_SIZE // 10 + 2
const STRIKE_SIZE = 24n
const WIDTH_STARTING_BIT = STRIKE_STARTING_BIT + STRIKE_SIZE // 12 + 24
const WIDTH_SIZE = 12n
const LEG_SIZE = WIDTH_STARTING_BIT + WIDTH_SIZE // 36 + 12 = 48

// converts unsigned strike to signed for encoding
export const convertStrike = (n: bigint): bigint => {
  if (n < 0n) {
    // 3 bytes because strike is int24
    return 16777216n + n
  } else {
    return n
  }
}

// converts encoded (unsigned) strike back to signed
export const signStrike = (encodedStrike: bigint): bigint => {
  if (encodedStrike > 2n ** 23n) {
    return encodedStrike - 16777216n
  }
  return encodedStrike
}

const getLegOffsetByIndex = (index: bigint): bigint => index * LEG_SIZE

const encodeAsset = (asset: bigint, legIndex: bigint): bigint =>
  asset << (getLegOffsetByIndex(legIndex) + ASSET_STARTING_BIT + POOL_ID_SIZE)

const encodeRatio = (optionRatio: bigint, legIndex: bigint): bigint =>
  optionRatio << (getLegOffsetByIndex(legIndex) + RATIO_STARTING_BIT + POOL_ID_SIZE)

const encodeIsLong = (isLong: bigint, legIndex: bigint): bigint =>
  isLong << (getLegOffsetByIndex(legIndex) + IS_LONG_STARTING_BIT + POOL_ID_SIZE)

const encodeTokenType = (tokenType: bigint, legIndex: bigint): bigint =>
  tokenType << (getLegOffsetByIndex(legIndex) + TOKEN_TYPE_STARTING_BIT + POOL_ID_SIZE)

const encodeRiskPartner = (riskPartner: bigint, legIndex: bigint): bigint =>
  riskPartner << (getLegOffsetByIndex(legIndex) + RISK_PARTNER_STARTING_BIT + POOL_ID_SIZE)

const encodeStrike = (strike: bigint, legIndex: bigint): bigint =>
  convertStrike(strike) << (getLegOffsetByIndex(legIndex) + STRIKE_STARTING_BIT + POOL_ID_SIZE)

const encodeWidth = (width: bigint, legIndex: bigint): bigint =>
  width << (getLegOffsetByIndex(legIndex) + WIDTH_STARTING_BIT + POOL_ID_SIZE)

const decodeAsset = (leg: bigint): bigint => leg % (1n << ASSET_SIZE)

const decodeRatio = (leg: bigint): bigint => (leg >> RATIO_STARTING_BIT) % (1n << RATIO_SIZE)

const decodeIsLong = (leg: bigint): bigint => (leg >> IS_LONG_STARTING_BIT) % (1n << IS_LONG_SIZE)

const decodeTokenType = (leg: bigint): bigint =>
  (leg >> TOKEN_TYPE_STARTING_BIT) % (1n << TOKEN_TYPE_SIZE)

const decodeRiskPartner = (leg: bigint): bigint =>
  (leg >> RISK_PARTNER_STARTING_BIT) % (1n << RISK_PARTNER_SIZE)

const decodeStrike = (leg: bigint): bigint =>
  signStrike((leg >> STRIKE_STARTING_BIT) % (1n << STRIKE_SIZE))

const decodeWidth = (leg: bigint): bigint => (leg >> WIDTH_STARTING_BIT) % (1n << WIDTH_SIZE)

/**
 * Extract vegoid from a TokenId
 * Vegoid is stored in bits 40-47 (8 bits) of the poolId
 */
export const decodeVegoid = (tokenId: bigint): bigint => {
  return ((tokenId % (1n << POOL_ID_SIZE)) >> VEGOID_STARTING_BIT) % (1n << VEGOID_SIZE)
}

/**
 * Extract vegoid from a poolId
 * Vegoid is stored in bits 40-47 (8 bits) of the poolId
 */
export const decodeVegoidFromPoolId = (poolId: bigint): bigint => {
  return (poolId >> VEGOID_STARTING_BIT) % (1n << VEGOID_SIZE)
}

/**
 * Extract tickSpacing from a TokenId
 * TickSpacing is stored in bits 48-63 (16 bits) of the poolId
 */
export const decodeTickSpacing = (tokenId: bigint): bigint => {
  return (tokenId % (1n << POOL_ID_SIZE)) >> TICK_SPACING_STARTING_BIT
}

/**
 * Encode poolId with vegoid support
 * The encoded PoolId structure: [16-bit tickSpacing][8-bit vegoid][40-bit pool address]
 * @param address The Uniswap V3 pool address (hex string)
 * @param tickSpacing The tick spacing of the pool
 * @param vegoidValue The vegoid value (defaults to 4 if not provided)
 * @return The encoded poolId as bigint
 */
export const encodePoolId = (
  address: Address,
  tickSpacing: bigint,
  vegoidValue: bigint = BigInt(vegoid),
): bigint => {
  // Remove 0x prefix and get first 10 hex chars (5 bytes = 40 bits)
  const addressHex = address.slice(2, 12).toLowerCase()

  // Convert to bytes array (big-endian), then reverse to little-endian
  const bytes: number[] = []
  for (let i = 0; i < 10; i += 2) {
    bytes.push(parseInt(addressHex.slice(i, i + 2), 16))
  }
  bytes.reverse()

  // Build poolId: pool address (5 bytes) + vegoid (1 byte) + tickSpacing (2 bytes) = 8 bytes
  // All in little-endian format
  let poolId = 0n
  for (let i = 0; i < bytes.length; i++) {
    poolId |= BigInt(bytes[i]) << BigInt(i * 8)
  }

  // Add vegoid at bit 40
  poolId |= (vegoidValue % 256n) << 40n

  // Add tickSpacing at bit 48
  poolId |= (tickSpacing % 65536n) << 48n

  return poolId
}

/**
 * Encode V4 poolId with vegoid support
 * The encoded PoolId structure: [16-bit tickSpacing][8-bit vegoid][40-bit pool pattern]
 * @param poolId The V4 pool ID (bytes32 hex string)
 * @param tickSpacing The tick spacing of the pool
 * @param vegoidValue The vegoid value (defaults to 4 if not provided)
 * @return The encoded poolId as bigint
 */
export const encodeV4PoolId = (
  poolId: Hex,
  tickSpacing: bigint,
  vegoidValue: bigint = BigInt(vegoid),
): bigint => {
  // Remove 0x prefix and get last 10 hex chars (5 bytes = 40 bits)
  const poolIdHex = poolId.slice(2)
  const last5BytesHex = poolIdHex.slice(-10).toLowerCase()

  // Convert to bytes array (big-endian), then reverse to little-endian
  const bytes: number[] = []
  for (let i = 0; i < 10; i += 2) {
    bytes.push(parseInt(last5BytesHex.slice(i, i + 2), 16))
  }
  bytes.reverse()

  // Build encoded poolId: pool pattern (5 bytes) + vegoid (1 byte) + tickSpacing (2 bytes) = 8 bytes
  let encodedPoolId = 0n
  for (let i = 0; i < bytes.length; i++) {
    encodedPoolId |= BigInt(bytes[i]) << BigInt(i * 8)
  }

  // Add vegoid at bit 40
  encodedPoolId |= (vegoidValue % 256n) << 40n

  // Add tickSpacing at bit 48
  encodedPoolId |= (tickSpacing % 65536n) << 48n

  return encodedPoolId
}

// Can be (ab)used to create a leg id by passing in a tokenId of 0
export const addLeg = (tokenId: bigint, leg: LegParams): bigint => {
  const legIndex = BigInt(leg.index)
  const width = leg.width
  const strike = leg.strike
  const riskPartner = leg.riskPartner
  const tokenType = leg.tokenType
  const isLong = leg.isLong
  const optionRatio = leg.optionRatio
  const asset = leg.asset

  return (
    tokenId +
    encodeWidth(width, legIndex) +
    encodeStrike(strike, legIndex) +
    (encodeRiskPartner(riskPartner, legIndex) |
      encodeTokenType(tokenType, legIndex) |
      encodeIsLong(isLong, legIndex) |
      encodeRatio(optionRatio, legIndex) |
      encodeAsset(asset, legIndex))
  )
}

export const encodePosition = (poolId: bigint, legs: LegParams[]): bigint => {
  return legs.reduce((acc, leg) => addLeg(acc, leg), poolId)
}

export interface Position {
  poolId: string
  legs: LegParams[]
}

export const decodePosition = (encodedPosition: bigint): Position => {
  const leg4 = (encodedPosition >> (POOL_ID_SIZE + getLegOffsetByIndex(3n))) % (1n << LEG_SIZE)

  const leg3 = (encodedPosition >> (POOL_ID_SIZE + getLegOffsetByIndex(2n))) % (1n << LEG_SIZE)

  const leg2 = (encodedPosition >> (POOL_ID_SIZE + getLegOffsetByIndex(1n))) % (1n << LEG_SIZE)

  const leg1 = (encodedPosition >> (POOL_ID_SIZE + getLegOffsetByIndex(0n))) % (1n << LEG_SIZE)

  let poolId = (encodedPosition % (1n << POOL_ID_SIZE)).toString(16)

  const poolIdLength = 16 // poolId is 64 bits => 16 hex characters
  if (poolId.length < poolIdLength) {
    poolId = padHexWithZeros('0x' + poolId, poolIdLength + 2) // +2 for 0x prefix
  } else {
    poolId = '0x' + poolId
  }

  const encodedLegs = [leg1, leg2, leg3, leg4].filter((leg) => decodeRatio(leg) > 0n)

  const legs: LegParams[] = encodedLegs.map((leg, index) => ({
    index: index,
    width: decodeWidth(leg),
    strike: decodeStrike(leg),
    riskPartner: decodeRiskPartner(leg),
    tokenType: decodeTokenType(leg),
    isLong: decodeIsLong(leg),
    optionRatio: decodeRatio(leg),
    asset: decodeAsset(leg),
  }))

  return {
    poolId,
    legs,
  }
}

export function padHexWithZeros(hex: string, length: number): string {
  // Check if the hex starts with "0x"
  if (hex.startsWith('0x')) {
    // Remove the "0x" prefix
    hex = hex.substring(2)
  } else {
    throw new Error('do not use padHexWithZeros on non-hex strings')
  }

  // Subtract 2 from length to account for the substring(2) call to remove the leading 0x
  while (hex.length < length - 2) {
    hex = '0' + hex
  }

  // Add back the "0x" prefix
  return '0x' + hex
}
