/**
 * Formatters module for the Panoptic v2 SDK.
 *
 * All formatters require explicit precision - no hidden defaults.
 *
 * @module v2/formatters
 */

// Tick and price formatters
export {
  formatPriceRange,
  formatTick,
  formatTickRange,
  getPricesAtTick,
  getTickSpacing,
  priceToTick,
  roundToTickSpacing,
  sqrtPriceX96ToPriceDecimalScaled,
  sqrtPriceX96ToTick,
  tickToPrice,
  tickToPriceDecimalScaled,
  tickToSqrtPriceX96,
} from './tick'

// Token amount formatters
export {
  formatTokenAmount,
  formatTokenAmountSigned,
  formatTokenDelta,
  formatTokenFlow,
  parseTokenAmount,
} from './amount'

// Percentage formatters
export { formatBps, formatRatioPercent, formatUtilization, parseBps } from './percentage'

// WAD formatters
export { formatRateWad, formatWad, formatWadPercent, formatWadSigned, parseWad } from './wad'

// Pool-bound formatters
export type { PoolFormatterConfig, PoolFormatters } from './poolFormatters'
export { createPoolFormatters } from './poolFormatters'

// Token list utilities
export { formatFeeTier, getPoolDisplayId, getTokenListId, parseTokenListId } from './tokenList'

// Display formatters
export {
  formatBlockNumber,
  formatCompact,
  formatDatetime,
  formatDuration,
  formatDurationSeconds,
  formatGas,
  formatGwei,
  formatPoolIdHex,
  formatTimestamp,
  formatTimestampLocale,
  formatTokenIdHex,
  formatTokenIdShort,
  formatTxHash,
  formatWei,
  truncateAddress,
} from './display'
