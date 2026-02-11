/**
 * TokenId constants for the Panoptic v2 SDK.
 * @module v2/tokenId/constants
 */

/**
 * Default vegoid value used in pool ID encoding.
 */
export const DEFAULT_VEGOID = 4n

/**
 * Standard tick widths matching DTE gamma profiles.
 *
 * These represent the position width in ticks for each timescale.
 * Width = tickUpper - tickLower.
 */
export const STANDARD_TICK_WIDTHS = {
  /** 1-hour expiry profile (240 ticks) */
  '1H': 240n,
  /** 1-day expiry profile (720 ticks) */
  '1D': 720n,
  /** 1-week expiry profile (2400 ticks) */
  '1W': 2400n,
  /** 1-month expiry profile (4800 ticks) */
  '1M': 4800n,
  /** 1-year expiry profile (15000 ticks) */
  '1Y': 15000n,
} as const

/**
 * Timescale key type for STANDARD_TICK_WIDTHS.
 */
export type Timescale = keyof typeof STANDARD_TICK_WIDTHS

/**
 * Bit positions and sizes for TokenId encoding.
 */
export const TOKEN_ID_BITS = {
  /** Pool ID occupies bits 0-63 */
  POOL_ID_SIZE: 64n,
  /** Vegoid starts at bit 40 within pool ID */
  VEGOID_STARTING_BIT: 40n,
  /** Vegoid is 8 bits */
  VEGOID_SIZE: 8n,
  /** Tick spacing starts at bit 48 within pool ID */
  TICK_SPACING_STARTING_BIT: 48n,
  /** Tick spacing is 16 bits */
  TICK_SPACING_SIZE: 16n,
  /** Each leg is 48 bits */
  LEG_SIZE: 48n,
  /** Maximum number of legs per TokenId */
  MAX_LEGS: 4n,
} as const

/**
 * Bit positions within a leg (relative to leg start).
 */
export const LEG_BITS = {
  /** Asset bit position */
  ASSET_BIT: 0n,
  /** Asset size in bits */
  ASSET_SIZE: 1n,
  /** Option ratio starting bit */
  RATIO_BIT: 1n,
  /** Option ratio size in bits */
  RATIO_SIZE: 7n,
  /** Is long starting bit */
  IS_LONG_BIT: 8n,
  /** Is long size in bits */
  IS_LONG_SIZE: 1n,
  /** Token type starting bit */
  TOKEN_TYPE_BIT: 9n,
  /** Token type size in bits */
  TOKEN_TYPE_SIZE: 1n,
  /** Risk partner starting bit */
  RISK_PARTNER_BIT: 10n,
  /** Risk partner size in bits */
  RISK_PARTNER_SIZE: 2n,
  /** Strike starting bit */
  STRIKE_BIT: 12n,
  /** Strike size in bits (24 bits, signed int24) */
  STRIKE_SIZE: 24n,
  /** Width starting bit */
  WIDTH_BIT: 36n,
  /** Width size in bits */
  WIDTH_SIZE: 12n,
} as const

/**
 * Masks for extracting/encoding leg fields.
 */
export const LEG_MASKS = {
  /** Mask for asset (1 bit) */
  ASSET: (1n << LEG_BITS.ASSET_SIZE) - 1n,
  /** Mask for option ratio (7 bits) */
  RATIO: (1n << LEG_BITS.RATIO_SIZE) - 1n,
  /** Mask for is long (1 bit) */
  IS_LONG: (1n << LEG_BITS.IS_LONG_SIZE) - 1n,
  /** Mask for token type (1 bit) */
  TOKEN_TYPE: (1n << LEG_BITS.TOKEN_TYPE_SIZE) - 1n,
  /** Mask for risk partner (2 bits) */
  RISK_PARTNER: (1n << LEG_BITS.RISK_PARTNER_SIZE) - 1n,
  /** Mask for strike (24 bits) */
  STRIKE: (1n << LEG_BITS.STRIKE_SIZE) - 1n,
  /** Mask for width (12 bits) */
  WIDTH: (1n << LEG_BITS.WIDTH_SIZE) - 1n,
  /** Mask for entire leg (48 bits) */
  LEG: (1n << TOKEN_ID_BITS.LEG_SIZE) - 1n,
} as const

/**
 * Maximum and minimum values for leg fields.
 */
export const LEG_LIMITS = {
  /** Maximum option ratio (127) */
  MAX_RATIO: 127n,
  /** Maximum width (4095) */
  MAX_WIDTH: 4095n,
  /** Maximum strike (8388607, max int24 positive) */
  MAX_STRIKE: 8388607n,
  /** Minimum strike (-8388608, min int24) */
  MIN_STRIKE: -8388608n,
} as const

/**
 * Value used to convert negative strike to unsigned representation.
 * Strike is stored as int24, so we use 2^24 for conversion.
 */
export const STRIKE_CONVERSION_FACTOR = 16777216n
