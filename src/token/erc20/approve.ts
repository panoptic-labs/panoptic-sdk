import type { Address } from 'viem'
import { encodeFunctionData } from 'viem'

import { Erc20Abi } from '../../abis/erc20ABI'

export function encodeApproveFunctionData({
  spender,
  amount,
}: {
  spender: Address
  amount: bigint
}): `0x${string}` {
  return encodeFunctionData({
    abi: Erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })
}
