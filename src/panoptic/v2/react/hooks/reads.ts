/**
 * TanStack Query v5 read hooks for the Panoptic v2 SDK.
 * @module v2/react/hooks/reads
 */

import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'

import {
  estimateCollateralRequired,
  getAccountCollateral,
  getAccountGreeks,
  getAccountPremia,
  getAccountSummaryBasic,
  getAccountSummaryRisk,
  getCollateralData,
  getCurrentRates,
  getLiquidationPrices,
  getMarginBuffer,
  getMaxPositionSize,
  getNetLiquidationValue,
  getOracleState,
  getPool,
  getPoolLiquidities,
  getPosition,
  getPositionGreeks,
  getPositions,
  getPositionsWithPremia,
  getRiskParameters,
  getSafeMode,
  getUtilization,
  isLiquidatable,
  previewDeposit,
  previewMint,
  previewRedeem,
  previewWithdraw,
} from '../../reads'
import {
  getChunkSpreads,
  getClosedPositions,
  getRealizedPnL,
  getSyncStatus,
  getTrackedPositionIds,
  getTradeHistory,
} from '../../sync'
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
  refetchInterval?: number
}

// --- Pool reads ---

export function usePool(poolAddress: Address, options?: QueryOptions) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.pool(chainId, poolAddress),
      getClientCacheScopeKey(publicClient, clientScope),
    ],
    queryFn: () => getPool({ client: publicClient, poolAddress, chainId }),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
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
      ...queryKeys.positions(ctx.chainId, poolAddress, resolvedOwner!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
    ],
    queryFn: () =>
      getPositions({ client: ctx.publicClient, poolAddress, owner: resolvedOwner!, tokenIds }),
    enabled: (options?.enabled ?? true) && !!resolvedOwner,
    refetchInterval: options?.refetchInterval,
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
      ...queryKeys.accountCollateral(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
    ],
    queryFn: () =>
      getAccountCollateral({ client: ctx.publicClient, poolAddress, account: resolvedAccount! }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
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
      ...queryKeys.accountSummaryBasic(ctx.chainId, poolAddress, resolvedAccount!),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      tokenIds,
    ],
    queryFn: () =>
      getAccountSummaryBasic({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        chainId: ctx.chainId,
        tokenIds,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
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
  })
}

// --- Collateral estimation ---

export function useEstimateCollateralRequired(
  poolAddress: Address,
  tokenId: bigint,
  positionSize: bigint,
  account?: Address,
  options?: QueryOptions & { queryAddress?: Address; atTick?: bigint },
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.collateralEstimate(ctx.chainId, poolAddress, resolvedAccount!, tokenId),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      positionSize,
      options?.queryAddress,
      options?.atTick,
    ],
    queryFn: () =>
      estimateCollateralRequired({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenId,
        positionSize,
        queryAddress: options?.queryAddress,
        atTick: options?.atTick,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
  })
}

export function useMaxPositionSize(
  poolAddress: Address,
  tokenId: bigint,
  queryAddress: Address,
  account?: Address,
  options?: QueryOptions,
) {
  const ctx = usePanopticContext()
  const resolvedAccount = account ?? ctx.account
  return useQuery({
    queryKey: [
      ...queryKeys.maxPositionSize(ctx.chainId, poolAddress, resolvedAccount!, tokenId),
      getClientCacheScopeKey(ctx.publicClient, ctx.clientScope),
      queryAddress,
    ],
    queryFn: () =>
      getMaxPositionSize({
        client: ctx.publicClient,
        poolAddress,
        account: resolvedAccount!,
        tokenId,
        queryAddress,
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount,
    refetchInterval: options?.refetchInterval,
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
  })
}
