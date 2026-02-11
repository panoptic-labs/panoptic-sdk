/**
 * Tick and price formatters for Uniswap V3/V4 pools.
 *
 * Ticks represent logarithmic prices where: price = 1.0001^tick
 *
 * @module v2/formatters/tick
 */

import { MAX_TICK, MIN_TICK } from '../utils/constants'

const Q192 = 1n << 192n
const RAW_PRICE_PRECISION = 40n

function pow10(exponent: bigint): bigint {
  if (exponent < 0n) {
    throw new RangeError('Exponent must be non-negative')
  }
  return 10n ** exponent
}

function absBigint(value: bigint): bigint {
  return value < 0n ? -value : value
}

function trimTrailingZeros(value: string): string {
  const dotIndex = value.indexOf('.')
  if (dotIndex === -1) return value

  let end = value.length
  while (end > dotIndex && value[end - 1] === '0') {
    end -= 1
  }

  if (end === dotIndex + 1) {
    end = dotIndex
  }

  return value.slice(0, end)
}

function formatRatio(numerator: bigint, denominator: bigint, precision: bigint): string {
  if (precision < 0n) {
    throw new RangeError('Precision must be non-negative')
  }

  const sign = numerator < 0n ? '-' : ''
  const absNumerator = numerator < 0n ? -numerator : numerator

  const scale = pow10(precision)
  const scaled = (absNumerator * scale + denominator / 2n) / denominator
  const integerPart = scaled / scale
  const fractionalPart = scaled % scale

  if (precision === 0n) {
    return `${sign}${integerPart}`
  }

  return `${sign}${integerPart}.${fractionalPart.toString().padStart(Number(precision), '0')}`
}

function parseDecimalToFraction(value: string): { numerator: bigint; denominator: bigint } {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error('Price must be a number')
  }

  const isNegative = trimmed.startsWith('-')
  const unsigned = isNegative || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed

  const [basePart, exponentPart] = unsigned.toLowerCase().split('e')
  const [integerStr, fractionalStr = ''] = basePart.split('.')

  if (integerStr === '' && fractionalStr === '') {
    throw new Error('Price must be a number')
  }

  const integerDigits = integerStr === '' ? '0' : integerStr
  const digits = `${integerDigits}${fractionalStr}`

  let numerator = BigInt(digits === '' ? '0' : digits)
  let denominator = pow10(BigInt(fractionalStr.length))

  if (exponentPart !== undefined && exponentPart !== '') {
    const exponent = BigInt(exponentPart)
    if (exponent > 0n) {
      numerator *= pow10(exponent)
    } else if (exponent < 0n) {
      denominator *= pow10(-exponent)
    }
  }

  if (isNegative) {
    numerator = -numerator
  }

  return { numerator, denominator }
}

function compareRatios(
  leftNumerator: bigint,
  leftDenominator: bigint,
  rightNumerator: bigint,
  rightDenominator: bigint,
): -1 | 0 | 1 {
  const left = leftNumerator * rightDenominator
  const right = rightNumerator * leftDenominator

  if (left === right) return 0
  return left < right ? -1 : 1
}

export function tickToSqrtPriceX96(tick: bigint): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new RangeError('Tick out of bounds')
  }

  const absTick = tick < 0n ? -tick : tick

  let ratio =
    (absTick & 0x1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n
  if ((absTick & 0x2n) !== 0n) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n
  if ((absTick & 0x4n) !== 0n) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n
  if ((absTick & 0x8n) !== 0n) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n
  if ((absTick & 0x10n) !== 0n) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n
  if ((absTick & 0x20n) !== 0n) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n
  if ((absTick & 0x40n) !== 0n) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n
  if ((absTick & 0x80n) !== 0n) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n
  if ((absTick & 0x100n) !== 0n) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n
  if ((absTick & 0x200n) !== 0n) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n
  if ((absTick & 0x400n) !== 0n) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n
  if ((absTick & 0x800n) !== 0n) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n
  if ((absTick & 0x1000n) !== 0n) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n
  if ((absTick & 0x2000n) !== 0n) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n
  if ((absTick & 0x4000n) !== 0n) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n
  if ((absTick & 0x8000n) !== 0n) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n
  if ((absTick & 0x10000n) !== 0n) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n
  if ((absTick & 0x20000n) !== 0n) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n
  if ((absTick & 0x40000n) !== 0n) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n
  if ((absTick & 0x80000n) !== 0n) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n

  if (tick > 0n) {
    ratio = ((1n << 256n) - 1n) / ratio
  }

  const remainderMask = (1n << 32n) - 1n
  const sqrtPriceX96 = (ratio >> 32n) + ((ratio & remainderMask) === 0n ? 0n : 1n)

  return sqrtPriceX96
}

