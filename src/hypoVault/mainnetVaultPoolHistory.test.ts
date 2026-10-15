import { describe, expect, it } from 'vitest'

import { MAINNET_CHAIN_ID, requireChainDeployment, ROBINHOOD_CHAIN_ID } from './chainDeployments'
import {
  getMainnetVaultManagerRootAtBlock,
  getMainnetVaultManagerRootHistory,
  getMainnetVaultPoolConfigurationAtBlock,
  getMainnetVaultPoolConfigurationHistory,
  MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK,
  MAINNET_REPLACEMENT_POOL_ACTIVATION_TRANSACTION,
  ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_BLOCK,
  ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_TRANSACTION,
  ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_BLOCK,
  ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_TRANSACTION,
} from './mainnetVaultPoolHistory'

const deployment = requireChainDeployment(MAINNET_CHAIN_ID)
const wethVault = deployment.hypovault.vaults.wethPlpVault
const usdcVault = deployment.hypovault.vaults.usdcPlpVault
const robinhoodDeployment = requireChainDeployment(ROBINHOOD_CHAIN_ID)
const robinhoodUsdgVault = robinhoodDeployment.hypovault.vaults.usdgPlpVault

if (robinhoodUsdgVault === undefined) {
  throw new Error('Missing Robinhood USDG PLP vault')
}

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
      25_898_997n,
      MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK,
    ])
    expect(wethHistory?.map((entry) => entry.poolHash)).toEqual([
      '0x10c87ff39e0bfadaa7b8ef86391b0578b66cec8b93e4bf5157c9ab7cc8db578b',
      '0x9d6a4835d0acf5b962185bc9ae5c82d8b3f0424945aa13e86d9766549011ca1f',
      '0x450c55809afb4950087cf439f3ee4c9ec6f13478568c0a7c9e919418b379b975',
      '0xc5b8b076033dff0e5786627eb33b9a857e1e907ecce721de286e45408e7c411c',
    ])

    expect(usdcHistory?.map((entry) => entry.activationBlockNumber)).toEqual([
      25_296_798n,
      25_332_015n,
      25_332_931n,
      25_704_951n,
      25_898_997n,
      MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK,
    ])
    expect(usdcHistory?.map((entry) => entry.poolHash)).toEqual([
      '0x10c87ff39e0bfadaa7b8ef86391b0578b66cec8b93e4bf5157c9ab7cc8db578b',
      '0x5f73f0cbb502600f6ef832e5e4d01111da93133f0124b51e81f037eb1f8f0966',
      '0x32148c1d3efa7ecf95c9b76cdaef4497a14a756deca81cfa2adfe4f6f30a9889',
      '0x34f9775b7712b73ed2f82344ae1e727f3d217c5df69fd9cfd230796731de62c9',
      '0x450c55809afb4950087cf439f3ee4c9ec6f13478568c0a7c9e919418b379b975',
      '0xc5b8b076033dff0e5786627eb33b9a857e1e907ecce721de286e45408e7c411c',
    ])

    expect(wethHistory?.at(-1)?.transactionHash).toBe(
      MAINNET_REPLACEMENT_POOL_ACTIVATION_TRANSACTION,
    )
    expect(usdcHistory?.at(-1)?.transactionHash).toBe(
      MAINNET_REPLACEMENT_POOL_ACTIVATION_TRANSACTION,
    )
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
      {
        blockNumber: 25_898_997n,
        precedingActivationBlockNumber: 25_704_951n,
        pools: 1,
        secondPoolDeviation: null,
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

  it.each([wethVault, usdcVault])(
    'switches Ethereum pool at the execution boundary for %s',
    (vaultAddress) => {
      const before = getMainnetVaultPoolConfigurationAtBlock({
        chainId: MAINNET_CHAIN_ID,
        vaultAddress,
        blockNumber: MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK - 1n,
      })
      const after = getMainnetVaultPoolConfigurationAtBlock({
        chainId: MAINNET_CHAIN_ID,
        vaultAddress,
        blockNumber: MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK,
      })
      expect(before?.poolInfos[0]?.pool.toLowerCase()).toBe(
        '0x00000000009c7b687e833559e34503f64d7ed7c4',
      )
      expect(after?.poolInfos[0]?.pool.toLowerCase()).toBe(
        '0x00000000000e98f6c5ae16835badf2f7cc0d49d7',
      )
      expect(after?.transactionHash).toBe(MAINNET_REPLACEMENT_POOL_ACTIVATION_TRANSACTION)
      expect(
        getMainnetVaultManagerRootAtBlock({
          chainId: MAINNET_CHAIN_ID,
          vaultAddress,
          blockNumber: MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK,
        })?.activationBlockNumber,
      ).toBe(MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK)
    },
  )

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

  it('switches the Robinhood vault history atomically to the 5bps pool', () => {
    const history = getMainnetVaultPoolConfigurationHistory({
      chainId: ROBINHOOD_CHAIN_ID,
      vaultAddress: robinhoodUsdgVault,
    })
    expect(history?.map((entry) => entry.activationBlockNumber)).toEqual([
      63_972_776n,
      ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_BLOCK,
      ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_BLOCK,
    ])
    expect(history?.[1]?.transactionHash).toBe(ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_TRANSACTION)

    const before = getMainnetVaultPoolConfigurationAtBlock({
      chainId: ROBINHOOD_CHAIN_ID,
      vaultAddress: robinhoodUsdgVault,
      blockNumber: ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_BLOCK - 1n,
    })
    const after = getMainnetVaultPoolConfigurationAtBlock({
      chainId: ROBINHOOD_CHAIN_ID,
      vaultAddress: robinhoodUsdgVault,
      blockNumber: ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_BLOCK,
    })
    expect(before?.poolInfos[0]?.pool.toLowerCase()).toBe(
      '0x00000000989bcb6f24af4a1ab2a6d6a31c98a58e',
    )
    expect(after?.poolInfos[0]?.pool.toLowerCase()).toBe(
      '0x000000000c21b38c54aca7c7145df01ff09d69bb',
    )
  })

  it('switches Robinhood pool and manager root at the confirmed replacement block', () => {
    const before = getMainnetVaultPoolConfigurationAtBlock({
      chainId: ROBINHOOD_CHAIN_ID,
      vaultAddress: robinhoodUsdgVault,
      blockNumber: ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_BLOCK - 1n,
    })
    const after = getMainnetVaultPoolConfigurationAtBlock({
      chainId: ROBINHOOD_CHAIN_ID,
      vaultAddress: robinhoodUsdgVault,
      blockNumber: ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_BLOCK,
    })
    expect(before?.poolInfos[0]?.pool.toLowerCase()).toBe(
      '0x000000000c21b38c54aca7c7145df01ff09d69bb',
    )
    expect(after?.poolInfos[0]?.pool.toLowerCase()).toBe(
      '0x000000000056475506823b2bedbd89f55232da40',
    )
    expect(after?.transactionHash).toBe(ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_TRANSACTION)
    expect(
      getMainnetVaultManagerRootAtBlock({
        chainId: ROBINHOOD_CHAIN_ID,
        vaultAddress: robinhoodUsdgVault,
        blockNumber: ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_BLOCK - 1n,
      })?.manageRoot,
    ).toBe('0x47b10d0b354a9c6f42e22ad86cda6a7f94a09328092dc1a8a974c89dc126635a')
    expect(
      getMainnetVaultManagerRootAtBlock({
        chainId: ROBINHOOD_CHAIN_ID,
        vaultAddress: robinhoodUsdgVault,
        blockNumber: ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_BLOCK,
      })?.manageRoot,
    ).toBe('0x18a0e35a8f382475cafc92af9d6f627302c7fa4551826e595322bb2c507029e5')
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
    const robinhoodHistory = getMainnetVaultManagerRootHistory({
      chainId: ROBINHOOD_CHAIN_ID,
      vaultAddress: robinhoodUsdgVault,
    })

    expect(wethHistory?.map((entry) => entry.activationBlockNumber)).toEqual([
      25_296_743n,
      25_303_785n,
      25_704_951n,
      25_898_997n,
      MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK,
    ])
    expect(usdcHistory?.map((entry) => entry.activationBlockNumber)).toEqual([
      25_296_786n,
      25_303_784n,
      25_332_022n,
      25_704_951n,
      25_898_997n,
      MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK,
    ])
    expect(robinhoodHistory?.map((entry) => entry.activationBlockNumber)).toEqual([
      63_972_776n,
      ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_BLOCK,
      ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_BLOCK,
    ])

    expect(wethHistory?.at(-1)).toEqual({
      activationBlockNumber: MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK,
      transactionHash: MAINNET_REPLACEMENT_POOL_ACTIVATION_TRANSACTION,
      manageRoot: '0x4d6b2f97937939f378ff26d99d85ccaeeef73f33e495946d3ba0fb17ae624da3',
    })
    expect(usdcHistory?.at(-1)).toEqual({
      activationBlockNumber: MAINNET_REPLACEMENT_POOL_ACTIVATION_BLOCK,
      transactionHash: MAINNET_REPLACEMENT_POOL_ACTIVATION_TRANSACTION,
      manageRoot: '0x035589e259ab734a0083fdd20a5930f9f1a6daf547b69d0b0a1fe40a2043662d',
    })

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
    expect(freshHistory).toHaveLength(6)
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

  it('records the Robinhood USDG vault atomic authorization deployment', () => {
    const poolHistory = getMainnetVaultPoolConfigurationHistory({
      chainId: ROBINHOOD_CHAIN_ID,
      vaultAddress: robinhoodUsdgVault,
    })
    const rootHistory = getMainnetVaultManagerRootHistory({
      chainId: ROBINHOOD_CHAIN_ID,
      vaultAddress: robinhoodUsdgVault,
    })

    expect(poolHistory).toHaveLength(3)
    expect(poolHistory?.[0]).toMatchObject({
      activationBlockNumber: 63_972_776n,
      transactionHash: '0x738c8a6d30a45f9b71d2d6260aa1c04aff558489631b3a9c6ccd5f49e0f57df4',
    })
    expect(poolHistory?.[0]?.poolInfos).toEqual([
      {
        pool: '0x00000000989bcb6f24af4a1Ab2A6d6a31c98A58E',
        token0: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
        token1: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
        maxPriceDeviation: 100,
        positionScanFromBlock: 62_901_925n,
      },
    ])
    expect(poolHistory?.[1]).toMatchObject({
      activationBlockNumber: ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_BLOCK,
      transactionHash: ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_TRANSACTION,
    })
    expect(poolHistory?.[1]?.poolInfos[0]?.pool.toLowerCase()).toBe(
      '0x000000000c21b38c54aca7c7145df01ff09d69bb',
    )
    expect(rootHistory).toEqual([
      {
        activationBlockNumber: 63_972_776n,
        transactionHash: '0x738c8a6d30a45f9b71d2d6260aa1c04aff558489631b3a9c6ccd5f49e0f57df4',
        manageRoot: '0x5ef821042a85fea05901e4612e8a8d60efd2468ca08f0810d5691e23ea98967f',
      },
      {
        activationBlockNumber: ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_BLOCK,
        transactionHash: ROBINHOOD_SPY_USDG_5BPS_ACTIVATION_TRANSACTION,
        manageRoot: '0x47b10d0b354a9c6f42e22ad86cda6a7f94a09328092dc1a8a974c89dc126635a',
      },
      {
        activationBlockNumber: ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_BLOCK,
        transactionHash: ROBINHOOD_REPLACEMENT_POOL_ACTIVATION_TRANSACTION,
        manageRoot: '0x18a0e35a8f382475cafc92af9d6f627302c7fa4551826e595322bb2c507029e5',
      },
    ])
    expect(
      getMainnetVaultPoolConfigurationAtBlock({
        chainId: ROBINHOOD_CHAIN_ID,
        vaultAddress: robinhoodUsdgVault,
        blockNumber: 63_972_775n,
      }),
    ).toBeNull()
    expect(
      getMainnetVaultPoolConfigurationAtBlock({
        chainId: ROBINHOOD_CHAIN_ID,
        vaultAddress: robinhoodUsdgVault,
        blockNumber: 63_972_776n,
      })?.activationBlockNumber,
    ).toBe(63_972_776n)
  })

  it('ignores unsupported chains and unknown vaults', () => {
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
