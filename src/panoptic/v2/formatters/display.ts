/**
 * General display formatters for UI components.
 *
 * These are utility formatters for common display needs like
 * addresses, timestamps, and durations.
 *
 * @module v2/formatters/display
 */

import { formatTokenAmount } from './amount'

const TEN = 10n

function formatRatio(numerator: bigint, denominator: bigint, precision: bigint): string {
  if (precision < 0n) {
    throw new RangeError('Precision must be non-negative')
  }

  const scale = TEN ** precision
  const scaled = (numerator * scale + denominator / 2n) / denominator
  const integerPart = scaled / scale
  const fractionalPart = scaled % scale

  if (precision === 0n) {
    return integerPart.toString()
  }

  return `${integerPart}.${fractionalPart.toString().padStart(Number(precision), '0')}`
}

/**
 * Truncate an address for display.
 *
 * @param address - Full address
 * @param chars - Characters to show on each side (default: 4)
 * @returns Truncated address like "0x1234...5678"
 *
 * @example
 * ```typescript
 * truncateAddress('0x1234567890abcdef1234567890abcdef12345678')
 * // "0x1234...5678"
 *
 * truncateAddress('0x1234567890abcdef1234567890abcdef12345678', 6)
 * // "0x123456...345678"
 * ```
 */
export function truncateAddress(address: string, chars = 4): string {
  const charsBig = BigInt(chars)
  const minLength = charsBig * 2n + 4n
  if (BigInt(address.length) <= minLength) return address
  return `${address.slice(0, Number(charsBig + 2n))}...${address.slice(-Number(charsBig))}`
}

/**
 * Format a Unix timestamp as an ISO date string (YYYY-MM-DD).
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns ISO date string
 *
 * @example
 * ```typescript
 * formatTimestamp(1700000000n)  // "2023-11-14"
 * ```
 */
export function formatTimestamp(timestamp: bigint): string {
  const ms = timestamp * 1000n
  return new Date(Number(ms)).toISOString().split('T')[0]
}

/**
 * Format a Unix timestamp as an ISO datetime string.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns ISO datetime string
 *
 * @example
 * ```typescript
 * formatDatetime(1700000000n)  // "2023-11-14T22:13:20.000Z"
 * ```
 */
export function formatDatetime(timestamp: bigint): string {
  const ms = timestamp * 1000n
  return new Date(Number(ms)).toISOString()
}

/**
 * Format a Unix timestamp as a locale-aware date string.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param locale - Locale string (default: system locale)
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string
 *
 * @example
 * ```typescript
 * formatTimestampLocale(1700000000n)
 * // "11/14/2023" (US locale)
 *
 * formatTimestampLocale(1700000000n, 'de-DE')
 * // "14.11.2023" (German locale)
 * ```
 */
export function formatTimestampLocale(
  timestamp: bigint,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const ms = timestamp * 1000n
  return new Date(Number(ms)).toLocaleDateString(locale, options)
}

/**
 * Format a duration in milliseconds as a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * formatDuration(1500n)   // "1.5s"
 * formatDuration(150n)    // "150ms"
 * formatDuration(90000n)  // "1m 30s"
 * formatDuration(3661000n) // "1h 1m"
 * ```
 */
export function formatDuration(ms: bigint): string {
  const isNegative = ms < 0n
  const absMs = isNegative ? -ms : ms
  const sign = isNegative ? '-' : ''

  if (absMs < 1000n) {
    return `${sign}${absMs}ms`
  }

  if (absMs < 60000n) {
    const tenthsTotal = (absMs + 50n) / 100n
    const seconds = tenthsTotal / 10n
    const tenths = tenthsTotal % 10n
    return `${sign}${seconds}.${tenths}s`
  }

  if (absMs < 3600000n) {
    const minutes = absMs / 60000n
    const seconds = ((absMs % 60000n) + 500n) / 1000n
    return seconds > 0n ? `${sign}${minutes}m ${seconds}s` : `${sign}${minutes}m`
  }

  const hours = absMs / 3600000n
  const minutes = ((absMs % 3600000n) + 30000n) / 60000n
  return minutes > 0n ? `${sign}${hours}h ${minutes}m` : `${sign}${hours}h`
}

