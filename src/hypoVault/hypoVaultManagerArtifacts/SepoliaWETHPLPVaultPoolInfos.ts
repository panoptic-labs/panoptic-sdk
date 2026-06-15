import {
  DEFAULT_TRIGGER_TICK,
  SEPOLIA_DEFAULT_POOL_INFOS,
  SEPOLIA_VAULT_ADDRESSES,
} from './poolInfosConfig'

export const SepoliaWETHPLPVaultPoolInfos = {
  vaultAddress: SEPOLIA_VAULT_ADDRESSES.wethPlpVault,
  poolInfos: SEPOLIA_DEFAULT_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const
