import type { Address } from 'viem'
import { useReadContract } from 'wagmi'

import { Erc20Abi } from '../../abis/erc20ABI'

export function useErc20Balance({
  chainId,
  token,
  account,
  enabled = true,
  staleTime,
}: {
  chainId: number
  token: Address
  account: Address
  enabled?: boolean
  staleTime?: number
}) {
  return useReadContract({
    chainId,
    address: token,
    abi: Erc20Abi,
    functionName: 'balanceOf',
    args: [account],
    query: {
      enabled,
      staleTime,
      refetchOnWindowFocus: false,
    },
  })
}
