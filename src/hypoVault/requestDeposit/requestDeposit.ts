import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { encodeFunctionData } from 'viem'
import { simulateContract, writeContract } from 'viem/actions'

import { HypoVaultAbi } from '../../abis/HypoVault'

export const getRequestDepositContractConfig = ({
  vaultAddress,
  assets,
}: {
  vaultAddress: Address
  assets: bigint
}) =>
  ({
    address: vaultAddress,
    abi: HypoVaultAbi,
    functionName: 'requestDeposit',
    args: [assets],
  }) as const

export function encodeRequestDepositFunctionData({ assets }: { assets: bigint }): Hex {
  return encodeFunctionData({
    abi: HypoVaultAbi,
    functionName: 'requestDeposit',
    args: [assets],
  })
}

export function simulateRequestDeposit({
  viemClient,
  vaultAddress,
  assets,
  account,
}: {
  viemClient: Client<Transport, Chain, Account | undefined>
  vaultAddress: Address
  assets: bigint
  account?: Account | Address
}): Promise<unknown> {
  return simulateContract(viemClient, {
    ...getRequestDepositContractConfig({ vaultAddress, assets }),
    account,
  })
}

export function requestDeposit({
  walletClient,
  vaultAddress,
  assets,
  account,
}: {
  walletClient: Client<Transport, Chain, Account>
  vaultAddress: Address
  assets: bigint
  account?: Account | Address
}): Promise<unknown> {
  return writeContract(walletClient, {
    ...getRequestDepositContractConfig({ vaultAddress, assets }),
    account,
  })
}
