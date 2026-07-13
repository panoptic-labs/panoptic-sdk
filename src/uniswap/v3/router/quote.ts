/**
 * Quote an exact-in single-hop swap against a Uniswap v3 pool via QuoterV2.
 * @module uniswap/v3/router/quote
 */

import type { Address, PublicClient } from 'viem'
import { BaseError, ContractFunctionRevertedError } from 'viem'

import { PanopticError } from '../../../panoptic/v2/errors'
import { quoterV2Abi } from '../abis/quoterV2'
import { type UniswapV3Addresses, getUniswapV3Addresses } from '../addresses'

const BPS_DENOMINATOR = 10_000n
const UINT128_MAX = (1n << 128n) - 1n

export interface QuoteV3ExactInParams {
  client: PublicClient
  chainId: bigint
  tokenIn: Address
  tokenOut: Address
  fee: bigint
  amountIn: bigint
  /** Slippage tolerance in bps, used to compute `amountOutMinimum`. */
  slippageBps: bigint
  blockNumber?: bigint
  addresses?: Partial<UniswapV3Addresses>
}

export interface V3ExactInQuote {
  amountOut: bigint
  amountOutMinimum: bigint
  gasEstimate: bigint
}

/**
 * Quote an exact-in v3 swap. Returns `null` when the quote reverts (e.g. the
 * pool does not exist / has no liquidity) so callers can skip that pool when
 * ranking venues, rather than aborting the whole cycle.
 */
export async function quoteV3ExactIn(params: QuoteV3ExactInParams): Promise<V3ExactInQuote | null> {
  const { client, chainId, tokenIn, tokenOut, fee, amountIn, slippageBps, blockNumber } = params
  if (amountIn < 0n || amountIn > UINT128_MAX) {
    throw new PanopticError(`amountIn ${amountIn} exceeds uint128 maximum`)
  }
  if (slippageBps < 0n || slippageBps > BPS_DENOMINATOR) {
    throw new PanopticError(`invalid slippageBps ${slippageBps}, must be 0..10000`)
  }

  const { quoterV2 } = getUniswapV3Addresses(chainId, params.addresses)

  try {
    const { result } = await client.simulateContract({
      address: quoterV2,
      abi: quoterV2Abi,
      functionName: 'quoteExactInputSingle',
      blockNumber,
      args: [{ tokenIn, tokenOut, amountIn, fee: Number(fee), sqrtPriceLimitX96: 0n }],
    })
    const [amountOut, , , gasEstimate] = result
    const amountOutMinimum = (amountOut * (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR
    return { amountOut, amountOutMinimum, gasEstimate }
  } catch (err) {
    if (isRevert(err)) return null
    // Transport/RPC/timeout errors are NOT "no liquidity" — rethrow so routing
    // doesn't silently treat an unreachable node as an empty pool.
    throw err
  }
}

/** True only for genuine contract reverts (missing pool / no liquidity). */
function isRevert(err: unknown): boolean {
  return (
    err instanceof BaseError &&
    err.walk((e) => e instanceof ContractFunctionRevertedError) instanceof
      ContractFunctionRevertedError
  )
}
