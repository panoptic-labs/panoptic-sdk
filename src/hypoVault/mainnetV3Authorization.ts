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
  readonly previous: AuthorizationGeneration
  readonly next: AuthorizationGeneration
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
    manageRoot: strategistLeaves.metadata.ManageRoot as Hex,
  }
}

const MAINNET_V3_AUTHORIZATION_TRANSITIONS: readonly VaultTransition[] = [
  {
    vaultAddress: MAINNET_DEPLOYMENT.hypovault.vaults.wethPlpVault,
    managerAddress: MAINNET_DEPLOYMENT.hypovault.managers.wethPlpVaultManager,
    strategistAddress: MAINNET_DEPLOYMENT.hypovault.turnkeySigners.wethPlpVaultManager,
    previous: generation(
      MainnetWETHPLPPreviousVaultPoolInfos.poolInfos,
      MainnetWETHPLPPreviousStrategistLeaves,
    ),
    next: generation(MainnetWETHPLPVaultPoolInfos.poolInfos, MainnetWETHPLPStrategistLeaves),
  },
  {
    vaultAddress: MAINNET_DEPLOYMENT.hypovault.vaults.usdcPlpVault,
    managerAddress: MAINNET_DEPLOYMENT.hypovault.managers.usdcPlpVaultManager,
    strategistAddress: MAINNET_DEPLOYMENT.hypovault.turnkeySigners.usdcPlpVaultManager,
    previous: generation(
      MainnetUSDCPLPPreviousVaultPoolInfos.poolInfos,
      MainnetUSDCPLPPreviousStrategistLeaves,
    ),
    next: generation(MainnetUSDCPLPVaultPoolInfos.poolInfos, MainnetUSDCPLPStrategistLeaves),
  },
] as const

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
 * Selects the exact artifact generation authorized by both the accountant and manager.
 * A mixed or unknown state is rejected: using only one side of the transition would
 * make either NAV calculation or strategist proof verification fail.
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

  for (const version of ['next', 'previous'] as const) {
    const candidate = transition[version]
    if (poolHash === candidate.poolHash && manageRoot === candidate.manageRoot) {
      return { version, blockNumber: resolvedBlockNumber, ...candidate }
    }
  }

  throw new Error(
    `Unsupported or inconsistent mainnet v3 authorization state for vault ${transition.vaultAddress}: accountant pool hash ${poolHash}, manager root ${manageRoot}`,
  )
}
