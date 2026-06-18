import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const APPROVAL_SYNC_POLL_INTERVAL_MS = 1200
const APPROVAL_SYNC_MAX_ATTEMPTS = 20

export const useRequestDeposit = ({
  chainId,
  vaultAddress,
  assets,
  tokenAddress,
  simulationAccount,
  onWaitSuccess,
}: {
  chainId?: number
  vaultAddress: Address
  assets: bigint
  tokenAddress: Address
  simulationAccount?: Address
  onWaitSuccess?: () => void
}) => {
  const { address: account } = useAccount()
  const simulatedAccount = simulationAccount ?? account
  const canReadAllowance =
    simulatedAccount != null &&
    simulatedAccount !== zeroAddress &&
    tokenAddress !== zeroAddress &&
    vaultAddress !== zeroAddress

  const allowanceRead = useReadContract({
    chainId,
    address: canReadAllowance ? tokenAddress : undefined,
    abi: Erc20Abi,
    functionName: 'allowance',
    args: canReadAllowance ? [simulatedAccount, vaultAddress] : undefined,
    query: {
      enabled: canReadAllowance,
    },
  })

  const allowanceKnown = allowanceRead.data !== undefined

  const tokenNeedsApproval = canReadAllowance && allowanceKnown && allowanceRead.data < assets
  const normalizedAccount = account?.toLowerCase()
  const normalizedSimulationAccount = simulationAccount?.toLowerCase()
  const canApproveForSimulatedAccount =
    normalizedAccount != null &&
    normalizedAccount !== zeroAddress &&
    (normalizedSimulationAccount === undefined || normalizedSimulationAccount === normalizedAccount)

  const refetchAllowance = allowanceRead.refetch

  const approveSimulate = useSimulateContract({
    chainId,
    address: tokenAddress,
    abi: Erc20Abi,
    functionName: 'approve',
    args: [vaultAddress, maxUint256],
    account,
    query: {
      enabled:
        allowanceKnown &&
        tokenNeedsApproval &&
        assets > 0n &&
        account != null &&
        canApproveForSimulatedAccount,
      retry: false,
    },
  })

  const approveWrite = useWriteContract()

  const approveWait = useWaitForTransactionReceipt({
    chainId,
    hash: approveWrite.data,
    query: {
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  })

  const simulate = useSimulateContract({
    chainId,
    ...getRequestDepositContractConfig({ vaultAddress, assets }),
    account: simulatedAccount,
    query: {
      enabled:
        allowanceKnown &&
        !tokenNeedsApproval &&
        assets > 0n &&
        vaultAddress !== zeroAddress &&
        simulatedAccount != null &&
        simulatedAccount !== zeroAddress,
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

  const handledApproveHashRef = useRef<`0x${string}` | undefined>(undefined)
  const handledRequestHashRef = useRef<`0x${string}` | undefined>(undefined)
  const approvalSyncAttemptCountRef = useRef(0)
  const [isApprovalSyncing, setIsApprovalSyncing] = useState(false)

  useEffect(() => {
    const approveHash = approveWrite.data
    if (!approveWait.isSuccess || approveHash == null) {
      return
    }
    if (handledApproveHashRef.current === approveHash) {
      return
    }

    handledApproveHashRef.current = approveHash
    approvalSyncAttemptCountRef.current = 0
    setIsApprovalSyncing(true)
    void refetchAllowance()
  }, [approveWait.isSuccess, approveWrite.data, refetchAllowance])

  useEffect(() => {
    if (!isApprovalSyncing) {
      return
    }
    if (!tokenNeedsApproval) {
      setIsApprovalSyncing(false)
      return
    }
    if (approvalSyncAttemptCountRef.current >= APPROVAL_SYNC_MAX_ATTEMPTS) {
      setIsApprovalSyncing(false)
      return
    }

    const timeoutId = setTimeout(() => {
      approvalSyncAttemptCountRef.current += 1
      void refetchAllowance()
    }, APPROVAL_SYNC_POLL_INTERVAL_MS)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [isApprovalSyncing, tokenNeedsApproval, refetchAllowance])

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
    if (isApprovalSyncing) {
      return undefined
    }
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
    isApprovalSyncing,
    simulate.data?.request,
    write,
  ])

  const actionLabel = useMemo(() => {
    if (isApprovalSyncing) {
      return 'Approval confirmed. Syncing allowance...'
    }
    if (tokenNeedsApproval) {
      if (!canApproveForSimulatedAccount) {
        return 'Approval Required'
      }
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
    isApprovalSyncing,
    tokenNeedsApproval,
    canApproveForSimulatedAccount,
    approveSimulate.isLoading,
    approveWrite.isPending,
    approveWait.isLoading,
    simulate.isLoading,
    write.isPending,
    wait.isLoading,
  ])

  const isLoading =
    isApprovalSyncing ||
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
