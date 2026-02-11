/**
 * TanStack Query v5 sync hooks for the Panoptic v2 SDK.
 * @module v2/react/hooks/sync
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Address, Hash } from 'viem'

import {
  type PendingPosition,
  type SyncProgressEvent,
  addPendingPosition,
  clearTrackedPositions,
  confirmPendingPosition,
  failPendingPosition,
  syncPositions,
} from '../../sync'
import { usePanopticContext, useRequireStorage } from '../provider'
import { queryKeys } from '../queryKeys'

/**
 * Hook for syncing positions with progress tracking.
 */
export function useSyncPositions(poolAddress: Address) {
  const { publicClient, chainId } = usePanopticContext()
  const storage = useRequireStorage()
  const account = usePanopticContext().account
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<SyncProgressEvent | null>(null)

  const mutation = useMutation({
    mutationFn: async (params?: { fromBlock?: bigint; toBlock?: bigint }) => {
      if (!account) throw new Error('account is required for sync')
      const result = await syncPositions({
        client: publicClient,
        chainId,
        poolAddress,
        account,
        storage,
        fromBlock: params?.fromBlock,
        toBlock: params?.toBlock,
        onUpdate: setProgress,
      })
      return result
    },
    onSuccess: () => {
      if (!account) return
      queryClient.invalidateQueries({
        queryKey: queryKeys.trackedPositionIds(chainId, poolAddress, account),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.syncStatus(chainId, poolAddress, account),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions(chainId, poolAddress, account),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.closedPositions(chainId, poolAddress, account),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.tradeHistory(chainId, poolAddress, account),
      })
    },
  })

  return { ...mutation, progress }
}

/**
 * Hook for adding a pending position (optimistic update).
 */
export function useAddPendingPosition(poolAddress: Address) {
  const { chainId } = usePanopticContext()
  const storage = useRequireStorage()
  const account = usePanopticContext().account
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (position: PendingPosition) => {
      if (!account) throw new Error('account is required')
      return addPendingPosition({ chainId, poolAddress, account, storage, position })
    },
    onSuccess: () => {
      if (!account) return
      queryClient.invalidateQueries({
        queryKey: queryKeys.trackedPositionIds(chainId, poolAddress, account),
      })
    },
  })
}

/**
 * Hook for confirming a pending position.
 */
export function useConfirmPendingPosition(poolAddress: Address) {
  const { chainId } = usePanopticContext()
  const storage = useRequireStorage()
  const account = usePanopticContext().account
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (tokenId: bigint) => {
      if (!account) throw new Error('account is required')
      return confirmPendingPosition({ chainId, poolAddress, account, storage, tokenId })
    },
    onSuccess: () => {
      if (!account) return
      queryClient.invalidateQueries({
        queryKey: queryKeys.trackedPositionIds(chainId, poolAddress, account),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions(chainId, poolAddress, account),
      })
    },
  })
}

/**
 * Hook for marking a pending position as failed.
 */
export function useFailPendingPosition(poolAddress: Address) {
  const { chainId } = usePanopticContext()
  const storage = useRequireStorage()
  const account = usePanopticContext().account
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (txHash: Hash) => {
      if (!account) throw new Error('account is required')
      return failPendingPosition({ chainId, poolAddress, account, storage, txHash })
    },
    onSuccess: () => {
      if (!account) return
      queryClient.invalidateQueries({
        queryKey: queryKeys.trackedPositionIds(chainId, poolAddress, account),
      })
    },
  })
}

/**
 * Hook for clearing all tracked positions.
 */
export function useClearTrackedPositions(poolAddress: Address) {
  const { chainId } = usePanopticContext()
  const storage = useRequireStorage()
  const account = usePanopticContext().account
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      if (!account) throw new Error('account is required')
      return clearTrackedPositions({ chainId, poolAddress, account, storage })
    },
    onSuccess: () => {
      if (!account) return
      queryClient.invalidateQueries({
        queryKey: queryKeys.trackedPositionIds(chainId, poolAddress, account),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions(chainId, poolAddress, account),
      })
    },
  })
}
