import type { Address, Client, Hex } from 'viem'
import { encodeAbiParameters, parseAbi } from 'viem'
import { readContract } from 'viem/actions'

import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'

export type PoolInfo = {
  pool: Address
  token0: Address
  token1: Address
  maxPriceDeviation: number
}

export type BuildManagerInputParams = {
  viemClient: Client
  poolInfos: readonly PoolInfo[]
  tokenIds: bigint[][]
  underlyingToken: Address
  wethAddress?: Address
  erc4626Vaults?: readonly Address[]
}

const NATIVE_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const NATIVE_ETH_ALIAS_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export function isUnderlyingEquivalentToken({
  token,
  underlyingToken,
  wethAddress,
}: {
  token: Address
  underlyingToken: Address
  wethAddress?: Address
}): boolean {
  const tokenLower = token.toLowerCase()
  const underlyingLower = underlyingToken.toLowerCase()
  if (tokenLower === underlyingLower) {
    return true
  }

  if (wethAddress === undefined) {
    return false
  }

  const wethLower = wethAddress.toLowerCase()
  const tokenIsNativeAlias =
    tokenLower === NATIVE_ZERO_ADDRESS || tokenLower === NATIVE_ETH_ALIAS_ADDRESS
  return tokenIsNativeAlias && underlyingLower === wethLower
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
 * @param params.erc4626Vaults - Optional list of ERC4626 vaults considered by accountant NAV
 * @returns Encoded managerInput as Hex
 */
export async function buildManagerInput({
  viemClient,
  poolInfos,
  tokenIds,
  underlyingToken,
  wethAddress,
  erc4626Vaults = [],
}: BuildManagerInputParams): Promise<Hex> {
  if (tokenIds.length !== poolInfos.length) {
    throw new Error(
      `Invalid managerInput tokenIds length: expected ${poolInfos.length}, received ${tokenIds.length}`,
    )
  }

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

  // Encode managerInput: (ManagerPrices[], PoolInfo[], TokenId[][], IERC4626[])
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
