import { type Address, type Hex, encodeAbiParameters, getAddress, keccak256 } from 'viem'

import { MAINNET_CHAIN_ID, requireChainDeployment } from './chainDeployments'
import {
  MainnetUSDCPLPPreviousVaultPoolInfos,
  MainnetUSDCPLPV3AuthorizedVaultPoolInfos,
} from './hypoVaultManagerArtifacts/MainnetUSDCPLPVaultPoolInfos'
import {
  MainnetWETHPLPPreviousVaultPoolInfos,
  MainnetWETHPLPV3AuthorizedVaultPoolInfos,
} from './hypoVaultManagerArtifacts/MainnetWETHPLPVaultPoolInfos'
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

export type MainnetVaultPoolConfiguration = {
  readonly activationBlockNumber: bigint
  readonly transactionHash: Hex
  readonly poolInfos: readonly PoolInfo[]
  readonly poolHash: Hex
}

export type MainnetVaultManagerRootTransition = {
  readonly activationBlockNumber: bigint
  readonly transactionHash: Hex
  readonly manageRoot: Hex
}

type VaultHistory = {
  readonly vaultAddress: Address
  readonly poolConfigurations: readonly MainnetVaultPoolConfiguration[]
  readonly managerRootTransitions: readonly MainnetVaultManagerRootTransition[]
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

function poolConfiguration(
  activationBlockNumber: bigint,
  transactionHash: Hex,
  poolInfos: readonly PoolInfo[],
): MainnetVaultPoolConfiguration {
  return {
    activationBlockNumber,
    transactionHash,
    poolInfos,
    poolHash: hashPoolInfos(poolInfos),
  }
}

const wethInitialPoolInfos = MainnetWETHPLPPreviousVaultPoolInfos.poolInfos
const usdcInitialPoolInfos = MainnetUSDCPLPPreviousVaultPoolInfos.poolInfos.slice(0, 1)
const usdcTwoPoolInitialDeviation = MainnetUSDCPLPPreviousVaultPoolInfos.poolInfos.map(
  (poolInfo, index) => (index === 1 ? { ...poolInfo, maxPriceDeviation: 100 } : poolInfo),
)

/**
 * Mainnet production vault authorization history reconstructed from:
 * - every `updateHashes` call into the accountant (transaction traces), and
 * - every `ManageRootUpdated` event for each production strategist.
 *
 * Manager roots are retained as audit metadata. `computeNAV` only consumes the
 * accountant pool configuration, so share-price reconstruction deliberately
 * does not require historical Merkle leaves.
 */
const MAINNET_VAULT_HISTORIES: readonly VaultHistory[] = [
  {
    vaultAddress: MAINNET_DEPLOYMENT.hypovault.vaults.wethPlpVault,
    poolConfigurations: [
      poolConfiguration(
        25_296_753n,
        '0xdb7ed1d63d3f3b158fca070bdbf8d0268ed8e5c398cae772a1facb40987a838e',
        wethInitialPoolInfos,
      ),
      poolConfiguration(
        25_704_951n,
        '0xb6d62abb10728655c4c9b612abcd82af9e93c5906357eb6be41cabb224b32118',
        MainnetWETHPLPV3AuthorizedVaultPoolInfos.poolInfos,
      ),
    ],
    managerRootTransitions: [
      {
        activationBlockNumber: 25_296_743n,
        transactionHash: '0xe809d2b0d67da62888967ba15b75168154b1dfe3036f9d7801ce4c2589091226',
        manageRoot: '0xcd0defea21f2f5625ba2d231bce9500ad31a12181821c3e44a9eab8091726ef9',
      },
      {
        activationBlockNumber: 25_303_785n,
        transactionHash: '0xa4deca842f0ce6ed3f95eecc07820869466349df2af78f5d4d9a3b5fac2867b1',
        manageRoot: '0x14c4c96cc3730452ce71a447bdde6132f81acec862098a9ddd5e086805046a07',
      },
      {
        activationBlockNumber: 25_704_951n,
        transactionHash: '0xb6d62abb10728655c4c9b612abcd82af9e93c5906357eb6be41cabb224b32118',
        manageRoot: '0x4d2fb008ac93d2a363881e31e65f31bacbefef39efb44cf2f95b65cf49c65c7d',
      },
    ],
  },
  {
    vaultAddress: MAINNET_DEPLOYMENT.hypovault.vaults.usdcPlpVault,
    poolConfigurations: [
      poolConfiguration(
        25_296_798n,
        '0x37f7ea4ec78c071b6301576745b22f411ac729363fab4202213c7191d89f48c6',
        usdcInitialPoolInfos,
      ),
      poolConfiguration(
        25_332_015n,
        '0xbe29b782e3aab5cb28476248ff4f5ea67cb6adc16bb5488ec7a1a27f07e59752',
        usdcTwoPoolInitialDeviation,
      ),
      poolConfiguration(
        25_332_931n,
        '0xb0cc8525abcf3c507eb46e8654250cc67e500886f031adec8cfb5b0baf7c2028',
        MainnetUSDCPLPPreviousVaultPoolInfos.poolInfos,
      ),
      poolConfiguration(
        25_704_951n,
        '0xb6d62abb10728655c4c9b612abcd82af9e93c5906357eb6be41cabb224b32118',
        MainnetUSDCPLPV3AuthorizedVaultPoolInfos.poolInfos,
      ),
    ],
    managerRootTransitions: [
      {
        activationBlockNumber: 25_296_786n,
        transactionHash: '0x76ffd4204aa7ce84195d22254d0450f1438656d1da034d54ac267c2636b0a06d',
        manageRoot: '0xe00ec1dbc941e12239b487765793e966350d795b11092d1cfbcb894be46c40d4',
      },
      {
        activationBlockNumber: 25_303_784n,
        transactionHash: '0xea67b8b3ab2cdee17ec79f7d59268468dd7b91774d318f219e5b405246617293',
        manageRoot: '0x215542d18c9cf442c62bc3a06dbe8d8d9bc893e5d97e70b675e5c8b1721c6e29',
      },
      {
        activationBlockNumber: 25_332_022n,
        transactionHash: '0xec02bfbfaa10325189ca751d2cf2412b6004910e65f43d40418bd0e12e7c40d1',
        manageRoot: '0xed7d4ae055fd62c6edc93bd676456748f52fe4f4b78f60ab3ef6394bacc31b5d',
      },
      {
        activationBlockNumber: 25_704_951n,
        transactionHash: '0xb6d62abb10728655c4c9b612abcd82af9e93c5906357eb6be41cabb224b32118',
        manageRoot: '0x3223880461fe3e61dc96d9d81579ae943507ec95f17cba100b462cec53967e14',
      },
    ],
  },
] as const

function copyPoolConfiguration(
  configuration: MainnetVaultPoolConfiguration,
): MainnetVaultPoolConfiguration {
  return {
    ...configuration,
    poolInfos: configuration.poolInfos.map((poolInfo) => ({ ...poolInfo })),
  }
}

function copyManagerRootTransition(
  transition: MainnetVaultManagerRootTransition,
): MainnetVaultManagerRootTransition {
  return { ...transition }
}

function copyHistory(history: VaultHistory): VaultHistory {
  return {
    ...history,
    poolConfigurations: history.poolConfigurations.map(copyPoolConfiguration),
    managerRootTransitions: history.managerRootTransitions.map(copyManagerRootTransition),
  }
}

function findHistory(chainId: number, vaultAddress: Address): VaultHistory | null {
  if (chainId !== MAINNET_CHAIN_ID) return null
  const normalizedVault = vaultAddress.toLowerCase()
  const history = MAINNET_VAULT_HISTORIES.find(
    (candidate) => candidate.vaultAddress.toLowerCase() === normalizedVault,
  )
  return history === undefined ? null : copyHistory(history)
}

function latestAtBlock<T extends { readonly activationBlockNumber: bigint }>(
  values: readonly T[],
  blockNumber: bigint,
): T | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (value !== undefined && blockNumber >= value.activationBlockNumber) return { ...value }
  }
  return null
}

