/**
 * TanStack Query v5 hooks for the CoW Protocol swap path.
 *
 * Mirrors the Universal Router hooks (usePanopticContext injection,
 * OmitInjected* params) but targets the order-book functions in `src/cow`.
 * Orders settle asynchronously: submission returns an order UID, and
 * `useCowOrderStatus` polls until the order reaches a terminal state.
 *
 * @module v2/react/hooks/cowSwap
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex, WalletClient } from 'viem'

import {
  type ApproveErc20ForCowParams,
  type CancelCowOrderParams,
  type CheckCowApprovalParams,
  type QuoteCowSwapParams,
  type SignAndSubmitCowOrderParams,
  approveErc20ForCow,
  cancelCowOrder,
  checkCowApproval,
  getCowOrderStatus,
  isCowSupportedChain,
  quoteCowSwap,
  signAndSubmitCowOrder,
} from '../../../../cow'
import { PanopticError } from '../../errors'
import { getClientCacheScopeKey } from '../cacheScopes'
import { usePanopticContext } from '../provider'
import { queryKeys } from '../queryKeys'

type OmitChainAndFrom<T> = Omit<T, 'chainId' | 'from'>
type OmitInjectedWithChain<T> = Omit<T, 'client' | 'walletClient' | 'account' | 'chainId'>
type OmitClientOnly<T> = Omit<T, 'client'>

function requireWallet(walletClient?: WalletClient, account?: Address) {
  if (!walletClient || !account) {
    throw new PanopticError(
      'walletClient and account are required. Provide them via PanopticProvider.',
    )
  }
  return { walletClient, account }
}

/** How often open-order status is re-polled (ms). */
const ORDER_POLL_INTERVAL_MS = 5_000
/** How often quotes refresh (ms) — CoW quotes go stale quickly. */
const QUOTE_REFETCH_INTERVAL_MS = 15_000

/**
 * Placeholder order owner for quotes when no wallet is connected — the order
 * book accepts any non-zero `from` for quoting (verification happens at order
 * submission, which always uses the real account).
 */
const QUOTE_STUB_FROM = '0x0000000000000000000000000000000000000001' as const

/**
 * Quote a swap via the CoW order book. The connected account (or a stub when
 * disconnected) is used as the order owner (`from`); disabled while the chain
 * has no order book.
 */
export function useQuoteCowSwap(params?: OmitChainAndFrom<QuoteCowSwapParams>) {
  const { publicClient, chainId, account, clientScope } = usePanopticContext()
  return useQuery({
    // Raw `params` carries bigints that break TanStack v5's JSON key hashing; the
    // stringified scalars below fully capture the query identity.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'cowSwap',
      'quote',
      chainId,
      params?.sellToken,
      params?.buyToken,
      params?.kind,
      params?.amount?.toString(),
      params?.slippageBps?.toString(),
      account,
      getClientCacheScopeKey(publicClient, clientScope),
    ] as const,
    queryFn: () => quoteCowSwap({ chainId, from: account ?? QUOTE_STUB_FROM, ...params! }),
    enabled: params !== undefined && isCowSupportedChain(chainId),
    staleTime: 0,
    refetchInterval: QUOTE_REFETCH_INTERVAL_MS,
  })
}

/** Check the ERC20 → GPv2VaultRelayer allowance for the sell token. */
export function useCheckCowApproval(params?: OmitClientOnly<CheckCowApprovalParams>) {
  const { publicClient, chainId, clientScope } = usePanopticContext()
  return useQuery({
    // Raw `params` carries bigints that break TanStack v5's JSON key hashing; the
    // stringified scalars below fully capture the query identity.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      ...queryKeys.all,
      'cowSwap',
      'approval',
      chainId,
      params?.sellToken,
      params?.owner,
      params?.amount?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
    ] as const,
    queryFn: () => checkCowApproval({ client: publicClient, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

/** Approval mutation: ERC20 → GPv2VaultRelayer (single step, no Permit2). */
export function useApproveErc20ForCow() {
  const { publicClient, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: OmitInjectedWithChain<ApproveErc20ForCowParams>) => {
      const wallet = requireWallet(walletClient, account)
      return approveErc20ForCow({ client: publicClient, ...wallet, ...params })
    },
    // Refresh the cached allowance read (useCheckCowApproval) so the swap CTA
    // advances past "Approve" once the approval confirms.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.all, 'cowSwap', 'approval'] })
    },
  })
}

/**
 * Sign an order (EIP-712) and post it to the order book. Resolves with the
 * order UID — not a tx hash; settlement is asynchronous.
 */
export function useSubmitCowOrder() {
  const { chainId, walletClient, account } = usePanopticContext()
  return useMutation({
    mutationFn: (
      params: Omit<SignAndSubmitCowOrderParams, 'walletClient' | 'account' | 'chainId'>,
    ) => {
      const wallet = requireWallet(walletClient, account)
      return signAndSubmitCowOrder({ ...wallet, chainId, ...params })
    },
  })
}

/**
 * Poll an order's lifecycle state every few seconds while it is open; polling
 * stops automatically once the order reaches a terminal state.
 */
export function useCowOrderStatus(orderUid?: Hex) {
  const { chainId } = usePanopticContext()
  return useQuery({
    queryKey: [...queryKeys.all, 'cowSwap', 'orderStatus', chainId, orderUid] as const,
    queryFn: () => getCowOrderStatus({ chainId, orderUid: orderUid! }),
    enabled: orderUid !== undefined,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === undefined || status === 'open' || status === 'presignaturePending'
        ? ORDER_POLL_INTERVAL_MS
        : false
    },
  })
}

/** Off-chain (signed, free) order cancellation mutation. */
export function useCancelCowOrder() {
  const { chainId, walletClient, account } = usePanopticContext()
  return useMutation({
    mutationFn: (params: Omit<CancelCowOrderParams, 'walletClient' | 'account' | 'chainId'>) => {
      const wallet = requireWallet(walletClient, account)
      return cancelCowOrder({ ...wallet, chainId, ...params })
    },
  })
}

// Re-export the chain gate so UI code can branch without importing `/cow`.
export { isCowSupportedChain }
