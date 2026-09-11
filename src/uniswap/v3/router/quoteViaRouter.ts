/**
 * Quote v3 swaps with the same `SimulationResult` shape as the v4 path.
 * @module uniswap/v3/router/quoteViaRouter
 */

import type { Address, PublicClient } from 'viem'

import { getBlockMeta } from '../../../panoptic/v2/clients/blockMeta'
import { PanopticError } from '../../../panoptic/v2/errors'
import type { SimulationResult } from '../../../panoptic/v2/types'
import type { SwapExactInQuote, SwapExactOutQuote } from '../../v4/router/types'
import type { UniswapV3Addresses } from '../addresses'
import { quoteV3ExactIn, quoteV3ExactOut } from './quote'
import { resolveV3SwapRoute } from './resolveRoute'

const FALLBACK_META = {
  blockNumber: 0n,
  blockTimestamp: 0n,
  blockHash: '0x0' as `0x${string}`,
}

export interface QuoteSwapExactInViaV3RouterParams {
  client: PublicClient
  poolAddress: Address
  chainId: bigint
  tokenIn: Address
  amountIn: bigint
  slippageBps: bigint
  blockNumber?: bigint
  addresses?: Partial<UniswapV3Addresses>
}

export async function quoteSwapExactInViaV3Router(
  params: QuoteSwapExactInViaV3RouterParams,
): Promise<SimulationResult<SwapExactInQuote>> {
  const { client, poolAddress, chainId, tokenIn, amountIn, slippageBps, blockNumber, addresses } =
    params

  try {
    const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
    const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })
    void metaPromise.catch(() => undefined)

    const route = await resolveV3SwapRoute({ client, poolAddress, tokenIn })

    const quote = await quoteV3ExactIn({
      client,
      chainId,
      tokenIn: route.tokenIn,
      tokenOut: route.tokenOut,
      fee: route.fee,
      amountIn,
      slippageBps,
      blockNumber: targetBlockNumber,
      addresses,
    })

    if (!quote) {
      throw new PanopticError('v3 quote returned no result (pool may have no liquidity)')
    }

    const _meta = await metaPromise

    return {
      success: true,
      data: {
        amountOut: quote.amountOut,
        amountOutMinimum: quote.amountOutMinimum,
        zeroForOne: route.zeroForOne,
        tokenOut: route.tokenOut,
        gasEstimate: quote.gasEstimate,
      },
      gasEstimate: quote.gasEstimate,
      _meta,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(
              error instanceof Error ? error.message : 'Quote failed',
              error instanceof Error ? error : undefined,
            ),
      _meta: FALLBACK_META,
    }
  }
}

export interface QuoteSwapExactOutViaV3RouterParams {
  client: PublicClient
  poolAddress: Address
  chainId: bigint
  tokenIn: Address
  amountOut: bigint
  slippageBps: bigint
  blockNumber?: bigint
  addresses?: Partial<UniswapV3Addresses>
}

export async function quoteSwapExactOutViaV3Router(
  params: QuoteSwapExactOutViaV3RouterParams,
): Promise<SimulationResult<SwapExactOutQuote>> {
  const { client, poolAddress, chainId, tokenIn, amountOut, slippageBps, blockNumber, addresses } =
    params

  try {
    const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
    const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })
    void metaPromise.catch(() => undefined)

    const route = await resolveV3SwapRoute({ client, poolAddress, tokenIn })

    const quote = await quoteV3ExactOut({
      client,
      chainId,
      tokenIn: route.tokenIn,
      tokenOut: route.tokenOut,
      fee: route.fee,
      amountOut,
      slippageBps,
      blockNumber: targetBlockNumber,
      addresses,
    })

    if (!quote) {
      throw new PanopticError('v3 quote returned no result (pool may have no liquidity)')
    }

    const _meta = await metaPromise

    return {
      success: true,
      data: {
        amountIn: quote.amountIn,
        amountInMaximum: quote.amountInMaximum,
        zeroForOne: route.zeroForOne,
        tokenOut: route.tokenOut,
        gasEstimate: quote.gasEstimate,
      },
      gasEstimate: quote.gasEstimate,
      _meta,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(
              error instanceof Error ? error.message : 'Quote failed',
              error instanceof Error ? error : undefined,
            ),
      _meta: FALLBACK_META,
    }
  }
}
