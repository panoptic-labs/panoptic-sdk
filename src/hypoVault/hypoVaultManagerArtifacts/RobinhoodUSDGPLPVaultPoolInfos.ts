import { requireChainDeployment, ROBINHOOD_CHAIN_ID } from '../chainDeployments'
import type { PoolInfo } from '../utils/buildManagerInput'
import {
  ROBINHOOD_USDG_PLP_5BPS_COMPILED_POOL_POLICY,
  ROBINHOOD_USDG_PLP_30BPS_COMPILED_POOL_POLICY,
} from './RobinhoodUSDGPLPStrategistLeaves'

const vaultAddress = requireChainDeployment(ROBINHOOD_CHAIN_ID).hypovault.vaults.usdgPlpVault

if (vaultAddress === undefined) {
  throw new Error('Missing Robinhood USDG PLP vault address')
}
const resolvedVaultAddress = vaultAddress

function createVaultPoolInfos(poolInfos: readonly PoolInfo[]) {
  return {
    vaultAddress: resolvedVaultAddress,
    poolInfos: poolInfos.map((poolInfo) => ({ ...poolInfo })),
  }
}

export const RobinhoodUSDGPLP30bpsVaultPoolInfos = createVaultPoolInfos(
  ROBINHOOD_USDG_PLP_30BPS_COMPILED_POOL_POLICY.poolInfos,
)
export const RobinhoodUSDGPLP5bpsVaultPoolInfos = createVaultPoolInfos(
  ROBINHOOD_USDG_PLP_5BPS_COMPILED_POOL_POLICY.poolInfos,
)
export const RobinhoodUSDGPLPVaultPoolInfos = RobinhoodUSDGPLP5bpsVaultPoolInfos
