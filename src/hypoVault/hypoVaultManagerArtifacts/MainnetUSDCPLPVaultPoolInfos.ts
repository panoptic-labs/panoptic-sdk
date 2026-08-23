import {
  DEFAULT_TRIGGER_TICK,
  MAINNET_LEGACY_DEFAULT_POOL_INFOS,
  MAINNET_LEGACY_VAULT_ADDRESSES,
  MAINNET_USDC_PLP_POOL_INFOS,
  MAINNET_USDC_WETH_5BPS_V3_POOL_INFO,
  MAINNET_VAULT_ADDRESSES,
} from './poolInfosConfig'

export const MainnetUSDCPLPVaultPoolInfos = {
  vaultAddress: MAINNET_VAULT_ADDRESSES.usdcPlpVault,
  poolInfos: MAINNET_USDC_PLP_POOL_INFOS.map((poolInfo) => ({
    ...poolInfo,
    triggerTick: DEFAULT_TRIGGER_TICK,
  })),
} as const

/** Production accountant input before the ETH/USDC 5bps v3 pool authorization executes. */
export const MainnetUSDCPLPPreviousVaultPoolInfos = {
  vaultAddress: MAINNET_VAULT_ADDRESSES.usdcPlpVault,
  poolInfos: MAINNET_USDC_PLP_POOL_INFOS.filter(
    (poolInfo) => poolInfo.pool !== MAINNET_USDC_WETH_5BPS_V3_POOL_INFO.pool,
  ).map((poolInfo) => ({
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
