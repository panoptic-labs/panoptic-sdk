import { type Address, type Hex, type PublicClient, keccak256 } from 'viem'

import { HypoVaultAbi } from '../../abis/HypoVault'
import { PanopticVaultAccountantAbi } from '../../abis/PanopticVaultAccountant'
import { fetchVaultLendingAllocation } from '../analytics/vaultLendingAllocation'
import { getStaleOracleStateOverrideForAccountant } from '../staleOracleOverride'
import type { VaultPoolCandidateTokenIds } from '../utils/vaultManagerInput'
import { isStaleOraclePriceReadError } from './errors'
import { computeSharePriceFromNavSnapshot } from './math'
import { getVaultApyStrategy } from './strategies'
import type { VaultApyVaultLike, VaultSharePriceSnapshot } from './types'

export type ReadContractParams = {
  address: Address
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
  blockNumber?: bigint
  stateOverride?: Array<{ address: Address; code: `0x${string}` }>
}

export type ReadContractFn = (client: PublicClient, params: ReadContractParams) => Promise<unknown>

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return BigInt(value)
  }
  return null
}

function getAssetsDepositedFromDepositEpochState(value: unknown): bigint | null {
  if (Array.isArray(value) && value.length > 0) {
    return toBigInt(value[0])
  }

  if (typeof value === 'object' && value !== null && 'assetsDeposited' in value) {
    const state = value as { assetsDeposited?: unknown }
    return state.assetsDeposited === undefined ? null : toBigInt(state.assetsDeposited)
  }

  return null
}

async function estimateNavOffchainFromPoolState({
  client,
  chainId,
  vaultAddress,
  underlyingTokenAddress,
  blockNumber,
  assetsDeposited,
}: {
  client: PublicClient
  chainId: number
  vaultAddress: Address
  underlyingTokenAddress: Address
  blockNumber: bigint
  assetsDeposited: bigint
}): Promise<bigint | null> {
  try {
    const allocationRows = await fetchVaultLendingAllocation({
      client,
      chainId,
      vaultAddress,
      underlyingTokenAddress,
      blockNumber,
    })
    const totalUnderlying = allocationRows.reduce((sum, row) => sum + row.allocationUnderlying, 0n)
    const totalAssetsEstimate = totalUnderlying + assetsDeposited
    return totalAssetsEstimate === 0n ? 0n : totalAssetsEstimate - 1n
  } catch {
    return null
  }
}