const MIN_SQRT_PRICE_X96 = tickToSqrtPriceX96(MIN_TICK)
const MAX_SQRT_PRICE_X96 = tickToSqrtPriceX96(MAX_TICK)

function getPriceRatioFromSqrtPriceX96(sqrtPriceX96: bigint): {
  numerator: bigint
  denominator: bigint
} {
  return {
    numerator: sqrtPriceX96 * sqrtPriceX96,
    denominator: Q192,
  }
}

function getRawPriceRatio(tick: bigint): { numerator: bigint; denominator: bigint } {
  return getPriceRatioFromSqrtPriceX96(tickToSqrtPriceX96(tick))
}

function adjustRatioForDecimals(
  numerator: bigint,
  denominator: bigint,
  decimals0: bigint,
  decimals1: bigint,
): { numerator: bigint; denominator: bigint } {
  const diff = decimals0 - decimals1
  if (diff === 0n) {
    return { numerator, denominator }
  }

  if (diff > 0n) {
    return { numerator: numerator * pow10(diff), denominator }
  }

  return { numerator, denominator: denominator * pow10(-diff) }
}

/**
 * Convert a tick to a raw price string (no decimal adjustment).
 * Uses the formula: price = 1.0001^tick
 *
 * This returns the raw price ratio, not adjusted for token decimals.
 * A fixed internal precision is used and trailing zeros are trimmed.
 *
 * @param tick - The tick value
 * @returns Price string
 *
 * @example
 * ```typescript
 * tickToPrice(0n)       // "1"
 * tickToPrice(1000n)    // "1.105..." (approximately)
 * tickToPrice(-1000n)   // "0.904..." (approximately)
 * tickToPrice(200000n)  // Very large number
 * ```
 */
export function tickToPrice(tick: bigint): string {
  const { numerator, denominator } = getRawPriceRatio(tick)
  const price = formatRatio(numerator, denominator, RAW_PRICE_PRECISION)
  return trimTrailingZeros(price)
}

/**
 * Convert a tick to a human-readable price with decimal scaling.
 * Uses the formula: price = 1.0001^tick * 10^(decimals0-decimals1)
 *
 * This adjusts for the different decimals of the two tokens in the pair.
 *
 * @param tick - The tick value
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @param precision - Number of decimal places to display
 * @returns Formatted price string
 *
 * @example
 * ```typescript
 * // WETH/USDC pool (18 decimals / 6 decimals)
 * // At tick ~200000, price is roughly $2000 per ETH
 * tickToPriceDecimalScaled(200000n, 18n, 6n, 2n) // "2000.00" (approximately)
 *
 * // For token1/token0 price, swap the decimals
 * tickToPriceDecimalScaled(200000n, 6n, 18n, 6n) // "0.000500" (approximately)
 * ```
 */
export function tickToPriceDecimalScaled(
  tick: bigint,
  decimals0: bigint,
  decimals1: bigint,
  precision: bigint,
): string {
  const rawRatio = getRawPriceRatio(tick)
  const { numerator, denominator } = adjustRatioForDecimals(
    rawRatio.numerator,
    rawRatio.denominator,
    decimals0,
    decimals1,
  )

  return formatRatio(numerator, denominator, precision)
}

/**
 * Convert a sqrtPriceX96 to a human-readable price with decimal scaling.
 *
 * Uses the formula: price = (sqrtPriceX96^2 / 2^192) * 10^(decimals0-decimals1)
 *
 * @param sqrtPriceX96 - The sqrt price in Q64.96 format
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @param precision - Number of decimal places to display
 * @returns Formatted price string
 *
 * @example
 * ```typescript
 * sqrtPriceX96ToPriceDecimalScaled(2n ** 96n, 18n, 18n, 2n) // "1.00"
 * ```
 */
