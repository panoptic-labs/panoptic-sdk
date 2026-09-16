import { getSpyUsdgMarket, requireChainDeployment, ROBINHOOD_CHAIN_ID } from '../chainDeployments'
import { ROBINHOOD_SPY_USDG_POOL_DEPLOYMENT_BLOCK } from '../hypoVaultManagerArtifacts/poolInfosConfig'
import { ROBINHOOD_USDG_PLP_COMPILED_POOL_POLICY } from '../hypoVaultManagerArtifacts/RobinhoodUSDGPLPStrategistLeaves'
import type { HypoVaultManagerConfig } from './schema'

const deployment = requireChainDeployment(ROBINHOOD_CHAIN_ID)
const vault = deployment.hypovault.vaults.usdgPlpVault
const manager = deployment.hypovault.managers.usdgPlpVaultManager

if (vault === undefined || manager === undefined) {
  throw new Error('Missing Robinhood USDG PLP vault deployment addresses')
}

export const UsdgPlpVaultRobinhoodProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  artifactSet: 'robinhood-prod',
  vaultAssetIndex: 1n,
  manageCycleIntervalMs: 600_000,
  vaultCapInUnderlying: 100_000_000_000n,
  vaultCapInShares: 100_000_000_000_000_000n,
  allowUnlimitedDepositRequestIfCapNotReached: true,
  maxBuyingPowerUsageBps: 6600,
  poolDeploymentBlock: Number(ROBINHOOD_SPY_USDG_POOL_DEPLOYMENT_BLOCK),
  chainId: ROBINHOOD_CHAIN_ID,
  hypoVaultAddress: vault,
  addresses: {
    ethUsdc500bpsV4Collateral0: deployment.panoptic.pool.collateralTracker0,
    ethUsdc500bpsV4Collateral1: deployment.panoptic.pool.collateralTracker1,
    ethUsdc500bpsV4PanopticPool: deployment.panoptic.pool.panopticPool,
    hypoVaultManagerWithMerkleVerification: manager,
    hypoVault: vault,
    underlyingToken: getSpyUsdgMarket(deployment).currency1,
  },
  automation: {
    primaryPool: ROBINHOOD_USDG_PLP_COMPILED_POOL_POLICY.automation.primaryPool,
    windDownPools: [...ROBINHOOD_USDG_PLP_COMPILED_POOL_POLICY.automation.windDownPools],
  },
  manualTxDefaults: {
    collateralAllocations: [
      {
        trackerAddress: deployment.panoptic.pool.collateralTracker1,
        allocationBps: 10_000,
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
  reporting: {
    assetSymbol: 'USDG',
    vaultLabel: 'USDG PLP',
  },
}
