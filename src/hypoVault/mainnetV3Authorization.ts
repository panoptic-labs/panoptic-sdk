import {
  type Address,
  type Client,
  type Hex,
  encodeAbiParameters,
  getAddress,
  keccak256,
} from 'viem'
import { getBlockNumber, readContract } from 'viem/actions'

import { HypoVaultManagerWithMerkleVerificationAbi } from '../abis/HypoVaultManagerWithMerkleVerification'
import { PanopticVaultAccountantAbi } from '../abis/PanopticVaultAccountant'
import { MAINNET_CHAIN_ID, requireChainDeployment } from './chainDeployments'
import {
  MainnetUSDCPLPPreviousStrategistLeaves,
  MainnetUSDCPLPStrategistLeaves,
} from './hypoVaultManagerArtifacts/MainnetUSDCPLPStrategistLeaves'
import {
  MainnetUSDCPLPPreviousVaultPoolInfos,
  MainnetUSDCPLPVaultPoolInfos,
} from './hypoVaultManagerArtifacts/MainnetUSDCPLPVaultPoolInfos'
import {
  MainnetWETHPLPPreviousStrategistLeaves,
  MainnetWETHPLPStrategistLeaves,
} from './hypoVaultManagerArtifacts/MainnetWETHPLPStrategistLeaves'
import {
  MainnetWETHPLPPreviousVaultPoolInfos,
  MainnetWETHPLPVaultPoolInfos,
} from './hypoVaultManagerArtifacts/MainnetWETHPLPVaultPoolInfos'
import type { StrategistLeavesArtifact } from './utils/buildManageArgs'
import type { PoolInfo } from './utils/buildManagerInput'

const MAINNET_DEPLOYMENT = requireChainDeployment(MAINNET_CHAIN_ID)

/** Block containing the successful V3 accountant-hash and manager-root update. */
export const MAINNET_V3_AUTHORIZATION_BLOCK = 25_704_951n

const POOL_INFO_ARRAY_ABI = {
  type: 'tuple[]',
  components: [
    { name: 'pool', type: 'address' },
    { name: 'token0', type: 'address' },
    { name: 'token1', type: 'address' },
    { name: 'maxPriceDeviation', type: 'int24' },
  ],
} as const

export type MainnetV3AuthorizationVersion = 'previous' | 'next'

export type MainnetV3AuthorizationArtifacts = {
  readonly version: MainnetV3AuthorizationVersion
  readonly blockNumber: bigint
  readonly poolInfos: readonly PoolInfo[]
  readonly strategistLeaves: StrategistLeavesArtifact
  readonly poolHash: Hex
  readonly manageRoot: Hex
}

type AuthorizationGeneration = Omit<MainnetV3AuthorizationArtifacts, 'blockNumber' | 'version'>

type VaultTransition = {
  readonly vaultAddress: Address
  readonly managerAddress: Address
  readonly strategistAddress: Address
  readonly activationBlockNumber: bigint
  readonly previous: AuthorizationGeneration
  readonly next: AuthorizationGeneration
  readonly generations: readonly (AuthorizationGeneration & {
    readonly version: MainnetV3AuthorizationVersion
  })[]
}

function createVaultTransition(transition: Omit<VaultTransition, 'generations'>): VaultTransition {
  return {
    ...transition,
    generations: [
      { version: 'previous', ...transition.previous },
      { version: 'next', ...transition.next },
    ],
  }
}

function hashPoolInfos(poolInfos: readonly PoolInfo[]): Hex {
  return keccak256(
    encodeAbiParameters(
      [POOL_INFO_ARRAY_ABI],
      [
        poolInfos.map((poolInfo) => ({
          pool: getAddress(poolInfo.pool),
          token0: getAddress(poolInfo.token0),
          token1: getAddress(poolInfo.token1),
          maxPriceDeviation: poolInfo.maxPriceDeviation,
        })),
      ],
    ),
  )
}

function generation(
  poolInfos: readonly PoolInfo[],
  strategistLeaves: StrategistLeavesArtifact,
): AuthorizationGeneration {
  return {
    poolInfos,
    strategistLeaves,
    poolHash: hashPoolInfos(poolInfos),
    manageRoot: strategistLeaves.metadata.ManageRoot,
  }
}

