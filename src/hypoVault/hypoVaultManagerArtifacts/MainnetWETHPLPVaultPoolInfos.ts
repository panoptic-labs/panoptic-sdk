import {
  DEFAULT_TRIGGER_TICK,
  MAINNET_DEFAULT_POOL_INFOS,
  MAINNET_LEGACY_DEFAULT_POOL_INFOS,
  MAINNET_LEGACY_VAULT_ADDRESSES,
  MAINNET_VAULT_ADDRESSES,
} from './poolInfosConfig'

export const MainnetWETHPLPVaultPoolInfos = {
  vaultAddress: MAINNET_VAULT_ADDRESSES.wethPlpVault,
  poolInfos: MAINNET_DEFAULT_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const

/** Production accountant input before the ETH/USDC 5bps v3 pool authorization executes. */
export const MainnetWETHPLPPreviousVaultPoolInfos = {
  vaultAddress: MAINNET_VAULT_ADDRESSES.wethPlpVault,
  poolInfos: MAINNET_DEFAULT_POOL_INFOS.slice(0, 1).map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const

export const MainnetWETHPLPLegacyVaultPoolInfos = {
  vaultAddress: MAINNET_LEGACY_VAULT_ADDRESSES.wethPlpVault,
  poolInfos: MAINNET_LEGACY_DEFAULT_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const
