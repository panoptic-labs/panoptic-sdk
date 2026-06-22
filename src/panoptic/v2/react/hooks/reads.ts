/**
 * TanStack Query v5 read hooks for the Panoptic v2 SDK.
 * @module v2/react/hooks/reads
 */

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import type { Address, PublicClient } from 'viem'

import { estimateBlockNumbers, resolveBlockNumbers } from '../../clients/blocksByTimestamp'
import { PanopticValidationError } from '../../errors'
import {
  type GetEnforcedTickLimitsParams,
  type GetFactoryConstructMetadataParams,
  type GetFactoryOwnerOfParams,
  type GetFactoryTokenURIParams,
  type GetPanopticPoolAddressParams,
  type GetPanopticPoolFromPoolIdParams,
  type GetUniswapV3PoolFromIdParams,
  type GetUniswapV4PoolKeyFromIdParams,
  type MinePoolAddressLocalParams,
  type ResolvePanopticPoolFromPoolIdParams,
  type SimulateDeployNewPoolParams,
  type UniswapV4PoolKey,
  estimateCollateralRequired,
  getAccountCollateral,
  getAccountGreeks,
  getAccountPremia,
  getAccountSummaryBasic,
  getAccountSummaryRisk,
  getCollateralData,
  getCurrentRates,
  getEnforcedTickLimits,
  getFactoryConstructMetadata,
  getFactoryOwnerOf,
  getFactoryTokenURI,
  getGuardianUnlockState,
  getInterestState,
  getLiquidationPrices,
  getMarginBuffer,
  getMaxPositionSize,
  getMaxWithdrawable,
  getNativeTokenPrice,
  getNetLiquidationValue,
  getNetLiquidationValues,
  getOpenPositionPreview,
  getOracleState,
  getPanopticPoolAddress,
  getPanopticPoolFromPoolId,
  getPool,
  getPoolLiquidities,
  getPosition,
  getPositionGreeks,
  getPositions,
  getPositionsWithPremia,
  getRequiredCreditForITM,
  getRiskParameters,
  getSafeMode,
  getUniswapV3PoolFromId,
  getUniswapV3PoolInfo,
  getUniswapV3PoolLiquidities,
  getUniswapV4PoolBasicState,
  getUniswapV4PoolInfo,
  getUniswapV4PoolKeyFromId,
  getUniswapV4PoolLiquidities,
  getUtilization,
  isLiquidatable,
  minePoolAddressLocalAsync,
  previewDeposit,
  previewMint,
  previewRedeem,
  previewWithdraw,
  resolvePanopticPoolFromPoolId,
  resolveUniswapV4PoolKey,
  simulateDeployNewPool,
  validateBuilderCode,
} from '../../reads'
import { getPriceHistory } from '../../reads/priceHistory'
import { optimizeTokenIdRiskPartners } from '../../reads/queryUtils'
import type { StreamiaLeg } from '../../reads/streamiaHistory'
import { getStreamiaHistory } from '../../reads/streamiaHistory'
import { getUniswapFeeHistory } from '../../reads/uniswapFeeHistory'
import {
  getChunkSpreads,
  getClosedPositions,
  getRealizedPnL,
  getSyncStatus,
  getTrackedPositionIds,
  getTradeHistory,
  scanChunks,
} from '../../sync'
import type { PoolVersionConfig } from '../../types/poolConfig'
import { interpolateBlocks } from '../../utils/interpolateBlocks'
import { previewBorrow } from '../../writes/lending'
import { getAtTickCacheKey, getClientCacheScopeKey, getStorageCacheScopeKey } from '../cacheScopes'
import { usePanopticContext, useRequireStorage } from '../provider'
import { queryKeys } from '../queryKeys'

/**
 * Common query options exposed to consumers.
 */
export interface QueryOptions {
  /** Whether the query is enabled */
  enabled?: boolean
  /** Refetch interval in milliseconds */
  refetchInterval?: number | false
  /** Time in milliseconds that data is considered fresh */
  staleTime?: number
  /** Time in milliseconds that unused data is kept in cache */
  gcTime?: number
}

// --- Pool reads ---

