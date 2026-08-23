import type { PublicClient } from 'viem'

import type { VaultPoolCandidateTokenIds } from '../utils/vaultManagerInput'
import { isTrustedVaultSharePriceStatus } from './errors'
import {
  type FetchVaultSharePriceSnapshotParams,
  type ReadContractFn,
  fetchVaultSharePriceSnapshotWithCandidateRecovery,
} from './snapshot'
import type { VaultApyStrategy, VaultApyVaultLike, VaultSharePriceSnapshot } from './types'

const DEFAULT_CANDIDATE_REFRESH_SECONDS = 3_600n

export type VaultSharePriceStatus =
  | 'ok'
  | 'stale_oracle_override'
  | 'zero_supply'
  | 'nonpositive_nav'

export function statusForVaultSharePriceSnapshot(
  snapshot: Pick<VaultSharePriceSnapshot, 'navSource' | 'sharePrice' | 'shares'>,
): VaultSharePriceStatus {
  if (snapshot.sharePrice === null) {
    return snapshot.shares <= 0n ? 'zero_supply' : 'nonpositive_nav'
  }
  return snapshot.navSource === 'computeNAVStateOverride' ? 'stale_oracle_override' : 'ok'
}

export function createVaultSharePriceProcessor({
  chainId,
  client,
  candidateRefreshSeconds = DEFAULT_CANDIDATE_REFRESH_SECONDS,
}: {
  chainId: number
  client: PublicClient
  candidateRefreshSeconds?: bigint
}) {
  const candidateCache = new Map<
    string,
    { candidates: readonly VaultPoolCandidateTokenIds[]; fetchedAtChainTime: bigint }
  >()
  const lastTrustedBlockByVault = new Map<string, bigint>()
  const seededVaults = new Set<string>()

  async function getCandidates({
    strategy,
    vault,
    blockTimestamp,
  }: {
    strategy: VaultApyStrategy
    vault: VaultApyVaultLike
    blockTimestamp: bigint
  }): Promise<readonly VaultPoolCandidateTokenIds[] | undefined> {
    if (strategy.resolveCandidates === undefined) return undefined

    const cached = candidateCache.get(vault.id)
    if (
      cached !== undefined &&
      blockTimestamp - cached.fetchedAtChainTime < candidateRefreshSeconds
    ) {
      return cached.candidates
    }

    const candidates = await strategy.resolveCandidates({ chainId, vault, client })
    candidateCache.set(vault.id, { candidates, fetchedAtChainTime: blockTimestamp })
    return candidates
  }

  async function getRecoveryFromBlock({
    vault,
    recoveryFallbackBlock,
    loadLastTrustedBlock,
  }: {
    vault: VaultApyVaultLike
    recoveryFallbackBlock: bigint
    loadLastTrustedBlock: () => Promise<bigint | undefined>
  }): Promise<bigint> {
    if (!seededVaults.has(vault.id)) {
      const persistedBlock = await loadLastTrustedBlock()
      if (persistedBlock !== undefined) {
        lastTrustedBlockByVault.set(vault.id, persistedBlock)
      }
      seededVaults.add(vault.id)
    }
    return lastTrustedBlockByVault.get(vault.id) ?? recoveryFallbackBlock
  }

  return {
    async process({
      vault,
      strategy,
      blockNumber,
      blockTimestamp,
      recoveryFallbackBlock,
      loadLastTrustedBlock,
      readContractFn,
      windowLabel = 'series',
    }: {
      vault: VaultApyVaultLike
      strategy: VaultApyStrategy
      blockNumber: bigint
      blockTimestamp: bigint
      recoveryFallbackBlock: bigint
      loadLastTrustedBlock: () => Promise<bigint | undefined>
      readContractFn: ReadContractFn
      windowLabel?: FetchVaultSharePriceSnapshotParams['windowLabel']
    }): Promise<{ snapshot: VaultSharePriceSnapshot; status: VaultSharePriceStatus }> {
      const candidates = await getCandidates({ strategy, vault, blockTimestamp })
      const recoveryFromBlock = await getRecoveryFromBlock({
        vault,
        recoveryFallbackBlock,
        loadLastTrustedBlock,
      })
      const result = await fetchVaultSharePriceSnapshotWithCandidateRecovery({
        client,
        vault,
        chainId,
        windowLabel,
        blockNumber,
        readContractFn,
        candidates,
        recoveryFromBlock,
      })

      if (result.candidates !== undefined && result.candidates !== candidates) {
        candidateCache.set(vault.id, {
          candidates: result.candidates,
          fetchedAtChainTime: blockTimestamp,
        })
      }
      const status = statusForVaultSharePriceSnapshot(result.snapshot)
      if (isTrustedVaultSharePriceStatus(status)) {
        lastTrustedBlockByVault.set(vault.id, blockNumber)
      }

      return {
        snapshot: result.snapshot,
        status,
      }
    },
  }
}
