/**
 * Token amount formatters and parsers.
 *
 * All formatters require explicit precision - no hidden defaults.
 *
 * @module v2/formatters/amount
 */

import type { TokenFlow } from '../types'

/**
 * Format a raw token amount to a human-readable string.
 *
 * @param amount - The amount in smallest units (e.g., wei)
 * @param decimals - Token decimals (e.g., 18n for WETH, 6n for USDC)
 * @param precision - Number of decimal places to display
 * @returns Formatted string
 *
 * @example
 * ```typescript
 * formatTokenAmount(1500000000000000000n, 18n, 4n) // "1.5000"
 * formatTokenAmount(1500000000000000000n, 18n, 2n) // "1.50"
 * formatTokenAmount(1500000n, 6n, 2n)              // "1.50" (USDC)
 * formatTokenAmount(-500000000000000000n, 18n, 4n) // "-0.5000"
 * ```
 */
export function formatTokenAmount(amount: bigint, decimals: bigint, precision: bigint): string {
  const isNegative = amount < 0n
  const absAmount = isNegative ? -amount : amount
  const divisor = 10n ** decimals
  const integerPart = absAmount / divisor
  const fractionalPart = absAmount % divisor

  // Build fractional string with proper padding
  const fullFractionalStr = fractionalPart.toString().padStart(Number(decimals), '0')
  const truncatedFractionalStr = fullFractionalStr.slice(0, Number(precision))
  const paddedFractionalStr = truncatedFractionalStr.padEnd(Number(precision), '0')

  const sign = isNegative ? '-' : ''
  return precision > 0n ? `${sign}${integerPart}.${paddedFractionalStr}` : `${sign}${integerPart}`
}

/**
 * Format a token amount with a sign prefix (+/-) for non-zero values.
 * Useful for displaying PnL, deltas, or changes.
 *
 * @param amount - The amount in smallest units
 * @param decimals - Token decimals
 * @param precision - Number of decimal places to display
 * @returns Formatted string with sign prefix
 *
 * @example
 * ```typescript
 * formatTokenAmountSigned(1500000000000000000n, 18n, 4n)  // "+1.5000"
 * formatTokenAmountSigned(-500000000000000000n, 18n, 4n) // "-0.5000"
 * formatTokenAmountSigned(0n, 18n, 4n)                   // "0.0000"
 * ```
 */
export function formatTokenAmountSigned(
  amount: bigint,
  decimals: bigint,
  precision: bigint,
): string {
  const formatted = formatTokenAmount(amount, decimals, precision)
  if (amount > 0n) {
    return `+${formatted}`
  }
  return formatted
}

/**
 * Parse a human-readable token amount string to raw units.
 *
 * @param amount - Human-readable amount string (e.g., "1.5")
 * @param decimals - Token decimals
 * @returns Amount in smallest units
 *
 * @example
 * ```typescript
 * parseTokenAmount("1.5", 18n)   // 1500000000000000000n
 * parseTokenAmount("1.5", 6n)    // 1500000n (USDC)
 * parseTokenAmount("100", 18n)   // 100000000000000000000n
 * parseTokenAmount("-0.5", 18n)  // -500000000000000000n
 * ```
 */
export function parseTokenAmount(amount: string, decimals: bigint): bigint {
  const trimmed = amount.trim()
  const isNegative = trimmed.startsWith('-')
  const cleanAmount = isNegative ? trimmed.slice(1) : trimmed

  const [integerStr, fractionalStr = ''] = cleanAmount.split('.')
  const paddedFractional = fractionalStr.padEnd(Number(decimals), '0').slice(0, Number(decimals))

  const integerPart = BigInt(integerStr || '0') * 10n ** decimals
  const fractionalPart = BigInt(paddedFractional || '0')

  const result = integerPart + fractionalPart
  return isNegative ? -result : result
}

/**
 * Format a token delta amount with a sign prefix (+/-) for non-zero values.
 * Alias for formatTokenAmountSigned, useful for clarity at call sites.
 *
 * @param amount - The delta amount in smallest units
 * @param decimals - Token decimals
 * @param precision - Number of decimal places to display
 * @returns Formatted string with sign prefix
 */
export function formatTokenDelta(amount: bigint, decimals: bigint, precision: bigint): string {
  return formatTokenAmountSigned(amount, decimals, precision)
}

/**
 * Format token flow deltas and balances from simulation results.
 *
 * @param flow - Token flow data
 * @param decimals0 - Token0 decimals
 * @param decimals1 - Token1 decimals
 * @param precision0 - Precision for token0 formatting
 * @param precision1 - Precision for token1 formatting
 * @returns Formatted token flow strings
 */
export function formatTokenFlow(
  flow: TokenFlow,
  decimals0: bigint,
  decimals1: bigint,
  precision0: bigint,
  precision1: bigint,
): {
  delta0: string
  delta1: string
  balanceBefore0: string
  balanceBefore1: string
  balanceAfter0: string
  balanceAfter1: string
} {
  return {
    delta0: formatTokenAmountSigned(flow.delta0, decimals0, precision0),
    delta1: formatTokenAmountSigned(flow.delta1, decimals1, precision1),
    balanceBefore0: formatTokenAmount(flow.balanceBefore0, decimals0, precision0),
    balanceBefore1: formatTokenAmount(flow.balanceBefore1, decimals1, precision1),
    balanceAfter0: formatTokenAmount(flow.balanceAfter0, decimals0, precision0),
    balanceAfter1: formatTokenAmount(flow.balanceAfter1, decimals1, precision1),
  }
}