/**
 * Format a duration in seconds as a human-readable string.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted duration string
 */
export function formatDurationSeconds(seconds: bigint): string {
  return formatDuration(seconds * 1000n)
}

/**
 * Format a block number for display.
 *
 * @param blockNumber - The block number
 * @returns Formatted block number with commas
 *
 * @example
 * ```typescript
 * formatBlockNumber(18000000n)  // "18,000,000"
 * ```
 */
export function formatBlockNumber(blockNumber: bigint): string {
  return blockNumber.toLocaleString()
}

/**
 * Format a gas amount for display.
 *
 * @param gas - Gas units
 * @returns Formatted gas string
 */
export function formatGas(gas: bigint): string {
  return gas.toLocaleString()
}

/**
 * Format a transaction hash for display (truncated).
 *
 * @param hash - Full transaction hash
 * @param chars - Characters to show on each side (default: 6)
 * @returns Truncated hash like "0x123456...abcdef"
 *
 * @example
 * ```typescript
 * formatTxHash('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')
 * // "0x123456...abcdef"
 * ```
 */
export function formatTxHash(hash: string, chars = 6): string {
  const charsBig = BigInt(chars)
  const minLength = charsBig * 2n + 4n
  if (BigInt(hash.length) <= minLength) return hash
  return `${hash.slice(0, Number(charsBig + 2n))}...${hash.slice(-Number(charsBig))}`
}

function formatHex(value: bigint): string {
  return `0x${value.toString(16)}`
}

/**
 * Format a TokenId as a hex string.
 *
 * @param tokenId - TokenId value
 * @returns Hex string representation
 */
export function formatTokenIdHex(tokenId: bigint): string {
  return formatHex(tokenId)
}

/**
 * Format a PoolId as a hex string.
 *
 * @param poolId - PoolId value
 * @returns Hex string representation
 */
export function formatPoolIdHex(poolId: bigint): string {
  return formatHex(poolId)
}

/**
 * Format a TokenId as a shortened hex string.
 *
 * @param tokenId - TokenId value
 * @param chars - Characters to show on each side (default: 4)
 * @returns Truncated hex string like "0x1234...abcd"
 */
export function formatTokenIdShort(tokenId: bigint, chars = 4): string {
  const hex = formatHex(tokenId)
  const charsBig = BigInt(chars)
  const minLength = charsBig * 2n + 4n
  if (BigInt(hex.length) <= minLength) return hex
  return `${hex.slice(0, Number(charsBig + 2n))}...${hex.slice(-Number(charsBig))}`
}

/**
 * Format a large number with K/M/B suffixes.
 *
 * @param value - The numeric value
 * @param precision - Number of decimal places (default: 1n)
 * @returns Formatted string with suffix
 *
 * @example
 * ```typescript
 * formatCompact(1234n)        // "1.2K"
 * formatCompact(1234567n)     // "1.2M"
 * formatCompact(1234567890n)  // "1.2B"
 * formatCompact(999n)         // "999"
 * ```
 */
export function formatCompact(value: bigint, precision: bigint = 1n): string {
  const isNegative = value < 0n
  const absValue = isNegative ? -value : value

  let formatted: string

  if (absValue < 1000n) {
    formatted = absValue.toString()
  } else if (absValue < 1_000_000n) {
    formatted = `${formatRatio(absValue, 1000n, precision)}K`
  } else if (absValue < 1_000_000_000n) {
    formatted = `${formatRatio(absValue, 1_000_000n, precision)}M`
  } else {
    formatted = `${formatRatio(absValue, 1_000_000_000n, precision)}B`
  }

  return isNegative ? `-${formatted}` : formatted
}

/**
 * Format a wei amount as a display string.
 *
 * @param wei - Amount in wei
 * @returns Formatted string with unit
 */
export function formatWei(wei: bigint): string {
  return `${wei} wei`
}

/**
 * Format a wei amount as gwei.
 *
 * @param wei - Amount in wei
 * @param precision - Number of decimal places to display
 * @returns Formatted string with unit
 */
export function formatGwei(wei: bigint, precision: bigint): string {
  return `${formatTokenAmount(wei, 9n, precision)} gwei`
}
