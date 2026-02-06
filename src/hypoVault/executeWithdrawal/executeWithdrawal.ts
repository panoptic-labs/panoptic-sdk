import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { encodeFunctionData } from 'viem'
import { simulateContract, writeContract } from 'viem/actions'

import { HypoVaultAbi } from '../../abis/HypoVault'

export function encodeExecuteWithdrawalFunctionData({
  user,
  epoch,
}: {
  user: Address
  epoch: bigint
}): Hex {
  return encodeFunctionData({
    abi: HypoVaultAbi,
    functionName: 'executeWithdrawal',
    args: [user, epoch],
  })
}

export function encodeExecuteWithdrawalMulticallFunctionData({
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

export const getExecuteWithdrawalContractConfig = ({
  vaultAddress,
  user,
  epoch,
}: {
  vaultAddress: Address
  user: Address
  epoch: bigint
}) =>
  ({
    address: vaultAddress,
    abi: HypoVaultAbi,
    functionName: 'executeWithdrawal',
    args: [user, epoch],
  }) as const

export const getExecuteWithdrawalMulticallContractConfig = ({
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

export function simulateExecuteWithdrawal({
  viemClient,
  vaultAddress,
  user,
  epoch,
  account,
}: {
  viemClient: Client<Transport, Chain, Account | undefined>
  vaultAddress: Address
  user: Address
  epoch: bigint
  account?: Account | Address
}): Promise<unknown> {
  return simulateContract(viemClient, {
    ...getExecuteWithdrawalContractConfig({ vaultAddress, user, epoch }),
    account,
  })
}

export function executeWithdrawal({
  walletClient,
  vaultAddress,
  user,
  epoch,
  account,
}: {
  walletClient: Client<Transport, Chain, Account>
  vaultAddress: Address
  user: Address
  epoch: bigint
  account?: Account | Address
}): Promise<unknown> {
  return writeContract(walletClient, {
    ...getExecuteWithdrawalContractConfig({ vaultAddress, user, epoch }),
    account,
  })
}

export function simulateExecuteWithdrawalMulticall({
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
    ...getExecuteWithdrawalMulticallContractConfig({ vaultAddress, multicallCalldatas }),
    account,
  })
}

export function executeWithdrawalMulticall({
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
    ...getExecuteWithdrawalMulticallContractConfig({ vaultAddress, multicallCalldatas }),
    account,
  })
}

export function buildExecuteWithdrawalCalldatas({
  user,
  epochsToExecute,
}: {
  user: Address
  epochsToExecute: bigint[]
}): Hex[] {
  return epochsToExecute.map((epoch) => encodeExecuteWithdrawalFunctionData({ user, epoch }))
}
