/**
 * TanStack Query v5 read hooks for the Panoptic v2 SDK.
 * @module v2/react/hooks/reads
 */

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import type { Address, PublicClient } from 'viem'

import { resolveBlockNumbers } from '../../clients/blocksByTimestamp'
import {
  type GetFactoryConstructMetadataParams,
  type GetFactoryOwnerOfParams,
  type GetFactoryTokenURIParams,
  type GetPanopticPoolAddressParams,
  type MinePoolAddressParams,
  type SimulateDeployNewPoolParams,
  estimateCollateralRequired,
  getAccountCollateral,
  getAccountGreeks,
  getAccountPremia,
  getAccountSummaryBasic,
  getAccountSummaryRisk,
  getCollateralData,
  getCurrentRates,
  getFactoryConstructMetadata,
  getFactoryOwnerOf,
  getFactoryTokenURI,
  getLiquidationPrices,
  getMarginBuffer,
  getMaxPositionSize,
  getMaxWithdrawable,
  getNativeTokenPrice,
  getNetLiquidationValue,
  getOpenPositionPreview,
  getOracleState,
  getPanopticPoolAddress,
  getPool,
  getPoolLiquidities,
  getPosition,
  getPositionGreeks,
  getPositions,
  getPositionsWithPremia,
  getRequiredCreditForITM,
  getRiskParameters,
  getSafeMode,
  getUtilization,
  isLiquidatable,
  minePoolAddress,
  previewDeposit,
  previewMint,
  previewRedeem,
  previewWithdraw,
  simulateDeployNewPool,
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
} from '../../sync'
import type { PoolVersionConfig } from '../../types/poolConfig'
import { interpolateBlocks } from '../../utils/interpolateBlocks'
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
      }),
    enabled: (options?.enabled ?? true) && !!resolvedAccount && tokenId !== 0n,
    staleTime: 0,
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

// --- Factory reads ---

type OmitFactoryClient<T> = Omit<T, 'client'>

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
    queryFn: () => getPanopticPoolAddress({ client: publicClient, ...params! }),
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
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
    queryFn: () => getFactoryTokenURI({ client: publicClient, ...params! }),
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
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
    queryFn: () => getFactoryOwnerOf({ client: publicClient, ...params! }),
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
  })
}

type OmitMineClient<T> = Omit<T, 'client'>

export function useMinePoolAddress() {
  const { publicClient } = usePanopticContext()
  return useMutation({
    mutationFn: (params: OmitMineClient<MinePoolAddressParams>) =>
      minePoolAddress({ client: publicClient, ...params }),
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
    queryFn: () => getFactoryConstructMetadata({ client: publicClient, ...params! }),
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
  })
}

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
    queryFn: () => simulateDeployNewPool({ client: publicClient, ...params! }),
    enabled: (options?.enabled ?? true) && params !== undefined,
    refetchInterval: options?.refetchInterval,
  })
}

// --- Price history ---

/** Timestamp-based time range. Start/end resolved to blocks via RPC binary search. */
export interface TimestampTimeRange {
  mode: 'timestamps'
  /** Start of the range (Unix seconds) */
  startTimestamp: number
  /** End of the range (Unix seconds). Defaults to now if omitted. */
  endTimestamp?: number
  /** Number of evenly-spaced data points to fetch */
  points: number
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
}

export type PriceHistoryTimeRange = TimestampTimeRange | BlockTimeRange

/**
 * Build a stable string cache key from time range params (no object references).
 */
function buildRangeHash(timeRange: PriceHistoryTimeRange): string {
  return timeRange.mode === 'timestamps'
    ? `ts:${timeRange.startTimestamp}-${timeRange.endTimestamp ?? 'now'}-${timeRange.points}`
    : `blk:${timeRange.startBlock}-${timeRange.endBlock ?? 'latest'}-${timeRange.points}`
}

/**
 * Resolve a PriceHistoryTimeRange to start/end block numbers.
 */
async function resolveTimeRange(
  client: PublicClient,
  timeRange: PriceHistoryTimeRange,
): Promise<{ startBlock: bigint; endBlock: bigint }> {
  if (timeRange.mode === 'timestamps') {
    if (timeRange.endTimestamp !== undefined) {
      const resolved = await resolveBlockNumbers({
        client,
        timestamps: [timeRange.startTimestamp, timeRange.endTimestamp],
      })
      return { startBlock: resolved[0], endBlock: resolved[1] }
    } else {
      const [resolved, latest] = await Promise.all([
        resolveBlockNumbers({ client, timestamps: [timeRange.startTimestamp] }),
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
 * In both cases, the actual price reads are O(points) slot0 calls,
 * HTTP-batched by viem.
 *
 * @param poolConfig - Pool version config (V3 pool address or V4 StateView + poolId)
 * @param timeRange - Time range specification (timestamps or blocks)
 * @param options - Query options (enabled, refetchInterval)
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
      const blockNumbers = interpolateBlocks(startBlock, endBlock, timeRange.points)
      return getPriceHistory({ client: publicClient, blockNumbers, poolConfig })
    },
    enabled: (options?.enabled ?? true) && timeRange.points > 0,
    refetchInterval: options?.refetchInterval,
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
      const blockNumbers = interpolateBlocks(startBlock, endBlock, timeRange.points)
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
    refetchInterval: options?.refetchInterval,
  })
}

/**
 * Hook to fetch historical Uniswap fee data for a set of liquidity legs.
 *
 * @param legs - Decoded legs with pre-computed liquidity
 * @param poolConfig - Pool version config (V3 pool address or V4 StateView + poolId)
 * @param timeRange - Time range specification (timestamps or blocks)
 * @param options - Query options (enabled, refetchInterval)
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
      const blockNumbers = interpolateBlocks(startBlock, endBlock, timeRange.points)
      return getUniswapFeeHistory({ client: publicClient, blockNumbers, legs, poolConfig })
    },
    enabled: (options?.enabled ?? true) && timeRange.points > 0 && legs.length > 0,
    refetchInterval: options?.refetchInterval,
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
  })
}
