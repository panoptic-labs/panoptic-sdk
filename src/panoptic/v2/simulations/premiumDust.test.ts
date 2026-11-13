import { describe, expect, it } from 'vitest'

import { getPremiumDustTolerance } from './premiumDust'

describe('getPremiumDustTolerance', () => {
  it.each([
    { decimals: [6n, 18n], tolerance: [0n, 100n] },
    { decimals: [18n, 6n], tolerance: [100n, 0n] },
    { decimals: [0n, 8n], tolerance: [0n, 0n] },
    { decimals: [17n, 24n], tolerance: [0n, 100n] },
    { decimals: [18n, 18n], tolerance: [100n, 100n] },
  ] as const)(
    'caps raw dust independently in either token ordering: $decimals',
    ({ decimals, tolerance }) => {
      expect(getPremiumDustTolerance(decimals[0], decimals[1])).toEqual(tolerance)
    },
  )
})
