import { describe, expect, it } from 'vitest'

import { MAINNET_CHAIN_ID, requireChainDeployment } from './chainDeployments'
import {
  getMainnetVaultManagerRootAtBlock,
  getMainnetVaultManagerRootHistory,
  getMainnetVaultPoolConfigurationAtBlock,
  getMainnetVaultPoolConfigurationHistory,
} from './mainnetVaultPoolHistory'

const deployment = requireChainDeployment(MAINNET_CHAIN_ID)
const wethVault = deployment.hypovault.vaults.wethPlpVault
const usdcVault = deployment.hypovault.vaults.usdcPlpVault

describe('mainnet vault pool history', () => {
  it('records every accountant configuration observed since vault inception', () => {
    const wethHistory = getMainnetVaultPoolConfigurationHistory({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: wethVault,
    })
    const usdcHistory = getMainnetVaultPoolConfigurationHistory({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: usdcVault,
    })

    expect(wethHistory?.map((entry) => entry.activationBlockNumber)).toEqual([
      25_296_753n,
      25_704_951n,
    ])
    expect(wethHistory?.map((entry) => entry.poolHash)).toEqual([
      '0x10c87ff39e0bfadaa7b8ef86391b0578b66cec8b93e4bf5157c9ab7cc8db578b',
      '0x9d6a4835d0acf5b962185bc9ae5c82d8b3f0424945aa13e86d9766549011ca1f',
    ])

    expect(usdcHistory?.map((entry) => entry.activationBlockNumber)).toEqual([
      25_296_798n,
      25_332_015n,
      25_332_931n,
      25_704_951n,
    ])
    expect(usdcHistory?.map((entry) => entry.poolHash)).toEqual([
      '0x10c87ff39e0bfadaa7b8ef86391b0578b66cec8b93e4bf5157c9ab7cc8db578b',
      '0x5f73f0cbb502600f6ef832e5e4d01111da93133f0124b51e81f037eb1f8f0966',
      '0x32148c1d3efa7ecf95c9b76cdaef4497a14a756deca81cfa2adfe4f6f30a9889',
      '0x34f9775b7712b73ed2f82344ae1e727f3d217c5df69fd9cfd230796731de62c9',
    ])
  })

  it('switches atomically at every USDC accountant update block', () => {
    const cases = [
      {
        blockNumber: 25_296_798n,
        precedingActivationBlockNumber: null,
        pools: 1,
        secondPoolDeviation: null,
      },
      {
        blockNumber: 25_332_015n,
        precedingActivationBlockNumber: 25_296_798n,
        pools: 2,
        secondPoolDeviation: 100,
      },
      {
        blockNumber: 25_332_931n,
        precedingActivationBlockNumber: 25_332_015n,
        pools: 2,
        secondPoolDeviation: 10_000,
      },
      {
        blockNumber: 25_704_951n,
        precedingActivationBlockNumber: 25_332_931n,
        pools: 3,
        secondPoolDeviation: 10_000,
      },
    ] as const

    for (const expected of cases) {
      const atBoundary = getMainnetVaultPoolConfigurationAtBlock({
        chainId: MAINNET_CHAIN_ID,
        vaultAddress: usdcVault,
        blockNumber: expected.blockNumber,
      })
      expect(atBoundary?.activationBlockNumber).toBe(expected.blockNumber)
      expect(atBoundary?.poolInfos).toHaveLength(expected.pools)
      expect(atBoundary?.poolInfos[1]?.maxPriceDeviation ?? null).toBe(expected.secondPoolDeviation)

      const beforeBoundary = getMainnetVaultPoolConfigurationAtBlock({
        chainId: MAINNET_CHAIN_ID,
        vaultAddress: usdcVault,
        blockNumber: expected.blockNumber - 1n,
      })
      expect(beforeBoundary?.activationBlockNumber ?? null).toBe(
        expected.precedingActivationBlockNumber,
      )
    }
  })

  it('returns no configuration before the accountant was initialized', () => {
    expect(
      getMainnetVaultPoolConfigurationAtBlock({
        chainId: MAINNET_CHAIN_ID,
        vaultAddress: wethVault,
        blockNumber: 25_296_752n,
      }),
    ).toBeNull()
    expect(
      getMainnetVaultPoolConfigurationAtBlock({
        chainId: MAINNET_CHAIN_ID,
        vaultAddress: usdcVault,
        blockNumber: 25_296_797n,
      }),
    ).toBeNull()
  })

  it('records every manager root transition independently of accountant changes', () => {
    const wethHistory = getMainnetVaultManagerRootHistory({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: wethVault,
    })
    const usdcHistory = getMainnetVaultManagerRootHistory({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: usdcVault,
    })

    expect(wethHistory?.map((entry) => entry.activationBlockNumber)).toEqual([
      25_296_743n,
      25_303_785n,
      25_704_951n,
    ])
    expect(usdcHistory?.map((entry) => entry.activationBlockNumber)).toEqual([
      25_296_786n,
      25_303_784n,
      25_332_022n,
      25_704_951n,
    ])

    const rootBetweenChanges = getMainnetVaultManagerRootAtBlock({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: usdcVault,
      blockNumber: 25_332_020n,
    })
    expect(rootBetweenChanges?.manageRoot).toBe(
      '0x215542d18c9cf442c62bc3a06dbe8d8d9bc893e5d97e70b675e5c8b1721c6e29',
    )
  })

  it('returns defensive copies of history and point-in-time lookups', () => {
    const history = getMainnetVaultPoolConfigurationHistory({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: usdcVault,
    })
    const configuration = history?.[0]
    const poolInfo = configuration?.poolInfos[0]
    if (history === null || configuration === undefined || poolInfo === undefined) {
      throw new Error('Expected USDC pool history')
    }
    const originalMaxPriceDeviation = poolInfo.maxPriceDeviation

    Reflect.set(poolInfo, 'maxPriceDeviation', -1)
    Reflect.apply(Array.prototype.pop, history, [])

    const freshHistory = getMainnetVaultPoolConfigurationHistory({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: usdcVault,
    })
    expect(freshHistory).toHaveLength(4)
    expect(freshHistory?.[0]?.poolInfos[0]?.maxPriceDeviation).toBe(originalMaxPriceDeviation)

    const atBlock = getMainnetVaultPoolConfigurationAtBlock({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: usdcVault,
      blockNumber: 25_296_798n,
    })
    if (atBlock?.poolInfos[0] === undefined) {
      throw new Error('Expected USDC pool configuration')
    }
    Reflect.set(atBlock.poolInfos[0], 'maxPriceDeviation', -1)

    expect(
      getMainnetVaultPoolConfigurationAtBlock({
        chainId: MAINNET_CHAIN_ID,
        vaultAddress: usdcVault,
        blockNumber: 25_296_798n,
      })?.poolInfos[0]?.maxPriceDeviation,
    ).toBe(originalMaxPriceDeviation)
  })

  it('ignores non-mainnet chains and unknown vaults', () => {
    expect(
      getMainnetVaultPoolConfigurationHistory({ chainId: 8453, vaultAddress: wethVault }),
    ).toBeNull()
    expect(
      getMainnetVaultManagerRootHistory({
        chainId: MAINNET_CHAIN_ID,
        vaultAddress: '0x0000000000000000000000000000000000000001',
      }),
    ).toBeNull()
  })
})
