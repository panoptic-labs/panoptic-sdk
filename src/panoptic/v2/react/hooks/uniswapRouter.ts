/**
 * TanStack Query v5 hooks for the Uniswap v4 Universal Router swap path.
 *
 * Mirrors the writes/simulations hook ergonomics (usePanopticContext injection,
 * OmitInjected* params, cache invalidation) but targets the generic Uniswap v4
 * router functions in `src/uniswap`.
 *
 * @module v2/react/hooks/uniswapRouter
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, WalletClient } from 'viem'

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
import { getClientCacheScopeKey } from '../cacheScopes'
import { mutationEffects } from '../mutationEffects'
import { usePanopticContext } from '../provider'
import { queryKeys } from '../queryKeys'

type OmitInjectedWithPoolAndChain<T> = Omit<
  T,
  'client' | 'walletClient' | 'account' | 'poolAddress' | 'chainId'
>
type OmitInjectedWithChain<T> = Omit<T, 'client' | 'walletClient' | 'account' | 'chainId'>
type OmitClientPoolAndChain<T> = Omit<T, 'client' | 'poolAddress' | 'chainId'>

function requireWallet(walletClient?: WalletClient, account?: Address) {
  if (!walletClient || !account) {
    throw new PanopticError(
      'walletClient and account are required. Provide them via PanopticProvider.',
    )
  }
  return { walletClient, account }
}

/**
 * Quote an exact-in spot swap via the Universal Router (V4Quoter-backed).
 * Returns a `SimulationResult`, matching `useSimulateSwapExactIn`'s shape.
 */
export function useQuoteSwapExactInViaRouter(
  poolAddress: Address,
  params?: OmitClientPoolAndChain<QuoteSwapExactInViaRouterParams>,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    // Raw `params` carries bigints that break TanStack v5's JSON key hashing; the
    // stringified scalars below fully capture the query identity.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'uniswapRouter',
      'quote',
      chainId,
      poolAddress,
      params?.tokenIn,
      params?.amountIn?.toString(),
      params?.slippageBps?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
    ] as const,
    queryFn: () =>
      quoteSwapExactInViaRouter({
        client: publicClient,
        poolAddress,
        chainId,
        ...params!,
      }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

/**
 * Quote an exact-out spot swap via the Universal Router (V4Quoter-backed).
 * Returns a `SimulationResult` carrying the required input + `amountInMaximum`.
 */
export function useQuoteSwapExactOutViaRouter(
  poolAddress: Address,
  params?: OmitClientPoolAndChain<QuoteSwapExactOutViaRouterParams>,
) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    // Raw `params` carries bigints that break TanStack v5's JSON key hashing; the
    // stringified scalars below fully capture the query identity.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'uniswapRouter',
      'quoteExactOut',
      chainId,
      poolAddress,
      params?.tokenIn,
      params?.amountOut?.toString(),
      params?.slippageBps?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
    ] as const,
    queryFn: () =>
      quoteSwapExactOutViaRouter({
        client: publicClient,
        poolAddress,
        chainId,
        ...params!,
      }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

/**
 * Check the ERC20 → Permit2 → Universal Router allowance chain.
 */
export function useCheckRouterApproval(params?: OmitInjectedWithChain<CheckRouterApprovalParams>) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    // Raw `params` carries bigints that break TanStack v5's JSON key hashing; the
    // stringified scalars below fully capture the query identity.
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
 */
export function useSwapExactInViaRouter(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: OmitInjectedWithPoolAndChain<SwapExactInViaRouterParams>) => {
      const wallet = requireWallet(walletClient, account)
      return swapExactInViaRouter({
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
 */
export function useSwapExactOutViaRouter(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: OmitInjectedWithPoolAndChain<SwapExactOutViaRouterParams>) => {
      const wallet = requireWallet(walletClient, account)
      return swapExactOutViaRouter({
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
