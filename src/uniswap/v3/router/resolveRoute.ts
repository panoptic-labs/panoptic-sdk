/**
 * Resolve v3 swap routing info from a PanopticPool address.
 * @module uniswap/v3/router/resolveRoute
 */

import type { Address, PublicClient } from 'viem'
import { isAddressEqual } from 'viem'

import { PanopticError } from '../../../panoptic/v2/errors'
import { getPoolMetadata } from '../../../panoptic/v2/reads/pool'
import { InvalidSwapTokenError } from '../../v4/router/errors'

export interface ResolvedV3SwapRoute {
  tokenIn: Address
  tokenOut: Address
  fee: bigint
  zeroForOne: boolean
}

export interface ResolveV3SwapRouteParams {
  client: PublicClient
  poolAddress: Address
  tokenIn: Address
}

export async function resolveV3SwapRoute(
  params: ResolveV3SwapRouteParams,
): Promise<ResolvedV3SwapRoute> {
  const { client, poolAddress, tokenIn } = params

  const meta = await getPoolMetadata({ client, poolAddress })
  if (meta.isV4) {
    throw new PanopticError('resolveV3SwapRoute called on a v4 pool')
  }

  const isToken0 = isAddressEqual(tokenIn, meta.token0Asset)
  const isToken1 = isAddressEqual(tokenIn, meta.token1Asset)
  if (!isToken0 && !isToken1) {
    throw new InvalidSwapTokenError(tokenIn, meta.token0Asset, meta.token1Asset)
  }

  const zeroForOne = isToken0
  return {
    tokenIn,
    tokenOut: zeroForOne ? meta.token1Asset : meta.token0Asset,
    fee: meta.fee,
    zeroForOne,
  }
}