export async function fetchVaultSharePriceSnapshot({
  client,
  vault,
  chainId,
  windowLabel,
  blockNumber,
  readContractFn,
  candidates,
  includeTokenIdsInDiagnostics = false,
}: {
  client: PublicClient
  vault: VaultApyVaultLike
  chainId: number
  windowLabel: 'now' | '7d' | '30d' | 'series'
  blockNumber: bigint
  readContractFn: ReadContractFn
  /**
   * Pre-resolved, block-independent candidate tokenIds, forwarded to the
   * strategy's `managerInputProvider` so a timeseries skips the per-anchor
   * subgraph candidate gather. Omit for one-shot snapshots.
   */
  candidates?: readonly VaultPoolCandidateTokenIds[]
  /**
   * When true, the returned snapshot's `tokenIdsByPool` diagnostics are
   * populated (useful for spike-log debugging). Replaces the UI-only
   * `import.meta.env.VITE_VAULT_APY_SPIKE_LOG_INCLUDE_TOKEN_IDS` flag so the
   * SDK works in plain node contexts. Defaults to false.
   */
  includeTokenIdsInDiagnostics?: boolean
}): Promise<VaultSharePriceSnapshot> {
  const vaultAddress = vault.id as Address
  const accountantAddress = vault.accountant as Address
  const underlyingTokenAddress = vault.underlyingToken.id as Address
  const strategy = getVaultApyStrategy({
    chainId,
    vaultAddress,
  })

  const managerInputProviderResult = await strategy.managerInputProvider({
    chainId,
    vault,
    client,
    blockNumber,
    candidates,
  })
  const managerInput =
    typeof managerInputProviderResult === 'string'
      ? managerInputProviderResult
      : managerInputProviderResult.managerInput
  const managerInputDiagnostics =
    typeof managerInputProviderResult === 'string'
      ? undefined
      : managerInputProviderResult.diagnostics
  const managerInputHash = keccak256(managerInput as Hex)
  const tokenIdCountsByPool =
    managerInputDiagnostics === undefined
      ? null
      : managerInputDiagnostics.tokenIdsByPool.map((tokenIds, index) => ({
          poolAddress: managerInputDiagnostics.poolAddresses[index] ?? null,
          tokenCount: tokenIds.length,
        }))
  const tokenIdsByPool =
    !includeTokenIdsInDiagnostics || managerInputDiagnostics === undefined
      ? null
      : managerInputDiagnostics.tokenIdsByPool.map((tokenIds, index) => ({
          poolAddress: managerInputDiagnostics.poolAddresses[index] ?? null,
          tokenIds: tokenIds.map((tokenId) => tokenId.toString()),
        }))

  const readWithContext = async ({
    callName,
    request,
  }: {
    callName:
      | 'depositEpoch'
      | 'depositEpochState'
      | 'computeNAV'
      | 'reservedWithdrawalAssets'
      | 'totalSupply'
    request: ReadContractParams
  }) => {
    try {
      return await readContractFn(client, request)
    } catch (error) {
      const details =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error'
      throw new Error(`[${callName}] ${details}`)
    }
  }

  // Round 1: the three reads with no data dependency are issued together so the
  // configured client folds them into a single Multicall3 call at this block.
  // `depositEpochState` needs `depositEpoch` as an arg, so it waits for round 2.
  const [depositEpochRaw, reservedWithdrawalAssetsRaw, sharesRaw] = await Promise.all([
    readWithContext({
      callName: 'depositEpoch',
      request: {
        address: vaultAddress,
        abi: HypoVaultAbi,
        functionName: 'depositEpoch',
        blockNumber,
      },
    }),
    readWithContext({
      callName: 'reservedWithdrawalAssets',
      request: {
        address: vaultAddress,
        abi: HypoVaultAbi,
        functionName: 'reservedWithdrawalAssets',
        blockNumber,
      },
    }),
    readWithContext({
      callName: 'totalSupply',
      request: {
        address: vaultAddress,
        abi: HypoVaultAbi,
        functionName: 'totalSupply',
        blockNumber,
      },
    }),
  ])

  const depositEpoch = toBigInt(depositEpochRaw)
  if (depositEpoch === null) {
    throw new Error(`Unexpected depositEpoch output type for vault ${vault.id}`)
  }

  const depositEpochStateRaw = await readWithContext({
    callName: 'depositEpochState',
    request: {
      address: vaultAddress,
      abi: HypoVaultAbi,
      functionName: 'depositEpochState',
      args: [depositEpoch],
      blockNumber,
    },
  })

  const reservedWithdrawalAssets = toBigInt(reservedWithdrawalAssetsRaw)
  const shares = toBigInt(sharesRaw)
  const assetsDeposited = getAssetsDepositedFromDepositEpochState(depositEpochStateRaw)
  if (reservedWithdrawalAssets === null || shares === null || assetsDeposited === null) {
    throw new Error(`Unexpected readContract output types for vault ${vault.id}`)
  }

  let nav: bigint | null = null
  let navSource: VaultSharePriceSnapshot['navSource'] = 'computeNAV'
  const staleOracleStateOverride = getStaleOracleStateOverrideForAccountant(accountantAddress)
  // Issue the initial computeNAV without the stale-oracle state override so a
  // healthy oracle reports `computeNAV`; the override is only injected on the
  // StaleOraclePrice retry below, which is why this request omits it here.
  const navRequest: ReadContractParams = {
    address: accountantAddress,
    abi: PanopticVaultAccountantAbi,
    functionName: 'computeNAV',
    args: [vaultAddress, underlyingTokenAddress, managerInput],
    blockNumber,
  }
  try {
    const navRaw = await readWithContext({
      callName: 'computeNAV',
      request: navRequest,
    })
    nav = toBigInt(navRaw)
    navSource = 'computeNAV'
  } catch (error) {
    if (!isStaleOraclePriceReadError(error)) {
      throw error
    }

    if (staleOracleStateOverride !== undefined) {
      try {
        const navRawWithOverride = await readWithContext({
          callName: 'computeNAV',
          request: {
            ...navRequest,
            stateOverride: staleOracleStateOverride,
          },
        })
        nav = toBigInt(navRawWithOverride)
        navSource = 'computeNAVStateOverride'
      } catch {
        // Keep existing offchain fallback for display continuity.
      }
    }
    if (nav === null) {
      nav = await estimateNavOffchainFromPoolState({
        client,
        chainId,
        vaultAddress,
        underlyingTokenAddress,
        blockNumber,
        assetsDeposited,
      })

      if (nav === null) {
        throw error
      }
      navSource = 'offchainLendingEstimate'
    }
  }
  if (nav === null) {
    throw new Error(`Unexpected computeNAV output type for vault ${vault.id}`)
  }

  const sharePrice = computeSharePriceFromNavSnapshot({
    nav,
    assetsDeposited,
    reservedWithdrawalAssets,
    shares,
  })

  return {
    sharePrice: sharePrice?.toString() ?? null,
    nav,
    assetsDeposited,
    reservedWithdrawalAssets,
    shares,
    blockNumber,
    navSource,
    managerInputBytes: managerInput as Hex,
    managerInputByteLength: (managerInput.length - 2) / 2,
    managerInputHash,
    tokenIdCountsByPool,
    tokenIdsByPool,
  }
}
