import { describe, expect, it } from 'vitest'

import { getOracleLag } from './oracleLag'

const state = (overrides: Partial<Parameters<typeof getOracleLag>[0]> = {}) => ({
  currentTick: 1_000n,
  spotEMA: 1_000n,
  twapTick: 1_000n,
  latestTick: 1_000n,
  medianTick: 1_000n,
  ...overrides,
})

describe('getOracleLag', () => {
  it('reports the widest liquidation reference, in either direction', () => {
    for (const [field, reference] of [
      ['spotEMA', 'spotEMA'],
      ['twapTick', 'twap'],
      ['latestTick', 'latest'],
    ] as const) {
      expect(getOracleLag(state({ [field]: 850n })).liquidation).toEqual({ gap: 150n, reference })
      expect(getOracleLag(state({ [field]: 1_150n })).liquidation).toEqual({ gap: 150n, reference })
    }
  })

  it('leaves the median out of the liquidation gap', () => {
    expect(getOracleLag(state({ medianTick: 9_000n })).liquidation.gap).toBe(0n)
  })

  it('prices new positions on the larger of the spot EMA and median gaps', () => {
    expect(getOracleLag(state({ currentTick: 2_500n, spotEMA: 2_000n })).newPosition).toEqual({
      gap: 1_500n,
      reference: 'median',
    })
    expect(
      getOracleLag(state({ currentTick: 2_500n, medianTick: 2_400n, twapTick: 2_500n }))
        .newPosition,
    ).toEqual({ gap: 1_500n, reference: 'spotEMA' })
  })

  it('leaves TWAP and latest out of the new-position gap', () => {
    expect(getOracleLag(state({ twapTick: 0n, latestTick: 0n })).newPosition.gap).toBe(0n)
  })
})
