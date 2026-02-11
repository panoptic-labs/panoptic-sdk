/**
 * Pool-bound formatters factory.
 *
 * Creates formatter functions that capture pool context (token decimals)
 * for less verbose call sites in single-pool UI components.
 *
 * @module v2/formatters/poolFormatters
 */

import { formatTokenAmount, parseTokenAmount } from './amount'
import { priceToTick, tickToPrice, tickToPriceDecimalScaled } from './tick'

/**
 * Pool-bound formatters interface.
 *
 * These formatters capture the pool's token decimals, so you don't need
 * to pass them at every call site.
 */
export interface PoolFormatters {
  /** Token0 decimals */
  readonly decimals0: bigint
  /** Token1 decimals */
  readonly decimals1: bigint

  /**
   * Convert tick to raw price (1.0001^tick).
   */
  tickToPrice(tick: bigint): string

  /**
   * Convert tick to decimal-scaled price (token1 per token0).
   */
  tickToPriceScaled(tick: bigint, precision: bigint): string

  /**
   * Convert tick to decimal-scaled inverse price (token0 per token1).
   */
  tickToInversePriceScaled(tick: bigint, precision: bigint): string

  /**
   * Convert a price (token1 per token0) to tick.
   */
  priceToTick(price: string): bigint

  /**
   * Format token0 amount with specified precision.
   */
  formatAmount0(amount: bigint, precision: bigint): string

  /**
   * Format token1 amount with specified precision.
   */
  formatAmount1(amount: bigint, precision: bigint): string

  /**
   * Parse token0 amount string to raw units.
   */
  parseAmount0(amount: string): bigint

  /**
   * Parse token1 amount string to raw units.
   */
  parseAmount1(amount: string): bigint
}

/**
 * Pool metadata required to create pool-bound formatters.
 */
export interface PoolFormatterConfig {
  /** Token0 decimals */
  decimals0: bigint
  /** Token1 decimals */
  decimals1: bigint
}

/**
 * Create pool-bound formatters that capture token decimals.
 *
 * Use this factory when working with a single pool to avoid passing
 * decimals at every call site.
 *
 * @param config - Pool configuration with token decimals
 * @returns Pool-bound formatter functions
 *
 * @example
 * ```typescript
 * // Get pool data
 * const pool = await getPool({ client, poolAddress })
 *
 * // Create formatters bound to this pool
 * const fmt = createPoolFormatters({
 *   decimals0: pool.token0Decimals,
 *   decimals1: pool.token1Decimals,
 * })
 *
 * // Now use without passing decimals each time
 * const priceStr = fmt.tickToPriceScaled(position.currentTick, 4n)
 * const amount0Str = fmt.formatAmount0(collateral.assets, 4n)
 * const amount1Str = fmt.formatAmount1(premia.token1, 2n)
 *
 * // Parse user input
 * const rawAmount0 = fmt.parseAmount0("1.5")
 * const rawAmount1 = fmt.parseAmount1("3000")
 * ```
 */
export function createPoolFormatters(config: PoolFormatterConfig): PoolFormatters {
  const { decimals0, decimals1 } = config

  return {
    decimals0,
    decimals1,

    tickToPrice(tick: bigint): string {
      return tickToPrice(tick)
    },

    tickToPriceScaled(tick: bigint, precision: bigint): string {
      return tickToPriceDecimalScaled(tick, decimals0, decimals1, precision)
    },

    tickToInversePriceScaled(tick: bigint, precision: bigint): string {
      // Swap decimals for inverse price
      return tickToPriceDecimalScaled(tick, decimals1, decimals0, precision)
    },

    priceToTick(price: string): bigint {
      return priceToTick(price, decimals0, decimals1)
    },

    formatAmount0(amount: bigint, precision: bigint): string {
      return formatTokenAmount(amount, decimals0, precision)
    },

    formatAmount1(amount: bigint, precision: bigint): string {
      return formatTokenAmount(amount, decimals1, precision)
    },

    parseAmount0(amount: string): bigint {
      return parseTokenAmount(amount, decimals0)
    },

    parseAmount1(amount: string): bigint {
      return parseTokenAmount(amount, decimals1)
    },
  }
}
