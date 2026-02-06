import type { Address } from 'viem'
import { encodeFunctionData } from 'viem'

import { CollateralTrackerAbi } from '../../../abis/CollateralTracker'

export function encodeWithdrawFunctionData({
  assets,
  receiver,
  owner,
}: {
  assets: bigint
  receiver: Address
  owner: Address
}): `0x${string}` {
  return encodeFunctionData({
    abi: CollateralTrackerAbi,
    functionName: 'withdraw',
    args: [assets, receiver, owner],
  })
}
