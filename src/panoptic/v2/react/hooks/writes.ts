/**
 * TanStack Query v5 mutation hooks for the Panoptic v2 SDK.
 * @module v2/react/hooks/writes
 */

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Address, WalletClient } from 'viem'

import {
  type ApproveParams,
  type ApprovePoolParams,
  type ClosePositionParams,
  type DepositParams,
  type DispatchParams,
  type ForceExerciseParams,
  type LiquidateParams,
  type MintParams,
  type OpenPositionParams,
  type PokeOracleParams,
  type RedeemParams,
  type RollPositionParams,
  type SettleParams,
  type WithdrawParams,
  type WithdrawWithPositionsParams,
  approve,
  approvePool,
  closePosition,
  deposit,
  dispatch,
  forceExercise,
  liquidate,
  mint,
  openPosition,
  pokeOracle,
  redeem,
  rollPosition,
  settleAccumulatedPremia,
  withdraw,
  withdrawWithPositions,
} from '../../writes'
import { mutationEffects } from '../mutationEffects'
import { usePanopticContext } from '../provider'
import { queryKeys } from '../queryKeys'

type OmitInjected<T> = Omit<T, 'client' | 'walletClient' | 'account'>
type OmitInjectedWithPool<T> = Omit<T, 'client' | 'walletClient' | 'account' | 'poolAddress'>

type WalletInputs = {
  walletClient?: WalletClient
  account?: Address
}

type WalletMutationContext = {
  signerAccount: Address
}

function requireWallet(inputs: WalletInputs): { walletClient: WalletClient; account: Address } {
  if (!inputs.walletClient || !inputs.account) {
    throw new Error('walletClient and account are required. Provide them via PanopticProvider.')
  }

  return {
    walletClient: inputs.walletClient,
    account: inputs.account,
  }
}

function createWalletMutationContext(inputs: WalletInputs): WalletMutationContext {
  return { signerAccount: requireWallet(inputs).account }
}

function invalidateKeys(
  queryClient: QueryClient,
  keysToInvalidate: readonly (readonly string[])[],
): void {
  const seen = new Set<string>()

  for (const key of keysToInvalidate) {
    const serialized = JSON.stringify(key)
    if (seen.has(serialized)) {
      continue
    }

    seen.add(serialized)
    queryClient.invalidateQueries({ queryKey: key })
  }
}

export function useApprove() {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjected<ApproveParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return approve({ client: publicClient, ...wallet, ...params })
    },
    onSuccess: (_data, params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.approve(
          chainId,
          params.tokenAddress,
          context.signerAccount,
          params.spenderAddress,
        ),
      )
    },
  })
}

export function useApprovePool(poolAddress: Address) {
  const { publicClient, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjectedWithPool<ApprovePoolParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return approvePool({ client: publicClient, ...wallet, poolAddress, ...params })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...queryKeys.all, 'approval'] })
    },
  })
}

export function useDeposit(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjected<DepositParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return deposit({ client: publicClient, ...wallet, ...params })
    },
    onSuccess: (_data, _params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.deposit({ chainId, poolAddress, account: context.signerAccount }),
      )
    },
  })
}

export function useWithdraw(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjected<WithdrawParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return withdraw({ client: publicClient, ...wallet, ...params })
    },
    onSuccess: (_data, _params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.withdraw({ chainId, poolAddress, account: context.signerAccount }),
      )
    },
  })
}

export function useMintShares(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjected<MintParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return mint({ client: publicClient, ...wallet, ...params })
    },
    onSuccess: (_data, _params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.mint({ chainId, poolAddress, account: context.signerAccount }),
      )
    },
  })
}

export function useRedeem(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjected<RedeemParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return redeem({ client: publicClient, ...wallet, ...params })
    },
    onSuccess: (_data, _params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.redeem({ chainId, poolAddress, account: context.signerAccount }),
      )
    },
  })
}

export function useWithdrawWithPositions(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjected<WithdrawWithPositionsParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return withdrawWithPositions({ client: publicClient, ...wallet, ...params })
    },
    onSuccess: (_data, _params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.withdraw({ chainId, poolAddress, account: context.signerAccount }),
      )
    },
  })
}

export function useOpenPosition(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjectedWithPool<OpenPositionParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return openPosition({ client: publicClient, ...wallet, poolAddress, ...params })
    },
    onSuccess: (_data, _params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.openPosition({ chainId, poolAddress, account: context.signerAccount }),
      )
    },
  })
}

export function useClosePosition(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjectedWithPool<ClosePositionParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return closePosition({ client: publicClient, ...wallet, poolAddress, ...params })
    },
    onSuccess: (_data, params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.closePosition({
          chainId,
          poolAddress,
          account: context.signerAccount,
          tokenId: params.tokenId,
        }),
      )
    },
  })
}

export function useRollPosition(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjectedWithPool<RollPositionParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return rollPosition({ client: publicClient, ...wallet, poolAddress, ...params })
    },
    onSuccess: (_data, _params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.openPosition({ chainId, poolAddress, account: context.signerAccount }),
      )
    },
  })
}

export function useLiquidate(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjectedWithPool<LiquidateParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return liquidate({ client: publicClient, ...wallet, poolAddress, ...params })
    },
    onSuccess: (_data, params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(queryClient, [
        ...mutationEffects.liquidate({ chainId, poolAddress, account: context.signerAccount }),
        ...mutationEffects.liquidate({ chainId, poolAddress, account: params.liquidatee }),
      ])
    },
  })
}

export function useForceExercise(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjectedWithPool<ForceExerciseParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return forceExercise({ client: publicClient, ...wallet, poolAddress, ...params })
    },
    onSuccess: (_data, params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(queryClient, [
        ...mutationEffects.forceExercise({ chainId, poolAddress, account: context.signerAccount }),
        ...mutationEffects.forceExercise({ chainId, poolAddress, account: params.user }),
      ])
    },
  })
}

export function useSettleAccumulatedPremia(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjectedWithPool<SettleParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return settleAccumulatedPremia({ client: publicClient, ...wallet, poolAddress, ...params })
    },
    onSuccess: (_data, _params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.settleAccumulatedPremia({
          chainId,
          poolAddress,
          account: context.signerAccount,
        }),
      )
    },
  })
}

export function usePokeOracle(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params?: OmitInjectedWithPool<PokeOracleParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return pokeOracle({ client: publicClient, ...wallet, poolAddress, ...params })
    },
    onSuccess: () => {
      invalidateKeys(queryClient, mutationEffects.pokeOracle({ chainId, poolAddress }))
    },
  })
}

export function useDispatch(poolAddress: Address) {
  const { publicClient, chainId, walletClient, account } = usePanopticContext()
  const queryClient = useQueryClient()

  return useMutation({
    onMutate: () => createWalletMutationContext({ walletClient, account }),
    mutationFn: (params: OmitInjectedWithPool<DispatchParams>) => {
      const wallet = requireWallet({ walletClient, account })
      return dispatch({ client: publicClient, ...wallet, poolAddress, ...params })
    },
    onSuccess: (_data, _params, context) => {
      if (!context) {
        return
      }

      invalidateKeys(
        queryClient,
        mutationEffects.openPosition({ chainId, poolAddress, account: context.signerAccount }),
      )
    },
  })
}
