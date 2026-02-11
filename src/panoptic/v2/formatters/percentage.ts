/**
 * Percentage and ratio formatters.
 *
 * All formatters require explicit precision - no hidden defaults.
 *
 * @module v2/formatters/percentage
 */

const TEN = 10n

function formatRatio(numerator: bigint, denominator: bigint, precision: bigint): string {
  if (precision < 0n) {
    throw new RangeError('Precision must be non-negative')
  }

  if (denominator === 0n) {
    return '0'
  }

  const isNegative = numerator < 0n !== denominator < 0n
  const absNumerator = numerator < 0n ? -numerator : numerator
  const absDenominator = denominator < 0n ? -denominator : denominator

  const scale = TEN ** precision
  const scaled = (absNumerator * scale + absDenominator / 2n) / absDenominator
  const integerPart = scaled / scale
  const fractionalPart = scaled % scale
  const sign = isNegative ? '-' : ''

  if (precision === 0n) {
    return `${sign}${integerPart}`
  }

  return `${sign}${integerPart}.${fractionalPart.toString().padStart(Number(precision), '0')}`
}

/**
 * Format basis points as a percentage string.
 * 100 bps = 1%
 *
 * @param bps - Basis points value
 * @param precision - Number of decimal places to display
 * @returns Formatted percentage string
 *
 * @example
 * ```typescript
 * formatBps(50n, 2n)   // "0.50%"
 * formatBps(50n, 1n)   // "0.5%"
 * formatBps(100n, 2n)  // "1.00%"
 * formatBps(1500n, 2n) // "15.00%"
 * formatBps(-50n, 2n)  // "-0.50%"
 * ```
 */
export function formatBps(bps: bigint, precision: bigint): string {
  const isNegative = bps < 0n
  const absBps = isNegative ? -bps : bps

  // bps to percentage: divide by 100
  // Scale up for precision, then divide
  const scaleFactor = 10n ** precision
  const scaled = (absBps * scaleFactor) / 100n
  const integerPart = scaled / scaleFactor
  const fractionalPart = scaled % scaleFactor

  const fractionalStr = fractionalPart.toString().padStart(Number(precision), '0')
  const sign = isNegative ? '-' : ''

  return precision > 0n ? `${sign}${integerPart}.${fractionalStr}%` : `${sign}${integerPart}%`
}

/**
 * Format utilization as a percentage string.
 * Utilization is stored as 0n-10000n, where 10000n = 100%.
 *
 * @param util - Utilization value (0-10000)
 * @param precision - Number of decimal places to display
 * @returns Formatted percentage string
 *
 * @example
 * ```typescript
 * formatUtilization(7500n, 2n)  // "75.00%"
 * formatUtilization(7500n, 0n)  // "75%"
 * formatUtilization(10000n, 2n) // "100.00%"
 * formatUtilization(123n, 2n)   // "1.23%"
 * ```
 */
export function formatUtilization(util: bigint, precision: bigint): string {
  // util is in basis points (10000 = 100%)
  return formatBps(util, precision)
}

/**
 * Parse a percentage string to basis points.
 *
 * @param percent - Percentage string (e.g., "1.5%" or "1.5")
 * @returns Basis points value
 *
 * @example
 * ```typescript
 * parseBps("1.5%")  // 150n
 * parseBps("1.5")   // 150n
 * parseBps("100%")  // 10000n
 * parseBps("0.5%")  // 50n
 * ```
 */
export function parseBps(percent: string): bigint {
  // Remove % suffix if present
  const cleaned = percent.trim().replace(/%$/, '')
  const isNegative = cleaned.startsWith('-')
  const absValue = isNegative ? cleaned.slice(1) : cleaned

  const [integerStr, fractionalStr = ''] = absValue.split('.')

  // Convert to basis points: multiply by 100
  // Handle up to 2 decimal places in the percentage
  const paddedFractional = fractionalStr.padEnd(2, '0').slice(0, 2)

  const integerPart = BigInt(integerStr || '0') * 100n
  const fractionalPart = BigInt(paddedFractional || '0')

  const result = integerPart + fractionalPart
  return isNegative ? -result : result
}

/**
 * Format a ratio as a percentage string.
 *
 * @param numerator - Numerator of the ratio
 * @param denominator - Denominator of the ratio
 * @param precision - Number of decimal places to display
 * @returns Formatted percentage string
 *
 * @example
 * ```typescript
 * formatRatioPercent(1n, 4n, 1n)  // "25.0%"
 * formatRatioPercent(3n, 4n, 2n)  // "75.00%"
 * ```
 */
export function formatRatioPercent(
  numerator: bigint,
  denominator: bigint,
  precision: bigint,
): string {
  const scaledNumerator = numerator * 100n
  return `${formatRatio(scaledNumerator, denominator, precision)}%`
}
