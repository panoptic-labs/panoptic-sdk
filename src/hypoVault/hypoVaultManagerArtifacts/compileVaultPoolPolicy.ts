import type { Address } from 'viem'

import type { PoolInfo } from '../utils/buildManagerInput'
import type { StrategistLeafDefinition } from './createStrategistLeavesArtifact'

export type VaultPoolMode = 'primary' | 'enabled' | 'wind-down' | 'retired'

export type VaultPoolPolicyEntry = {
  readonly id: string
  readonly mode: VaultPoolMode
  readonly poolInfo: PoolInfo
  readonly fullLeafDefinitions: readonly StrategistLeafDefinition[]
  readonly windDownLeafDefinitions: readonly StrategistLeafDefinition[]
}

export type CompiledVaultPoolPolicy = {
  readonly poolInfos: readonly PoolInfo[]
  readonly strategistLeafDefinitions: readonly StrategistLeafDefinition[]
  readonly automation: {
    readonly primaryPool: Address
    readonly windDownPools: readonly Address[]
  }
}

/**
 * Compiles one ordered pool policy into every authorization surface consumed by a vault.
 * Retired pools deliberately disappear from accountant inputs, Merkle permissions, and
 * automation together so those surfaces cannot drift independently.
 */
export function compileVaultPoolPolicy({
  baseLeafDefinitions = [],
  pools,
}: {
  readonly baseLeafDefinitions?: readonly StrategistLeafDefinition[]
  readonly pools: readonly VaultPoolPolicyEntry[]
}): CompiledVaultPoolPolicy {
  const ids = pools.map(({ id }) => id)
  if (new Set(ids).size !== ids.length) {
    throw new Error('Vault pool policy contains duplicate pool ids')
  }

  const poolAddresses = pools.map(({ poolInfo }) => poolInfo.pool.toLowerCase())
  if (new Set(poolAddresses).size !== poolAddresses.length) {
    throw new Error('Vault pool policy contains duplicate pool addresses')
  }

  const primaryPools = pools.filter(({ mode }) => mode === 'primary')
  if (primaryPools.length !== 1) {
    throw new Error(
      `Vault pool policy requires exactly one primary pool, found ${primaryPools.length}`,
    )
  }
  const primaryPool = primaryPools[0]
  if (primaryPool === undefined) {
    throw new Error('Vault pool policy primary pool was not resolved')
  }

  const includedPools = pools.filter(({ mode }) => mode !== 'retired')
  const poolInfos = includedPools.map(({ poolInfo }) => poolInfo)
  const strategistLeafDefinitions = [
    ...baseLeafDefinitions,
    ...includedPools.flatMap(({ mode, fullLeafDefinitions, windDownLeafDefinitions }) =>
      mode === 'wind-down' ? windDownLeafDefinitions : fullLeafDefinitions,
    ),
  ]
  if (strategistLeafDefinitions.length === 0) {
    throw new Error('Vault pool policy produced no strategist leaves')
  }

  return {
    poolInfos,
    strategistLeafDefinitions,
    automation: {
      primaryPool: primaryPool.poolInfo.pool,
      windDownPools: includedPools
        .filter(({ mode }) => mode === 'wind-down')
        .map(({ poolInfo }) => poolInfo.pool),
    },
  }
}
