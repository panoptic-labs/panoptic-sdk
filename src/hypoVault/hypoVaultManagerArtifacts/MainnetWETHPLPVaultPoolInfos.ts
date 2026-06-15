import {
  DEFAULT_TRIGGER_TICK,
  MAINNET_DEFAULT_POOL_INFOS,
  MAINNET_VAULT_ADDRESSES,
} from './poolInfosConfig'

export const MainnetWETHPLPVaultPoolInfos = {
  vaultAddress: MAINNET_VAULT_ADDRESSES.wethPlpVault,
  poolInfos: MAINNET_DEFAULT_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const
