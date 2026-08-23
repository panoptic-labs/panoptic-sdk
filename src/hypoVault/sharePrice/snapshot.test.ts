import type { Address, PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import {
  type ReadContractFn,
  fetchVaultSharePriceSnapshot,
  fetchVaultSharePriceSnapshotWithCandidateRecovery,
} from './snapshot'
import { setVaultApyStrategyOverride } from './strategies'
import type { CandidateRecoveryContext, VaultApyVaultLike } from './types'

const chainId = 9_999
const accountant = '0x65aA902AE3135658587FFC36ED51B61c927114e1' as const
const underlyingToken = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const poolAddress = '0x0000000000000000000000000000000000000010' as const

function vault(address: Address): VaultApyVaultLike {
  return {
    id: address,
    accountant,
    createdAt: '0',
    underlyingToken: { id: underlyingToken },
  }
}

function baseReadContractFn(
  computeNav: (params: Parameters<ReadContractFn>[1]) => Promise<unknown>,
): ReadContractFn {
  return async (_client, params) => {
    if (params.functionName === 'depositEpoch') return 1n
    if (params.functionName === 'depositEpochState') return [0n]
    if (params.functionName === 'reservedWithdrawalAssets') return 0n
    if (params.functionName === 'totalSupply') return 1_000n
    if (params.functionName === 'computeNAV') return computeNav(params)
    throw new Error(`Unexpected function ${params.functionName}`)
  }
}

describe('fetchVaultSharePriceSnapshotWithCandidateRecovery', () => {
  it('recovers a missing position and retries the stale-oracle override once', async () => {
    const vaultAddress = '0x0000000000000000000000000000000000000101' as const
    const recoverCandidates = vi.fn(async ({ candidates }: CandidateRecoveryContext) => [
      {
        poolAddress,
        candidates: [...(candidates[0]?.candidates ?? []), 2n],
      },
    ])
    setVaultApyStrategyOverride({
      chainId,
      vaultAddress,
      strategy: {
        enabledMetrics: ['nav'],
        managerInputProvider: async ({ candidates }) => ({
          managerInput: candidates?.[0]?.candidates.includes(2n) ? '0x02' : '0x01',
        }),
        recoverCandidates,
      },
    })

    const computeNavCalls: Array<{ override: boolean; managerInput: unknown }> = []
    const readContractFn = baseReadContractFn(async (params) => {
      const managerInput = params.args?.[2]
      computeNavCalls.push({ override: params.stateOverride !== undefined, managerInput })
      if (params.stateOverride === undefined) {
        throw new Error('StaleOraclePrice()')
      }
      if (managerInput === '0x01') {
        throw Object.assign(new Error('computeNAV override failed'), {
          cause: { data: { errorName: 'IncorrectPositionList' } },
        })
      }
      return 1_000n
    })

    const result = await fetchVaultSharePriceSnapshotWithCandidateRecovery({
      client: {} as PublicClient,
      vault: vault(vaultAddress),
      chainId,
      windowLabel: 'series',
      blockNumber: 200n,
      recoveryFromBlock: 100n,
      candidates: [{ poolAddress, candidates: [1n] }],
      readContractFn,
    })

    expect(computeNavCalls).toEqual([
      { override: false, managerInput: '0x01' },
      { override: true, managerInput: '0x01' },
      { override: false, managerInput: '0x02' },
      { override: true, managerInput: '0x02' },
    ])
    expect(recoverCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: 200n, fromBlock: 100n }),
    )
    expect(result.candidates?.[0]?.candidates).toEqual([1n, 2n])
    expect(result.snapshot.navSource).toBe('computeNAVStateOverride')
    expect(result.snapshot.nav).toBe(1_000n)
  })

  it('surfaces a failed recovery so the indexer stores nav_reverted', async () => {
    const vaultAddress = '0x0000000000000000000000000000000000000102' as const
    setVaultApyStrategyOverride({
      chainId,
      vaultAddress,
      strategy: {
        enabledMetrics: ['nav'],
        managerInputProvider: async () => '0x01',
        recoverCandidates: async () => {
          throw new Error('position recovery failed')
        },
      },
    })
    const readContractFn = baseReadContractFn(async (params) => {
      if (params.stateOverride === undefined) throw new Error('StaleOraclePrice()')
      throw new Error('IncorrectPositionList()')
    })

    await expect(
      fetchVaultSharePriceSnapshotWithCandidateRecovery({
        client: {} as PublicClient,
        vault: vault(vaultAddress),
        chainId,
        windowLabel: 'series',
        blockNumber: 200n,
        recoveryFromBlock: 100n,
        candidates: [{ poolAddress, candidates: [1n] }],
        readContractFn,
      }),
    ).rejects.toThrow('position recovery failed')
  })

  it('does not substitute an off-chain estimate when the override fails', async () => {
    const vaultAddress = '0x0000000000000000000000000000000000000103' as const
    setVaultApyStrategyOverride({
      chainId,
      vaultAddress,
      strategy: {
        enabledMetrics: ['nav'],
        managerInputProvider: async () => '0x',
      },
    })
    const readContractFn = baseReadContractFn(async (params) => {
      if (params.stateOverride === undefined) throw new Error('StaleOraclePrice()')
      throw new Error('override RPC failed')
    })

    await expect(
      fetchVaultSharePriceSnapshot({
        client: {} as PublicClient,
        vault: vault(vaultAddress),
        chainId,
        windowLabel: 'series',
        blockNumber: 200n,
        readContractFn,
      }),
    ).rejects.toThrow('override RPC failed')
  })
})
