/**
 * WAD-scaled value formatters.
 *
 * WAD is a fixed-point representation where 1e18 = 1.0.
 * Used extensively in DeFi for representing ratios, prices, and multipliers.
 *
 * @module v2/formatters/wad
 */

import { formatTokenAmount } from './amount'

/**
 * Format a WAD-scaled value (1e18 = 1.0).
 *
 * @param wad - WAD-scaled value
 * @param precision - Number of decimal places to display
 * @returns Formatted string
 *
 * @example
 * ```typescript
 * formatWad(1220000000000000000n, 2n) // "1.22"
 * formatWad(1220000000000000000n, 4n) // "1.2200"
 * formatWad(1000000000000000000n, 2n) // "1.00"
 * formatWad(500000000000000000n, 2n)  // "0.50"
 * ```
 */
export function formatWad(wad: bigint, precision: bigint): string {
  return formatTokenAmount(wad, 18n, precision)
}

/**
 * Format a WAD-scaled value with sign prefix (+/-) for non-zero values.
 *
 * @param wad - WAD-scaled value
 * @param precision - Number of decimal places to display
 * @returns Formatted string with sign prefix
 *
 * @example
 * ```typescript
 * formatWadSigned(1220000000000000000n, 2n)  // "+1.22"
 * formatWadSigned(-500000000000000000n, 2n) // "-0.50"
 * formatWadSigned(0n, 2n)                   // "0.00"
 * ```
 */
export function formatWadSigned(wad: bigint, precision: bigint): string {
  const formatted = formatWad(wad, precision)
  if (wad > 0n) {
    return `+${formatted}`
  }
  return formatted
}

/**
 * Format a WAD-scaled value as a percentage string.
 *
 * @param wad - WAD-scaled value
 * @param precision - Number of decimal places to display
 * @returns Formatted percentage string
 *
 * @example
 * ```typescript
 * formatWadPercent(50000000000000000n, 2n) // "5.00%"
 * formatWadPercent(1000000000000000000n, 1n) // "100.0%"
 * ```
 */
export function formatWadPercent(wad: bigint, precision: bigint): string {
  return `${formatTokenAmount(wad * 100n, 18n, precision)}%`
}

/**
 * Format an annualized rate stored as a WAD-scaled value.
 * Alias for formatWadPercent.
 *
 * @param rateWad - Rate in WAD (1e18 = 1.0)
 * @param precision - Number of decimal places to display
 * @returns Formatted percentage string
 */
export function formatRateWad(rateWad: bigint, precision: bigint): string {
  return formatWadPercent(rateWad, precision)
}

/**
 * Parse a decimal string to a WAD-scaled value.
 *
 * @param value - Decimal string (e.g., "1.5")
 * @returns WAD-scaled bigint
 *
 * @example
 * ```typescript
 * parseWad("1.5")   // 1500000000000000000n
 * parseWad("0.5")   // 500000000000000000n
 * parseWad("100")   // 100000000000000000000n
 * parseWad("-1.22") // -1220000000000000000n
 * ```
 */
export function parseWad(value: string): bigint {
  const trimmed = value.trim()
  const isNegative = trimmed.startsWith('-')
  const cleanValue = isNegative ? trimmed.slice(1) : trimmed

  const [integerStr, fractionalStr = ''] = cleanValue.split('.')
  const paddedFractional = fractionalStr.padEnd(18, '0').slice(0, 18)

  const integerPart = BigInt(integerStr || '0') * 10n ** 18n
  const fractionalPart = BigInt(paddedFractional || '0')

  const result = integerPart + fractionalPart
  return isNegative ? -result : result
}
