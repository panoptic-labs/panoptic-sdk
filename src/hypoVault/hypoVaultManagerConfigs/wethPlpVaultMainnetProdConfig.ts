import { MAINNET_CHAIN_ID, requireChainDeployment } from '../chainDeployments'
import type { HypoVaultManagerConfig } from './schema'

const MAINNET_DEPLOYMENT = requireChainDeployment(MAINNET_CHAIN_ID)
const MAINNET_HYPOVAULT_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.vaults
const MAINNET_HYPOVAULT_MANAGER_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.managers
const MAINNET_PANOPTIC_POOL_ADDRESSES = MAINNET_DEPLOYMENT.panoptic.pool

export const WethPlpVaultMainnetProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  vaultAssetIndex: 1n,
  manageCycleIntervalMs: 600000,
  vaultCapInUnderlying: 9_500_000_000_000_000_000n, // Fallback cap: 9.5 WETH if share-price-derived cap is unavailable
  vaultCapInShares: 9_500_000_000_000_000_000_000_000n, // Active cap target: 9.5 WETH in share-cap mode
  maxBuyingPowerUsageBps: 6600,
  chainId: MAINNET_CHAIN_ID,
  hypoVaultAddress: MAINNET_HYPOVAULT_ADDRESSES.wethPlpVault,
  addresses: {
    ethUsdc500bpsV4Collateral0: MAINNET_PANOPTIC_POOL_ADDRESSES.collateralTracker0,
    ethUsdc500bpsV4PanopticPool: MAINNET_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: MAINNET_HYPOVAULT_MANAGER_ADDRESSES.wethPlpVaultManager,
    hypoVault: MAINNET_HYPOVAULT_ADDRESSES.wethPlpVault,
    underlyingToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: MAINNET_PANOPTIC_POOL_ADDRESSES.collateralTracker0,
        allocationBps: 10000,
      },
    ],
  },
  deltaHedge: {
    deltaThresholdBps: 200n,
    maxHedgeSlots: 3,
  },
  alerts: {
    outOfRangeEnabled: true,
  },
}
