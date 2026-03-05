import type { Address, Client, Hex } from 'viem'
import { encodeAbiParameters, parseAbi } from 'viem'
import { readContract } from 'viem/actions'

import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'
import type { PoolInfo } from './buildManagerInput'

export type BuildManagerInputAtBlockParams = {
  viemClient: Client
  poolInfos: readonly PoolInfo[]
  tokenIds: bigint[][]
  underlyingToken: Address
  blockNumber: bigint
}

/**
 * Builds encoded managerInput for HypoVault accountant reads at a specific block.
 */
export async function buildManagerInputAtBlock({
  viemClient,
  poolInfos,
  tokenIds,
  underlyingToken,
  blockNumber,
}: BuildManagerInputAtBlockParams): Promise<Hex> {
  const twapTicks = await Promise.all(
    poolInfos.map((poolInfo) =>
      readContract(viemClient, {
        address: poolInfo.pool as Address,
        abi: parseAbi(['function getTWAP() view returns (int24)']),
        functionName: 'getTWAP',
        blockNumber,
      }),
    ),
  )

  const managerPrices = poolInfos.map((poolInfo, i) => {
    const twapTick = Number(twapTicks[i])
    const underlyingLower = underlyingToken.toLowerCase()
    const token0IsUnderlying = poolInfo.token0.toLowerCase() === underlyingLower
    const token1IsUnderlying = poolInfo.token1.toLowerCase() === underlyingLower

    return {
      poolPrice: twapTick,
      token0Price: token0IsUnderlying ? 0 : twapTick,
      token1Price: token1IsUnderlying ? 0 : twapTick,
    }
  })

  return encodeAbiParameters(PanopticVaultAccountantManagerInputAbi, [
    managerPrices,
    poolInfos.map((poolInfo) => ({
      pool: poolInfo.pool as Address,
      token0: poolInfo.token0 as Address,
      token1: poolInfo.token1 as Address,
      maxPriceDeviation: poolInfo.maxPriceDeviation,
    })),
    tokenIds,
  ])
}
