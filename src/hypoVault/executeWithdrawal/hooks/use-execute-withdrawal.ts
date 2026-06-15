import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Address } from 'viem'
import { zeroAddress } from 'viem'
import {
  useAccount,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

import { isErrorUserRejection, parseCustomError } from '../../../errors/ethereum'
import type { BaseContractWriteHookOutput } from '../../../types/baseContractWriteHookOutput'
import {
  buildExecuteWithdrawalCalldatas,
  getExecuteWithdrawalMulticallContractConfig,
} from '../executeWithdrawal'
import type { QueuedWithdrawalSnapshot, WithdrawalEpochStateSnapshot } from '../utils'
import { calculateClaimableAssetsFromQueuedWithdrawals } from '../utils'

export const selectExecutableWithdrawalEpochs = ({
  desiredAssets,
  maxAssetsToExecute,
  claimableWithdrawals,
}: {
  desiredAssets: bigint
  maxAssetsToExecute?: bigint
  claimableWithdrawals: ReturnType<typeof calculateClaimableAssetsFromQueuedWithdrawals>['byEpoch']
}) => {
  if (desiredAssets <= 0n) {
    return { epochsToExecute: [] as bigint[], assetsToExecute: 0n }
  }

  const ordered = [...claimableWithdrawals].sort((a, b) => {
    if (maxAssetsToExecute !== undefined && a.assetsToReceive !== b.assetsToReceive) {
      return a.assetsToReceive > b.assetsToReceive ? -1 : 1
    }
    return a.epoch < b.epoch ? -1 : 1
  })

  const selectedEpochs: bigint[] = []
  let accumulatedAssets = 0n

  for (const entry of ordered) {
    const nextAccumulatedAssets = accumulatedAssets + entry.assetsToReceive
    if (maxAssetsToExecute !== undefined && nextAccumulatedAssets > maxAssetsToExecute) {
      continue
    }

    selectedEpochs.push(entry.epoch)
    accumulatedAssets = nextAccumulatedAssets

    if (accumulatedAssets >= desiredAssets) {
      break
    }
  }

  return { epochsToExecute: selectedEpochs, assetsToExecute: accumulatedAssets }
}

export const useExecuteWithdrawal = ({
  chainId,
  vaultAddress,
  desiredAssets,
  maxAssetsToExecute,
  queuedWithdrawals,
  withdrawalEpochStates,
  currentWithdrawalEpoch,
  onWaitSuccess,
}: {
  chainId?: number
  vaultAddress: Address
  desiredAssets: bigint
  maxAssetsToExecute?: bigint
  queuedWithdrawals: QueuedWithdrawalSnapshot[]
  withdrawalEpochStates: WithdrawalEpochStateSnapshot[]
  currentWithdrawalEpoch: bigint
  onWaitSuccess?: () => void
}) => {
  const { address: account } = useAccount()
  const user = account ?? zeroAddress

  const claimableWithdrawals = useMemo(
    () =>
      calculateClaimableAssetsFromQueuedWithdrawals({
        queuedWithdrawals,
        withdrawalEpochStates,
        currentWithdrawalEpoch,
      }),
    [queuedWithdrawals, withdrawalEpochStates, currentWithdrawalEpoch],
  )

  const { epochsToExecute, assetsToExecute } = useMemo(() => {
    return selectExecutableWithdrawalEpochs({
      desiredAssets,
      maxAssetsToExecute,
      claimableWithdrawals: claimableWithdrawals.byEpoch,
    })
  }, [desiredAssets, maxAssetsToExecute, claimableWithdrawals.byEpoch])

  const multicallCalldatas = useMemo(() => {
    return epochsToExecute.length > 0
      ? buildExecuteWithdrawalCalldatas({ user, epochsToExecute })
      : []
  }, [epochsToExecute, user])

  const multicallDecoded = useMemo(() => {
    return epochsToExecute.map((epoch) => ({
      functionName: 'executeWithdrawal',
      args: [user, epoch] as const,
    }))
  }, [epochsToExecute, user])

  console.debug('executeWithdrawal multicall calldatas', {
    user,
    epochsToExecute,
    multicallCalldatas,
    multicallDecoded,
    assetsToExecute,
    claimableAssets: claimableWithdrawals.totalAssets,
  })

  const canSimulate =
    multicallCalldatas.length > 0 &&
    vaultAddress !== zeroAddress &&
    account != null &&
    account !== zeroAddress

  const simulate = useSimulateContract({
    chainId,
    ...getExecuteWithdrawalMulticallContractConfig({ vaultAddress, multicallCalldatas }),
    account,
    query: {
      enabled: canSimulate,
      retry: false,
    },
  })

  const write = useWriteContract()

  const wait = useWaitForTransactionReceipt({
    chainId,
    hash: write.data,
    query: {
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  })

  const handledRequestHashRef = useRef<`0x${string}` | undefined>(undefined)

  useEffect(() => {
    const requestHash = write.data
    if (!wait.isSuccess || requestHash == null) {
      return
    }
    if (handledRequestHashRef.current === requestHash) {
      return
    }

    handledRequestHashRef.current = requestHash
    onWaitSuccess?.()
  }, [onWaitSuccess, wait.isSuccess, write.data])

  const act = useCallback(() => {
    const request = simulate.data?.request
    return request != null ? write.writeContract(request) : undefined
  }, [simulate.data?.request, write])

  const actionLabel = useMemo(() => {
    if (simulate.isLoading) {
      return 'Simulating withdrawal execution...'
    }
    if (write.isPending || wait.isLoading) {
      return 'Executing withdrawal...'
    }
    return 'Execute Withdrawal'
  }, [simulate.isLoading, write.isPending, wait.isLoading])

  const isLoading = simulate.isLoading || write.isPending || wait.isLoading

  const error = useMemo(() => {
    if (simulate.error) {
      return parseCustomError(simulate.error)
    }
    if (write.error && !isErrorUserRejection(write.error.message)) {
      return parseCustomError(write.error)
    }
    return undefined
  }, [simulate.error, write.error])

  const output = {
    actionLabel,
    act,
    isLoading,
    error,
    simulate,
    write,
    wait,
  } satisfies BaseContractWriteHookOutput

  return {
    ...output,
    claimableAssets: claimableWithdrawals.totalAssets,
    assetsToExecute,
    epochsToExecute,
    multicallCalldatas,
  }
}
