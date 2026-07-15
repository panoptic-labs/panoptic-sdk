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
  buildClaimVaultShareCalldatas,
  getRequestWithdrawalMulticallContractConfig,
} from '../requestWithdrawal'
import type { DepositEpochStateSnapshot, QueuedDepositSnapshot } from '../utils'

export const useClaimVaultShares = ({
  chainId,
  vaultAddress,
  queuedDeposits,
  depositEpochStates,
  currentDepositEpoch,
  simulationAccount,
  onWaitSuccess,
}: {
  chainId?: number
  vaultAddress: Address
  queuedDeposits: QueuedDepositSnapshot[]
  depositEpochStates: DepositEpochStateSnapshot[]
  currentDepositEpoch: bigint
  simulationAccount?: Address
  onWaitSuccess?: () => void
}) => {
  const { address: account } = useAccount()
  const simulatedAccount = simulationAccount ?? account
  const user = simulatedAccount ?? zeroAddress

  const { claimableDepositShares, selectedExecuteDepositEpochs, multicallCalldatas } = useMemo(
    () =>
      buildClaimVaultShareCalldatas({
        user,
        queuedDeposits,
        depositEpochStates,
        currentDepositEpoch,
      }),
    [user, queuedDeposits, depositEpochStates, currentDepositEpoch],
  )

  const canSimulate =
    multicallCalldatas.length > 0 &&
    vaultAddress !== zeroAddress &&
    simulatedAccount != null &&
    simulatedAccount !== zeroAddress

  const simulate = useSimulateContract({
    chainId,
    ...getRequestWithdrawalMulticallContractConfig({ vaultAddress, multicallCalldatas }),
    account: simulatedAccount,
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
      return 'Simulating vault share claim...'
    }
    if (write.isPending || wait.isLoading) {
      return 'Claiming vault shares...'
    }
    return 'Claim Vault Shares'
  }, [simulate.isLoading, write.isPending, wait.isLoading])

  const isLoading = simulate.isLoading || write.isPending || wait.isLoading

  const error = useMemo(() => {
    if (simulate.error) {
      return parseCustomError(simulate.error)
    }
    if (write.error && !isErrorUserRejection(write.error.message)) {
      return parseCustomError(write.error)
    }
    if (wait.error) {
      return parseCustomError(wait.error)
    }
    return undefined
  }, [simulate.error, wait.error, write.error])

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
    claimableDepositShares,
    selectedExecuteDepositEpochs,
    multicallCalldatas,
  }
}
