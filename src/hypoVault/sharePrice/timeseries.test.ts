import { describe, expect, it } from 'vitest'

import { deriveVaultApyTimeseriesFromSharePrices } from './timeseries'

describe('deriveVaultApyTimeseriesFromSharePrices', () => {
  it('derives annualized APY points from consecutive share prices', () => {
    const day = 86_400
    const points = deriveVaultApyTimeseriesFromSharePrices([
      { timestampSec: 0, sharePrice: '1.0' },
      { timestampSec: day, sharePrice: '1.001' },
      { timestampSec: 2 * day, sharePrice: '1.001' },
    ])

    expect(points).toHaveLength(2)
    expect(points[0].timestampSec).toBe(day)
    expect(points[0].apyPct).toBeGreaterThan(0)
    expect(points[1].apyPct).toBe(0)
  })

  it('sorts unordered input and skips invalid growth pairs', () => {
    const day = 86_400
    const points = deriveVaultApyTimeseriesFromSharePrices([
      { timestampSec: 2 * day, sharePrice: '1.2' },
      { timestampSec: 0, sharePrice: '0' },
      { timestampSec: day, sharePrice: '1.1' },
    ])

    // 0 → day pair is invalid (previous price 0), day → 2*day is valid.
    expect(points).toHaveLength(1)
    expect(points[0].timestampSec).toBe(2 * day)
    expect(points[0].apyPct).toBeGreaterThan(0)
  })

  it('returns empty series for fewer than two points', () => {
    expect(deriveVaultApyTimeseriesFromSharePrices([])).toEqual([])
    expect(deriveVaultApyTimeseriesFromSharePrices([{ timestampSec: 0, sharePrice: '1' }])).toEqual(
      [],
    )
  })
})
