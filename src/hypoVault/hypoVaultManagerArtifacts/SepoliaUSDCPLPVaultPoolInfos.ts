import {
  DEFAULT_TRIGGER_TICK,
  SEPOLIA_DEFAULT_POOL_INFOS,
  SEPOLIA_VAULT_ADDRESSES,
} from './poolInfosConfig'

export const SepoliaUSDCPLPVaultPoolInfos = {
  vaultAddress: SEPOLIA_VAULT_ADDRESSES.usdcPlpVault,
  poolInfos: SEPOLIA_DEFAULT_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const
