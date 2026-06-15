/**
 * Quote exact-in and exact-out swaps via the Uniswap v4 V4Quoter.
 * @module uniswap/v4/router/quote
 */

import { zeroAddress } from 'viem'

import { getBlockMeta } from '../../../panoptic/v2/clients'
import { PanopticError } from '../../../panoptic/v2/errors'
import type { SimulationResult } from '../../../panoptic/v2/types'
import { v4QuoterAbi } from '../abis/v4Quoter'
import { getUniswapV4Addresses } from '../addresses'
import { QuoterUnavailableError } from './errors'
import { resolveSwapRoute } from './resolvePoolKey'
import type {
  QuoteSwapExactInViaRouterParams,
  QuoteSwapExactOutViaRouterParams,
  SwapExactInQuote,
  SwapExactOutQuote,
} from './types'

const BPS_DENOMINATOR = 10_000n
const UINT128_MAX = (1n << 128n) - 1n

/** Reject out-of-range slippage so the min/max amount math can't underflow/overflow. */
function assertSlippageBps(slippageBps: bigint): void {
  if (slippageBps < 0n || slippageBps > BPS_DENOMINATOR) {
    throw new PanopticError(`invalid slippageBps ${slippageBps}, must be 0..10000`)
  }
}

const FALLBACK_META = {
  blockNumber: 0n,
  blockTimestamp: 0n,
  blockHash: '0x0' as `0x${string}`,
}

/**
 * Quote an exact-in spot swap against the underlying Uniswap v4 pool.
 *
 * Uses the V4Quoter `quoteExactInputSingle` via `eth_call` (the quoter is
 * state-mutating / revert-based, so it must be simulated, not read). Returns a
 * `SimulationResult` so failures carry a structured error rather than throwing.
 */
export async function quoteSwapExactInViaRouter(
  params: QuoteSwapExactInViaRouterParams,
): Promise<SimulationResult<SwapExactInQuote>> {
  const { client, poolAddress, chainId, tokenIn, amountIn, slippageBps, blockNumber, addresses } =
    params

  try {
    if (amountIn < 0n || amountIn > UINT128_MAX) {
      throw new PanopticError(`amountIn ${amountIn} exceeds uint128 maximum`)
    }
    assertSlippageBps(slippageBps)

    const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
    const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

    const { v4Quoter } = getUniswapV4Addresses(chainId, addresses)
    if (v4Quoter === zeroAddress) {
      throw new QuoterUnavailableError(chainId)
    }

    const route = await resolveSwapRoute({
      client,
      poolAddress,
      chainId,
      tokenIn,
      blockNumber: targetBlockNumber,
    })

    const { result } = await client.simulateContract({
      address: v4Quoter,
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      blockNumber: targetBlockNumber,
      args: [
        {
          poolKey: {
            currency0: route.poolKey.currency0,
            currency1: route.poolKey.currency1,
            fee: Number(route.poolKey.fee),
            tickSpacing: Number(route.poolKey.tickSpacing),
            hooks: route.poolKey.hooks,
          },
          zeroForOne: route.zeroForOne,
          exactAmount: amountIn,
          hookData: '0x',
        },
      ],
    })

    const [amountOut, gasEstimate] = result
    const amountOutMinimum = (amountOut * (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR

    const _meta = await metaPromise

    return {
      success: true,
      data: {
        amountOut,
        amountOutMinimum,
        zeroForOne: route.zeroForOne,
        tokenOut: route.tokenOut,
        poolKey: route.poolKey,
        gasEstimate,
      },
      gasEstimate,
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

/**
 * Quote an exact-out spot swap against the underlying Uniswap v4 pool.
 *
 * Uses the V4Quoter `quoteExactOutputSingle` via `eth_call` (the quoter is
 * state-mutating / revert-based, so it must be simulated, not read). Returns a
 * `SimulationResult` so failures carry a structured error rather than throwing.
 */
export async function quoteSwapExactOutViaRouter(
  params: QuoteSwapExactOutViaRouterParams,
): Promise<SimulationResult<SwapExactOutQuote>> {
  const { client, poolAddress, chainId, tokenIn, amountOut, slippageBps, blockNumber, addresses } =
    params

  try {
    if (amountOut < 0n || amountOut > UINT128_MAX) {
      throw new PanopticError(`amountOut ${amountOut} exceeds uint128 maximum`)
    }
    assertSlippageBps(slippageBps)

    const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
    const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

    const { v4Quoter } = getUniswapV4Addresses(chainId, addresses)
    if (v4Quoter === zeroAddress) {
      throw new QuoterUnavailableError(chainId)
    }

    const route = await resolveSwapRoute({
      client,
      poolAddress,
      chainId,
      tokenIn,
      blockNumber: targetBlockNumber,
    })

    const { result } = await client.simulateContract({
      address: v4Quoter,
      abi: v4QuoterAbi,
      functionName: 'quoteExactOutputSingle',
      blockNumber: targetBlockNumber,
      args: [
        {
          poolKey: {
            currency0: route.poolKey.currency0,
            currency1: route.poolKey.currency1,
            fee: Number(route.poolKey.fee),
            tickSpacing: Number(route.poolKey.tickSpacing),
            hooks: route.poolKey.hooks,
          },
          zeroForOne: route.zeroForOne,
          exactAmount: amountOut,
          hookData: '0x',
        },
      ],
    })

    const [amountIn, gasEstimate] = result
    // Ceiling division: never round the input cap down (would tighten the buffer).
    const amountInMaximum =
      (amountIn * (BPS_DENOMINATOR + slippageBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR

    const _meta = await metaPromise

    return {
      success: true,
      data: {
        amountIn,
        amountInMaximum,
        zeroForOne: route.zeroForOne,
        tokenOut: route.tokenOut,
        poolKey: route.poolKey,
        gasEstimate,
      },
      gasEstimate,
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