export function sqrtPriceX96ToPriceDecimalScaled(
  sqrtPriceX96: bigint,
  decimals0: bigint,
  decimals1: bigint,
  precision: bigint,
): string {
  const rawRatio = getPriceRatioFromSqrtPriceX96(sqrtPriceX96)
  const { numerator, denominator } = adjustRatioForDecimals(
    rawRatio.numerator,
    rawRatio.denominator,
    decimals0,
    decimals1,
  )

  return formatRatio(numerator, denominator, precision)
}

/**
 * Convert a price to a tick value.
 *
 * @param price - The price string
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @returns The tick value (rounded to nearest integer)
 *
 * @example
 * ```typescript
 * // WETH/USDC: What tick for $2000 per ETH?
 * priceToTick("2000", 18n, 6n) // ~200000n
 *
 * // Inverse: What tick for 0.0005 ETH per USDC?
 * priceToTick("0.0005", 6n, 18n) // ~200000n
 * ```
 */
export function priceToTick(price: string, decimals0: bigint, decimals1: bigint): bigint {
  const parsed = parseDecimalToFraction(price)
  if (parsed.numerator <= 0n) {
    throw new Error('Price must be positive')
  }

  let targetNumerator = parsed.numerator
  let targetDenominator = parsed.denominator

  const diff = decimals0 - decimals1
  if (diff > 0n) {
    targetDenominator *= pow10(diff)
  } else if (diff < 0n) {
    targetNumerator *= pow10(-diff)
  }

  let low = MIN_TICK
  let high = MAX_TICK

  while (low <= high) {
    const mid = (low + high) / 2n
    const { numerator, denominator } = getRawPriceRatio(mid)
    const cmp = compareRatios(numerator, denominator, targetNumerator, targetDenominator)

    if (cmp === 0) {
      return mid
    }

    if (cmp < 0) {
      low = mid + 1n
    } else {
      high = mid - 1n
    }
  }

  const floorTick = high
  const ceilTick = low

  if (floorTick < MIN_TICK) return MIN_TICK
  if (ceilTick > MAX_TICK) return MAX_TICK

  const floorRatio = getRawPriceRatio(floorTick)
  const ceilRatio = getRawPriceRatio(ceilTick)

  const floorDiffNumerator = absBigint(
    targetNumerator * floorRatio.denominator - floorRatio.numerator * targetDenominator,
  )
  const ceilDiffNumerator = absBigint(
    targetNumerator * ceilRatio.denominator - ceilRatio.numerator * targetDenominator,
  )
  const floorDiffDenominator = targetDenominator * floorRatio.denominator
  const ceilDiffDenominator = targetDenominator * ceilRatio.denominator

  return floorDiffNumerator * ceilDiffDenominator <= ceilDiffNumerator * floorDiffDenominator
    ? floorTick
    : ceilTick
}

/**
 * Convert a sqrtPriceX96 value to the nearest tick.
 *
 * @param sqrtPriceX96 - The sqrt price in Q64.96 format
 * @returns The tick value (rounded to nearest integer)
 *
 * @example
 * ```typescript
 * const tick = sqrtPriceX96ToTick(2n ** 96n) // 0n
 * ```
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 <= 0n) {
    throw new Error('Sqrt price must be positive')
  }

  if (sqrtPriceX96 < MIN_SQRT_PRICE_X96 || sqrtPriceX96 > MAX_SQRT_PRICE_X96) {
    throw new RangeError('Sqrt price out of bounds')
  }

  let low = MIN_TICK
  let high = MAX_TICK

  while (low <= high) {
    const mid = (low + high) / 2n
    const midSqrt = tickToSqrtPriceX96(mid)

    if (midSqrt === sqrtPriceX96) {
      return mid
    }

    if (midSqrt < sqrtPriceX96) {
      low = mid + 1n
    } else {
      high = mid - 1n
    }
  }

  const floorTick = high
  const ceilTick = low

  if (floorTick < MIN_TICK) return MIN_TICK
  if (ceilTick > MAX_TICK) return MAX_TICK

  const floorSqrt = tickToSqrtPriceX96(floorTick)
  const ceilSqrt = tickToSqrtPriceX96(ceilTick)

  const floorDiff = absBigint(sqrtPriceX96 - floorSqrt)
  const ceilDiff = absBigint(ceilSqrt - sqrtPriceX96)

  return floorDiff <= ceilDiff ? floorTick : ceilTick
}

/**
 * Format a tick value for display.
 *
 * @param tick - The tick value
 * @returns Formatted tick string
 *
 * @example
 * ```typescript
 * formatTick(200000n)  // "200000"
 * formatTick(-50000n)  // "-50000"
 * ```
 */
