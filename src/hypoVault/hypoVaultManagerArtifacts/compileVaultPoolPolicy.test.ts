import { describe, expect, it } from 'vitest'

import type { PoolInfo } from '../utils/buildManagerInput'
import { type VaultPoolPolicyEntry, compileVaultPoolPolicy } from './compileVaultPoolPolicy'
import type { StrategistLeafDefinition } from './createStrategistLeavesArtifact'

const TOKEN_0 = '0x0000000000000000000000000000000000000010'
const TOKEN_1 = '0x0000000000000000000000000000000000000011'

function poolInfo(pool: PoolInfo['pool']): PoolInfo {
  return { pool, token0: TOKEN_0, token1: TOKEN_1, maxPriceDeviation: 100 }
}

function leaf(
  description: string,
  target: StrategistLeafDefinition['target'],
): StrategistLeafDefinition {
  return {
    description,
    target,
    functionSignature: 'withdraw(uint256,address,address)',
    addressArguments: [TOKEN_0, TOKEN_0],
    canSendValue: false,
  }
}

function policyEntry({
  id,
  mode,
  pool,
}: {
  id: string
  mode: VaultPoolPolicyEntry['mode']
  pool: PoolInfo['pool']
}): VaultPoolPolicyEntry {
  return {
    id,
    mode,
    poolInfo: poolInfo(pool),
    fullLeafDefinitions: [leaf(`${id}:full`, pool)],
    windDownLeafDefinitions: [leaf(`${id}:wind-down`, pool)],
  }
}

describe('compileVaultPoolPolicy', () => {
  it('compiles active, wind-down, and retired modes into every authorization surface', () => {
    const primary = policyEntry({
      id: 'primary',
      mode: 'primary',
      pool: '0x0000000000000000000000000000000000000001',
    })
    const enabled = policyEntry({
      id: 'enabled',
      mode: 'enabled',
      pool: '0x0000000000000000000000000000000000000002',
    })
    const windDown = policyEntry({
      id: 'wind-down',
      mode: 'wind-down',
      pool: '0x0000000000000000000000000000000000000003',
    })
    const retired = policyEntry({
      id: 'retired',
      mode: 'retired',
      pool: '0x0000000000000000000000000000000000000004',
    })
    const baseLeaf = leaf('base', TOKEN_1)

    const compiled = compileVaultPoolPolicy({
      baseLeafDefinitions: [baseLeaf],
      pools: [primary, enabled, windDown, retired],
    })

    expect(compiled.poolInfos.map(({ pool }) => pool)).toEqual([
      primary.poolInfo.pool,
      enabled.poolInfo.pool,
      windDown.poolInfo.pool,
    ])
    expect(compiled.strategistLeafDefinitions.map(({ description }) => description)).toEqual([
      'base',
      'primary:full',
      'enabled:full',
      'wind-down:wind-down',
    ])
    expect(compiled.automation).toEqual({
      primaryPool: primary.poolInfo.pool,
      windDownPools: [windDown.poolInfo.pool],
    })
  })

  it('requires exactly one primary pool', () => {
    const enabled = policyEntry({
      id: 'enabled',
      mode: 'enabled',
      pool: '0x0000000000000000000000000000000000000001',
    })
    expect(() => compileVaultPoolPolicy({ pools: [enabled] })).toThrow(
      'requires exactly one primary pool',
    )

    expect(() =>
      compileVaultPoolPolicy({
        pools: [
          { ...enabled, id: 'primary-a', mode: 'primary' },
          {
            ...enabled,
            id: 'primary-b',
            mode: 'primary',
            poolInfo: poolInfo('0x0000000000000000000000000000000000000002'),
          },
        ],
      }),
    ).toThrow('requires exactly one primary pool')
  })

  it('rejects duplicate pool ids and addresses', () => {
    const primary = policyEntry({
      id: 'primary',
      mode: 'primary',
      pool: '0x0000000000000000000000000000000000000001',
    })
    expect(() => compileVaultPoolPolicy({ pools: [primary, { ...primary }] })).toThrow(
      'duplicate pool ids',
    )
    expect(() =>
      compileVaultPoolPolicy({
        pools: [primary, { ...primary, id: 'duplicate-address', mode: 'enabled' }],
      }),
    ).toThrow('duplicate pool addresses')
  })
})
