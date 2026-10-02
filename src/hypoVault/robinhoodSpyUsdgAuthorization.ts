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
import { requireChainDeployment, ROBINHOOD_CHAIN_ID } from './chainDeployments'
import {
  RobinhoodUSDGPLP5bpsStrategistLeaves,
  RobinhoodUSDGPLP30bpsStrategistLeaves,
} from './hypoVaultManagerArtifacts/RobinhoodUSDGPLPStrategistLeaves'
import {
  RobinhoodUSDGPLP5bpsVaultPoolInfos,
  RobinhoodUSDGPLP30bpsVaultPoolInfos,
} from './hypoVaultManagerArtifacts/RobinhoodUSDGPLPVaultPoolInfos'
import type { StrategistLeavesArtifact } from './utils/buildManageArgs'
import type { PoolInfo } from './utils/buildManagerInput'

const deployment = requireChainDeployment(ROBINHOOD_CHAIN_ID)
const vaultAddress = deployment.hypovault.vaults.usdgPlpVault
const managerAddress = deployment.hypovault.managers.usdgPlpVaultManager
const strategistAddress = deployment.hypovault.turnkeySigners.usdgPlpVaultManager

if (vaultAddress === undefined || managerAddress === undefined || strategistAddress === undefined) {
  throw new Error('Missing Robinhood USDG authorization addresses')
}
const resolvedVaultAddress = vaultAddress
const resolvedManagerAddress = managerAddress
const resolvedStrategistAddress = strategistAddress

const POOL_INFO_ARRAY_ABI = {
  type: 'tuple[]',
  components: [
    { name: 'pool', type: 'address' },
    { name: 'token0', type: 'address' },
    { name: 'token1', type: 'address' },
    { name: 'maxPriceDeviation', type: 'int24' },
  ],
} as const

export const ROBINHOOD_USDG_30BPS_MANAGE_ROOT =
  '0x5ef821042a85fea05901e4612e8a8d60efd2468ca08f0810d5691e23ea98967f' as const
export const ROBINHOOD_USDG_30BPS_POOL_HASH =
  '0x12b0d7232a6250eb3cf61040edbf4015717756c4819926aedc3670a4217e56cc' as const
export const ROBINHOOD_USDG_5BPS_POOL_HASH =
  '0xc5dcfa7ae982f641493c9f848bb93cb138a1ad5b3bc13c309b7625850af8562b' as const

export type RobinhoodSpyUsdgAuthorizationVersion = '30bps' | '5bps'

export type RobinhoodSpyUsdgAuthorizationArtifacts = {
  readonly version: RobinhoodSpyUsdgAuthorizationVersion
  readonly blockNumber: bigint
  readonly poolInfos: readonly PoolInfo[]
  readonly strategistLeaves: StrategistLeavesArtifact
  readonly poolHash: Hex
  readonly manageRoot: Hex
}

type Generation = Omit<RobinhoodSpyUsdgAuthorizationArtifacts, 'blockNumber'>

export function hashRobinhoodSpyUsdgPoolInfos(poolInfos: readonly PoolInfo[]): Hex {
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

const generations = [
  {
    version: '30bps',
    poolInfos: RobinhoodUSDGPLP30bpsVaultPoolInfos.poolInfos,
    strategistLeaves: RobinhoodUSDGPLP30bpsStrategistLeaves,
    poolHash: ROBINHOOD_USDG_30BPS_POOL_HASH,
    manageRoot: ROBINHOOD_USDG_30BPS_MANAGE_ROOT,
  },
  {
    version: '5bps',
    poolInfos: RobinhoodUSDGPLP5bpsVaultPoolInfos.poolInfos,
    strategistLeaves: RobinhoodUSDGPLP5bpsStrategistLeaves,
    poolHash: ROBINHOOD_USDG_5BPS_POOL_HASH,
    manageRoot: RobinhoodUSDGPLP5bpsStrategistLeaves.metadata.ManageRoot,
  },
] as const satisfies readonly Generation[]

for (const generation of generations) {
  const computedPoolHash = hashRobinhoodSpyUsdgPoolInfos(generation.poolInfos)
  if (computedPoolHash !== generation.poolHash) {
    throw new Error(
      `Robinhood ${generation.version} pool hash mismatch: expected ${generation.poolHash}, computed ${computedPoolHash}`,
    )
  }
}
if (
  RobinhoodUSDGPLP30bpsStrategistLeaves.metadata.ManageRoot !== ROBINHOOD_USDG_30BPS_MANAGE_ROOT
) {
  throw new Error('Robinhood 30bps strategist artifact no longer reproduces the live manage root')
}

export function getRobinhoodSpyUsdgAuthorizationGenerations(): readonly Generation[] {
  return generations
}

export function resolveRobinhoodSpyUsdgAuthorizationState({
  blockNumber,
  poolHash,
  manageRoot,
}: {
  blockNumber: bigint
  poolHash: Hex
  manageRoot: Hex
}): RobinhoodSpyUsdgAuthorizationArtifacts {
  const generation = generations.find(
    (candidate) => candidate.poolHash === poolHash && candidate.manageRoot === manageRoot,
  )
  if (generation === undefined) {
    throw new Error(
      `Unsupported or inconsistent Robinhood SPY/USDG authorization state: accountant pool hash ${poolHash}, manager root ${manageRoot}`,
    )
  }
  return { blockNumber, ...generation }
}

export async function resolveRobinhoodSpyUsdgAuthorizationArtifacts({
  viemClient,
  chainId,
  vault,
  blockNumber,
}: {
  viemClient: Client
  chainId: number
  vault: Address
  blockNumber?: bigint
}): Promise<RobinhoodSpyUsdgAuthorizationArtifacts | null> {
  if (
    chainId !== ROBINHOOD_CHAIN_ID ||
    vault.toLowerCase() !== resolvedVaultAddress.toLowerCase()
  ) {
    return null
  }
  const resolvedBlockNumber = blockNumber ?? (await getBlockNumber(viemClient))
  const [poolHash, manageRoot] = await Promise.all([
    readContract(viemClient, {
      address: deployment.hypovault.core.accountant,
      abi: PanopticVaultAccountantAbi,
      functionName: 'vaultHashes',
      args: [resolvedVaultAddress, 0n],
      blockNumber: resolvedBlockNumber,
    }),
    readContract(viemClient, {
      address: resolvedManagerAddress,
      abi: HypoVaultManagerWithMerkleVerificationAbi,
      functionName: 'manageRoot',
      args: [resolvedStrategistAddress],
      blockNumber: resolvedBlockNumber,
    }),
  ])
  return resolveRobinhoodSpyUsdgAuthorizationState({
    blockNumber: resolvedBlockNumber,
    poolHash,
    manageRoot,
  })
}
