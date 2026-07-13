/**
 * Bit-field masks over the Panoptic v2 tokenId layout, mirroring
 * `contracts/lib/TokenIdMasks.sol` (kept in lockstep by golden unit tests).
 *
 * Layout (packages/panoptic-v2-core/contracts/types/TokenId.sol):
 *   - bits [0, 64)        poolId
 *   - each leg is 48 bits, starting at 64 + legIndex*48, packing
 *     asset(+0,1b) | optionRatio(+1,7b) | isLong(+8) | tokenType(+9)
 *     | riskPartner(+10,2b) | strike(+12,24b) | width(+36,12b)
 */

const POOL_ID_SIZE = 64n
const LEG_SIZE = 48n
const MAX_LEGS = 4n

/** Mask with 1-bits over a `bits`-wide field at `fieldOffset` in every leg. */
export function legFieldMask(fieldOffset: bigint, bits: bigint): bigint {
  const field = (1n << bits) - 1n
  let mask = 0n
  for (let leg = 0n; leg < MAX_LEGS; leg++) {
    mask |= field << (POOL_ID_SIZE + leg * LEG_SIZE + fieldOffset)
  }
  return mask
}

/** Mask with 1-bits over every leg's 12-bit width field. */
export function loanWidthFieldsMask(): bigint {
  return legFieldMask(36n, 12n)
}

/** Mask with 1-bits over every leg's 24-bit strike field. */
export function strikeFieldsMask(): bigint {
  return legFieldMask(12n, 24n)
}

/** Mask with 1-bits over every leg's 7-bit optionRatio field. */
export function optionRatioFieldsMask(): bigint {
  return legFieldMask(1n, 7n)
}

/** True iff every leg of the tokenId has width == 0 (a pure loan/credit). */
export function isPureLoanTokenId(tokenId: bigint): boolean {
  return (tokenId & loanWidthFieldsMask()) === 0n
}

/** The 32-byte mask + expected value for a Zodiac Roles v2 Bitmask condition. */
export function loanBitmaskCondition(): { mask: `0x${string}`; expected: `0x${string}` } {
  const mask = loanWidthFieldsMask()
  const toBytes32 = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}` as `0x${string}`
  return { mask: toBytes32(mask), expected: toBytes32(0n) }
}
