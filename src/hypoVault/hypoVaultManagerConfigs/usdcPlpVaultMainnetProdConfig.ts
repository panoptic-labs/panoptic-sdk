import { getEthUsdcMarket, MAINNET_CHAIN_ID, requireChainDeployment } from '../chainDeployments'
import { MAINNET_USDC_PLP_COMPILED_POOL_POLICY } from '../hypoVaultManagerArtifacts/MainnetUSDCPLPStrategistLeaves'
import type { HypoVaultManagerConfig } from './schema'

const MAINNET_DEPLOYMENT = requireChainDeployment(MAINNET_CHAIN_ID)
const MAINNET_ETH_USDC_MARKET = getEthUsdcMarket(MAINNET_DEPLOYMENT)
const MAINNET_HYPOVAULT_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.vaults
const MAINNET_HYPOVAULT_MANAGER_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.managers
const MAINNET_PANOPTIC_POOL_ADDRESSES = MAINNET_DEPLOYMENT.panoptic.pool
const MAINNET_V3_POOL_ADDRESSES = MAINNET_DEPLOYMENT.panoptic.additionalPools?.ethUsdc5bpsV3
if (MAINNET_V3_POOL_ADDRESSES === undefined) {
  throw new Error('Missing mainnet ETH/USDC 5bps v3 Panoptic pool deployment')
}
const MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES = {
  panopticPool: '0x000000007588B488d180899cDEa2080a886D2441',
  collateralTracker0: '0x6cd0186Fb4c32B6fD23279bBE0022506958216f9',
  collateralTracker1: '0x6778d652A0BCe658C9a0E27D506eA20D179140e5',
} as const

export const UsdcPlpVaultMainnetProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  artifactSet: 'mainnet-prod',
  vaultAssetIndex: 0n,
  manageCycleIntervalMs: 600000,
  vaultCapInUnderlying: 350_000_000_000n, // Fallback cap: 350,000 USDC if share-price-derived cap is unavailable
  vaultCapInShares: 350_000_000_000_000_000n, // Active cap target: 350,000 USDC in share-cap mode
  allowUnlimitedDepositRequestIfCapNotReached: true,
  maxBuyingPowerUsageBps: 2000,
  poolDeploymentBlock: 25_302_077,
  chainId: MAINNET_CHAIN_ID,
  hypoVaultAddress: MAINNET_HYPOVAULT_ADDRESSES.usdcPlpVault,
  addresses: {
    ethUsdc500bpsV4Collateral1: MAINNET_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
    ethUsdc500bpsV4PanopticPool: MAINNET_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: MAINNET_HYPOVAULT_MANAGER_ADDRESSES.usdcPlpVaultManager,
    hypoVault: MAINNET_HYPOVAULT_ADDRESSES.usdcPlpVault,
    underlyingToken: MAINNET_ETH_USDC_MARKET.currency1,
  },
  automation: {
    primaryPool: MAINNET_USDC_PLP_COMPILED_POOL_POLICY.automation.primaryPool,
    windDownPools: [...MAINNET_USDC_PLP_COMPILED_POOL_POLICY.automation.windDownPools],
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: MAINNET_V3_POOL_ADDRESSES.collateralTracker0,
        allocationBps: 10000,
      },
    ],
  },
  deltaHedge: {
    deltaThresholdBps: 1500n,
    maxHedgeSlots: 3,
    timedRehedge: {
      elapsedMinutes: 1440,
      jitterMinutes: 60,
      deltaThresholdBps: 0n,
    },
  },
  alerts: {
    outOfRangeEnabled: true,
  },
}

export const UsdcPlpVaultMainnetLegacyConfig: HypoVaultManagerConfig = {
  ...UsdcPlpVaultMainnetProdConfig,
  artifactSet: 'mainnet-legacy',
  manageCycleIntervalMs: 3600000,
  poolDeploymentBlock: 24_822_309,
  hypoVaultAddress: '0x963Fe9c93bc353602656ee4051A75114bA74d6c5',
  deltaHedge: {
    deltaThresholdBps: 1500n,
    maxHedgeSlots: 3,
  },
  addresses: {
    ...UsdcPlpVaultMainnetProdConfig.addresses,
    ethUsdc500bpsV4Collateral0: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.collateralTracker0,
    ethUsdc500bpsV4Collateral1: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.collateralTracker1,
    ethUsdc500bpsV4PanopticPool: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: '0xf42EED8F0d3326ad59fc1f5d4c4009B5F6B4D87c',
    hypoVault: '0x963Fe9c93bc353602656ee4051A75114bA74d6c5',
  },
  automation: {
    primaryPool: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.panopticPool,
    windDownPools: [],
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: MAINNET_LEGACY_PANOPTIC_POOL_ADDRESSES.collateralTracker0,
        allocationBps: 10000,
      },
    ],
  },
}
