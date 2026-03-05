import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { encodeFunctionData } from 'viem'
import { simulateContract, writeContract } from 'viem/actions'

import { HypoVaultAbi } from '../../abis/HypoVault'

export const getCancelDepositContractConfig = ({ vaultAddress }: { vaultAddress: Address }) =>
  ({
    address: vaultAddress,
    abi: HypoVaultAbi,
    functionName: 'cancelDeposit',
    args: [],
  }) as const

export function encodeCancelDepositFunctionData(): Hex {
  return encodeFunctionData({
    abi: HypoVaultAbi,
    functionName: 'cancelDeposit',
    args: [],
  })
}

export function simulateCancelDeposit({
  viemClient,
  vaultAddress,
  account,
}: {
  viemClient: Client<Transport, Chain, Account | undefined>
  vaultAddress: Address
  account?: Account | Address
}): Promise<unknown> {
  return simulateContract(viemClient, {
    ...getCancelDepositContractConfig({ vaultAddress }),
    account,
  })
}

export function cancelDeposit({
  walletClient,
  vaultAddress,
  account,
}: {
  walletClient: Client<Transport, Chain, Account>
  vaultAddress: Address
  account?: Account | Address
}): Promise<unknown> {
  return writeContract(walletClient, {
    ...getCancelDepositContractConfig({ vaultAddress }),
    account,
  })
}
