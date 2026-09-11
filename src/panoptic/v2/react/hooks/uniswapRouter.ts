/**
 * TanStack Query v5 hooks for the Uniswap Universal Router swap path.
 *
 * Version-aware: dispatches to v3 or v4 quote/swap functions based on pool
 * metadata (`isV4`). The consumer passes a pool address and gets back a
 * `SimulationResult` regardless of version.
 *
 * @module v2/react/hooks/uniswapRouter
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, WalletClient } from 'viem'

import type { UniswapV3Addresses } from '../../../../uniswap/v3/addresses'
import {
  quoteSwapExactInViaV3Router,
  quoteSwapExactOutViaV3Router,
  swapExactInViaV3Router,
  swapExactOutViaV3Router,
} from '../../../../uniswap/v3/router'
import type { UniswapV4Addresses } from '../../../../uniswap/v4/addresses'
import {
  type ApproveErc20ForPermit2Params,
  type ApproveRouterViaPermit2Params,
  type CheckRouterApprovalParams,
  type QuoteSwapExactInViaRouterParams,
  type QuoteSwapExactOutViaRouterParams,
  type SwapExactInViaRouterParams,
  type SwapExactOutViaRouterParams,
  approveErc20ForPermit2,
  approveRouterViaPermit2,
  checkRouterApproval,
  quoteSwapExactInViaRouter,
  quoteSwapExactOutViaRouter,
  swapExactInViaRouter,
  swapExactOutViaRouter,
} from '../../../../uniswap/v4/router'
import { PanopticError } from '../../errors'
import { getPoolMetadata } from '../../reads/pool'
import { getClientCacheScopeKey } from '../cacheScopes'
import { mutationEffects } from '../mutationEffects'
import { usePanopticContext } from '../provider'
import { queryKeys } from '../queryKeys'

type RouterAddresses = Partial<UniswapV3Addresses & UniswapV4Addresses>
type OmitInjectedWithPoolAndChain<T> = Omit<
  T,
  'client' | 'walletClient' | 'account' | 'poolAddress' | 'chainId' | 'addresses'
> & { addresses?: RouterAddresses }
type OmitInjectedWithChain<T> = Omit<T, 'client' | 'walletClient' | 'account' | 'chainId'>
type OmitClientPoolAndChain<T> = Omit<T, 'client' | 'poolAddress' | 'chainId' | 'addresses'> & {
  addresses?: RouterAddresses
}

function requireWallet(walletClient?: WalletClient, account?: Address) {
  if (!walletClient || !account) {
    throw new PanopticError(
      'walletClient and account are required. Provide them via PanopticProvider.',
    )
  }
  return { walletClient, account }
}

/**
 * Fetch the immutable `isV4` flag for a pool. Cached indefinitely (metadata
 * never changes for a given pool address).
 */
export function usePoolVersion(poolAddress: Address) {
  const { publicClient } = usePanopticContext()
  const isRealPool = poolAddress !== '0x0000000000000000000000000000000000000000'
  const { data, isLoading, isError } = useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [...queryKeys.all, 'poolVersion', poolAddress] as const,
    queryFn: async () => {
      const meta = await getPoolMetadata({ client: publicClient, poolAddress })
      return meta.isV4
    },
    enabled: isRealPool,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 3,
  })
  return { isV4: data, isLoading: isRealPool && isLoading, isError }
}

/**
 * Quote an exact-in spot swap via the Universal Router.
 * Dispatches to v3 or v4 quoter based on pool version.
 */
export function useQuoteSwapExactInViaRouter(
  poolAddress: Address,
  params?: OmitClientPoolAndChain<QuoteSwapExactInViaRouterParams>,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  const { isV4 } = usePoolVersion(poolAddress)
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'uniswapRouter',
      'quote',
      isV4 ? 'v4' : 'v3',
      chainId,
      poolAddress,
      params?.tokenIn,
      params?.amountIn?.toString(),
      params?.slippageBps?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticError('params is required')
      if (isV4) {
        return quoteSwapExactInViaRouter({ client: publicClient, poolAddress, chainId, ...params })
      }
      return quoteSwapExactInViaV3Router({ client: publicClient, poolAddress, chainId, ...params })
    },
    enabled: params !== undefined && isV4 !== undefined,
    staleTime: 0,
  })
}

