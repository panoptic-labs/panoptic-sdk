import { BASE_CHAIN_ID, getEthUsdcMarket, requireChainDeployment } from '../chainDeployments'
import type { HypoVaultManagerConfig } from './schema'

const BASE_DEPLOYMENT = requireChainDeployment(BASE_CHAIN_ID)
const BASE_ETH_USDC_5BPS_MARKET = getEthUsdcMarket(BASE_DEPLOYMENT)
const BASE_HYPOVAULT_ADDRESSES = BASE_DEPLOYMENT.hypovault.vaults
const BASE_HYPOVAULT_MANAGER_ADDRESSES = BASE_DEPLOYMENT.hypovault.managers
const BASE_PANOPTIC_POOL_ADDRESSES = BASE_DEPLOYMENT.panoptic.pool

export const UsdcPlpVaultBaseProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  vaultAssetIndex: 0n,
  manageCycleIntervalMs: 1200000,
  vaultCapInUnderlying: 300_000_000n, // 300 USDC
  vaultCapInShares: 3_000_000_000_000_000n, // ~300 USDC (verify share scaling on-chain)
  maxBuyingPowerUsageBps: 2000,
  chainId: BASE_CHAIN_ID,
  poolDeploymentBlock: 43_000_000,
  hypoVaultAddress: BASE_HYPOVAULT_ADDRESSES.usdcPlpVault,
  addresses: {
    ethUsdc500bpsV4Collateral1: BASE_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
    ethUsdc500bpsV4PanopticPool: BASE_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: BASE_HYPOVAULT_MANAGER_ADDRESSES.usdcPlpVaultManager,
    hypoVault: BASE_HYPOVAULT_ADDRESSES.usdcPlpVault,
    underlyingToken: BASE_ETH_USDC_5BPS_MARKET.currency1,
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: BASE_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
        allocationBps: 10000,
      },
    ],
  },
  deltaHedge: {
    deltaThresholdBps: 200n,
    maxHedgeSlots: 2,
  },
  alerts: {
    outOfRangeEnabled: true,
  },
}
