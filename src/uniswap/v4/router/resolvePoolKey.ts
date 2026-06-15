/**
 * Resolve the Uniswap v4 PoolKey + swap direction from a PanopticPool address.
 * @module uniswap/v4/router/resolvePoolKey
 */

import type { Address, PublicClient } from 'viem'
import { isAddressEqual } from 'viem'

import { getPool } from '../../../panoptic/v2/reads/pool'
import type { PoolKey } from '../../../panoptic/v2/types'
import { InvalidSwapTokenError } from './errors'

/**
 * Resolved swap routing info for a given `tokenIn`.
 */
export interface ResolvedSwapRoute {
  /** Underlying v4 PoolKey. */
  poolKey: PoolKey
  /** Whether the swap goes currency0 → currency1. */
  zeroForOne: boolean
  /** Output token address. */
  tokenOut: Address
  /** Decimals of the output token. */
  tokenOutDecimals: bigint
  /** Symbol of the output token. */
  tokenOutSymbol: string
}

/**
 * Parameters for {@link resolveSwapRoute}.
 */
export interface ResolveSwapRouteParams {
  client: PublicClient
  poolAddress: Address
  chainId: bigint
  tokenIn: Address
  blockNumber?: bigint
}

/**
 * Resolve the PoolKey, swap direction, and output token metadata for a swap.
 *
 * @throws {InvalidSwapTokenError} when `tokenIn` is not part of the pool.
 */
export async function resolveSwapRoute(params: ResolveSwapRouteParams): Promise<ResolvedSwapRoute> {
  const { client, poolAddress, chainId, tokenIn, blockNumber } = params

  const pool = await getPool({ client, poolAddress, chainId, blockNumber })
  const { poolKey } = pool

  const isCurrency0 = isAddressEqual(tokenIn, poolKey.currency0)
  const isCurrency1 = isAddressEqual(tokenIn, poolKey.currency1)
  if (!isCurrency0 && !isCurrency1) {
    throw new InvalidSwapTokenError(tokenIn, poolKey.currency0, poolKey.currency1)
  }

  const zeroForOne = isCurrency0
  const tokenOut = zeroForOne ? poolKey.currency1 : poolKey.currency0
  const outTracker = zeroForOne ? pool.collateralTracker1 : pool.collateralTracker0

  return {
    poolKey,
    zeroForOne,
    tokenOut,
    tokenOutDecimals: outTracker.decimals,
    tokenOutSymbol: outTracker.symbol,
  }
}
