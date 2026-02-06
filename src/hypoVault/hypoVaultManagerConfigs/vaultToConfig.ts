import type { Address } from 'viem'

import type { HypoVaultManagerConfig } from './schema'
import { UsdcPlpVaultSepoliaDevConfig } from './usdcPlpVaultSepoliaDevConfig'
import { UsdcPlpVaultSepoliaProdConfig } from './usdcPlpVaultSepoliaProdConfig'
import { WethPlpVaultSepoliaDevConfig } from './wethPlpVaultSepoliaDevConfig'
import { WethPlpVaultSepoliaProdConfig } from './wethPlpVaultSepoliaProdConfig'

const ALL_HYPO_VAULT_CONFIGS: HypoVaultManagerConfig[] = [
  WethPlpVaultSepoliaDevConfig,
  WethPlpVaultSepoliaProdConfig,
  UsdcPlpVaultSepoliaDevConfig,
  UsdcPlpVaultSepoliaProdConfig,
]

export function getHypoVaultConfigForVault(
  vaultAddress: Address,
  chainId: number,
): HypoVaultManagerConfig | undefined {
  const vaultLower = vaultAddress.toLowerCase()
  return ALL_HYPO_VAULT_CONFIGS.find(
    (c) => c.hypoVaultAddress?.toLowerCase() === vaultLower && c.chainId === chainId,
  )
}
