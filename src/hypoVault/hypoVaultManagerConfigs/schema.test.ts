import { describe, expect, it } from 'vitest'

import {
  BASE_CHAIN_ID,
  MAINNET_CHAIN_ID,
  requireChainDeployment,
  SEPOLIA_CHAIN_ID,
} from '../chainDeployments'
import { MainnetLegacyUSDCPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/MainnetLegacyUSDCPLPStrategistLeaves'
import { MainnetLegacyWETHPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/MainnetLegacyWETHPLPStrategistLeaves'
import { MainnetUSDCPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/MainnetUSDCPLPStrategistLeaves'
import {
  MainnetUSDCPLPLegacyVaultPoolInfos,
  MainnetUSDCPLPVaultPoolInfos,
} from '../hypoVaultManagerArtifacts/MainnetUSDCPLPVaultPoolInfos'
import { MainnetWETHPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/MainnetWETHPLPStrategistLeaves'
import {
  MainnetWETHPLPLegacyVaultPoolInfos,
  MainnetWETHPLPVaultPoolInfos,
} from '../hypoVaultManagerArtifacts/MainnetWETHPLPVaultPoolInfos'
import {
  HypoVaultManagerConfigSchema,
  UsdcPlpVaultBaseProdConfig,
  UsdcPlpVaultMainnetLegacyConfig,
  UsdcPlpVaultMainnetProdConfig,
  UsdcPlpVaultSepoliaDevConfig,
  UsdcPlpVaultSepoliaProdConfig,
  WethPlpVaultBaseProdConfig,
  WethPlpVaultMainnetLegacyConfig,
  WethPlpVaultMainnetProdConfig,
  WethPlpVaultSepoliaDevConfig,
  WethPlpVaultSepoliaProdConfig,
} from './index'

const BASE_MANUAL_TX_CONFIGS = [UsdcPlpVaultBaseProdConfig, WethPlpVaultBaseProdConfig]
const MAINNET_MANUAL_TX_CONFIGS = [
  UsdcPlpVaultMainnetProdConfig,
  UsdcPlpVaultMainnetLegacyConfig,
  WethPlpVaultMainnetProdConfig,
  WethPlpVaultMainnetLegacyConfig,
]

const SEPOLIA_MANUAL_TX_CONFIGS = [
  UsdcPlpVaultSepoliaDevConfig,
  UsdcPlpVaultSepoliaProdConfig,
  WethPlpVaultSepoliaDevConfig,
  WethPlpVaultSepoliaProdConfig,
]

describe('HypoVaultManagerConfigSchema manualTxDefaults', () => {
  it('accepts manual collateral allocation defaults', () => {
    const parsed = HypoVaultManagerConfigSchema.parse(UsdcPlpVaultSepoliaDevConfig)
    const allocations = parsed.manualTxDefaults?.collateralAllocations ?? []
    expect(allocations.length).toBeGreaterThan(0)
    expect(allocations.reduce((sum, allocation) => sum + allocation.allocationBps, 0)).toBe(10000)
  })

  it('keeps Base configs at 100% default allocation', () => {
    for (const config of BASE_MANUAL_TX_CONFIGS) {
      const parsed = HypoVaultManagerConfigSchema.parse(config)
      const allocations = parsed.manualTxDefaults?.collateralAllocations ?? []
      expect(allocations.length).toBe(1)
      expect(allocations[0]?.allocationBps).toBe(10000)
      expect(allocations[0]?.trackerAddress.startsWith('0x')).toBe(true)
    }
  })

  it('keeps Sepolia configs at 100% default allocation', () => {
    for (const config of SEPOLIA_MANUAL_TX_CONFIGS) {
      const parsed = HypoVaultManagerConfigSchema.parse(config)
      const allocations = parsed.manualTxDefaults?.collateralAllocations ?? []
      expect(allocations.length).toBe(1)
      expect(allocations[0]?.allocationBps).toBe(10000)
      expect(allocations[0]?.trackerAddress.startsWith('0x')).toBe(true)
    }
  })

  it('keeps Mainnet configs at 100% default allocation', () => {
    for (const config of MAINNET_MANUAL_TX_CONFIGS) {
      const parsed = HypoVaultManagerConfigSchema.parse(config)
      const allocations = parsed.manualTxDefaults?.collateralAllocations ?? []
      expect(allocations.length).toBe(1)
      expect(allocations[0]?.allocationBps).toBe(10000)
      expect(allocations[0]?.trackerAddress.startsWith('0x')).toBe(true)
    }
  })

  it('sources key manager config addresses from chain deployment registry', () => {
    const baseDeployment = requireChainDeployment(BASE_CHAIN_ID)
    const deployment = requireChainDeployment(SEPOLIA_CHAIN_ID)
    const parsed = HypoVaultManagerConfigSchema.parse(UsdcPlpVaultSepoliaProdConfig)
    const baseParsed = HypoVaultManagerConfigSchema.parse(UsdcPlpVaultBaseProdConfig)
    const addresses = parsed.addresses
    const baseAddresses = baseParsed.addresses

    expect(addresses).toBeDefined()
    if (addresses === undefined) {
      throw new Error('Expected parsed addresses to be defined')
    }
    if (baseAddresses === undefined) {
      throw new Error('Expected base parsed addresses to be defined')
    }

    expect(parsed.hypoVaultAddress).toBe(deployment.hypovault.vaults.usdcPlpVault)
    expect(addresses.hypoVaultManagerWithMerkleVerification).toBe(
      deployment.hypovault.managers.usdcPlpVaultManager,
    )
    expect(addresses.ethUsdc500bpsV4PanopticPool).toBe(deployment.panoptic.pool.panopticPool)
    expect(baseParsed.hypoVaultAddress).toBe(baseDeployment.hypovault.vaults.usdcPlpVault)
    expect(baseAddresses.hypoVaultManagerWithMerkleVerification).toBe(
      baseDeployment.hypovault.managers.usdcPlpVaultManager,
    )
    expect(baseAddresses.ethUsdc500bpsV4PanopticPool).toBe(
      baseDeployment.panoptic.pool.panopticPool,
    )
  })

  it('resolves Ethereum mainnet prod configs to the new vault and pool artifacts', () => {
    const deployment = requireChainDeployment(MAINNET_CHAIN_ID)

    expect(WethPlpVaultMainnetProdConfig.artifactSet).toBe('mainnet-prod')
    expect(UsdcPlpVaultMainnetProdConfig.artifactSet).toBe('mainnet-prod')
    expect(WethPlpVaultMainnetProdConfig.hypoVaultAddress).toBe(
      '0xd4e2c720a760049cc4151bcf61e3a9348db9cd92',
    )
    expect(UsdcPlpVaultMainnetProdConfig.hypoVaultAddress).toBe(
      '0x236d0558f06cd60780b232d4Ec4c92d2cb7e4D18',
    )
    expect(WethPlpVaultMainnetProdConfig.addresses?.hypoVaultManagerWithMerkleVerification).toBe(
      '0xB6Fc48e658C9B1a7dbdFA51A5E153ab60BB2e04d',
    )
    expect(UsdcPlpVaultMainnetProdConfig.addresses?.hypoVaultManagerWithMerkleVerification).toBe(
      '0x2ce65016366ef7320078e0758D58Cf1038bc7C4e',
    )
    expect(WethPlpVaultMainnetProdConfig.addresses?.ethUsdc500bpsV4PanopticPool).toBe(
      '0x00000000563b70d704f4c6675a5f6ac989fbae13',
    )
    expect(WethPlpVaultMainnetProdConfig.addresses?.ethUsdc500bpsV4Collateral0).toBe(
      '0x1e46b0289B7E0F710E2Db8Ab87800dd782D624f7',
    )
    expect(UsdcPlpVaultMainnetProdConfig.addresses?.ethUsdc500bpsV4Collateral1).toBe(
      '0x12bF31955522BAC337D93e1bC0a39F68D8BDa216',
    )
    expect(MainnetWETHPLPStrategistLeaves.metadata.ManageRoot).toBe(
      '0x14c4c96cc3730452ce71a447bdde6132f81acec862098a9ddd5e086805046a07',
    )
    expect(MainnetUSDCPLPStrategistLeaves.metadata.ManageRoot).toBe(
      '0xed7d4ae055fd62c6edc93bd676456748f52fe4f4b78f60ab3ef6394bacc31b5d',
    )
    expect(MainnetWETHPLPVaultPoolInfos.vaultAddress).toBe(deployment.hypovault.vaults.wethPlpVault)
    expect(MainnetUSDCPLPVaultPoolInfos.vaultAddress).toBe(deployment.hypovault.vaults.usdcPlpVault)
    expect(MainnetWETHPLPVaultPoolInfos.poolInfos[0]?.pool).toBe(
      deployment.panoptic.pool.panopticPool,
    )
    expect(MainnetUSDCPLPVaultPoolInfos.poolInfos[0]?.pool).toBe(
      deployment.panoptic.pool.panopticPool,
    )
    expect(MainnetUSDCPLPVaultPoolInfos.poolInfos[1]?.pool).toBe(
      '0x0f34e6fCda264349Db10d445BD95f529cbe88090',
    )
  })

  it('resolves Ethereum mainnet legacy configs to beta vault and pool artifacts', () => {
    expect(WethPlpVaultMainnetLegacyConfig.artifactSet).toBe('mainnet-legacy')
    expect(UsdcPlpVaultMainnetLegacyConfig.artifactSet).toBe('mainnet-legacy')
    expect(WethPlpVaultMainnetLegacyConfig.hypoVaultAddress).toBe(
      '0x779a2aa634A004b3a3f3b322083744869BBC6D66',
    )
    expect(UsdcPlpVaultMainnetLegacyConfig.hypoVaultAddress).toBe(
      '0x963Fe9c93bc353602656ee4051A75114bA74d6c5',
    )
    expect(WethPlpVaultMainnetLegacyConfig.addresses?.hypoVaultManagerWithMerkleVerification).toBe(
      '0xcc80f113298DdF9D399323D5288aE5Eeaed20D44',
    )
    expect(UsdcPlpVaultMainnetLegacyConfig.addresses?.hypoVaultManagerWithMerkleVerification).toBe(
      '0xf42EED8F0d3326ad59fc1f5d4c4009B5F6B4D87c',
    )
    expect(WethPlpVaultMainnetLegacyConfig.addresses?.ethUsdc500bpsV4PanopticPool).toBe(
      '0x000000007588B488d180899cDEa2080a886D2441',
    )
    expect(WethPlpVaultMainnetLegacyConfig.addresses?.ethUsdc500bpsV4Collateral0).toBe(
      '0x6cd0186Fb4c32B6fD23279bBE0022506958216f9',
    )
    expect(UsdcPlpVaultMainnetLegacyConfig.addresses?.ethUsdc500bpsV4Collateral1).toBe(
      '0x6778d652A0BCe658C9a0E27D506eA20D179140e5',
    )
    expect(MainnetLegacyWETHPLPStrategistLeaves.metadata.ManageRoot).toBe(
      '0xcb3f5429a543b40755e0b93c8d0bd9741a8ebe81c7ee537a03fc8a842c10592f',
    )
    expect(MainnetLegacyUSDCPLPStrategistLeaves.metadata.ManageRoot).toBe(
      '0xe4daaf6390188a7f4d786ef65148e555eb95f9b92a6e08990487519916135cd9',
    )
    expect(MainnetWETHPLPLegacyVaultPoolInfos.vaultAddress).toBe(
      '0x779a2aa634A004b3a3f3b322083744869BBC6D66',
    )
    expect(MainnetUSDCPLPLegacyVaultPoolInfos.vaultAddress).toBe(
      '0x963Fe9c93bc353602656ee4051A75114bA74d6c5',
    )
    expect(MainnetWETHPLPLegacyVaultPoolInfos.poolInfos[0]?.pool).toBe(
      '0x000000007588B488d180899cDEa2080a886D2441',
    )
    expect(MainnetUSDCPLPLegacyVaultPoolInfos.poolInfos[0]?.pool).toBe(
      '0x000000007588B488d180899cDEa2080a886D2441',
    )
  })
})
