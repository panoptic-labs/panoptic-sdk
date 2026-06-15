import { getEthUsdcMarket, requireChainDeployment, SEPOLIA_CHAIN_ID } from '../chainDeployments'
import type { HypoVaultManagerConfig } from './schema'

const SEPOLIA_DEPLOYMENT = requireChainDeployment(SEPOLIA_CHAIN_ID)
const SEPOLIA_ETH_USDC_5BPS_MARKET = getEthUsdcMarket(SEPOLIA_DEPLOYMENT)
const SEPOLIA_HYPOVAULT_ADDRESSES = SEPOLIA_DEPLOYMENT.hypovault.vaults
const SEPOLIA_HYPOVAULT_MANAGER_ADDRESSES = SEPOLIA_DEPLOYMENT.hypovault.managers
const SEPOLIA_PANOPTIC_POOL_ADDRESSES = SEPOLIA_DEPLOYMENT.panoptic.pool

export const UsdcPlpVaultSepoliaProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  vaultAssetIndex: 0n,
  manageCycleIntervalMs: 1200000,
  vaultCapInUnderlying: 300_000_000n, // 300 USDC
  maxBuyingPowerUsageBps: 2000,
  chainId: SEPOLIA_CHAIN_ID,
  hypoVaultAddress: SEPOLIA_HYPOVAULT_ADDRESSES.usdcPlpVault,
  addresses: {
    ethUsdc500bpsV4Collateral1: SEPOLIA_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
    ethUsdc500bpsV4PanopticPool: SEPOLIA_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: SEPOLIA_HYPOVAULT_MANAGER_ADDRESSES.usdcPlpVaultManager,
    hypoVault: SEPOLIA_HYPOVAULT_ADDRESSES.usdcPlpVault,
    underlyingToken: SEPOLIA_ETH_USDC_5BPS_MARKET.currency1,
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: SEPOLIA_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
        allocationBps: 10000,
      },
    ],
  },
  deltaHedge: {
    maxHedgeSlots: 12,
  },
}
