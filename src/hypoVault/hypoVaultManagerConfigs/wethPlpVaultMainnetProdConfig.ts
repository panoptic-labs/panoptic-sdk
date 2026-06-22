import { MAINNET_CHAIN_ID, requireChainDeployment } from '../chainDeployments'
import type { HypoVaultManagerConfig } from './schema'

const MAINNET_DEPLOYMENT = requireChainDeployment(MAINNET_CHAIN_ID)
const MAINNET_HYPOVAULT_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.vaults
const MAINNET_HYPOVAULT_MANAGER_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.managers
const MAINNET_PANOPTIC_POOL_ADDRESSES = MAINNET_DEPLOYMENT.panoptic.pool
const MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES = {
  panopticPool: '0x000000007588B488d180899cDEa2080a886D2441',
  collateralTracker0: '0x6cd0186Fb4c32B6fD23279bBE0022506958216f9',
  collateralTracker1: '0x6778d652A0BCe658C9a0E27D506eA20D179140e5',
} as const

export const WethPlpVaultMainnetProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  artifactSet: 'mainnet-prod',
  vaultAssetIndex: 1n,
  manageCycleIntervalMs: 600000,
  vaultCapInUnderlying: 9_500_000_000_000_000_000n, // Fallback cap: 9.5 WETH if share-price-derived cap is unavailable
  vaultCapInShares: 9_500_000_000_000_000_000_000_000n, // Active cap target: 9.5 WETH in share-cap mode
  allowUnlimitedDepositRequestIfCapNotReached: true,
  maxBuyingPowerUsageBps: 6600,
  poolDeploymentBlock: 25_302_077,
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

export const WethPlpVaultMainnetLegacyConfig: HypoVaultManagerConfig = {
  ...WethPlpVaultMainnetProdConfig,
  artifactSet: 'mainnet-legacy',
  manageCycleIntervalMs: 3600000,
  poolDeploymentBlock: 24_822_309,
  hypoVaultAddress: '0x779a2aa634A004b3a3f3b322083744869BBC6D66',
  addresses: {
    ...WethPlpVaultMainnetProdConfig.addresses,
    ethUsdc500bpsV4Collateral0: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.collateralTracker0,
    ethUsdc500bpsV4Collateral1: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
    ethUsdc500bpsV4PanopticPool: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: '0xcc80f113298DdF9D399323D5288aE5Eeaed20D44',
    hypoVault: '0x779a2aa634A004b3a3f3b322083744869BBC6D66',
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