export function usePool(poolAddress: Address, options?: QueryOptions) {
  const { publicClient, chainId, clientScope, stateViewAddress } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.pool(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
      stateViewAddress,
    ],
    queryFn: () => getPool({ client: publicClient, poolAddress, chainId, stateViewAddress }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    // Caching is opt-in per consumer: per the SDK's "no memoization of dynamic RPC
    // data" constraint, we never default a staleTime here. App code can set one
    // explicitly when it knows the consumer can tolerate cached pool state.
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useUtilization(poolAddress: Address, options?: QueryOptions) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.utilization(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => getUtilization({ client: publicClient, poolAddress }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useOracleState(poolAddress: Address, options?: QueryOptions) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.oracle(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => getOracleState({ client: publicClient, poolAddress }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useRiskParameters(poolAddress: Address, options?: QueryOptions) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.riskParameters(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => getRiskParameters({ client: publicClient, poolAddress }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useCurrentRates(poolAddress: Address, options?: QueryOptions) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.rates(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => getCurrentRates({ client: publicClient, poolAddress }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useSafeMode(poolAddress: Address, options?: QueryOptions) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.safeMode(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => getSafeMode({ client: publicClient, poolAddress }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

/**
 * React hook for the Guardian pending-unlock state of a pool.
 *
 * Reads `unlockEta` + `isPoolUnlockReady` from the PanopticGuardian so the UI
 * can surface the unlock timelock while a pool is locked (close-only). Gate it
 * via `options.enabled` so it only runs when the pool is actually locked.
 *
 * @param poolAddress - The PanopticPool address
 * @param options - Optional react-query settings (enabled, refetchInterval, staleTime, gcTime)
 * @returns A react-query result whose `data` is a `GuardianUnlockState`
 */
export function useGuardianUnlockState(poolAddress: Address, options?: QueryOptions) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.guardianUnlock(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => getGuardianUnlockState({ client: publicClient, poolAddress }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useCollateralData(poolAddress: Address, tokenIndex: 0 | 1, options?: QueryOptions) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.collateralData(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
      tokenIndex,
    ],
    queryFn: () => getCollateralData({ client: publicClient, poolAddress, tokenIndex }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function usePoolLiquidities(
  poolAddress: Address,
  params: { queryAddress: Address; startTick: bigint; nTicks: bigint },
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.poolLiquidities(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
      params.queryAddress,
      params.startTick,
      params.nTicks,
    ],
    queryFn: () =>
      getPoolLiquidities({
        client: publicClient,
        poolAddress,
        queryAddress: params.queryAddress,
        startTick: params.startTick,
        nTicks: params.nTicks,
      }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useScanChunks(
  poolAddress: Address,
  params: { queryAddress: Address; tickLower: bigint; tickUpper: bigint; width: bigint },
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.chunkSpreads(chainId, poolAddress),
      'scanChunks',
      getClientCacheScopeKey(publicClient, clientScope),
      params.queryAddress,
      params.tickLower,
      params.tickUpper,
      params.width,
    ],
    queryFn: () =>
      scanChunks({
        client: publicClient,
        poolAddress,
        queryAddress: params.queryAddress,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        width: params.width,
      }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useChunkSpreads(
  poolAddress: Address,
  params: { sfpmAddress: Address },
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope, storageScope } = usePanopticContext()
  const storage = useRequireStorage()
  return useQuery({
    queryKey: [
      ...queryKeys.chunkSpreads(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
      params.sfpmAddress,
      getStorageCacheScopeKey(storage, storageScope),
    ],
    queryFn: () =>
      getChunkSpreads({
        client: publicClient,
        chainId,
        poolAddress,
        sfpmAddress: params.sfpmAddress,
        storage,
      }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Position reads ---

export function usePosition(
  poolAddress: Address,
  owner: Address,
  tokenId: bigint,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.position(chainId, poolAddress, tokenId),
      getClientCacheScopeKey(publicClient, clientScope),
      owner,
    ],
    queryFn: () => getPosition({ client: publicClient, poolAddress, owner, tokenId }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function usePositions(
  poolAddress: Address,
  tokenIds: bigint[],
  owner?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedOwner = owner ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.positions(ctx.chainId, poolAddress, resolvedOwner ?? ('' as Address)),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
    ],
    queryFn: () => {
      if (!resolvedOwner) throw new Error('owner required for getPositions')
      return getPositions({ client: ctx.publicClient, poolAddress, owner: resolvedOwner, tokenIds })
    },
    enabled: (options?.enabled ?? true) && !!resolvedOwner,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function usePositionGreeks(
  poolAddress: Address,
  tokenId: bigint,
  owner: Address,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.positionGreeks(chainId, poolAddress, tokenId),
      getClientCacheScopeKey(publicClient, clientScope),
      owner,
    ],
    queryFn: () => getPositionGreeks({ client: publicClient, poolAddress, tokenId, owner }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Account reads ---

export function useAccountCollateral(
  poolAddress: Address,
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.accountCollateral(ctx.chainId, poolAddress, resolvedAccount ?? ('' as Address)),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
    ],
    queryFn: () => {
      if (!resolvedAccount) throw new Error('account required for getAccountCollateral')
      return getAccountCollateral({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount,
      })
    },
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useInterestState(poolAddress: Address, account?: Address, options?: QueryOptions) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.interestState(ctx.chainId, poolAddress, resolvedAccount ?? ('' as Address)),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
    ],
    queryFn: () => {
      if (!resolvedAccount) throw new Error('account required for getInterestState')
      return getInterestState({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount,
      })
    },
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useAccountSummaryBasic(
  poolAddress: Address,
  tokenIds: bigint[],
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.accountSummaryBasic(
        ctx.chainId,
        poolAddress,
        resolvedAccount ?? ('' as Address),
      ),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
    ],
    queryFn: () => {
      if (!resolvedAccount) throw new Error('account required for getAccountSummaryBasic')
      return getAccountSummaryBasic({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount,
        chainId: ctx.chainId,
        tokenIds,
      })
    },
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useAccountSummaryRisk(
  poolAddress: Address,
  tokenIds: bigint[],
  queryAddress: Address,
  account?: Address,
  options?: QueryOptions & { atTick?: bigint; includePendingPremium?: boolean },
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.accountSummaryRisk(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
      queryAddress,
      options?.atTick,
      options?.includePendingPremium,
    ],
    queryFn: () =>
      getAccountSummaryRisk({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        chainId: ctx.chainId,
        tokenIds,
        queryAddress,
        atTick: options?.atTick,
        includePendingPremium: options?.includePendingPremium,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useNetLiquidationValue(
  poolAddress: Address,
  tokenIds: bigint[],
  queryAddress: Address,
  account?: Address,
  options?: QueryOptions & { atTick?: bigint },
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'netLiquidationValue',
      ctx.chainId.toString(),
      poolAddress,
      resolvedAccount!,
      getAtTickCacheKey(options?.atTick),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
      queryAddress,
    ],
    queryFn: () =>
      getNetLiquidationValue({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenIds,
        atTick: options?.atTick,
        queryAddress,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useNetLiquidationValues(
  poolAddress: Address,
  tokenIds: bigint[],
  queryAddress: Address,
  atTicks: bigint[],
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'netLiquidationValues',
      ctx.chainId.toString(),
      poolAddress,
      resolvedAccount!,
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
      queryAddress,
      atTicks,
    ],
    queryFn: () =>
      getNetLiquidationValues({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenIds,
        atTicks,
        queryAddress,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount && atTicks.length > 0,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useLiquidationPrices(
  poolAddress: Address,
  tokenIds: bigint[],
  queryAddress: Address,
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.liquidationPrices(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
      queryAddress,
    ],
    queryFn: () =>
      getLiquidationPrices({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenIds,
        queryAddress,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useAccountGreeks(poolAddress: Address, account?: Address, options?: QueryOptions) {
  const ctx = usePanopticContext()
  const storage = useRequireStorage()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.accountGreeks(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      getStorageCacheScopeKey(storage, ctx.storageScope),
    ],
    queryFn: () =>
      getAccountGreeks({
        client: ctx.publicClient,
        chainId: ctx.chainId,
        poolAddress,
        account: resolvedAccount!,
        storage,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useMarginBuffer(
  poolAddress: Address,
  tokenIds: bigint[],
  queryAddress: Address,
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.marginBuffer(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
      queryAddress,
    ],
    queryFn: () =>
      getMarginBuffer({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenIds,
        queryAddress,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useIsLiquidatable(
  poolAddress: Address,
  tokenIds: bigint[],
  queryAddress: Address,
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.isLiquidatable(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
      queryAddress,
    ],
    queryFn: () =>
      isLiquidatable({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenIds,
        queryAddress,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useAccountPremia(
  poolAddress: Address,
  tokenIds: bigint[],
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.accountPremia(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
    ],
    queryFn: () =>
      getAccountPremia({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenIds,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function usePositionsWithPremia(
  poolAddress: Address,
  tokenIds: bigint[],
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.positionsWithPremia(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
    ],
    queryFn: () =>
      getPositionsWithPremia({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenIds,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- ERC4626 previews ---

export function usePreviewDeposit(
  poolAddress: Address,
  tokenIndex: 0 | 1,
  amount: bigint,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.erc4626Preview(chainId, poolAddress, 'deposit', amount),
      getClientCacheScopeKey(publicClient, clientScope),
      tokenIndex,
    ],
    queryFn: () => previewDeposit({ client: publicClient, poolAddress, tokenIndex, amount }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function usePreviewWithdraw(
  poolAddress: Address,
  tokenIndex: 0 | 1,
  amount: bigint,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.erc4626Preview(chainId, poolAddress, 'withdraw', amount),
      getClientCacheScopeKey(publicClient, clientScope),
      tokenIndex,
    ],
    queryFn: () => previewWithdraw({ client: publicClient, poolAddress, tokenIndex, amount }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function usePreviewMint(
  poolAddress: Address,
  tokenIndex: 0 | 1,
  amount: bigint,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.erc4626Preview(chainId, poolAddress, 'mint', amount),
      getClientCacheScopeKey(publicClient, clientScope),
      tokenIndex,
    ],
    queryFn: () => previewMint({ client: publicClient, poolAddress, tokenIndex, amount }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function usePreviewRedeem(
  poolAddress: Address,
  tokenIndex: 0 | 1,
  amount: bigint,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.erc4626Preview(chainId, poolAddress, 'redeem', amount),
      getClientCacheScopeKey(publicClient, clientScope),
      tokenIndex,
    ],
    queryFn: () => previewRedeem({ client: publicClient, poolAddress, tokenIndex, amount }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Collateral estimation ---

export function useEstimateCollateralRequired(
  poolAddress: Address,
  tokenId: bigint,
  positionSize: bigint,
  queryAddress: Address,
  account?: Address,
  options?: QueryOptions & { atTick?: bigint },
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.collateralEstimate(ctx.chainId, poolAddress, resolvedAccount!, tokenId),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      positionSize,
      queryAddress,
      options?.atTick,
    ],
    queryFn: () =>
      estimateCollateralRequired({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenId,
        positionSize,
        queryAddress,
        atTick: options?.atTick,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useRequiredCreditForITM(
  poolAddress: Address,
  tokenId: bigint,
  positionSize: bigint,
  account?: Address,
  options?: QueryOptions & { existingPositionIds?: bigint[] },
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.requiredCreditForITM(
        ctx.chainId,
        poolAddress,
        resolvedAccount ?? ('' as Address),
        tokenId,
      ),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      positionSize,
      options?.existingPositionIds,
    ],
    queryFn: () => {
      if (!resolvedAccount) throw new Error('account required for getRequiredCreditForITM')
      return getRequiredCreditForITM({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount,
        tokenId,
        positionSize,
        existingPositionIds: options?.existingPositionIds,
      })
    },
    enabled: (options?.enabled ?? true) && !!resolvedAccount && tokenId !== 0n && positionSize > 0n,
    refetchInterval: options?.refetchInterval,
    placeholderData: keepPreviousData,
  })
}

export function useMaxPositionSize(
  poolAddress: Address,
  tokenId: bigint,
  queryAddress: Address,
  account?: Address,
  options?: QueryOptions & {
    existingPositionIds?: bigint[]
    swapAtMint?: boolean
    precisionPct?: number
  },
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.maxPositionSize(
        ctx.chainId,
        poolAddress,
        resolvedAccount ?? ('' as Address),
        tokenId,
      ),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      queryAddress,
      options?.existingPositionIds?.map(String).join(',') ?? '',
      options?.existingPositionIds,
      options?.swapAtMint ?? false,
      options?.precisionPct ?? 1,
    ],
    queryFn: () => {
      if (!resolvedAccount) throw new Error('account required for getMaxPositionSize')
      return getMaxPositionSize({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount,
        tokenId,
        queryAddress,
        existingPositionIds: options?.existingPositionIds,
        swapAtMint: options?.swapAtMint,
        precisionPct: options?.precisionPct,
      })
    },
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    placeholderData: keepPreviousData,
  })
}

export function useOptimizeRiskPartners(
  poolAddress: Address,
  tokenId: bigint,
  queryAddress: Address,
  atTick?: bigint,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.optimizeRiskPartners(chainId, poolAddress, tokenId),
      getClientCacheScopeKey(publicClient, clientScope),
      queryAddress,
      getAtTickCacheKey(atTick),
    ],
    queryFn: () =>
      optimizeTokenIdRiskPartners({
        client: publicClient,
        poolAddress,
        tokenId,
        queryAddress,
        atTick,
      }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    placeholderData: keepPreviousData,
  })
}

export function useMaxWithdrawable(
  collateralTrackerAddress: Address,
  positionIdList: bigint[],
  totalAssets: bigint,
  account?: Address,
  options?: QueryOptions & { client?: PublicClient },
) {
  const ctx = usePanopticContext()
  const client = options?.client ?? ctx.publicClient
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.maxWithdrawable(
        ctx.chainId,
        collateralTrackerAddress,
        positionIdList,
        totalAssets,
        resolvedAccount ?? ('' as Address),
      ),
      getClientCacheScopeKey(client, ctx.clientScope),
    ],
    queryFn: () => {
      if (!resolvedAccount) throw new Error('account required for getMaxWithdrawable')
      return getMaxWithdrawable({
        client,
        collateralTrackerAddress,
        account: resolvedAccount,
        positionIdList,
        totalAssets,
      })
    },
    enabled: (options?.enabled ?? true) && !!resolvedAccount && totalAssets > 0n,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Open position preview ---

export function useOpenPositionPreview(
  poolAddress: Address,
  account: Address | undefined,
  existingPositionIds: bigint[],
  tokenId: bigint,
  positionSize: bigint,
  queryAddress: Address,
  tickLimitLow: bigint,
  tickLimitHigh: bigint,
  options?: QueryOptions & {
    spreadLimit?: bigint
    swapAtMint?: boolean
    usePremiaAsCollateral?: boolean
    blockNumber?: bigint
  },
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- deps serialized as strings
    queryKey: [
      ...queryKeys.all,
      'openPositionPreview',
      ctx.chainId.toString(),
      poolAddress,
      resolvedAccount!,
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenId.toString(),
      positionSize.toString(),
      existingPositionIds.map(String).join(','),
      queryAddress,
      tickLimitLow.toString(),
      tickLimitHigh.toString(),
      options?.spreadLimit?.toString(),
      options?.swapAtMint,
      options?.usePremiaAsCollateral,
      options?.blockNumber?.toString(),
    ],
    queryFn: () =>
      getOpenPositionPreview({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        existingPositionIds,
        tokenId,
        positionSize,
        queryAddress,
        tickLimitLow,
        tickLimitHigh,
        spreadLimit: options?.spreadLimit,
        swapAtMint: options?.swapAtMint,
        usePremiaAsCollateral: options?.usePremiaAsCollateral,
        chainId: ctx.chainId,
        blockNumber: options?.blockNumber,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount && tokenId !== 0n,
    staleTime: options?.staleTime ?? 0,
  })
}

// --- Storage-backed reads ---

export function useTrackedPositionIds(
  poolAddress: Address,
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const storage = useRequireStorage()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.trackedPositionIds(ctx.chainId, poolAddress, resolvedAccount!),
      getStorageCacheScopeKey(storage, ctx.storageScope),
    ],
    queryFn: () =>
      getTrackedPositionIds({
        chainId: ctx.chainId,
        poolAddress,
        account: resolvedAccount!,
        storage,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useTradeHistory(poolAddress: Address, account?: Address, options?: QueryOptions) {
  const ctx = usePanopticContext()
  const storage = useRequireStorage()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.tradeHistory(ctx.chainId, poolAddress, resolvedAccount!),
      getStorageCacheScopeKey(storage, ctx.storageScope),
    ],
    queryFn: () =>
      getTradeHistory({ chainId: ctx.chainId, poolAddress, account: resolvedAccount!, storage }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useRealizedPnL(poolAddress: Address, account?: Address, options?: QueryOptions) {
  const ctx = usePanopticContext()
  const storage = useRequireStorage()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.realizedPnL(ctx.chainId, poolAddress, resolvedAccount!),
      getStorageCacheScopeKey(storage, ctx.storageScope),
    ],
    queryFn: () =>
      getRealizedPnL({ chainId: ctx.chainId, poolAddress, account: resolvedAccount!, storage }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useClosedPositions(
  poolAddress: Address,
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const storage = useRequireStorage()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.closedPositions(ctx.chainId, poolAddress, resolvedAccount!),
      getStorageCacheScopeKey(storage, ctx.storageScope),
    ],
    queryFn: () =>
      getClosedPositions({ chainId: ctx.chainId, poolAddress, account: resolvedAccount!, storage }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useSyncStatus(poolAddress: Address, account?: Address, options?: QueryOptions) {
  const ctx = usePanopticContext()
  const storage = useRequireStorage()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.syncStatus(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      getStorageCacheScopeKey(storage, ctx.storageScope),
    ],
    queryFn: () =>
      getSyncStatus({
        client: ctx.publicClient,
        chainId: ctx.chainId,
        poolAddress,
        account: resolvedAccount!,
        storage,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Factory reads ---

type OmitFactoryClient<T> = T extends unknown ? Omit<T, 'client'> : never

export function usePanopticPoolAddress(
  params?: OmitFactoryClient<GetPanopticPoolAddressParams>,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'factory',
      'getPanopticPool',
      params?.factoryAddress,
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return getPanopticPoolAddress({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useFactoryTokenURI(
  params?: OmitFactoryClient<GetFactoryTokenURIParams>,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'factory',
      'tokenURI',
      params?.factoryAddress,
      params?.tokenId?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return getFactoryTokenURI({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useFactoryOwnerOf(
  params?: OmitFactoryClient<GetFactoryOwnerOfParams>,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'factory',
      'ownerOf',
      params?.factoryAddress,
      params?.tokenId?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return getFactoryOwnerOf({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useMinePoolAddress() {
  return useMutation({
    mutationFn: (params: MinePoolAddressLocalParams) => minePoolAddressLocalAsync(params),
  })
}

export function useFactoryConstructMetadata(
  params?: OmitFactoryClient<GetFactoryConstructMetadataParams>,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'factory',
      'constructMetadata',
      params?.factoryAddress,
      params?.panopticPoolAddress,
      params?.symbol0,
      params?.symbol1,
      params?.fee?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return getFactoryConstructMetadata({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

type OmitMineClient<T> = T extends unknown ? Omit<T, 'client'> : never

export function useSimulateDeployNewPool(
  params?: OmitMineClient<SimulateDeployNewPoolParams>,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'factory',
      'simulateDeployNewPool',
      params?.factoryAddress,
      params?.account,
      params?.salt?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return simulateDeployNewPool({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Price history ---

/** Timestamp-based time range. Start/end resolved to blocks via RPC binary search or estimation. */
export interface TimestampTimeRange {
  mode: 'timestamps'
  /** Start of the range (Unix seconds) */
  startTimestamp: number
  /** End of the range (Unix seconds). Defaults to now if omitted. */
  endTimestamp?: number
  /** Number of evenly-spaced data points to fetch */
  points: number
  /** Extra block numbers to include in the fetched set (e.g. blockAtMint) */
  pinnedBlocks?: bigint[]
  /**
   * Block resolution strategy.
   * - 'exact': RPC binary search (~25 sequential getBlock calls). Default.
   * - 'estimate': 2-RPC linear extrapolation. Suitable for charts where
   *   ±N-block error is invisible. Saves ~23 RPCs per call.
   */
  resolution?: 'exact' | 'estimate'
}

/** Block-based time range. No RPC resolution needed. */
export interface BlockTimeRange {
  mode: 'blocks'
  /** Start block number */
  startBlock: bigint
  /** End block number. Defaults to latest if omitted. */
  endBlock?: bigint
  /** Number of evenly-spaced data points to fetch */
  points: number
  /** Extra block numbers to include in the fetched set (e.g. blockAtMint) */
  pinnedBlocks?: bigint[]
}

export type PriceHistoryTimeRange = TimestampTimeRange | BlockTimeRange

/**
 * Build a stable string cache key from time range params (no object references).
 */
function buildRangeHash(timeRange: PriceHistoryTimeRange): string {
  const pinnedSuffix = timeRange.pinnedBlocks?.length
    ? `-pin:${timeRange.pinnedBlocks.join(',')}`
    : ''
  return timeRange.mode === 'timestamps'
    ? `ts:${timeRange.startTimestamp}-${timeRange.endTimestamp ?? 'now'}-${timeRange.points}-${timeRange.resolution ?? 'exact'}${pinnedSuffix}`
    : `blk:${timeRange.startBlock}-${timeRange.endBlock ?? 'latest'}-${timeRange.points}${pinnedSuffix}`
}

/**
 * Resolve a PriceHistoryTimeRange to start/end block numbers.
 */
async function resolveTimeRange(
  client: PublicClient,
  timeRange: PriceHistoryTimeRange,
): Promise<{ startBlock: bigint; endBlock: bigint }> {
  if (timeRange.mode === 'timestamps') {
    const resolver =
      timeRange.resolution === 'estimate' ? estimateBlockNumbers : resolveBlockNumbers
    if (timeRange.endTimestamp !== undefined) {
      const resolved = await resolver({
        client,
        timestamps: [timeRange.startTimestamp, timeRange.endTimestamp],
      })
      return { startBlock: resolved[0], endBlock: resolved[1] }
    } else {
      const [resolved, latest] = await Promise.all([
        resolver({ client, timestamps: [timeRange.startTimestamp] }),
        client.getBlockNumber(),
      ])
      return { startBlock: resolved[0], endBlock: latest }
    }
  } else {
    return {
      startBlock: timeRange.startBlock,
      endBlock: timeRange.endBlock ?? (await client.getBlockNumber()),
    }
  }
}

/**
 * Hook to fetch historical price data (tick + sqrtPriceX96) for a pool.
 *
 * Supports two modes:
 * - **timestamps**: Resolves start/end timestamps to blocks (2 RPC binary searches),
 *   then interpolates the blocks in between (pure math).
 * - **blocks**: Uses start/end blocks directly, interpolates in between.
 *   Zero resolution overhead.
 *
 * In both cases, the actual price reads are O(points) slot0 calls.
 * Reads at different historical blocks cannot be coalesced into one multicall.
 *
 * @param poolConfig - Pool version config (V3 pool address or V4 StateView + poolId)
 * @param timeRange - Time range specification (timestamps or blocks)
 * @param options - Query options (enabled, refetchInterval, staleTime, gcTime)
 */
export function usePriceHistory(
  poolConfig: PoolVersionConfig,
  timeRange: PriceHistoryTimeRange,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()

  const poolKey = poolConfig.version === 'v3' ? poolConfig.poolAddress : poolConfig.poolId
  const rangeHash = buildRangeHash(timeRange)

  return useQuery({
    // rangeHash serializes timeRange; poolKey serializes poolConfig
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.priceHistory(chainId, poolKey, rangeHash),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: async () => {
      const { startBlock, endBlock } = await resolveTimeRange(publicClient, timeRange)
      let blockNumbers = interpolateBlocks(startBlock, endBlock, timeRange.points)

      // Merge pinned blocks (e.g. blockAtMint) into the sorted array
      if (timeRange.pinnedBlocks?.length) {
        const blockSet = new Set(blockNumbers.map(String))
        const extras = timeRange.pinnedBlocks.filter(
          (b) => b >= startBlock && b <= endBlock && !blockSet.has(String(b)),
        )
        if (extras.length > 0) {
          blockNumbers = [...blockNumbers, ...extras].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        }
      }

      return getPriceHistory({ client: publicClient, blockNumbers, poolConfig })
    },
    enabled: (options?.enabled ?? true) && timeRange.points > 0,
    staleTime: options?.staleTime ?? Infinity,
    gcTime: options?.gcTime ?? 60 * 60_000,
    refetchInterval: options?.refetchInterval ?? false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/**
 * Hook to fetch historical streamia (streaming premia + Uniswap fee) data for a position.
 *
 * @param panopticPoolAddress - PanopticPool contract address
 * @param account - Account whose position to query
 * @param tokenId - The encoded tokenId
 * @param legs - Decoded legs with pre-computed liquidity
 * @param poolConfig - Pool version config (V3 pool address or V4 StateView + poolId)
 * @param timeRange - Time range specification (timestamps or blocks)
 * @param options - Query options + optional includeUniswapFees and settledEvents
 */
export function useStreamiaHistory(
  panopticPoolAddress: Address,
  account: Address,
  tokenId: bigint,
  legs: StreamiaLeg[],
  poolConfig: PoolVersionConfig,
  timeRange: PriceHistoryTimeRange,
  options?: QueryOptions & {
    includeUniswapFees?: boolean
    settledEvents?: Array<{ blockNumber: bigint; settled0: bigint; settled1: bigint }>
  },
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()

  const poolKey = poolConfig.version === 'v3' ? poolConfig.poolAddress : poolConfig.poolId
  const rangeHash = buildRangeHash(timeRange)

  const legsKey = legs.map((l) => `${l.lowerTick}:${l.upperTick}:${l.liquidity}`).join(',')
  const includeUniswapFees = options?.includeUniswapFees ?? true
  const settledEventsKey = options?.settledEvents
    ? options.settledEvents.map((e) => `${e.blockNumber}:${e.settled0}:${e.settled1}`).join(',')
    : ''

  return useQuery({
    // rangeHash serializes timeRange; poolKey serializes poolConfig; legsKey serializes legs
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.streamiaHistory(chainId, poolKey, rangeHash),
      getClientCacheScopeKey(publicClient, clientScope),
      panopticPoolAddress,
      account,
      tokenId.toString(),
      legsKey,
      includeUniswapFees,
      settledEventsKey,
    ],
    queryFn: async () => {
      const { startBlock, endBlock } = await resolveTimeRange(publicClient, timeRange)
      let blockNumbers = interpolateBlocks(startBlock, endBlock, timeRange.points)
      if (timeRange.pinnedBlocks?.length) {
        const pinSet = new Set(blockNumbers.map(String))
        const pins = timeRange.pinnedBlocks.filter(
          (b) => b >= startBlock && b <= endBlock && !pinSet.has(String(b)),
        )
        if (pins.length) {
          blockNumbers = [...blockNumbers, ...pins].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        }
      }
      return getStreamiaHistory({
        client: publicClient,
        panopticPoolAddress,
        account,
        tokenId,
        blockNumbers,
        legs,
        poolConfig,
        includeUniswapFees: options?.includeUniswapFees,
        settledEvents: options?.settledEvents,
      })
    },
    enabled: (options?.enabled ?? true) && timeRange.points > 0,
    staleTime: options?.staleTime ?? Infinity,
    gcTime: options?.gcTime ?? 60 * 60_000,
    refetchInterval: options?.refetchInterval ?? false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/**
 * Hook to fetch historical Uniswap fee data for a set of liquidity legs.
 *
 * @param legs - Decoded legs with pre-computed liquidity
 * @param poolConfig - Pool version config (V3 pool address or V4 StateView + poolId)
 * @param timeRange - Time range specification (timestamps or blocks)
 * @param options - Query options (enabled, refetchInterval, staleTime, gcTime)
 */
export function useUniswapFeeHistory(
  legs: StreamiaLeg[],
  poolConfig: PoolVersionConfig,
  timeRange: PriceHistoryTimeRange,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()

  const poolKey = poolConfig.version === 'v3' ? poolConfig.poolAddress : poolConfig.poolId
  const rangeHash = buildRangeHash(timeRange)

  const legsKey = legs.map((l) => `${l.lowerTick}:${l.upperTick}:${l.liquidity}`).join(',')

  return useQuery({
    // rangeHash serializes timeRange; poolKey serializes poolConfig; legsKey serializes legs
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.uniswapFeeHistory(chainId, poolKey, rangeHash),
      getClientCacheScopeKey(publicClient, clientScope),
      legsKey,
    ],
    queryFn: async () => {
      const { startBlock, endBlock } = await resolveTimeRange(publicClient, timeRange)
      let blockNumbers = interpolateBlocks(startBlock, endBlock, timeRange.points)
      if (timeRange.pinnedBlocks?.length) {
        const pinSet = new Set(blockNumbers.map(String))
        const pins = timeRange.pinnedBlocks.filter(
          (b) => b >= startBlock && b <= endBlock && !pinSet.has(String(b)),
        )
        if (pins.length) {
          blockNumbers = [...blockNumbers, ...pins].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        }
      }
      return getUniswapFeeHistory({ client: publicClient, blockNumbers, legs, poolConfig })
    },
    enabled: (options?.enabled ?? true) && timeRange.points > 0 && legs.length > 0,
    staleTime: options?.staleTime ?? Infinity,
    gcTime: options?.gcTime ?? 60 * 60_000,
    refetchInterval: options?.refetchInterval ?? false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

// --- Direct Uniswap V3 pool info (no Panoptic required) ---

/**
 * Reads basic on-chain info (token0, token1, fee, tickSpacing, slot0, liquidity) from a Uniswap V3 pool.
 * @param poolAddress - The Uniswap V3 pool contract address.
 * @param options - Optional React Query options (`enabled`, `staleTime`, `gcTime`, `refetchInterval`).
 * @returns React Query result resolving to the pool info object.
 */
export function useUniswapV3PoolInfo(poolAddress: Address | undefined, options?: QueryOptions) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'uniswapV3PoolInfo',
      chainId.toString(),
      poolAddress,
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () =>
      getUniswapV3PoolInfo({ client: publicClient, poolAddress: poolAddress as Address }),
    enabled: (options?.enabled ?? true) && !!poolAddress,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

/**
 * Reads per-tick active liquidity from a Uniswap V3 pool via PanopticQuery's `getTickNetsV3`.
 * @param poolAddress - The Uniswap V3 pool contract address.
 * @param queryAddress - The PanopticQuery helper contract address.
 * @param args - Tick window: `startTick` (inclusive) and `nTicks` count to scan.
 * @param options - Optional React Query options (`enabled`, `staleTime`, `gcTime`, `refetchInterval`).
 * @returns React Query result resolving to `{ ticks, liquidityNets }` parallel arrays.
 */
export function useUniswapV3PoolLiquidities(
  poolAddress: Address | undefined,
  queryAddress: Address | undefined,
  args: { startTick: number; nTicks: bigint } | undefined,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'uniswapV3PoolLiquidities',
      chainId.toString(),
      poolAddress,
      queryAddress,
      args?.startTick,
      args?.nTicks,
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => {
      if (!poolAddress || !queryAddress || !args) {
        throw new PanopticValidationError('useUniswapV3PoolLiquidities: missing required args')
      }
      const { startTick, nTicks } = args
      return getUniswapV3PoolLiquidities({
        client: publicClient,
        poolAddress,
        queryAddress,
        startTick,
        nTicks,
      })
    },
    enabled: (options?.enabled ?? true) && !!poolAddress && !!queryAddress && !!args,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Uniswap V4 direct reads (no Panoptic required) ---

/**
 * Resolves a Uniswap V4 PoolKey from a poolId hash by scanning `Initialize` event logs on the PoolManager.
 * PoolKey is immutable, so results are cached indefinitely within the session by default.
 * @param poolManager - The Uniswap V4 PoolManager contract address.
 * @param poolId - The 32-byte poolId hash.
 * @param args - Optional `fromBlock` and `chunkSize` for log paging.
 * @param options - Optional React Query options (`enabled`, `staleTime`, `gcTime`, `refetchInterval`).
 * @returns React Query result resolving to the resolved `UniswapV4PoolKey`.
 */
export function useResolveUniswapV4PoolKey(
  poolManager: Address | undefined,
  poolId: `0x${string}` | undefined,
  args?: { fromBlock?: bigint; chunkSize?: bigint },
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'uniswapV4PoolKey',
      chainId.toString(),
      poolManager,
      poolId,
      args?.fromBlock?.toString(),
      args?.chunkSize?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () =>
      resolveUniswapV4PoolKey({
        client: publicClient,
        poolManager: poolManager as Address,
        poolId: poolId as `0x${string}`,
        fromBlock: args?.fromBlock,
        chunkSize: args?.chunkSize,
      }),
    enabled: (options?.enabled ?? true) && !!poolManager && !!poolId,
    // PoolKey is immutable — cache forever within the session.
    staleTime: options?.staleTime ?? Infinity,
    gcTime: options?.gcTime,
    refetchInterval: options?.refetchInterval,
  })
}

/**
 * Reads basic on-chain state (slot0, liquidity) for a Uniswap V4 pool via the StateView contract.
 * @param stateViewAddress - The Uniswap V4 StateView contract address.
 * @param poolId - The 32-byte poolId hash.
 * @param options - Optional React Query options (`enabled`, `staleTime`, `gcTime`, `refetchInterval`).
 * @returns React Query result resolving to the pool's basic state.
 */
export function useUniswapV4PoolBasicState(
  stateViewAddress: Address | undefined,
  poolId: `0x${string}` | undefined,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'uniswapV4PoolBasicState',
      chainId.toString(),
      stateViewAddress,
      poolId,
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () =>
      getUniswapV4PoolBasicState({
        client: publicClient,
        stateViewAddress: stateViewAddress as Address,
        poolId: poolId as `0x${string}`,
      }),
    enabled: (options?.enabled ?? true) && !!stateViewAddress && !!poolId,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

/**
 * Reads full pool info (slot0, liquidity, and PoolKey-derived metadata) for a Uniswap V4 pool via the StateView contract.
 * @param stateViewAddress - The Uniswap V4 StateView contract address.
 * @param poolKey - The pool's `UniswapV4PoolKey` (currency0, currency1, fee, tickSpacing, hooks).
 * @param options - Optional React Query options (`enabled`, `staleTime`, `gcTime`, `refetchInterval`).
 * @returns React Query result resolving to the full pool info object.
 */
export function useUniswapV4PoolInfo(
  stateViewAddress: Address | undefined,
  poolKey: UniswapV4PoolKey | undefined,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'uniswapV4PoolInfo',
      chainId.toString(),
      stateViewAddress,
      poolKey?.currency0,
      poolKey?.currency1,
      poolKey?.fee,
      poolKey?.tickSpacing,
      poolKey?.hooks,
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () =>
      getUniswapV4PoolInfo({
        client: publicClient,
        stateViewAddress: stateViewAddress as Address,
        poolKey: poolKey as UniswapV4PoolKey,
      }),
    enabled: (options?.enabled ?? true) && !!stateViewAddress && !!poolKey,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

/**
 * Reads per-tick active liquidity from a Uniswap V4 pool via PanopticQuery's `getTickNetsV4`.
 * @param queryAddress - The PanopticQuery helper contract address.
 * @param poolManager - The Uniswap V4 PoolManager contract address.
 * @param poolId - The 32-byte poolId hash.
 * @param args - `tickSpacing`, `startTick` (inclusive), and `nTicks` count to scan.
 * @param options - Optional React Query options (`enabled`, `staleTime`, `gcTime`, `refetchInterval`).
 * @returns React Query result resolving to `{ ticks, liquidityNets }` parallel arrays.
 */
export function useUniswapV4PoolLiquidities(
  queryAddress: Address | undefined,
  poolManager: Address | undefined,
  poolId: `0x${string}` | undefined,
  args: { tickSpacing: number; startTick: number; nTicks: bigint } | undefined,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'uniswapV4PoolLiquidities',
      chainId.toString(),
      queryAddress,
      poolManager,
      poolId,
      args?.tickSpacing,
      args?.startTick,
      args?.nTicks,
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => {
      if (!queryAddress || !poolManager || !poolId || !args) {
        throw new PanopticValidationError('useUniswapV4PoolLiquidities: missing required args')
      }
      const { tickSpacing, startTick, nTicks } = args
      return getUniswapV4PoolLiquidities({
        client: publicClient,
        queryAddress,
        poolManager,
        poolId,
        tickSpacing,
        startTick,
        nTicks,
      })
    },
    enabled: (options?.enabled ?? true) && !!queryAddress && !!poolManager && !!poolId && !!args,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Native token price ---

export function useNativeTokenPrice(
  panopticPoolAddress: Address | undefined,
  token0Decimals: bigint,
  token1Decimals: bigint,
  nativeIsToken0: boolean,
  options?: QueryOptions,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'nativeTokenPrice',
      chainId,
      panopticPoolAddress,
      token0Decimals,
      token1Decimals,
      nativeIsToken0,
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () =>
      getNativeTokenPrice({
        client: publicClient,
        panopticPoolAddress: panopticPoolAddress!,
        token0Decimals,
        token1Decimals,
        nativeIsToken0,
      }),
    enabled: (options?.enabled ?? true) && panopticPoolAddress !== undefined,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- SFPM reads ---

type OmitSfpmClient<T> = Omit<T, 'client'>

export function useUniswapV3PoolFromId(
  params?: OmitSfpmClient<GetUniswapV3PoolFromIdParams>,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sfpm',
      'getUniswapV3PoolFromId',
      params?.sfpmAddress,
      params?.poolId?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return getUniswapV3PoolFromId({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useUniswapV4PoolKeyFromId(
  params?: OmitSfpmClient<GetUniswapV4PoolKeyFromIdParams>,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sfpm',
      'getUniswapV4PoolKeyFromId',
      params?.sfpmAddress,
      params?.poolId?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return getUniswapV4PoolKeyFromId({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

export function useEnforcedTickLimits(
  params?: OmitSfpmClient<GetEnforcedTickLimitsParams>,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sfpm',
      'getEnforcedTickLimits',
      params?.sfpmAddress,
      params?.poolId?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return getEnforcedTickLimits({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Factory + SFPM composite reads ---

export function usePanopticPoolFromPoolId(
  params?: OmitFactoryClient<GetPanopticPoolFromPoolIdParams>,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'factory',
      'getPanopticPoolFromPoolId',
      params?.sfpmAddress,
      params?.factoryAddress,
      params?.riskEngine,
      params?.poolId?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return getPanopticPoolFromPoolId({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

type OmitResolveClient = Omit<ResolvePanopticPoolFromPoolIdParams, 'client'>

export function useResolvePanopticPoolFromPoolId(
  params?: OmitResolveClient,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'factory',
      'resolvePanopticPoolFromPoolId',
      params?.poolId?.toString(),
      params?.riskEngine,
      params?.v3?.sfpmAddress,
      params?.v3?.factoryAddress,
      params?.v4?.sfpmAddress,
      params?.v4?.factoryAddress,
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticValidationError('params is required')
      return resolvePanopticPoolFromPoolId({ client: publicClient, ...params })
    },
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
    gcTime: options?.gcTime,
  })
}

// --- Borrow preview ---

export function usePreviewBorrow(
  poolAddress: Address,
  params?: {
    account: Address
    token: Address
    amount: bigint
    slippageBps: bigint
    existingPositionIds: bigint[]
  },
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'previewBorrow',
      ctx.chainId,
      poolAddress,
      params?.account,
      params?.token,
      params?.amount?.toString(),
      params?.slippageBps?.toString(),
      params?.existingPositionIds?.map(String).join(','),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
    ],
    queryFn: () =>
      previewBorrow({
        client: ctx.publicClient,
        poolAddress,
        chainId: ctx.chainId,
        account: params!.account,
        token: params!.token,
        amount: params!.amount,
        slippageBps: params!.slippageBps,
        existingPositionIds: params!.existingPositionIds,
      }),
    enabled: (options?.enabled ?? true) && !!params && params.amount > 0n,
    staleTime: options?.staleTime ?? 10_000,
    gcTime: options?.gcTime,
    placeholderData: keepPreviousData,
  })
}

/**
 * Validate whether a builder code maps to a deployed builder wallet.
 *
 * Returns `{ data: true }` for valid codes, `{ data: false }` for invalid.
 * Disabled when `builderCode` is `undefined` or `0n`.
 */
export function useValidateBuilderCode(
  poolAddress: Address,
  builderCode: bigint | undefined,
  options?: QueryOptions,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      'validateBuilderCode',
      poolAddress,
      String(builderCode),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => {
      if (builderCode === undefined) throw new Error('builderCode is undefined')
      return validateBuilderCode({
        client: publicClient,
        poolAddress,
        builderCode,
      })
    },
    enabled: (options?.enabled ?? true) && builderCode !== undefined && builderCode !== 0n,
    staleTime: options?.staleTime ?? 60_000,
    gcTime: options?.gcTime,
  })
}
