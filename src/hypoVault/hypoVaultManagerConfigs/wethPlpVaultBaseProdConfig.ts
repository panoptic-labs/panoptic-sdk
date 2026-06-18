import { BASE_CHAIN_ID, requireChainDeployment } from '../chainDeployments'
import type { HypoVaultManagerConfig } from './schema'

const BASE_DEPLOYMENT = requireChainDeployment(BASE_CHAIN_ID)
const BASE_HYPOVAULT_ADDRESSES = BASE_DEPLOYMENT.hypovault.vaults
const BASE_HYPOVAULT_MANAGER_ADDRESSES = BASE_DEPLOYMENT.hypovault.managers
const BASE_PANOPTIC_POOL_ADDRESSES = BASE_DEPLOYMENT.panoptic.pool

export const WethPlpVaultBaseProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  vaultAssetIndex: 1n,
  manageCycleIntervalMs: 1200000,
  vaultCapInUnderlying: 1_000_000_000_000_000_000n, // 1 WETH
  vaultCapInShares: 1_000_000_000_000_000_000_000_000n, // ~1 WETH (verify share scaling on-chain)
  allowUnlimitedDepositRequestIfCapNotReached: true,
  maxBuyingPowerUsageBps: 6600,
  chainId: BASE_CHAIN_ID,
  poolDeploymentBlock: 43_000_000,
  hypoVaultAddress: BASE_HYPOVAULT_ADDRESSES.wethPlpVault,
  addresses: {
    ethUsdc500bpsV4Collateral0: BASE_PANOPTIC_POOL_ADDRESSES.collateralTracker0,
    ethUsdc500bpsV4PanopticPool: BASE_PANOPTIC_POOL_ADDRESSES.panopticPool,
    hypoVaultManagerWithMerkleVerification: BASE_HYPOVAULT_MANAGER_ADDRESSES.wethPlpVaultManager,
    hypoVault: BASE_HYPOVAULT_ADDRESSES.wethPlpVault,
    underlyingToken: '0x4200000000000000000000000000000000000006',
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: BASE_PANOPTIC_POOL_ADDRESSES.collateralTracker0,
        allocationBps: 10000,
      },
    ],
  },
  deltaHedge: {
    maxHedgeSlots: 2,
  },
  alerts: {
    outOfRangeEnabled: true,
  },
}
