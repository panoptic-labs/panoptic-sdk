/**
 * TanStack Query v5 simulation hooks for the Panoptic v2 SDK.
 * @module v2/react/hooks/simulations
 */

import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'

import {
  type SimulateClosePositionParams,
  type SimulateDepositParams,
  type SimulateDispatchParams,
  type SimulateForceExerciseParams,
  type SimulateLiquidateParams,
  type SimulateOpenPositionParams,
  type SimulateSettleParams,
  type SimulateWithdrawParams,
  simulateClosePosition,
  simulateDeposit,
  simulateDispatch,
  simulateForceExercise,
  simulateLiquidate,
  simulateOpenPosition,
  simulateSettle,
  simulateWithdraw,
} from '../../simulations'
import { getClientCacheScopeKey } from '../cacheScopes'
import { usePanopticContext } from '../provider'
import { queryKeys } from '../queryKeys'

type OmitClient<T> = Omit<T, 'client'>
type OmitClientAndPool<T> = Omit<T, 'client' | 'poolAddress'>

export function useSimulateOpenPosition(
  poolAddress: Address,
  params?: OmitClientAndPool<SimulateOpenPositionParams>,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sim',
      'openPosition',
      poolAddress,
      params?.tokenId?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => simulateOpenPosition({ client: publicClient, poolAddress, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

export function useSimulateClosePosition(
  poolAddress: Address,
  params?: OmitClientAndPool<SimulateClosePositionParams>,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sim',
      'closePosition',
      poolAddress,
      params?.tokenId?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => simulateClosePosition({ client: publicClient, poolAddress, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

export function useSimulateDeposit(params?: OmitClient<SimulateDepositParams>) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sim',
      'deposit',
      params?.collateralTrackerAddress,
      params?.assets?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => simulateDeposit({ client: publicClient, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

export function useSimulateWithdraw(params?: OmitClient<SimulateWithdrawParams>) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sim',
      'withdraw',
      params?.collateralTrackerAddress,
      params?.assets?.toString(),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => simulateWithdraw({ client: publicClient, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

export function useSimulateLiquidate(
  poolAddress: Address,
  params?: OmitClientAndPool<SimulateLiquidateParams>,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sim',
      'liquidate',
      poolAddress,
      params?.liquidatee,
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => simulateLiquidate({ client: publicClient, poolAddress, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

export function useSimulateForceExercise(
  poolAddress: Address,
  params?: OmitClientAndPool<SimulateForceExerciseParams>,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sim',
      'forceExercise',
      poolAddress,
      params?.user,
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => simulateForceExercise({ client: publicClient, poolAddress, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

export function useSimulateSettle(
  poolAddress: Address,
  params?: OmitClientAndPool<SimulateSettleParams>,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sim',
      'settle',
      poolAddress,
      params?.account,
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => simulateSettle({ client: publicClient, poolAddress, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}

export function useSimulateDispatch(
  poolAddress: Address,
  params?: OmitClientAndPool<SimulateDispatchParams>,
) {
  const { publicClient, clientScope } = usePanopticContext()
  return useQuery({
    queryKey: [
      ...queryKeys.all,
      'sim',
      'dispatch',
      poolAddress,
      JSON.stringify(params?.positionIdList?.map(String)),
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ] as const,
    queryFn: () => simulateDispatch({ client: publicClient, poolAddress, ...params! }),
    enabled: params !== undefined,
    staleTime: 0,
  })
}
