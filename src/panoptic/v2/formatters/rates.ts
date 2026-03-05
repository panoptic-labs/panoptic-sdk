/**
 * Per-second rate helpers.
 *
 * Collateral tracker rates are returned as WAD-scaled per-second rates.
 * These helpers annualize them for display.
 *
 * @module v2/formatters/rates
 */

import { formatWadPercent } from './wad'

const SECONDS_PER_DAY = 86_400n
const DAYS_PER_YEAR = 365n
const SECONDS_PER_YEAR = SECONDS_PER_DAY * DAYS_PER_YEAR

/**
 * Annualize a per-second WAD-scaled rate to annual WAD.
 *
 * @param ratePerSecondWad - Rate in WAD per second
 * @returns Annualized rate in WAD
 */
export function annualizePerSecondRateWad(ratePerSecondWad: bigint): bigint {
  return ratePerSecondWad * SECONDS_PER_YEAR
}

/**
 * Format a per-second WAD rate as APY percentage text.
 * Uses linear annualization, then formats as WAD percent.
 *
 * @param ratePerSecondWad - Rate in WAD per second
 * @param precision - Decimal places
 * @returns Percentage string, e.g. "2.41%"
 */
export function formatPerSecondRateWadAsApyPct(
  ratePerSecondWad: bigint,
  precision: bigint,
): string {
  return formatWadPercent(annualizePerSecondRateWad(ratePerSecondWad), precision)
}

/**
 * Format a per-second WAD rate as APR percentage text.
 * For this rate model, APR presentation uses the same annualized output.
 *
 * @param ratePerSecondWad - Rate in WAD per second
 * @param precision - Decimal places
 * @returns Percentage string, e.g. "2.41%"
 */
export function formatPerSecondRateWadAsAprPct(
  ratePerSecondWad: bigint,
  precision: bigint,
): string {
  return formatWadPercent(annualizePerSecondRateWad(ratePerSecondWad), precision)
}
