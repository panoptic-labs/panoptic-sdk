import { type Address, type Hex, type PublicClient, keccak256 } from 'viem'

import { HypoVaultAbi } from '../../abis/HypoVault'
import { PanopticVaultAccountantAbi } from '../../abis/PanopticVaultAccountant'
import { getStaleOracleStateOverrideForAccountant } from '../staleOracleOverride'
import type { VaultPoolCandidateTokenIds } from '../utils/vaultManagerInput'
import { isIncorrectPositionListReadError, isStaleOraclePriceReadError } from './errors'
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

export type FetchVaultSharePriceSnapshotParams = {
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
  /** Populate full token-id diagnostics instead of counts only. */
  includeTokenIdsInDiagnostics?: boolean
}

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

export async function fetchVaultSharePriceSnapshot({
  client,
  vault,
  chainId,
  windowLabel,
  blockNumber,
  readContractFn,
  candidates,
  includeTokenIdsInDiagnostics = false,
}: FetchVaultSharePriceSnapshotParams): Promise<VaultSharePriceSnapshot> {
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
      throw Object.assign(new Error(`[${callName}] ${details}`), { cause: error })
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

    if (staleOracleStateOverride === undefined) {
      throw error
    }

    const navRawWithOverride = await readWithContext({
      callName: 'computeNAV',
      request: {
        ...navRequest,
        stateOverride: staleOracleStateOverride,
      },
    })
    nav = toBigInt(navRawWithOverride)
    navSource = 'computeNAVStateOverride'
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

export async function fetchVaultSharePriceSnapshotWithCandidateRecovery({
  recoveryFromBlock,
  ...params
}: FetchVaultSharePriceSnapshotParams & {
  recoveryFromBlock: bigint
}): Promise<{
  snapshot: VaultSharePriceSnapshot
  candidates: readonly VaultPoolCandidateTokenIds[] | undefined
}> {
  try {
    return {
      snapshot: await fetchVaultSharePriceSnapshot(params),
      candidates: params.candidates,
    }
  } catch (error) {
    const strategy = getVaultApyStrategy({
      chainId: params.chainId,
      vaultAddress: params.vault.id as Address,
    })
    if (
      !isIncorrectPositionListReadError(error) ||
      strategy.recoverCandidates === undefined ||
      params.candidates === undefined
    ) {
      throw error
    }

    const recoveredCandidates = await strategy.recoverCandidates({
      chainId: params.chainId,
      vault: params.vault,
      client: params.client,
      blockNumber: params.blockNumber,
      fromBlock: recoveryFromBlock,
      candidates: params.candidates,
    })
    return {
      snapshot: await fetchVaultSharePriceSnapshot({
        ...params,
        candidates: recoveredCandidates,
      }),
      candidates: recoveredCandidates,
    }
  }
}