/**
 * Quote an exact-out spot swap via the Universal Router.
 * Dispatches to v3 or v4 quoter based on pool version.
 */
export function useQuoteSwapExactOutViaRouter(
  poolAddress: Address,
  params?: OmitClientPoolAndChain<QuoteSwapExactOutViaRouterParams>,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  const { isV4 } = usePoolVersion(poolAddress)
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'uniswapRouter',
      'quoteExactOut',
      isV4 ? 'v4' : 'v3',
      chainId,
      poolAddress,
      params?.tokenIn,
      params?.amountOut?.toString(),
      params?.slippageBps?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
    ] as const,
    queryFn: () => {
      if (!params) throw new PanopticError('params is required')
      if (isV4) {
        return quoteSwapExactOutViaRouter({
          client: publicClient,
          poolAddress,
          chainId,
          ...params,
        })
      }
      return quoteSwapExactOutViaV3Router({ client: publicClient, poolAddress, chainId, ...params })
    },
    enabled: params !== undefined && isV4 !== undefined,
    staleTime: 0,
  })
}

/**
 * Check the ERC20 → Permit2 → Universal Router allowance chain.
 */
export function useCheckRouterApproval(params?: OmitInjectedWithChain<CheckRouterApprovalParams>) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'uniswapRouter',
      'approval',
      chainId,
      params?.tokenIn,
      params?.owner,
      params?.amount?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
    ] as const,
    queryFn: () => checkRouterApproval({ client: publicClient, chainId, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

/**
 * Execute an exact-in spot swap via the Universal Router.
 * Dispatches to v3 or v4 swap path based on pool version.
 */
export function useSwapExactInViaRouter(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const { isV4 } = usePoolVersion(poolAddress)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: OmitInjectedWithPoolAndChain<SwapExactInViaRouterParams>) => {
      const wallet = requireWallet(walletClient, account)
      if (isV4 === undefined) {
        throw new PanopticError('Pool version unknown — cannot route swap')
      }
      if (isV4) {
        return swapExactInViaRouter({
          client: publicClient,
          ...wallet,
          poolAddress,
          chainId,
          ...params,
        })
      }
      return swapExactInViaV3Router({
        client: publicClient,
        ...wallet,
        poolAddress,
        chainId,
        ...params,
      })
    },
    onSuccess: () => {
      if (!account) return
      for (const key of mutationEffects.deposit({ chainId, poolAddress, account })) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })
}

/**
 * Execute an exact-out spot swap via the Universal Router.
 * Dispatches to v3 or v4 swap path based on pool version.
 */
export function useSwapExactOutViaRouter(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const { isV4 } = usePoolVersion(poolAddress)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: OmitInjectedWithPoolAndChain<SwapExactOutViaRouterParams>) => {
      const wallet = requireWallet(walletClient, account)
      if (isV4 === undefined) {
        throw new PanopticError('Pool version unknown — cannot route swap')
      }
      if (isV4) {
        return swapExactOutViaRouter({
          client: publicClient,
          ...wallet,
          poolAddress,
          chainId,
          ...params,
        })
      }
      return swapExactOutViaV3Router({
        client: publicClient,
        ...wallet,
        poolAddress,
        chainId,
        ...params,
      })
    },
    onSuccess: () => {
      if (!account) return
      for (const key of mutationEffects.deposit({ chainId, poolAddress, account })) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })
}

/**
 * Step 1 approval mutation: ERC20 → Permit2.
 */
export function useApproveErc20ForPermit2() {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  return useMutation({
    mutationFn: (params: OmitInjectedWithChain<ApproveErc20ForPermit2Params>) => {
      const wallet = requireWallet(walletClient, account)
      return approveErc20ForPermit2({ client: publicClient, ...wallet, chainId, ...params })
    },
  })
}

/**
 * Step 2 approval mutation: Permit2 → Universal Router.
 */
export function useApproveRouterViaPermit2() {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  return useMutation({
    mutationFn: (params: OmitInjectedWithChain<ApproveRouterViaPermit2Params>) => {
      const wallet = requireWallet(walletClient, account)
      return approveRouterViaPermit2({ client: publicClient, ...wallet, chainId, ...params })
    },
  })
}
