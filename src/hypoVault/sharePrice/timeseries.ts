import Decimal from 'decimal.js'

import { calculateAnnualizedApyPct } from './math'
import type { VaultApySeriesPoint, VaultSharePriceSeriesPoint } from './types'

const SECONDS_PER_DAY = 86_400

/**
 * Pure derivation: turn an (unordered) share-price series into an annualized
 * APY series. Each point annualizes the growth between consecutive share
 * prices over their actual time gap.
 */
export function deriveVaultApyTimeseriesFromSharePrices(
  sharePricePoints: VaultSharePriceSeriesPoint[],
): VaultApySeriesPoint[] {
  const sorted = [...sharePricePoints].sort((a, b) => a.timestampSec - b.timestampSec)
  const points: VaultApySeriesPoint[] = []

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]
    const current = sorted[i]
    const days = (current.timestampSec - previous.timestampSec) / SECONDS_PER_DAY
    const apyPct = calculateAnnualizedApyPct({
      currentSharePrice: new Decimal(current.sharePrice),
      previousSharePrice: new Decimal(previous.sharePrice),
      days,
    })

    if (apyPct === null || !Number.isFinite(apyPct)) {
      continue
    }

    points.push({
      timestampSec: current.timestampSec,
      apyPct,
    })
  }

  return points
}
