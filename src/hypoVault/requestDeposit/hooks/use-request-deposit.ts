import { useCallback, useMemo } from 'react'
import type { Address } from 'viem'
import { maxUint256, zeroAddress } from 'viem'
import {
  useAccount,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

import { Erc20Abi } from '../../../abis/erc20ABI'
import { isErrorUserRejection, parseCustomError } from '../../../errors/ethereum'
import type { BaseContractWriteHookOutput } from '../../../types/baseContractWriteHookOutput'
import { getRequestDepositContractConfig } from '../requestDeposit'

export const useRequestDeposit = ({
  vaultAddress,
  assets,
  tokenAddress,
  onWaitSuccess,
}: {
  vaultAddress: Address
  assets: bigint
  tokenAddress: Address
  onWaitSuccess?: () => void
}) => {
  const { address: account } = useAccount()

  const allowanceRead = useReadContract({
    address: tokenAddress,
    abi: Erc20Abi,
    functionName: 'allowance',
    args: [account ?? zeroAddress, vaultAddress],
    query: {
      enabled: account != null && account !== zeroAddress,
    },
  })

  const tokenNeedsApproval =
    !allowanceRead.isFetching && (allowanceRead.data === undefined || allowanceRead.data < assets)

  const refetchAllowance = allowanceRead.refetch

  const approveSimulate = useSimulateContract({
    address: tokenAddress,
    abi: Erc20Abi,
    functionName: 'approve',
    args: [vaultAddress, maxUint256],
    account,
    query: {
      enabled: tokenNeedsApproval && assets > 0n && account != null,
      retry: false,
    },
  })

  const approveWrite = useWriteContract()

  const approveWait = useWaitForTransactionReceipt({
    hash: approveWrite.data,
    query: {
      meta: {
        onSuccess: refetchAllowance,
      },
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  })

  const simulate = useSimulateContract({
    ...getRequestDepositContractConfig({ vaultAddress, assets }),
    account,
    query: {
      enabled:
        !tokenNeedsApproval &&
        assets > 0n &&
        vaultAddress !== zeroAddress &&
        account != null &&
        account !== zeroAddress,
      retry: false,
    },
  })

  const write = useWriteContract()

  const wait = useWaitForTransactionReceipt({
    hash: write.data,
    query: {
      meta: {
        onSuccess: onWaitSuccess,
      },
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  })

  const act = useCallback(() => {
    if (tokenNeedsApproval) {
      const request = approveSimulate.data?.request
      return request != null ? approveWrite.writeContract(request) : undefined
    }
    const request = simulate.data?.request
    return request != null ? write.writeContract(request) : undefined
  }, [
    tokenNeedsApproval,
    approveSimulate.data?.request,
    approveWrite,
    simulate.data?.request,
    write,
  ])

  const actionLabel = useMemo(() => {
    if (tokenNeedsApproval) {
      if (approveSimulate.isLoading) {
        return 'Simulating approval...'
      }
      if (approveWrite.isPending || approveWait.isLoading) {
        return 'Approving...'
      }
      return 'Approve Token'
    }
    if (simulate.isLoading) {
      return 'Simulating deposit request...'
    }
    if (write.isPending || wait.isLoading) {
      return 'Requesting deposit...'
    }
    return 'Request Deposit'
  }, [
    tokenNeedsApproval,
    approveSimulate.isLoading,
    approveWrite.isPending,
    approveWait.isLoading,
    simulate.isLoading,
    write.isPending,
    wait.isLoading,
  ])

  const isLoading =
    (tokenNeedsApproval &&
      (approveSimulate.isLoading || approveWrite.isPending || approveWait.isLoading)) ||
    (!tokenNeedsApproval && (simulate.isLoading || write.isPending || wait.isLoading))

  const error = useMemo(() => {
    if (tokenNeedsApproval) {
      if (approveSimulate.error) {
        return parseCustomError(approveSimulate.error)
      }
      if (approveWrite.error) {
        return parseCustomError(approveWrite.error)
      }
    }
    if (simulate.error) {
      return parseCustomError(simulate.error)
    }
    if (write.error && !isErrorUserRejection(write.error.message)) {
      return parseCustomError(write.error)
    }
    return undefined
  }, [tokenNeedsApproval, approveSimulate.error, approveWrite.error, simulate.error, write.error])

  return {
    actionLabel,
    act,
    isLoading,
    error,
    simulate,
    write,
    wait,
  } satisfies BaseContractWriteHookOutput
}
