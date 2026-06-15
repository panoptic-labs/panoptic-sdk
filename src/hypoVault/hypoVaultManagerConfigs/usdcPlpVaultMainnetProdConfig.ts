import { getEthUsdcMarket, MAINNET_CHAIN_ID, requireChainDeployment } from '../chainDeployments'
import type { HypoVaultManagerConfig } from './schema'

const MAINNET_DEPLOYMENT = requireChainDeployment(MAINNET_CHAIN_ID)
const MAINNET_ETH_USDC_MARKET = getEthUsdcMarket(MAINNET_DEPLOYMENT)
const MAINNET_HYPOVAULT_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.vaults
const MAINNET_HYPOVAULT_MANAGER_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.managers
const MAINNET_PANOPTIC_POOL_ADDRESSES = MAINNET_DEPLOYMENT.panoptic.pool

export const UsdcPlpVaultMainnetProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  vaultAssetIndex: 0n,
  manageCycleIntervalMs: 600000,
  vaultCapInUnderlying: 19_500_000_000n, // Fallback cap: 19,500 USDC if share-price-derived cap is unavailable
  vaultCapInShares: 19_500_000_000_000_000n, // Active cap target: 19,500 USDC in share-cap mode
  maxBuyingPowerUsageBps: 2000,
  chainId: MAINNET_CHAIN_ID,
  hypoVaultAddress: MAINNET_HYPOVAULT_ADDRESSES.usdcPlpVault,
  addresses: {
    ethUsdc500bpsV4Collateral1: MAINNET_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
    ethUsdc500bpsV4PanopticPool: MAINNET_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: MAINNET_HYPOVAULT_MANAGER_ADDRESSES.usdcPlpVaultManager,
    hypoVault: MAINNET_HYPOVAULT_ADDRESSES.usdcPlpVault,
    underlyingToken: MAINNET_ETH_USDC_MARKET.currency1,
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: MAINNET_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
        allocationBps: 10000,
      },
    ],
  },
  deltaHedge: {
    deltaThresholdBps: 1500n,
    maxHedgeSlots: 3,
  },
  alerts: {
    outOfRangeEnabled: true,
  },
}
