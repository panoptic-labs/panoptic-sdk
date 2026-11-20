import { describe, expect, it } from 'vitest'

import { decodeAllLegs } from '../tokenId'
import { type PlanSfpmCoveredCallOpenParams, planSfpmCoveredCallOpen } from './open'

const base: PlanSfpmCoveredCallOpenParams = {
  sfpmAddress: '0x000000000000031d296bBA22f188472157eEb01f',
  poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  // Mainnet 5bps USDC/WETH pool on the SFPM: tick spacing 10.
  poolId: 0xa0488e6a0c2ddn,
  assetIdx: 0n,
  strike: 201500n,
  width: 100n,
  deposit: 10n ** 18n,
  currentTick: 201042n,
  liquidity: 10n ** 19n,
  fee: 500,
  slippageBps: 50n,
}

describe('planSfpmCoveredCallOpen', () => {
  it.each([
    ['token0 asset', { assetIdx: 0n, strike: 201500n, deposit: 100_000n * 10n ** 6n }],
    ['token1 asset', { assetIdx: 1n, strike: 200600n, deposit: 30n * 10n ** 18n }],
  ] as const)('swaps for the quote share of an in-range %s call within the deposit', (_, args) => {
    const plan = planSfpmCoveredCallOpen({ ...base, ...args })
    expect(plan.calls).toHaveLength(3)
    expect(plan.quoteBought).toBeGreaterThan(0n)
    expect(plan.maxAssetIn).toBeLessThanOrEqual(args.deposit)
    expect(plan.maxAssetIn * 1000n).toBeGreaterThan(args.deposit * 990n)
    expect(plan.positionSize).toBeLessThanOrEqual(args.deposit)
    const [leg] = decodeAllLegs(plan.tokenId)
    expect(leg).toMatchObject({ asset: args.assetIdx, tokenType: args.assetIdx, isLong: false })
  })

  it.each([
    ['token0 asset', { assetIdx: 0n, strike: 205000n }],
    ['token1 asset', { assetIdx: 1n, strike: 197000n }],
  ] as const)('mints an out-of-range %s call at the full deposit without swapping', (_, args) => {
    const plan = planSfpmCoveredCallOpen({ ...base, ...args })
    expect(plan.calls).toHaveLength(1)
    expect(plan.quoteBought).toBe(0n)
    expect(plan.positionSize).toBe(base.deposit)
  })

  it.each([
    ['token0 asset', { assetIdx: 0n, strike: 197000n }],
    ['token1 asset', { assetIdx: 1n, strike: 205000n }],
  ] as const)('rejects a %s range that holds none of the asset', (_, args) => {
    expect(() => planSfpmCoveredCallOpen({ ...base, ...args })).toThrow(/holds none of the asset/)
  })

  it('rejects a swap that would move the price beyond the slippage band', () => {
    expect(() => planSfpmCoveredCallOpen({ ...base, liquidity: 10n ** 12n })).toThrow(/too large/)
  })
})
