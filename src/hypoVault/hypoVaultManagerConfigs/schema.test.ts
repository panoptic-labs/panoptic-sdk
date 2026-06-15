import { describe, expect, it } from 'vitest'

import { BASE_CHAIN_ID, requireChainDeployment, SEPOLIA_CHAIN_ID } from '../chainDeployments'
import {
  HypoVaultManagerConfigSchema,
  UsdcPlpVaultBaseProdConfig,
  UsdcPlpVaultSepoliaDevConfig,
  UsdcPlpVaultSepoliaProdConfig,
  WethPlpVaultBaseProdConfig,
  WethPlpVaultSepoliaDevConfig,
  WethPlpVaultSepoliaProdConfig,
} from './index'

const BASE_MANUAL_TX_CONFIGS = [UsdcPlpVaultBaseProdConfig, WethPlpVaultBaseProdConfig]

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
})
