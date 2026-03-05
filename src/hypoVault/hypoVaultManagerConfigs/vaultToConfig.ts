import type { Address } from 'viem'

import type { HypoVaultManagerConfig } from './schema'
import { UsdcGammaVaultSepoliaDevConfig } from './usdcGammaVaultSepoliaDevConfig'
import { UsdcGammaVaultSepoliaProdConfig } from './usdcGammaVaultSepoliaProdConfig'
import { UsdcPlpVaultSepoliaDevConfig } from './usdcPlpVaultSepoliaDevConfig'
import { UsdcPlpVaultSepoliaProdConfig } from './usdcPlpVaultSepoliaProdConfig'
import { WethPlpVaultSepoliaDevConfig } from './wethPlpVaultSepoliaDevConfig'
import { WethPlpVaultSepoliaProdConfig } from './wethPlpVaultSepoliaProdConfig'

const ALL_HYPO_VAULT_CONFIGS: HypoVaultManagerConfig[] = [
  WethPlpVaultSepoliaDevConfig,
  WethPlpVaultSepoliaProdConfig,
  UsdcPlpVaultSepoliaDevConfig,
  UsdcPlpVaultSepoliaProdConfig,
  UsdcGammaVaultSepoliaDevConfig,
  UsdcGammaVaultSepoliaProdConfig,
]

type GetHypoVaultConfigOptions = {
  preferredDeployment?: HypoVaultManagerConfig['deployment']
}

export function getHypoVaultConfigForVault(
  vaultAddress: Address,
  chainId: number,
  options?: GetHypoVaultConfigOptions,
): HypoVaultManagerConfig | undefined {
  const vaultLower = vaultAddress.toLowerCase()
  const matchingConfigs = ALL_HYPO_VAULT_CONFIGS.filter(
    (c) => c.hypoVaultAddress?.toLowerCase() === vaultLower && c.chainId === chainId,
  )
  if (matchingConfigs.length === 0) {
    return undefined
  }

  const preferredDeployment = options?.preferredDeployment
  if (preferredDeployment !== undefined) {
    const preferredConfig = matchingConfigs.find((c) => c.deployment === preferredDeployment)
    if (preferredConfig !== undefined) {
      return preferredConfig
    }
  }

  const deploymentRank: Record<HypoVaultManagerConfig['deployment'], number> = {
    prod: 0,
    dev: 1,
  }
  return [...matchingConfigs].sort(
    (a, b) => deploymentRank[a.deployment] - deploymentRank[b.deployment],
  )[0]
}
