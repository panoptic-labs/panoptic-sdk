import {
  BASE_DEFAULT_POOL_INFOS,
  BASE_VAULT_ADDRESSES,
  DEFAULT_TRIGGER_TICK,
} from './poolInfosConfig'

export const BaseUSDCPLPVaultPoolInfos = {
  vaultAddress: BASE_VAULT_ADDRESSES.usdcPlpVault,
  poolInfos: BASE_DEFAULT_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const
