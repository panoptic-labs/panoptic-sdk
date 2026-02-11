/**
 * TokenId decoding for the Panoptic v2 SDK.
 * @module v2/tokenId/decode
 */

import type { TokenIdLeg } from '../types'
import {
  type DecodedLeg,
  countLegs,
  decodeAllLegs,
  decodePoolId,
  decodeTickSpacing,
  decodeVegoid,
} from './encoding'

/**
 * Decoded TokenId data.
 */
export interface DecodedTokenId {
  /** The original TokenId */
  tokenId: bigint
  /** The pool ID portion as hex */
  poolId: `0x${string}`
  /** The vegoid value */
  vegoid: bigint
  /** The tick spacing */
  tickSpacing: bigint
  /** The decoded legs */
  legs: TokenIdLeg[]
  /** Number of active legs */
  legCount: bigint
}

/**
 * Convert a DecodedLeg to TokenIdLeg format.
 *
 * @param leg - The decoded leg from encoding utils
 * @param tickSpacing - The tick spacing for calculating tick bounds
 * @returns The TokenIdLeg format
 */
function convertToTokenIdLeg(leg: DecodedLeg, tickSpacing: bigint): TokenIdLeg {
  // Calculate tick bounds from strike and width
  // width is in tick spacing units, so actual width = width * tickSpacing
  const halfWidth = (leg.width * tickSpacing) / 2n
  const tickLower = leg.strike - halfWidth
  const tickUpper = leg.strike + halfWidth

  return {
    index: leg.index,
    asset: leg.asset,
    optionRatio: leg.optionRatio,
    isLong: leg.isLong,
    tokenType: leg.tokenType,
    riskPartner: leg.riskPartner,
    strike: leg.strike,
    width: leg.width,
    tickLower,
    tickUpper,
  }
}

/**
 * Decode a TokenId into its component parts.
 *
 * @param tokenId - The TokenId to decode
 * @returns The decoded TokenId data
 *
 * @example
 * ```typescript
 * const decoded = decodeTokenId(tokenId)
 * console.log(decoded.legs) // Array of legs
 * console.log(decoded.tickSpacing) // Tick spacing
 * ```
 */
export function decodeTokenId(tokenId: bigint): DecodedTokenId {
  const poolId = decodePoolId(tokenId)
  const vegoid = decodeVegoid(tokenId)
  const tickSpacing = decodeTickSpacing(tokenId)
  const rawLegs = decodeAllLegs(tokenId)
  const numLegs = countLegs(tokenId)

  const legs = rawLegs.map((leg) => convertToTokenIdLeg(leg, tickSpacing))

  return {
    tokenId,
    poolId,
    vegoid,
    tickSpacing,
    legs,
    legCount: numLegs,
  }
}

/**
 * Validate that a TokenId has the expected pool ID.
 *
 * @param tokenId - The TokenId to validate
 * @param expectedPoolId - The expected pool ID
 * @returns True if the pool IDs match
 */
export function validatePoolId(tokenId: bigint, expectedPoolId: bigint): boolean {
  const actualPoolId = tokenId & ((1n << 64n) - 1n)
  return actualPoolId === expectedPoolId
}

/**
 * Check if a TokenId represents a long position (any leg is long).
 *
 * @param tokenId - The TokenId to check
 * @returns True if any leg is long
 */
export function hasLongLeg(tokenId: bigint): boolean {
  const legs = decodeAllLegs(tokenId)
  return legs.some((leg) => leg.isLong)
}

/**
 * Check if a TokenId represents a short-only position.
 *
 * @param tokenId - The TokenId to check
 * @returns True if all legs are short
 */
export function isShortOnly(tokenId: bigint): boolean {
  const legs = decodeAllLegs(tokenId)
  return legs.length > 0 && legs.every((leg) => !leg.isLong)
}

/**
 * Check if a TokenId represents a spread (legs with different risk partners).
 *
 * @param tokenId - The TokenId to check
 * @returns True if any leg has a different risk partner
 */
export function isSpread(tokenId: bigint): boolean {
  const legs = decodeAllLegs(tokenId)
  return legs.some((leg) => leg.riskPartner !== leg.index)
}

/**
 * Get the asset index for a TokenId (from the first leg).
 *
 * @param tokenId - The TokenId
 * @returns The asset index (0 or 1), or undefined if no legs
 */
export function getAssetIndex(tokenId: bigint): bigint | undefined {
  const legs = decodeAllLegs(tokenId)
  if (legs.length === 0) {
    return undefined
  }
  return legs[0].asset
}

/**
 * Check if a leg is a loan (width=0 and isLong=false).
 *
 * Loans borrow liquidity from the pool at a specific strike price.
 *
 * @param leg - The decoded leg to check
 * @returns True if the leg is a loan
 */
export function isLoanLeg(leg: DecodedLeg): boolean {
  return leg.width === 0n && !leg.isLong
}

/**
 * Check if a leg is a credit (width=0 and isLong=true).
 *
 * Credits lend liquidity to the pool at a specific strike price.
 *
 * @param leg - The decoded leg to check
 * @returns True if the leg is a credit
 */
export function isCreditLeg(leg: DecodedLeg): boolean {
  return leg.width === 0n && leg.isLong
}

/**
 * Check if a TokenId has any loan legs.
 *
 * @param tokenId - The TokenId to check
 * @returns True if any leg is a loan (width=0, isLong=false)
 */
export function hasLoanLeg(tokenId: bigint): boolean {
  const legs = decodeAllLegs(tokenId)
  return legs.some(isLoanLeg)
}

/**
 * Check if a TokenId has any credit legs.
 *
 * @param tokenId - The TokenId to check
 * @returns True if any leg is a credit (width=0, isLong=true)
 */
export function hasCreditLeg(tokenId: bigint): boolean {
  const legs = decodeAllLegs(tokenId)
  return legs.some(isCreditLeg)
}

/**
 * Check if a TokenId is a pure loan (all legs are loans).
 *
 * @param tokenId - The TokenId to check
 * @returns True if all legs are loans
 */
export function isLoan(tokenId: bigint): boolean {
  const legs = decodeAllLegs(tokenId)
  return legs.length > 0 && legs.every(isLoanLeg)
}

/**
 * Check if a TokenId is a pure credit (all legs are credits).
 *
 * @param tokenId - The TokenId to check
 * @returns True if all legs are credits
 */
export function isCredit(tokenId: bigint): boolean {
  const legs = decodeAllLegs(tokenId)
  return legs.length > 0 && legs.every(isCreditLeg)
}

/**
 * Check if a TokenId contains loan or credit legs (width=0).
 *
 * @param tokenId - The TokenId to check
 * @returns True if any leg has width=0 (loan or credit)
 */
export function hasLoanOrCredit(tokenId: bigint): boolean {
  const legs = decodeAllLegs(tokenId)
  return legs.some((leg) => leg.width === 0n)
}
