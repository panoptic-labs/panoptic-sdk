import {
  DEFAULT_TRIGGER_TICK,
  MAINNET_LEGACY_DEFAULT_POOL_INFOS,
  MAINNET_LEGACY_VAULT_ADDRESSES,
  MAINNET_USDC_PLP_POOL_INFOS,
  MAINNET_VAULT_ADDRESSES,
} from './poolInfosConfig'

export const MainnetUSDCPLPVaultPoolInfos = {
  vaultAddress: MAINNET_VAULT_ADDRESSES.usdcPlpVault,
  poolInfos: MAINNET_USDC_PLP_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const

export const MainnetUSDCPLPLegacyVaultPoolInfos = {
  vaultAddress: MAINNET_LEGACY_VAULT_ADDRESSES.usdcPlpVault,
  poolInfos: MAINNET_LEGACY_DEFAULT_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const
