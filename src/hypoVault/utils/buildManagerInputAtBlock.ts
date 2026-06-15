import type { Address, Client, Hex } from 'viem'
import { encodeAbiParameters, parseAbi } from 'viem'
import { readContract } from 'viem/actions'

import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'
import { type PoolInfo, isUnderlyingEquivalentToken } from './buildManagerInput'

export type BuildManagerInputAtBlockParams = {
  viemClient: Client
  poolInfos: readonly PoolInfo[]
  tokenIds: bigint[][]
  underlyingToken: Address
  wethAddress?: Address
  blockNumber: bigint
  erc4626Vaults?: readonly Address[]
}

/**
 * Builds encoded managerInput for HypoVault accountant reads at a specific block.
 */
export async function buildManagerInputAtBlock({
  viemClient,
  poolInfos,
  tokenIds,
  underlyingToken,
  wethAddress,
  blockNumber,
  erc4626Vaults = [],
}: BuildManagerInputAtBlockParams): Promise<Hex> {
  if (tokenIds.length !== poolInfos.length) {
    throw new Error(
      `Invalid managerInput tokenIds length: expected ${poolInfos.length}, received ${tokenIds.length}`,
    )
  }

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
    const token0IsUnderlying = isUnderlyingEquivalentToken({
      token: poolInfo.token0,
      underlyingToken,
      wethAddress,
    })
    const token1IsUnderlying = isUnderlyingEquivalentToken({
      token: poolInfo.token1,
      underlyingToken,
      wethAddress,
    })

    return {
      poolPrice: twapTick,
      token0Price: token0IsUnderlying ? 0 : twapTick,
      token1Price: token1IsUnderlying ? 0 : twapTick,
    }
  })
  if (managerPrices.length !== poolInfos.length) {
    throw new Error(
      `Invalid managerInput managerPrices length: expected ${poolInfos.length}, received ${managerPrices.length}`,
    )
  }

  return encodeAbiParameters(PanopticVaultAccountantManagerInputAbi, [
    managerPrices,
    poolInfos.map((poolInfo) => ({
      pool: poolInfo.pool as Address,
      token0: poolInfo.token0 as Address,
      token1: poolInfo.token1 as Address,
      maxPriceDeviation: poolInfo.maxPriceDeviation,
    })),
    tokenIds,
    erc4626Vaults,
  ])
}
