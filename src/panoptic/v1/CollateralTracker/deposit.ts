import type { Address, Hex } from 'viem'
import { encodeFunctionData } from 'viem'

import { CollateralTrackerAbi } from '../../../abis/CollateralTracker'

export function encodeDepositFunctionData({
  assets,
  receiver,
}: {
  assets: bigint
  receiver: Address
}): Hex {
  return encodeFunctionData({
    abi: CollateralTrackerAbi,
    functionName: 'deposit',
    args: [assets, receiver],
  })
}
