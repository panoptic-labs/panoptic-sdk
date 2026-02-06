import type { Address, Client, Hex } from 'viem'
import { encodeAbiParameters, parseAbi } from 'viem'
import { readContract } from 'viem/actions'

import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'
import type { ProductionWETHPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/ProductionWETHPLPVaultPoolInfos'

// Derive PoolInfo type from the existing const
export type PoolInfo = (typeof ProductionWETHPLPVaultPoolInfos.poolInfos)[number]

export type BuildManagerInputParams = {
  viemClient: Client
  poolInfos: readonly PoolInfo[]
  tokenIds: bigint[][]
  underlyingToken: Address
}

/**
 * Builds the encoded managerInput for HypoVault operations like fulfillDeposits and fulfillWithdrawals.
 *
 * Supports the full input space of computeNAV by:
 * - Fetching TWAP ticks from each pool in poolInfos
 * - Setting token prices based on whether each token matches the underlyingToken address
 *
 * @param params.viemClient - Viem client with account for RPC calls
 * @param params.poolInfos - Array of pool info objects containing pool and token configuration
 * @param params.tokenIds - 2D array of tokenIds for each pool
 * @param params.underlyingToken - Address of the vault's underlying token
 * @returns Encoded managerInput as Hex
 */
export async function buildManagerInput({
  viemClient,
  poolInfos,
  tokenIds,
  underlyingToken,
}: BuildManagerInputParams): Promise<Hex> {
  // Fetch TWAP ticks for all pools in parallel
  const twapTicks = await Promise.all(
    poolInfos.map((poolInfo) =>
      readContract(viemClient, {
        address: poolInfo.pool as Address,
        abi: parseAbi(['function getTWAP() view returns (int24)']),
        functionName: 'getTWAP',
      }),
    ),
  )

  // Create ManagerPrices array, 1 entry per pool
  // ManagerPrices struct: { poolPrice: int24, token0Price: int24, token1Price: int24 }
  // - poolPrice: always the pool's TWAP tick
  // - token0Price: 0 if token0 == underlyingToken (no conversion needed), otherwise TWAP tick
  // - token1Price: 0 if token1 == underlyingToken (no conversion needed), otherwise TWAP tick
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

  // Encode managerInput: (ManagerPrices[], PoolInfo[], TokenId[][])
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
