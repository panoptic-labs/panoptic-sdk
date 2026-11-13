import { describe, expect, it } from 'vitest'

import { createTokenIdBuilder } from './builder'
import { buildEarnCoveredCallTokenId, getCoveredCallOutcome } from './coveredCall'
import { allocateCoveredCallCollateral, getEarnCollateralFunding } from './coveredCallPortfolio'

const call = (asset: bigint, ratio = 1n, strike = 0n) =>
  createTokenIdBuilder(10n << 48n)
    .addCall({ asset, optionRatio: ratio, strike, width: 10n, isLong: false })
    .build()

const earn = (assetIdx: 0n | 1n, strike = 0n) =>
  buildEarnCoveredCallTokenId({
    poolId: 10n << 48n,
    assetIdx,
    strike,
    width: 10n,
    loanStrike: -100n,
  })

describe('Earn collateral funding', () => {
  it.each([0n, 1n] as const)(
    'treats an upfront covered call as backed by deposited asset %s',
    (assetIdx) => {
      const quoteIdx = assetIdx === 0n ? 1n : 0n
      const positionSize = 10n ** 18n
      const tokenId = createTokenIdBuilder(1n << 48n)
        .addCall({ asset: assetIdx, optionRatio: 1n, isLong: false, strike: 200_000n, width: 20n })
        .addCredit({ asset: assetIdx, tokenType: quoteIdx, strike: 150_000n })
        .build()
      const funding = getEarnCollateralFunding({
        positions: [{ tokenId, positionSize }],
        assetIdx,
        collateral0: assetIdx === 0n ? positionSize : 0n,
        collateral1: assetIdx === 1n ? positionSize : 0n,
        walletBalance: 0n,
        requestedAmount: 0n,
      })
      expect(funding).toMatchObject({ covered: positionSize, uncovered: 0n, maximumAmount: 0n })
      const [allocation] = allocateCoveredCallCollateral({
        positions: [{ tokenId, positionSize }],
        collateral0: assetIdx === 0n ? positionSize : 0n,
        collateral1: assetIdx === 1n ? positionSize : 0n,
      })
      expect(allocation).toMatchObject({ assetIdx, allocatedAsset: positionSize })
    },
  )
  it.each([0n, 1n] as const)(
    'ignores only one raw unit of deposit dust in asset %s',
    (assetIdx) => {
      const requestedAmount = 2_000_000_000_000_000n
      const deposited = requestedAmount - 1n
      const args = {
        positions: [],
        assetIdx,
        collateral0: assetIdx === 0n ? deposited : 0n,
        collateral1: assetIdx === 1n ? deposited : 0n,
        walletBalance: 0n,
        requestedAmount,
      }
      expect(getEarnCollateralFunding(args)).toMatchObject({
        deposited,
        uncovered: deposited,
        depositRequired: 0n,
        maximumAmount: deposited,
      })
      expect(
        getEarnCollateralFunding({ ...args, requestedAmount: requestedAmount + 1n })
          .depositRequired,
      ).toBe(2n)
    },
  )

  it.each([6n, 18n])('keeps dust negligible for %s-decimal assets', (decimals) => {
    const requestedAmount = 10n ** decimals
    const result = getEarnCollateralFunding({
      positions: [],
      assetIdx: 0n,
      collateral0: requestedAmount - 1n,
      collateral1: 0n,
      walletBalance: 0n,
      requestedAmount,
    })
    expect(result.depositRequired).toBe(0n)
    expect(
      getEarnCollateralFunding({
        positions: [],
        assetIdx: 0n,
        collateral0: 999_998n,
        collateral1: 0n,
        walletBalance: 0n,
        requestedAmount: 999_999n,
      }).depositRequired,
    ).toBe(1n)
  })

  it.each([0n, 1n] as const)(
    'does not give each Earn call a separate dust allowance in asset %s',
    (assetIdx) => {
      const size = 1_000_000n
      const positions = [
        { tokenId: earn(assetIdx), positionSize: size },
        { tokenId: earn(assetIdx, 100n), positionSize: size },
        { tokenId: earn(assetIdx === 0n ? 1n : 0n), positionSize: size * 5n },
      ]
      const deposited = 3n * size - 1n
      const args = {
        positions,
        assetIdx,
        collateral0: assetIdx === 0n ? deposited : 10n * size,
        collateral1: assetIdx === 1n ? deposited : 10n * size,
        walletBalance: 0n,
        requestedAmount: size,
      }
      expect(getEarnCollateralFunding(args).depositRequired).toBe(0n)
      expect(
        getEarnCollateralFunding({ ...args, requestedAmount: size + 1n }).depositRequired,
      ).toBe(2n)
    },
  )

  it('requires funding when no collateral is deposited', () => {
    expect(
      getEarnCollateralFunding({
        positions: [],
        assetIdx: 0n,
        collateral0: 0n,
        collateral1: 0n,
        walletBalance: 0n,
        requestedAmount: 1n,
      }).depositRequired,
    ).toBe(1n)
  })

  it.each([0n, 1n] as const)(
    'reserves only open Earn call-and-loan backing in asset %s',
    (assetIdx) => {
      const otherAsset = assetIdx === 0n ? 1n : 0n
      const positions = [
        { tokenId: earn(assetIdx), positionSize: 100n },
        { tokenId: earn(assetIdx, 100n), positionSize: 200n },
        { tokenId: earn(otherAsset), positionSize: 400n },
        { tokenId: call(assetIdx), positionSize: 700n },
        { tokenId: earn(assetIdx, 200n), positionSize: 0n },
      ]
      const result = getEarnCollateralFunding({
        positions,
        assetIdx,
        collateral0: assetIdx === 0n ? 500n : 1000n,
        collateral1: assetIdx === 1n ? 500n : 1000n,
        walletBalance: 70n,
        requestedAmount: 250n,
        expectedLegCount: 7n,
      })
      expect(result).toMatchObject({
        deposited: 500n,
        covered: 300n,
        uncovered: 200n,
        maximumAmount: 270n,
        depositRequired: 50n,
        coverageDeficit: 0n,
      })
    },
  )
  it.each([0n, 1n] as const)(
    'permits skipping a deposit with sufficient uncovered asset %s',
    (assetIdx) => {
      const result = getEarnCollateralFunding({
        positions: [{ tokenId: earn(assetIdx), positionSize: 100n }],
        assetIdx,
        collateral0: 500n,
        collateral1: 500n,
        walletBalance: 0n,
        requestedAmount: 300n,
      })
      expect(result).toMatchObject({ maximumAmount: 400n, depositRequired: 0n, uncovered: 400n })
    },
  )
  it('accounts for missing backing on existing Earn calls before funding another', () => {
    const result = getEarnCollateralFunding({
      positions: [{ tokenId: earn(0n), positionSize: 300n }],
      assetIdx: 0n,
      collateral0: 100n,
      collateral1: 0n,
      walletBalance: 500n,
      requestedAmount: 150n,
    })
    expect(result).toMatchObject({
      covered: 100n,
      uncovered: 0n,
      coverageDeficit: 200n,
      maximumAmount: 300n,
      depositRequired: 350n,
    })
  })
  it('fails closed when discovery does not account for every open leg', () => {
    expect(() =>
      getEarnCollateralFunding({
        positions: [],
        assetIdx: 0n,
        collateral0: 100n,
        collateral1: 0n,
        walletBalance: 0n,
        requestedAmount: 100n,
        expectedLegCount: 2n,
      }),
    ).toThrow('Incomplete position list')
  })
  it('preserves raw-unit precision and rejects negative funding amounts', () => {
    const args = {
      positions: [],
      assetIdx: 0n as const,
      collateral0: 1n,
      collateral1: 0n,
      walletBalance: 1n,
      requestedAmount: 2n,
    }
    expect(getEarnCollateralFunding(args)).toMatchObject({ maximumAmount: 2n, depositRequired: 1n })
    expect(() => getEarnCollateralFunding({ ...args, walletBalance: -1n })).toThrow(RangeError)
    expect(() => getEarnCollateralFunding({ ...args, requestedAmount: -1n })).toThrow(RangeError)
  })
})