export function getMainnetVaultPoolConfigurationAtBlock({
  chainId,
  vaultAddress,
  blockNumber,
}: {
  chainId: number
  vaultAddress: Address
  blockNumber: bigint
}): MainnetVaultPoolConfiguration | null {
  const history = findHistory(chainId, vaultAddress)
  return history === null ? null : latestAtBlock(history.poolConfigurations, blockNumber)
}

export function getMainnetVaultManagerRootAtBlock({
  chainId,
  vaultAddress,
  blockNumber,
}: {
  chainId: number
  vaultAddress: Address
  blockNumber: bigint
}): MainnetVaultManagerRootTransition | null {
  const history = findHistory(chainId, vaultAddress)
  return history === null ? null : latestAtBlock(history.managerRootTransitions, blockNumber)
}

export function getMainnetVaultPoolConfigurationHistory({
  chainId,
  vaultAddress,
}: {
  chainId: number
  vaultAddress: Address
}): readonly MainnetVaultPoolConfiguration[] | null {
  return findHistory(chainId, vaultAddress)?.poolConfigurations ?? null
}

export function getMainnetVaultManagerRootHistory({
  chainId,
  vaultAddress,
}: {
  chainId: number
  vaultAddress: Address
}): readonly MainnetVaultManagerRootTransition[] | null {
  return findHistory(chainId, vaultAddress)?.managerRootTransitions ?? null
}
