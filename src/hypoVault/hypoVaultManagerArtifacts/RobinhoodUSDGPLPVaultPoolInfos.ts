import { requireChainDeployment, ROBINHOOD_CHAIN_ID } from '../chainDeployments'
import { ROBINHOOD_USDG_PLP_COMPILED_POOL_POLICY } from './RobinhoodUSDGPLPStrategistLeaves'

const vaultAddress = requireChainDeployment(ROBINHOOD_CHAIN_ID).hypovault.vaults.usdgPlpVault

if (vaultAddress === undefined) {
  throw new Error('Missing Robinhood USDG PLP vault address')
}

export const RobinhoodUSDGPLPVaultPoolInfos = {
  vaultAddress,
  poolInfos: ROBINHOOD_USDG_PLP_COMPILED_POOL_POLICY.poolInfos.map((poolInfo) => ({
    ...poolInfo,
  })),
}
