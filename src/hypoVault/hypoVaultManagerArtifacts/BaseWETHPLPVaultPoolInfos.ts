import {
  BASE_DEFAULT_POOL_INFOS,
  BASE_VAULT_ADDRESSES,
  DEFAULT_TRIGGER_TICK,
} from './poolInfosConfig'

export const BaseWETHPLPVaultPoolInfos = {
  vaultAddress: BASE_VAULT_ADDRESSES.wethPlpVault,
  poolInfos: BASE_DEFAULT_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const
