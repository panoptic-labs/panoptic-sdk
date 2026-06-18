import { getEthUsdcMarket, MAINNET_CHAIN_ID, requireChainDeployment } from '../chainDeployments'
import type { HypoVaultManagerConfig } from './schema'

const MAINNET_DEPLOYMENT = requireChainDeployment(MAINNET_CHAIN_ID)
const MAINNET_ETH_USDC_MARKET = getEthUsdcMarket(MAINNET_DEPLOYMENT)
const MAINNET_HYPOVAULT_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.vaults
const MAINNET_HYPOVAULT_MANAGER_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.managers
const MAINNET_PANOPTIC_POOL_ADDRESSES = MAINNET_DEPLOYMENT.panoptic.pool
const MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES = {
  panopticPool: '0x000000007588B488d180899cDEa2080a886D2441',
  collateralTracker1: '0x6778d652A0BCe658C9a0E27D506eA20D179140e5',
} as const

export const UsdcPlpVaultMainnetProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  artifactSet: 'mainnet-prod',
  vaultAssetIndex: 0n,
  manageCycleIntervalMs: 600000,
  vaultCapInUnderlying: 19_500_000_000n, // Fallback cap: 19,500 USDC if share-price-derived cap is unavailable
  vaultCapInShares: 19_500_000_000_000_000n, // Active cap target: 19,500 USDC in share-cap mode
  allowUnlimitedDepositRequestIfCapNotReached: true,
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

export const UsdcPlpVaultMainnetLegacyConfig: HypoVaultManagerConfig = {
  ...UsdcPlpVaultMainnetProdConfig,
  artifactSet: 'mainnet-legacy',
  manageCycleIntervalMs: 3600000,
  hypoVaultAddress: '0x963Fe9c93bc353602656ee4051A75114bA74d6c5',
  addresses: {
    ...UsdcPlpVaultMainnetProdConfig.addresses,
    ethUsdc500bpsV4Collateral1: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
    ethUsdc500bpsV4PanopticPool: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: '0xf42EED8F0d3326ad59fc1f5d4c4009B5F6B4D87c',
    hypoVault: '0x963Fe9c93bc353602656ee4051A75114bA74d6c5',
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
        allocationBps: 10000,
      },
    ],
  },
}
