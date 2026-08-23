import type { Address, PublicClient } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createVaultSharePriceProcessor, statusForVaultSharePriceSnapshot } from './processor'
import type { ReadContractFn } from './snapshot'
import { clearVaultApyStrategyOverride, setVaultApyStrategyOverride } from './strategies'
import type { CandidateRecoveryContext, VaultApyStrategy, VaultApyVaultLike } from './types'

const chainId = 9_998
const vaultAddress = '0x0000000000000000000000000000000000000101' as const
const poolAddress = '0x0000000000000000000000000000000000000010' as const

const vault: VaultApyVaultLike = {
  id: vaultAddress,
  accountant: '0x65aA902AE3135658587FFC36ED51B61c927114e1',
  createdAt: '0',
  underlyingToken: { id: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
}

afterEach(() => {
  clearVaultApyStrategyOverride({ chainId, vaultAddress })
})

describe('createVaultSharePriceProcessor', () => {
  it('seeds the trusted block once and retains recovered candidates by chain time', async () => {
    const resolveCandidates = vi.fn(async () => [{ poolAddress, candidates: [1n] }])
    const recoverCandidates = vi.fn(async ({ candidates, fromBlock }: CandidateRecoveryContext) => {
      expect(fromBlock).toBe(123n)
      return [{ poolAddress, candidates: [...(candidates[0]?.candidates ?? []), 2n] }]
    })
    const strategy: VaultApyStrategy = {
      enabledMetrics: ['nav'],
      resolveCandidates,
      recoverCandidates,
      managerInputProvider: async ({ candidates }) => ({
        managerInput: candidates?.[0]?.candidates.includes(2n) ? '0x02' : '0x01',
      }),
    }
    setVaultApyStrategyOverride({ chainId, vaultAddress: vaultAddress as Address, strategy })

    const readContractFn: ReadContractFn = async (_client, params) => {
      if (params.functionName === 'depositEpoch') return 1n
      if (params.functionName === 'depositEpochState') return [0n]
      if (params.functionName === 'reservedWithdrawalAssets') return 0n
      if (params.functionName === 'totalSupply') return 1_000n
      if (params.functionName === 'computeNAV') {
        if (params.args?.[2] === '0x01') throw new Error('IncorrectPositionList()')
        return 1_000n
      }
      throw new Error(`Unexpected function ${params.functionName}`)
    }
    const loadLastTrustedBlock = vi.fn(async () => 123n)
    const processor = createVaultSharePriceProcessor({
      chainId,
      client: {} as PublicClient,
    })

    const first = await processor.process({
      vault,
      strategy,
      blockNumber: 200n,
      blockTimestamp: 1_000n,
      recoveryFallbackBlock: 50n,
      loadLastTrustedBlock,
      readContractFn,
    })
    const second = await processor.process({
      vault,
      strategy,
      blockNumber: 201n,
      blockTimestamp: 1_100n,
      recoveryFallbackBlock: 50n,
      loadLastTrustedBlock,
      readContractFn,
    })

    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
    expect(loadLastTrustedBlock).toHaveBeenCalledTimes(1)
    expect(resolveCandidates).toHaveBeenCalledTimes(1)
    expect(recoverCandidates).toHaveBeenCalledTimes(1)
  })

  it('does not advance the trusted block for a zero-supply snapshot', async () => {
    let totalSupply = 1_000n
    let requireRecovery = false
    const resolveCandidates = vi.fn(async () => [{ poolAddress, candidates: [1n] }])
    const recoverCandidates = vi.fn(async ({ candidates, fromBlock }: CandidateRecoveryContext) => {
      expect(fromBlock).toBe(200n)
      return [{ poolAddress, candidates: [...(candidates[0]?.candidates ?? []), 2n] }]
    })
    const strategy: VaultApyStrategy = {
      enabledMetrics: ['nav'],
      resolveCandidates,
      recoverCandidates,
      managerInputProvider: async ({ candidates }) => ({
        managerInput: candidates?.[0]?.candidates.includes(2n) ? '0x02' : '0x01',
      }),
    }
    setVaultApyStrategyOverride({ chainId, vaultAddress, strategy })

    const readContractFn: ReadContractFn = async (_client, params) => {
      if (params.functionName === 'depositEpoch') return 1n
      if (params.functionName === 'depositEpochState') return [0n]
      if (params.functionName === 'reservedWithdrawalAssets') return 0n
      if (params.functionName === 'totalSupply') return totalSupply
      if (params.functionName === 'computeNAV') {
        if (requireRecovery && params.args?.[2] === '0x01') {
          throw new Error('IncorrectPositionList()')
        }
        return 1_000n
      }
      throw new Error(`Unexpected function ${params.functionName}`)
    }
    const processor = createVaultSharePriceProcessor({
      chainId,
      client: {} as PublicClient,
    })
    const loadLastTrustedBlock = vi.fn(async () => 123n)

    const trusted = await processor.process({
      vault,
      strategy,
      blockNumber: 200n,
      blockTimestamp: 1_000n,
      recoveryFallbackBlock: 50n,
      loadLastTrustedBlock,
      readContractFn,
    })
    totalSupply = 0n
    const zeroSupply = await processor.process({
      vault,
      strategy,
      blockNumber: 201n,
      blockTimestamp: 1_100n,
      recoveryFallbackBlock: 50n,
      loadLastTrustedBlock,
      readContractFn,
    })
    totalSupply = 1_000n
    requireRecovery = true
    await processor.process({
      vault,
      strategy,
      blockNumber: 202n,
      blockTimestamp: 1_200n,
      recoveryFallbackBlock: 50n,
      loadLastTrustedBlock,
      readContractFn,
    })

    expect(trusted.status).toBe('ok')
    expect(zeroSupply.status).toBe('zero_supply')
    expect(loadLastTrustedBlock).toHaveBeenCalledTimes(1)
    expect(resolveCandidates).toHaveBeenCalledTimes(1)
    expect(recoverCandidates).toHaveBeenCalledTimes(1)
  })
})

describe('statusForVaultSharePriceSnapshot', () => {
  it.each([
    [{ navSource: 'computeNAV', sharePrice: '1', shares: 1n }, 'ok'],
    [
      { navSource: 'computeNAVStateOverride', sharePrice: '1', shares: 1n },
      'stale_oracle_override',
    ],
    [{ navSource: 'computeNAV', sharePrice: null, shares: 0n }, 'zero_supply'],
    [{ navSource: 'computeNAV', sharePrice: null, shares: 1n }, 'nonpositive_nav'],
  ] as const)('maps %o to %s', (snapshot, expected) => {
    expect(statusForVaultSharePriceSnapshot(snapshot)).toBe(expected)
  })
})
