/**
 * Token list integration utilities.
 *
 * Provides helpers for integrating with standard token lists
 * (e.g., Uniswap token list, CoinGecko token list).
 *
 * @module v2/formatters/tokenList
 */

import type { Address } from 'viem'

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
 * Generate a token list ID for external token list integration.
 *
 * Token lists use a standardized format: `chainId:address`
 * This is compatible with most token list standards.
 *
 * @param chainId - The chain ID
 * @param address - The token address
 * @returns Token list ID string
 *
 * @example
 * ```typescript
 * getTokenListId(1n, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
 * // "1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
 *
 * getTokenListId(11155111n, '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14')
 * // "11155111:0xfff9976782d46cc05630d1f6ebab18b2324d6b14"
 * ```
 */
export function getTokenListId(chainId: bigint, address: Address): string {
  return `${chainId}:${address.toLowerCase()}`
}

/**
 * Parse a token list ID back to chain ID and address.
 *
 * @param tokenListId - The token list ID string
 * @returns Object with chainId and address
 *
 * @example
 * ```typescript
 * parseTokenListId("1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
 * // { chainId: 1n, address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" }
 * ```
 */
export function parseTokenListId(tokenListId: string): {
  chainId: bigint
  address: Address
} {
  const [chainIdStr, address] = tokenListId.split(':')
  if (!chainIdStr || !address) {
    throw new Error(`Invalid token list ID: ${tokenListId}`)
  }
  return {
    chainId: BigInt(chainIdStr),
    address: address as Address,
  }
}

/**
 * Generate a pool ID string for display purposes.
 *
 * @param token0Symbol - Symbol of token0
 * @param token1Symbol - Symbol of token1
 * @param feeBps - Fee in basis points (e.g., 500n for 0.05%)
 * @returns Pool ID string
 *
 * @example
 * ```typescript
 * getPoolDisplayId('WETH', 'USDC', 500n)
 * // "WETH/USDC 0.05%"
 *
 * getPoolDisplayId('WBTC', 'ETH', 3000n)
 * // "WBTC/ETH 0.30%"
 * ```
 */
export function getPoolDisplayId(
  token0Symbol: string,
  token1Symbol: string,
  feeBps: bigint,
): string {
  return `${token0Symbol}/${token1Symbol} ${formatFeeTier(feeBps)}`
}

/**
 * Format a fee tier for display.
 *
 * @param feeBps - Fee in basis points (e.g., 500n for 0.05%)
 * @returns Fee tier string
 *
 * @example
 * ```typescript
 * formatFeeTier(500n)   // "0.05%"
 * formatFeeTier(3000n)  // "0.30%"
 * formatFeeTier(10000n) // "1.0%"
 * ```
 */
export function formatFeeTier(feeBps: bigint): string {
  const precision = feeBps < 10000n ? 2n : 1n
  const feeStr = formatRatio(feeBps, 10_000n, precision)
  return `${feeStr}%`
}
