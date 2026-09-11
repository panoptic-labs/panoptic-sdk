/**
 * Quote exact-in and exact-out single-hop swaps against a Uniswap v3 pool via
 * QuoterV2.
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
  assertSlippageBps(slippageBps)

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
    throw err
  }
}

export interface QuoteV3ExactOutParams {
  client: PublicClient
  chainId: bigint
  tokenIn: Address
  tokenOut: Address
  fee: bigint
  amountOut: bigint
  slippageBps: bigint
  blockNumber?: bigint
  addresses?: Partial<UniswapV3Addresses>
}

export interface V3ExactOutQuote {
  amountIn: bigint
  amountInMaximum: bigint
  gasEstimate: bigint
}

/**
 * Quote an exact-out v3 swap. Returns `null` on revert (no pool / no liquidity).
 */
export async function quoteV3ExactOut(
  params: QuoteV3ExactOutParams,
): Promise<V3ExactOutQuote | null> {
  const { client, chainId, tokenIn, tokenOut, fee, amountOut, slippageBps, blockNumber } = params
  if (amountOut < 0n || amountOut > UINT128_MAX) {
    throw new PanopticError(`amountOut ${amountOut} exceeds uint128 maximum`)
  }
  assertSlippageBps(slippageBps)

  const { quoterV2 } = getUniswapV3Addresses(chainId, params.addresses)

  try {
    const { result } = await client.simulateContract({
      address: quoterV2,
      abi: quoterV2Abi,
      functionName: 'quoteExactOutputSingle',
      blockNumber,
      args: [{ tokenIn, tokenOut, amount: amountOut, fee: Number(fee), sqrtPriceLimitX96: 0n }],
    })
    const [amountIn, , , gasEstimate] = result
    const amountInMaximum =
      (amountIn * (BPS_DENOMINATOR + slippageBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
    return { amountIn, amountInMaximum, gasEstimate }
  } catch (err) {
    if (isRevert(err)) return null
    throw err
  }
}

function assertSlippageBps(slippageBps: bigint): void {
  if (slippageBps < 0n || slippageBps > BPS_DENOMINATOR) {
    throw new PanopticError(`invalid slippageBps ${slippageBps}, must be 0..10000`)
  }
}

function isRevert(err: unknown): boolean {
  return (
    err instanceof BaseError &&
    err.walk((e) => e instanceof ContractFunctionRevertedError) instanceof
      ContractFunctionRevertedError
  )
}
