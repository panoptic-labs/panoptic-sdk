import {
  type Address,
  type PublicClient,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
} from 'viem'

import { safeAbi } from './signedSafeTx'

/** Detect deployed Safes by their account interface; RPC failures remain errors. */
export async function isSafeAccount({
  client,
  address,
}: {
  client: Pick<PublicClient, 'getCode' | 'readContract'>
  address: Address
}): Promise<boolean> {
  const code = await client.getCode({ address })
  if (!code || code === '0x') return false

  try {
    const [version, threshold, owners] = await Promise.all([
      client.readContract({ address, abi: safeAbi, functionName: 'VERSION' }),
      client.readContract({ address, abi: safeAbi, functionName: 'getThreshold' }),
      client.readContract({ address, abi: safeAbi, functionName: 'getOwners' }),
    ])
    return /^\d+\.\d+\.\d+/.test(version) && threshold > 0n && threshold <= BigInt(owners.length)
  } catch (error) {
    const cause =
      error instanceof BaseError
        ? error.walk(
            (cause) =>
              cause instanceof ContractFunctionRevertedError ||
              cause instanceof ContractFunctionZeroDataError,
          )
        : error
    if (
      cause instanceof ContractFunctionRevertedError ||
      cause instanceof ContractFunctionZeroDataError
    )
      return false
    throw error
  }
}
