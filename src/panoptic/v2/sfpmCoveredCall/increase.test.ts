import { describe, expect, it } from 'vitest'

import { PanopticValidationError } from '../errors'
import { planSfpmCoveredCallIncrease } from './increase'
import { planSfpmCoveredCallOpen } from './open'

// tickSpacing 10, vegoid 4.
const POOL_ID = 0xa0488e6a0c2ddn
const market = {
  sfpmAddress: '0x00000000000005E4693aDc8Ec0f12D686f728198',
  poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  currentTick: 200_000n,
  liquidity: 10n ** 22n,
  fee: 500,
  slippageBps: 30n,
} as const

describe('planSfpmCoveredCallIncrease', () => {
  it('reuses the open planner on the same token ID', () => {
    const open = planSfpmCoveredCallOpen({
      ...market,
      poolId: POOL_ID,
      assetIdx: 0n,
      strike: 200_050n,
      width: 10n,
      deposit: 10n ** 18n,
    })
    const increase = planSfpmCoveredCallIncrease({
      ...market,
      tokenId: open.tokenId,
      deposit: 10n ** 18n,
    })
    expect(increase).toEqual(open)
  })

  it('rejects token IDs that are not a single short range', () => {
    expect(() => planSfpmCoveredCallIncrease({ ...market, tokenId: POOL_ID, deposit: 1n })).toThrow(
      PanopticValidationError,
    )
  })
})