export function formatTick(tick: bigint): string {
  return tick.toString()
}

/**
 * Get the price at a specific tick, returning both token0/token1 and token1/token0 prices.
 *
 * @param tick - The tick value
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @param precision - Number of decimal places to display
 * @returns Object with both price directions
 *
 * @example
 * ```typescript
 * const prices = getPricesAtTick(200000n, 18n, 6n, 2n)
 * // prices.token0PerToken1 = "0.00" (very small)
 * // prices.token1PerToken0 = "2000.00" (USDC per ETH)
 * ```
 */
export function getPricesAtTick(
  tick: bigint,
  decimals0: bigint,
  decimals1: bigint,
  precision: bigint,
): { token0PerToken1: string; token1PerToken0: string } {
  const rawRatio = getRawPriceRatio(tick)
  const adjustedRatio = adjustRatioForDecimals(
    rawRatio.numerator,
    rawRatio.denominator,
    decimals0,
    decimals1,
  )

  return {
    token0PerToken1: formatRatio(adjustedRatio.denominator, adjustedRatio.numerator, precision),
    token1PerToken0: formatRatio(adjustedRatio.numerator, adjustedRatio.denominator, precision),
  }
}

/**
 * Format a tick range for display.
 *
 * @param tickLower - Lower tick
 * @param tickUpper - Upper tick
 * @returns Formatted tick range string
 *
 * @example
 * ```typescript
 * formatTickRange(-50000n, 200000n) // "-50000 - 200000"
 * ```
 */
export function formatTickRange(tickLower: bigint, tickUpper: bigint): string {
  return `${tickLower} - ${tickUpper}`
}

/**
 * Format a price range for display.
 *
 * @param tickLower - Lower tick
 * @param tickUpper - Upper tick
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @param precision - Number of decimal places to display
 * @returns Formatted price range string
 *
 * @example
 * ```typescript
 * formatPriceRange(0n, 0n, 18n, 18n, 2n) // "1.00 - 1.00"
 * ```
 */
export function formatPriceRange(
  tickLower: bigint,
  tickUpper: bigint,
  decimals0: bigint,
  decimals1: bigint,
  precision: bigint,
): string {
  const lower = tickToPriceDecimalScaled(tickLower, decimals0, decimals1, precision)
  const upper = tickToPriceDecimalScaled(tickUpper, decimals0, decimals1, precision)
  return `${lower} - ${upper}`
}

/**
 * Calculate the tick spacing for a given fee tier.
 *
 * @param feeBps - Fee in basis points (e.g., 500n for 0.05%)
 * @returns Tick spacing
 *
 * @example
 * ```typescript
 * getTickSpacing(100n)  // 1n (0.01% fee tier)
 * getTickSpacing(500n)  // 10n (0.05% fee tier)
 * getTickSpacing(3000n) // 60n (0.30% fee tier)
 * getTickSpacing(10000n) // 200n (1.00% fee tier)
 * ```
 */
export function getTickSpacing(feeBps: bigint): bigint {
  // Standard Uniswap V3 tick spacings
  switch (feeBps) {
    case 100n:
      return 1n
    case 500n:
      return 10n
    case 3000n:
      return 60n
    case 10000n:
      return 200n
    default: {
      const spacing = feeBps / 50n
      return spacing > 1n ? spacing : 1n
    }
  }
}

/**
 * Round a tick to the nearest valid tick for a given tick spacing.
 *
 * @param tick - The tick to round
 * @param tickSpacing - The tick spacing
 * @returns Rounded tick
 *
 * @example
 * ```typescript
 * roundToTickSpacing(12345n, 10n) // 12340n
 * roundToTickSpacing(12345n, 60n) // 12360n
 * roundToTickSpacing(-12345n, 10n) // -12350n
 * ```
 */
export function roundToTickSpacing(tick: bigint, tickSpacing: bigint): bigint {
  const remainder = tick % tickSpacing
  if (remainder === 0n) {
    return tick
  }
  // Round to nearest
  if (tick >= 0n) {
    return remainder >= tickSpacing / 2n ? tick + (tickSpacing - remainder) : tick - remainder
  }

  const absRemainder = -remainder
  return absRemainder >= tickSpacing / 2n
    ? tick - (tickSpacing - absRemainder)
    : tick + absRemainder
}
