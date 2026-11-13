import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { computeInterestShortfall, getInterestShortfall } from './interestShortfall'

// Mainnet USDC tracker 0x3e24…c482, read after an `InsolvencyPenaltyApplied` for 1 wei of interest.
const USDC_SUPPLY = 975_555_983_525_747_519n
const USDC_ASSETS = 976_125_228_731n
const TRACKER = '0x3e24e4ab1e097f35c910eb9242a8c1530ee9c482' as const
const NO_ACCRUAL = { collateralTracker: TRACKER, netBorrows: 0n, interestRatePerSecond: 0n }

describe('computeInterestShortfall', () => {
  it('flags dust interest owed on an empty balance', () => {
    const result = computeInterestShortfall({
      ...NO_ACCRUAL,
      interestOwed: 1n,
      shareBalance: 0n,
      totalSupply: USDC_SUPPLY,
      totalAssets: USDC_ASSETS,
    })
    // 1 wei mints floor(supply / assets) shares, one short of ceil(supply / assets).
    expect(result.shortfall).toBe(2n)
    expect(result.recommendedDeposit).toBe(3n)
    expect(result.collateralAssets).toBe(0n)
  })

  it('reports no shortfall when the balance covers the interest', () => {
    const result = computeInterestShortfall({
      ...NO_ACCRUAL,
      interestOwed: 1n,
      shareBalance: 20_420_250_189n,
      totalSupply: USDC_SUPPLY,
      totalAssets: USDC_ASSETS,
    })
    expect(result).toEqual({
      collateralTracker: TRACKER,
      interestOwed: 1n,
      collateralAssets: 20_432n,
      shortfall: 0n,
      recommendedDeposit: 0n,
    })
  })

  it('flags a non-zero balance that would be fully burned', () => {
    const result = computeInterestShortfall({
      ...NO_ACCRUAL,
      interestOwed: 1_000n,
      shareBalance: 999_000n,
      totalSupply: 1_000_000n,
      totalAssets: 1_000n,
    })
    expect(result.shortfall).toBe(1n)
    expect(result.recommendedDeposit).toBe(2n)
  })

  it('sizes headroom from borrow accrual, not from the interest already owed', () => {
    // 10,000 USDC borrowed at ~10% APR, settled moments ago so only 1 wei is owed.
    const netBorrows = 10_000_000_000n
    const interestRatePerSecond = 3_170_979_198n
    const result = computeInterestShortfall({
      collateralTracker: TRACKER,
      interestOwed: 1n,
      netBorrows,
      interestRatePerSecond,
      shareBalance: 0n,
      totalSupply: USDC_SUPPLY,
      totalAssets: USDC_ASSETS,
    })
    const accruedOverAnHour = (netBorrows * interestRatePerSecond * 3_600n) / 10n ** 18n
    expect(accruedOverAnHour).toBeGreaterThan(100_000n)
    expect(result.recommendedDeposit - result.shortfall).toBeGreaterThan(accruedOverAnHour)
  })

  it('ignores net lending when sizing headroom', () => {
    const result = computeInterestShortfall({
      collateralTracker: TRACKER,
      interestOwed: 1n,
      netBorrows: -10_000_000_000n,
      interestRatePerSecond: 3_170_979_198n,
      shareBalance: 0n,
      totalSupply: USDC_SUPPLY,
      totalAssets: USDC_ASSETS,
    })
    expect(result.recommendedDeposit).toBe(result.shortfall + 1n)
  })

  it('sizes the deposit so the minted shares cover the missing shares', () => {
    const totalSupply = 7_000_003n
    const totalAssets = 3_000_001n
    const shareBalance = 12_345n
    const interestOwed = 98_765n
    const { shortfall } = computeInterestShortfall({
      ...NO_ACCRUAL,
      interestOwed,
      shareBalance,
      totalSupply,
      totalAssets,
    })
    const sharesRequired = (interestOwed * totalSupply + totalAssets - 1n) / totalAssets
    const minted = (shortfall * totalSupply) / totalAssets
    expect(shareBalance + minted).toBeGreaterThanOrEqual(sharesRequired)
    const mintedIfOneLess = ((shortfall - 1n) * totalSupply) / totalAssets
    expect(shareBalance + mintedIfOneLess).toBeLessThan(sharesRequired)
  })

  it('reports nothing when no interest is owed', () => {
    expect(
      computeInterestShortfall({
        ...NO_ACCRUAL,
        interestOwed: 0n,
        shareBalance: 0n,
        totalSupply: USDC_SUPPLY,
        totalAssets: USDC_ASSETS,
      }).shortfall,
    ).toBe(0n)
  })
})

describe('getInterestShortfall', () => {
  it('evaluates each tracker independently at one block', async () => {
    const multicall = vi
      .fn()
      .mockResolvedValue([
        1n,
        0n,
        USDC_SUPPLY,
        USDC_ASSETS,
        [10n ** 18n, 2n],
        0n,
        0n,
        5n,
        10n,
        10n,
        [10n ** 18n, 0n],
        0n,
      ])
    const client = {
      multicall,
      getBlockNumber: vi.fn().mockResolvedValue(42n),
      getBlock: vi.fn().mockResolvedValue({ number: 42n, timestamp: 1n, hash: '0x01' }),
    } as unknown as PublicClient

    const result = await getInterestShortfall({
      client,
      poolAddress: '0x0000000000000000000000000000000000000001',
      account: '0x0000000000000000000000000000000000000002',
      collateralAddresses: {
        collateralToken0: '0x0000000000000000000000000000000000000003',
        collateralToken1: '0x0000000000000000000000000000000000000004',
      },
    })

    expect(result.token0.shortfall).toBe(2n)
    expect(result.token1.shortfall).toBe(0n)
    expect(result.token0.collateralTracker).toBe('0x0000000000000000000000000000000000000003')
    expect(multicall).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 42n }))
  })
})
