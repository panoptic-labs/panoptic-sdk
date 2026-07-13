import type { Address } from 'viem'

import {
  BASE_CHAIN_ID,
  MAINNET_CHAIN_ID,
  requireChainDeployment,
  SEPOLIA_CHAIN_ID,
} from '../chainDeployments'
import { BaseUSDCPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/BaseUSDCPLPVaultPoolInfos'
import { BaseWETHPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/BaseWETHPLPVaultPoolInfos'
import { MainnetUSDCPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/MainnetUSDCPLPVaultPoolInfos'
import { MainnetWETHPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/MainnetWETHPLPVaultPoolInfos'
import { SepoliaUSDCPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/SepoliaUSDCPLPVaultPoolInfos'
import { SepoliaWETHPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/SepoliaWETHPLPVaultPoolInfos'
import { getHypoVaultConfigForVault } from '../hypoVaultManagerConfigs/vaultToConfig'
import { buildManagerInputAtBlock } from '../utils/buildManagerInputAtBlock'
import {
  getVaultPoolInfos,
  resolveVaultHistoricalCandidatesByPool,
  resolveVaultTokenIdsByPool,
  verifyVaultOpenTokenIdsAtBlock,
} from '../utils/vaultManagerInput'
import { VaultApyPreInceptionBlockError } from './errors'
import type { VaultApyStrategy } from './types'

const DEFAULT_MANAGER_INPUT = '0x' as const

function buildVaultStrategyKey(chainId: number, vaultAddress: Address): string {
  return `${chainId}:${vaultAddress.toLowerCase()}`
}

function resolveChainWethAddress(chainId: number): Address | undefined {
  // Only the unsupported-chain / no-deployment case is expected here; let any
  // other failure surface instead of masking it.
  let deployment: ReturnType<typeof requireChainDeployment>
  try {
    deployment = requireChainDeployment(chainId)
  } catch {
    return undefined
  }
  const wethVaultAddress = deployment.hypovault.vaults.wethPlpVault as Address
  return getHypoVaultConfigForVault(wethVaultAddress, chainId)?.addresses?.underlyingToken as
    | Address
    | undefined
}

function getPlpManagerAddress(chainId: number, vaultAddress: Address): Address | null {
  return (
    getHypoVaultConfigForVault(vaultAddress, chainId)?.addresses
      ?.hypoVaultManagerWithMerkleVerification ?? null
  )
}

function createPlpManagerInputStrategy(minBlock?: bigint): VaultApyStrategy {
  return {
    enabledMetrics: ['nav'],
    resolveCandidates: async ({ chainId, vault }) => {
      const vaultAddress = vault.id as Address
      const poolInfos = getVaultPoolInfos(vaultAddress, chainId)
      if (poolInfos.length === 0) {
        return []
      }
      return resolveVaultHistoricalCandidatesByPool({
        chainId,
        vaultAddress,
        managerAddress: getPlpManagerAddress(chainId, vaultAddress),
        poolInfos,
      })
    },
    managerInputProvider: async ({ chainId, client, vault, blockNumber, candidates }) => {
      const vaultAddress = vault.id as Address
      if (minBlock !== undefined && blockNumber < minBlock) {
        throw new VaultApyPreInceptionBlockError({
          blockNumber,
          minBlockNumber: minBlock,
          context: `PLP manager input for vault ${vault.id}`,
        })
      }

      const poolInfos = getVaultPoolInfos(vaultAddress, chainId)
      if (poolInfos.length === 0) {
        return DEFAULT_MANAGER_INPUT
      }

      // When the caller pre-resolved the (block-independent) candidate set, verify
      // it on-chain at this block instead of re-running the subgraph paging.
      const tokenIds =
        candidates === undefined
          ? await resolveVaultTokenIdsByPool({
              viemClient: client,
              chainId,
              vaultAddress,
              managerAddress: getPlpManagerAddress(chainId, vaultAddress),
              poolInfos,
              verificationBlockNumber: blockNumber,
            })
          : await verifyVaultOpenTokenIdsAtBlock({
              viemClient: client,
              vaultAddress,
              candidatesByPool: candidates,
              blockNumber,
            })

      const wethAddress = resolveChainWethAddress(chainId)

      const managerInput = await buildManagerInputAtBlock({
        viemClient: client,
        poolInfos,
        tokenIds,
        underlyingToken: vault.underlyingToken.id as Address,
        ...(wethAddress === undefined ? {} : { wethAddress }),
        blockNumber,
      })

      return {
        managerInput,
        diagnostics: {
          poolAddresses: poolInfos.map((poolInfo) => poolInfo.pool),
          tokenIdsByPool: tokenIds,
        },
      }
    },
  }
}

const SEPOLIA_PLP_POOL_MIN_BLOCK = 10_268_542n

const defaultStrategy: VaultApyStrategy = {
  enabledMetrics: ['nav'],
  managerInputProvider: async () => DEFAULT_MANAGER_INPUT,
}

const strategyOverridesByVaultKey: Record<string, VaultApyStrategy> = {
  [buildVaultStrategyKey(MAINNET_CHAIN_ID, MainnetUSDCPLPVaultPoolInfos.vaultAddress)]:
    createPlpManagerInputStrategy(),
  [buildVaultStrategyKey(MAINNET_CHAIN_ID, MainnetWETHPLPVaultPoolInfos.vaultAddress)]:
    createPlpManagerInputStrategy(),
  [buildVaultStrategyKey(BASE_CHAIN_ID, BaseUSDCPLPVaultPoolInfos.vaultAddress)]:
    createPlpManagerInputStrategy(),
  [buildVaultStrategyKey(BASE_CHAIN_ID, BaseWETHPLPVaultPoolInfos.vaultAddress)]:
    createPlpManagerInputStrategy(),
  [buildVaultStrategyKey(SEPOLIA_CHAIN_ID, SepoliaUSDCPLPVaultPoolInfos.vaultAddress)]:
    createPlpManagerInputStrategy(SEPOLIA_PLP_POOL_MIN_BLOCK),
  [buildVaultStrategyKey(SEPOLIA_CHAIN_ID, SepoliaWETHPLPVaultPoolInfos.vaultAddress)]:
    createPlpManagerInputStrategy(SEPOLIA_PLP_POOL_MIN_BLOCK),
}

export function getVaultApyStrategy({
  chainId,
  vaultAddress,
}: {
  chainId: number
  vaultAddress: Address
}): VaultApyStrategy {
  const key = buildVaultStrategyKey(chainId, vaultAddress)
  return strategyOverridesByVaultKey[key] ?? defaultStrategy
}

export function setVaultApyStrategyOverride({
  chainId,
  vaultAddress,
  strategy,
}: {
  chainId: number
  vaultAddress: Address
  strategy: VaultApyStrategy
}) {
  const key = buildVaultStrategyKey(chainId, vaultAddress)
  strategyOverridesByVaultKey[key] = strategy
}
