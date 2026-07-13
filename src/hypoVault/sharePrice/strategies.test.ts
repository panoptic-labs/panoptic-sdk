import { describe, expect, it, vi } from 'vitest'

import { getVaultApyStrategy, setVaultApyStrategyOverride } from './strategies'

vi.mock('../chainDeployments', () => ({
  MAINNET_CHAIN_ID: 1,
  BASE_CHAIN_ID: 8453,
  SEPOLIA_CHAIN_ID: 11155111,
  requireChainDeployment: vi.fn(() => ({
    hypovault: {
      vaults: {
        wethPlpVault: '0x0000000000000000000000000000000000000b02',
      },
    },
  })),
}))

vi.mock('../hypoVaultManagerConfigs/vaultToConfig', () => ({
  getHypoVaultConfigForVault: vi.fn(() => null),
}))

vi.mock('../utils/buildManagerInputAtBlock', () => ({
  buildManagerInputAtBlock: vi.fn(async () => '0x1234'),
}))

vi.mock('../utils/vaultManagerInput', () => ({
  getVaultPoolInfos: vi.fn(() => [
    {
      maxPriceDeviation: 100,
      pool: '0x00000000000000000000000000000000000000aa',
      token0: '0x00000000000000000000000000000000000000bb',
      token1: '0x00000000000000000000000000000000000000cc',
    },
  ]),
  resolveVaultTokenIdsByPool: vi.fn(async () => [[]]),
  resolveVaultHistoricalCandidatesByPool: vi.fn(async () => []),
  verifyVaultOpenTokenIdsAtBlock: vi.fn(async () => [[]]),
}))

vi.mock('../hypoVaultManagerArtifacts/BaseUSDCPLPVaultPoolInfos', () => ({
  BaseUSDCPLPVaultPoolInfos: {
    vaultAddress: '0x0000000000000000000000000000000000000b01',
  },
}))
vi.mock('../hypoVaultManagerArtifacts/BaseWETHPLPVaultPoolInfos', () => ({
  BaseWETHPLPVaultPoolInfos: {
    vaultAddress: '0x0000000000000000000000000000000000000b02',
  },
}))
vi.mock('../hypoVaultManagerArtifacts/MainnetUSDCPLPVaultPoolInfos', () => ({
  MainnetUSDCPLPVaultPoolInfos: {
    vaultAddress: '0x0000000000000000000000000000000000000101',
  },
}))
vi.mock('../hypoVaultManagerArtifacts/MainnetWETHPLPVaultPoolInfos', () => ({
  MainnetWETHPLPVaultPoolInfos: {
    vaultAddress: '0x0000000000000000000000000000000000000102',
  },
}))
vi.mock('../hypoVaultManagerArtifacts/SepoliaUSDCPLPVaultPoolInfos', () => ({
  SepoliaUSDCPLPVaultPoolInfos: {
    vaultAddress: '0x91760623ce2BBE50001e18F0973Ffe37c0C6b948',
  },
}))
vi.mock('../hypoVaultManagerArtifacts/SepoliaWETHPLPVaultPoolInfos', () => ({
  SepoliaWETHPLPVaultPoolInfos: {
    vaultAddress: '0x69a3Dd63BCB02E89a70630294EDCe0e78377B876',
  },
}))

describe('getVaultApyStrategy', () => {
  it('returns default strategy when no override exists', async () => {
    const strategy = getVaultApyStrategy({
      chainId: 11155111,
      vaultAddress: '0x0000000000000000000000000000000000000001',
    })

    expect(strategy.enabledMetrics).toEqual(['nav'])
    await expect(
      strategy.managerInputProvider({
        chainId: 11155111,
        vault: {
          id: '0x0000000000000000000000000000000000000001',
        } as never,
        client: {} as never,
        blockNumber: 1n,
      }),
    ).resolves.toBe('0x')
  })

  it('returns vault-specific override strategy when present', () => {
    const overrideAddress = '0x0000000000000000000000000000000000000002'

    setVaultApyStrategyOverride({
      chainId: 11155111,
      vaultAddress: overrideAddress,
      strategy: {
        enabledMetrics: ['nav', 'premium'],
        managerInputProvider: async () => '0x1234',
      },
    })

    const strategy = getVaultApyStrategy({
      chainId: 11155111,
      vaultAddress: overrideAddress,
    })

    expect(strategy.enabledMetrics).toEqual(['nav', 'premium'])
  })

  it('returns encoded managerInput for configured PLP vault strategies', async () => {
    const strategy = getVaultApyStrategy({
      chainId: 11155111,
      vaultAddress: '0x91760623ce2BBE50001e18F0973Ffe37c0C6b948',
    })

    await expect(
      strategy.managerInputProvider({
        chainId: 11155111,
        vault: {
          id: '0x91760623ce2BBE50001e18F0973Ffe37c0C6b948',
          underlyingToken: {
            id: '0x00000000000000000000000000000000000000cc',
          },
        } as never,
        client: {} as never,
        blockNumber: 10_268_542n,
      }),
    ).resolves.toMatchObject({
      managerInput: '0x1234',
    })
  })

  it('returns encoded managerInput for configured Base PLP vault strategies', async () => {
    const strategy = getVaultApyStrategy({
      chainId: 8453,
      vaultAddress: '0x0000000000000000000000000000000000000b01',
    })

    await expect(
      strategy.managerInputProvider({
        chainId: 8453,
        vault: {
          id: '0x0000000000000000000000000000000000000b01',
          underlyingToken: {
            id: '0x00000000000000000000000000000000000000bc',
          },
        } as never,
        client: {} as never,
        blockNumber: 10_268_542n,
      }),
    ).resolves.toMatchObject({
      managerInput: '0x1234',
    })
  })

  it('returns default strategy for non-PLP vault addresses', async () => {
    const strategy = getVaultApyStrategy({
      chainId: 11155111,
      vaultAddress: '0x696fD6Eda3D0e95c2AF71c2ACa41151d50a887c0',
    })

    await expect(
      strategy.managerInputProvider({
        chainId: 11155111,
        vault: {
          id: '0x696fD6Eda3D0e95c2AF71c2ACa41151d50a887c0',
          underlyingToken: {
            id: '0x00000000000000000000000000000000000000cc',
          },
        } as never,
        client: {} as never,
        blockNumber: 10_268_542n,
      }),
    ).resolves.toBe('0x')
  })
})
