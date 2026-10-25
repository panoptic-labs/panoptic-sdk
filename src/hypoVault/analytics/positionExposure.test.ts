import { describe, expect, it } from 'vitest'

import { qualifyVaultWeeks } from './positionActivity'
import { calculateLongOptionNotionalPct } from './positionExposure'

const leg = { width: 10n, isLong: true, asset: 0n, optionRatio: 1n }

describe('meaningful option exposure', () => {
  it('sums multiple long legs and excludes shorts and width-zero hedges', () => {
    expect(
      calculateLongOptionNotionalPct({
        navRaw: 1000n,
        underlyingToken: 'quote',
        pools: [
          {
            token0: 'quote',
            token1: 'risk',
            token0Price: 0,
            token1Price: 0,
            positions: [
              {
                positionSize: 10n,
                legs: [
                  leg,
                  { ...leg, optionRatio: 2n },
                  { ...leg, width: 0n },
                  { ...leg, isLong: false },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe('3')
  })
  it.each([true, false])(
    'converts mixed asset legs in either token ordering (%s)',
    (quoteIsToken0) => {
      const quoteIndex = quoteIsToken0 ? 0n : 1n
      const riskIndex = quoteIsToken0 ? 1n : 0n
      const tick = quoteIsToken0 ? -10000 : 10000
      const pct = calculateLongOptionNotionalPct({
        navRaw: 10000n,
        underlyingToken: 'quote',
        pools: [
          {
            token0: quoteIsToken0 ? 'quote' : 'risk',
            token1: quoteIsToken0 ? 'risk' : 'quote',
            token0Price: tick,
            token1Price: tick,
            positions: [
              {
                positionSize: 100n,
                legs: [
                  { ...leg, asset: quoteIndex },
                  { ...leg, asset: riskIndex },
                ],
              },
            ],
          },
        ],
      })
      expect(pct).toBe('3.71')
    },
  )
  it('rejects pools outside the NAV denomination instead of assuming a price frame', () => {
    expect(() =>
      calculateLongOptionNotionalPct({
        navRaw: 1000n,
        underlyingToken: 'quote',
        pools: [{ token0: 'other', token1: 'risk', token0Price: 0, token1Price: 0, positions: [] }],
      }),
    ).toThrow('Unsupported exposure denomination')
  })
  it('requires at least 5% long exposure for half the week and retains only qualifying intervals', () => {
    const week = { startTimestampSec: 0, endTimestampSec: 100, apyPct: '-1' }
    const activity = {
      fromTimestampSec: 0,
      throughTimestampSec: 100,
      changes: [
        { timestampSec: 0, hasOpenPositions: true, longOptionNotionalPct: '4.99' },
        { timestampSec: 20, hasOpenPositions: true, longOptionNotionalPct: '5' },
        { timestampSec: 40, hasOpenPositions: false, longOptionNotionalPct: '20' },
        { timestampSec: 70, hasOpenPositions: true, longOptionNotionalPct: '10' },
      ],
    }
    expect(qualifyVaultWeeks([week], activity)).toEqual([
      {
        ...week,
        activeIntervals: [
          { startTimestampSec: 20, endTimestampSec: 40 },
          { startTimestampSec: 70, endTimestampSec: 100 },
        ],
      },
    ])
    expect(
      qualifyVaultWeeks([week], {
        ...activity,
        changes: activity.changes.map((change) => ({ ...change, longOptionNotionalPct: '4.99' })),
      }),
    ).toEqual([])
  })
})