describe('covered call collateral allocation', () => {
  it.each([0n, 1n])('matches notional including ratios in asset %s', (asset) => {
    const result = allocateCoveredCallCollateral({
      positions: [{ tokenId: call(asset, 3n), positionSize: 100n }],
      collateral0: 300n,
      collateral1: 300n,
    })
    expect(result[0]).toMatchObject({
      positionSize: 300n,
      allocatedAsset: 300n,
      uncoveredAsset: 0n,
      assetIdx: asset,
    })
  })

  it('shares insufficient collateral proportionally and keeps token frames separate', () => {
    const result = allocateCoveredCallCollateral({
      positions: [
        { tokenId: call(0n), positionSize: 100n },
        { tokenId: call(0n, 1n, 100n), positionSize: 300n },
        { tokenId: call(1n), positionSize: 200n },
      ],
      collateral0: 200n,
      collateral1: 1000n,
    })
    expect(result.map((position) => position.allocatedAsset)).toEqual([50n, 150n, 200n])
    expect(result.map((position) => position.uncoveredAsset)).toEqual([50n, 150n, 0n])
  })

  it('does not classify spreads, puts, loans, long calls or closed positions as covered calls', () => {
    const builder = () => createTokenIdBuilder(10n << 48n)
    const config = { optionRatio: 1n, strike: 0n, width: 10n, isLong: false }
    const ids = [
      builder()
        .addCall(config)
        .addCall({ ...config, strike: 100n, isLong: true })
        .build(),
      builder().addPut(config).build(),
      builder().addLoan({ asset: 0n, tokenType: 1n, strike: 0n }).build(),
      builder()
        .addCall({ ...config, isLong: true })
        .build(),
    ]
    expect(
      allocateCoveredCallCollateral({
        positions: [
          ...ids.map((tokenId) => ({ tokenId, positionSize: 100n })),
          { tokenId: call(0n), positionSize: 0n },
        ],
        collateral0: 1000n,
        collateral1: 1000n,
      }),
    ).toEqual([])
  })

  it('never creates collateral through rounding or negative balances', () => {
    const positions = [0n, 100n, 200n].map((strike) => ({
      tokenId: call(0n, 1n, strike),
      positionSize: 1n,
    }))
    const result = allocateCoveredCallCollateral({ positions, collateral0: 2n, collateral1: 0n })
    expect(result.reduce((sum, row) => sum + row.allocatedAsset, 0n)).toBeLessThanOrEqual(2n)
    expect(
      allocateCoveredCallCollateral({ positions, collateral0: -1n, collateral1: 0n })[0]
        ?.allocatedAsset,
    ).toBe(0n)
  })

  it.each([0n, 1n])('payoff adds only the allocated asset for ordering %s', (assetIdx) => {
    const args = {
      positionSize: 10n ** 18n,
      assetIdx: assetIdx === 0n ? (0n as const) : (1n as const),
      strike: 0n,
      width: 10n,
      tickSpacing: 10n,
      atTick: 0n,
    }
    const full = getCoveredCallOutcome(args)
    const half = getCoveredCallOutcome({ ...args, contributedAsset: args.positionSize / 2n })
    expect(full.base - half.base).toBe(args.positionSize / 2n)
    expect(full.quote).toBe(half.quote)
    expect(() => getCoveredCallOutcome({ ...args, contributedAsset: -1n })).toThrow()
  })
})

it.each([0n, 1n] as const)(
  'allocates combined Earn calls without ignoring standalone call exposure in asset %s',
  (assetIdx) => {
    const tokenId = buildEarnCoveredCallTokenId({
      poolId: 10n << 48n,
      assetIdx,
      strike: 0n,
      width: 10n,
      loanStrike: -100n,
    })
    const allocations = allocateCoveredCallCollateral({
      positions: [
        { tokenId, positionSize: 100n },
        { tokenId: call(assetIdx), positionSize: 100n },
      ],
      collateral0: 100n,
      collateral1: 100n,
    })
    expect(allocations[0]).toMatchObject({
      allocatedAsset: 50n,
      uncoveredAsset: 50n,
      additionalAssetRequired: 100n,
    })
    const covered = allocateCoveredCallCollateral({
      positions: [
        { tokenId, positionSize: 100n },
        { tokenId: call(assetIdx), positionSize: 100n },
      ],
      collateral0: 200n,
      collateral1: 200n,
    })
    expect(covered[0]).toMatchObject({ uncoveredAsset: 0n, additionalAssetRequired: 0n })
  },
)
