/**
 * Quote an exact-in single-hop v4 swap for an EXPLICIT PoolKey (as opposed to
 * `quoteSwapExactInViaRouter`, which resolves the pool from a PanopticPool
 * address). Used to rank an arbitrary whitelist of hedge pools.
 * @module uniswap/v4/router/quoteByPoolKey
 */

import type { PublicClient } from 'viem'
import { BaseError, ContractFunctionRevertedError } from 'viem'

import { PanopticError } from '../../../panoptic/v2/errors'
import type { PoolKey } from '../../../panoptic/v2/types'
import { v4QuoterAbi } from '../abis/v4Quoter'
import { type UniswapV4Addresses, getUniswapV4Addresses } from '../addresses'

const BPS_DENOMINATOR = 10_000n
const UINT128_MAX = (1n << 128n) - 1n

export interface QuoteV4ExactInByPoolKeyParams {
  client: PublicClient
  chainId: bigint
  poolKey: PoolKey
  zeroForOne: boolean
  amountIn: bigint
  slippageBps: bigint
  blockNumber?: bigint
  addresses?: Partial<UniswapV4Addresses>
}

export interface V4ExactInQuote {
  amountOut: bigint
  amountOutMinimum: bigint
  gasEstimate: bigint
}

/**
 * Quote an exact-in v4 swap for a specific PoolKey. Returns `null` when the
 * quote reverts (pool missing / no liquidity) so callers can skip that pool when
 * ranking venues rather than aborting the cycle.
 */
export async function quoteV4ExactInByPoolKey(
  params: QuoteV4ExactInByPoolKeyParams,
): Promise<V4ExactInQuote | null> {
  const { client, chainId, poolKey, zeroForOne, amountIn, slippageBps, blockNumber } = params
  if (amountIn < 0n || amountIn > UINT128_MAX) {
    throw new PanopticError(`amountIn ${amountIn} exceeds uint128 maximum`)
  }
  if (slippageBps < 0n || slippageBps > BPS_DENOMINATOR) {
    throw new PanopticError(`invalid slippageBps ${slippageBps}, must be 0..10000`)
  }

  const { v4Quoter } = getUniswapV4Addresses(chainId, params.addresses)

  try {
    const { result } = await client.simulateContract({
      address: v4Quoter,
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      blockNumber,
      args: [
        {
          poolKey: {
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: Number(poolKey.fee),
            tickSpacing: Number(poolKey.tickSpacing),
            hooks: poolKey.hooks,
          },
          zeroForOne,
          exactAmount: amountIn,
          hookData: '0x',
        },
      ],
    })
    const [amountOut, gasEstimate] = result
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
