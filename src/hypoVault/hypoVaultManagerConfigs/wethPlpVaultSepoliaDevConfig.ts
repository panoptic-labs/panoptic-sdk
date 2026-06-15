import { requireChainDeployment, SEPOLIA_CHAIN_ID } from '../chainDeployments'
import type { HypoVaultManagerConfig } from './schema'

const SEPOLIA_DEPLOYMENT = requireChainDeployment(SEPOLIA_CHAIN_ID)
const SEPOLIA_HYPOVAULT_ADDRESSES = SEPOLIA_DEPLOYMENT.hypovault.vaults
const SEPOLIA_HYPOVAULT_MANAGER_ADDRESSES = SEPOLIA_DEPLOYMENT.hypovault.managers
const SEPOLIA_PANOPTIC_POOL_ADDRESSES = SEPOLIA_DEPLOYMENT.panoptic.pool

export const WethPlpVaultSepoliaDevConfig: HypoVaultManagerConfig = {
  deployment: 'dev',
  vaultAssetIndex: 1n,
  manageCycleIntervalMs: 600000,
  vaultCapInUnderlying: 1_000_000_000_000_000_000n, // 1 WETH
  maxBuyingPowerUsageBps: 6600,
  chainId: SEPOLIA_CHAIN_ID,
  hypoVaultAddress: SEPOLIA_HYPOVAULT_ADDRESSES.wethPlpVault,
  addresses: {
    ethUsdc500bpsV4Collateral0: SEPOLIA_PANOPTIC_POOL_ADDRESSES.collateralTracker0,
    ethUsdc500bpsV4PanopticPool: SEPOLIA_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: SEPOLIA_HYPOVAULT_MANAGER_ADDRESSES.wethPlpVaultManager,
    hypoVault: SEPOLIA_HYPOVAULT_ADDRESSES.wethPlpVault,
    underlyingToken: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: SEPOLIA_PANOPTIC_POOL_ADDRESSES.collateralTracker0,
        allocationBps: 10000,
      },
    ],
  },
  deltaHedge: {
    maxHedgeSlots: 12,
  },
}
