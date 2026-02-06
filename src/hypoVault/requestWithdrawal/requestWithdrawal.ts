import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { encodeFunctionData } from 'viem'
import { simulateContract, writeContract } from 'viem/actions'

import { HypoVaultAbi } from '../../abis/HypoVault'
import {
  type DepositEpochStateSnapshot,
  type QueuedDepositSnapshot,
  type SharePrice,
  calculateAvailableShares,
  calculateClaimableSharesFromQueuedDeposits,
  calculateSharesFromAssets,
} from './utils'

export function encodeExecuteDepositFunctionData({
  user,
  epoch,
}: {
  user: Address
  epoch: bigint
}): Hex {
  return encodeFunctionData({
    abi: HypoVaultAbi,
    functionName: 'executeDeposit',
    args: [user, epoch],
  })
}

export function encodeRequestWithdrawalFunctionData({ shares }: { shares: bigint }): Hex {
  return encodeFunctionData({
    abi: HypoVaultAbi,
    functionName: 'requestWithdrawal',
    args: [shares],
  })
}

export function encodeRequestWithdrawalMulticallFunctionData({
  multicallCalldatas,
}: {
  multicallCalldatas: Hex[]
}): Hex {
  return encodeFunctionData({
    abi: HypoVaultAbi,
    functionName: 'multicall',
    args: [multicallCalldatas],
  })
}

export const getRequestWithdrawalContractConfig = ({
  vaultAddress,
  shares,
}: {
  vaultAddress: Address
  shares: bigint
}) =>
  ({
    address: vaultAddress,
    abi: HypoVaultAbi,
    functionName: 'requestWithdrawal',
    args: [shares],
  }) as const

export const getRequestWithdrawalMulticallContractConfig = ({
  vaultAddress,
  multicallCalldatas,
}: {
  vaultAddress: Address
  multicallCalldatas: Hex[]
}) =>
  ({
    address: vaultAddress,
    abi: HypoVaultAbi,
    functionName: 'multicall',
    args: [multicallCalldatas],
  }) as const

export function simulateRequestWithdrawal({
  viemClient,
  vaultAddress,
  shares,
  account,
}: {
  viemClient: Client<Transport, Chain, Account | undefined>
  vaultAddress: Address
  shares: bigint
  account?: Account | Address
}): Promise<unknown> {
  return simulateContract(viemClient, {
    ...getRequestWithdrawalContractConfig({ vaultAddress, shares }),
    account,
  })
}

export function requestWithdrawal({
  walletClient,
  vaultAddress,
  shares,
  account,
}: {
  walletClient: Client<Transport, Chain, Account>
  vaultAddress: Address
  shares: bigint
  account?: Account | Address
}): Promise<unknown> {
  return writeContract(walletClient, {
    ...getRequestWithdrawalContractConfig({ vaultAddress, shares }),
    account,
  })
}

export function simulateRequestWithdrawalMulticall({
  viemClient,
  vaultAddress,
  multicallCalldatas,
  account,
}: {
  viemClient: Client<Transport, Chain, Account | undefined>
  vaultAddress: Address
  multicallCalldatas: Hex[]
  account?: Account | Address
}): Promise<unknown> {
  return simulateContract(viemClient, {
    ...getRequestWithdrawalMulticallContractConfig({ vaultAddress, multicallCalldatas }),
    account,
  })
}

export function requestWithdrawalMulticall({
  walletClient,
  vaultAddress,
  multicallCalldatas,
  account,
}: {
  walletClient: Client<Transport, Chain, Account>
  vaultAddress: Address
  multicallCalldatas: Hex[]
  account?: Account | Address
}): Promise<unknown> {
  return writeContract(walletClient, {
    ...getRequestWithdrawalMulticallContractConfig({ vaultAddress, multicallCalldatas }),
    account,
  })
}

export function buildExecuteDepositCalldatas({
  user,
  epochsToExecute,
}: {
  user: Address
  epochsToExecute: bigint[]
}): Hex[] {
  return epochsToExecute.map((epoch) => encodeExecuteDepositFunctionData({ user, epoch }))
}

export function buildRequestWithdrawalCalldatas({
  user,
  desiredAssets,
  sharePrice,
  walletShares,
  queuedDeposits,
  depositEpochStates,
  currentDepositEpoch,
}: {
  user: Address
  desiredAssets: bigint
  sharePrice: SharePrice
  walletShares: bigint
  queuedDeposits: QueuedDepositSnapshot[]
  depositEpochStates: DepositEpochStateSnapshot[]
  currentDepositEpoch: bigint
}) {
  const claimable = calculateClaimableSharesFromQueuedDeposits({
    queuedDeposits,
    depositEpochStates,
    currentDepositEpoch,
  })

  const availableShares = calculateAvailableShares({
    walletShares,
    claimableDepositShares: claimable.totalShares,
  })

  const sharesForAssets = calculateSharesFromAssets({
    assets: desiredAssets,
    sharePrice,
  })

  const sharesToRequest = sharesForAssets > availableShares ? availableShares : sharesForAssets

  const executeDepositCalldatas = buildExecuteDepositCalldatas({
    user,
    epochsToExecute: claimable.epochsToExecute,
  })

  const requestWithdrawalCalldata =
    sharesToRequest > 0n ? encodeRequestWithdrawalFunctionData({ shares: sharesToRequest }) : null

  const multicallCalldatas = requestWithdrawalCalldata
    ? [...executeDepositCalldatas, requestWithdrawalCalldata]
    : executeDepositCalldatas

  return {
    claimableDepositShares: claimable,
    availableShares,
    sharesToRequest,
    multicallCalldatas,
  }
}