const MAINNET_V3_AUTHORIZATION_TRANSITIONS: readonly VaultTransition[] = [
  createVaultTransition({
    vaultAddress: MAINNET_DEPLOYMENT.hypovault.vaults.wethPlpVault,
    managerAddress: MAINNET_DEPLOYMENT.hypovault.managers.wethPlpVaultManager,
    strategistAddress: MAINNET_DEPLOYMENT.hypovault.turnkeySigners.wethPlpVaultManager,
    activationBlockNumber: MAINNET_V3_AUTHORIZATION_BLOCK,
    previous: generation(
      MainnetWETHPLPPreviousVaultPoolInfos.poolInfos,
      MainnetWETHPLPPreviousStrategistLeaves,
    ),
    next: generation(MainnetWETHPLPVaultPoolInfos.poolInfos, MainnetWETHPLPStrategistLeaves),
  }),
  createVaultTransition({
    vaultAddress: MAINNET_DEPLOYMENT.hypovault.vaults.usdcPlpVault,
    managerAddress: MAINNET_DEPLOYMENT.hypovault.managers.usdcPlpVaultManager,
    strategistAddress: MAINNET_DEPLOYMENT.hypovault.turnkeySigners.usdcPlpVaultManager,
    activationBlockNumber: MAINNET_V3_AUTHORIZATION_BLOCK,
    previous: generation(
      MainnetUSDCPLPPreviousVaultPoolInfos.poolInfos,
      MainnetUSDCPLPPreviousStrategistLeaves,
    ),
    next: generation(MainnetUSDCPLPVaultPoolInfos.poolInfos, MainnetUSDCPLPStrategistLeaves),
  }),
] as const

const authorizationCacheByClient = new WeakMap<
  Client,
  Map<string, MainnetV3AuthorizationArtifacts>
>()

function findTransition(chainId: number, vaultAddress: Address): VaultTransition | null {
  if (chainId !== MAINNET_CHAIN_ID) {
    return null
  }
  const normalizedVault = vaultAddress.toLowerCase()
  return (
    MAINNET_V3_AUTHORIZATION_TRANSITIONS.find(
      (transition) => transition.vaultAddress.toLowerCase() === normalizedVault,
    ) ?? null
  )
}

/** Returns both known generations without reading chain state. */
export function getMainnetV3AuthorizationGenerations({
  chainId,
  vaultAddress,
}: {
  chainId: number
  vaultAddress: Address
}): Pick<VaultTransition, 'previous' | 'next'> | null {
  const transition = findTransition(chainId, vaultAddress)
  return transition === null ? null : { previous: transition.previous, next: transition.next }
}

/**
 * Selects the mainnet authorization artifacts active at a historical block without RPC reads.
 * Live callers should use the compiled current artifacts directly; this selector exists for
 * block-pinned NAV and manager-input reconstruction across the V3 authorization boundary.
 */
export function getMainnetV3AuthorizationArtifactsAtBlock({
  chainId,
  vaultAddress,
  blockNumber,
}: {
  chainId: number
  vaultAddress: Address
  blockNumber: bigint
}): MainnetV3AuthorizationArtifacts | null {
  const transition = findTransition(chainId, vaultAddress)
  if (transition === null) return null

  const version = blockNumber < transition.activationBlockNumber ? 'previous' : 'next'
  return { blockNumber, version, ...transition[version] }
}

/**
 * Selects the exact artifact generation authorized by both the accountant and manager.
 * A mixed or unknown state is rejected: using only one side of the transition would
 * make either NAV calculation or strategist proof verification fail.
 * Every authorization release must add its generation to this transition table before
 * the on-chain hashes change, so startup and release verification keeps recognizing it.
 */
export async function resolveMainnetV3AuthorizationArtifacts({
  viemClient,
  chainId,
  vaultAddress,
  blockNumber,
}: {
  viemClient: Client
  chainId: number
  vaultAddress: Address
  blockNumber?: bigint
}): Promise<MainnetV3AuthorizationArtifacts | null> {
  const transition = findTransition(chainId, vaultAddress)
  if (transition === null) {
    return null
  }

  const resolvedBlockNumber = blockNumber ?? (await getBlockNumber(viemClient))
  const cacheKey = `${chainId}:${vaultAddress.toLowerCase()}:${resolvedBlockNumber.toString()}`
  const clientCache = authorizationCacheByClient.get(viemClient)
  const cached = clientCache?.get(cacheKey)
  if (cached !== undefined) return cached
  const [poolHash, manageRoot] = await Promise.all([
    readContract(viemClient, {
      address: MAINNET_DEPLOYMENT.hypovault.core.accountant,
      abi: PanopticVaultAccountantAbi,
      functionName: 'vaultHashes',
      args: [transition.vaultAddress, 0n],
      blockNumber: resolvedBlockNumber,
    }),
    readContract(viemClient, {
      address: transition.managerAddress,
      abi: HypoVaultManagerWithMerkleVerificationAbi,
      functionName: 'manageRoot',
      args: [transition.strategistAddress],
      blockNumber: resolvedBlockNumber,
    }),
  ])

  for (const candidate of [...transition.generations].reverse()) {
    if (poolHash === candidate.poolHash && manageRoot === candidate.manageRoot) {
      const resolved = { blockNumber: resolvedBlockNumber, ...candidate }
      const resolvedClientCache = clientCache ?? new Map<string, MainnetV3AuthorizationArtifacts>()
      resolvedClientCache.set(cacheKey, resolved)
      if (clientCache === undefined) authorizationCacheByClient.set(viemClient, resolvedClientCache)
      return resolved
    }
  }

  throw new Error(
    `Unsupported or inconsistent mainnet v3 authorization state for vault ${transition.vaultAddress}: accountant pool hash ${poolHash}, manager root ${manageRoot}`,
  )
}
