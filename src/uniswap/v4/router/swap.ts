/**
 * Exact-in and exact-out spot swaps via the Uniswap v4 Universal Router.
 *
 * Swaps directly on the underlying Uniswap v4 pool, bypassing Panoptic (no SFPM,
 * no Panoptic LP fees, no pool collateral required). Native ETH (`address(0)`)
 * is supported via `msg.value` with no Permit2 approval.
 *
 * @module uniswap/v4/router/swap
 */

import { isAddressEqual } from 'viem'

import { getBlockMeta } from '../../../panoptic/v2/clients'
import { PanopticError } from '../../../panoptic/v2/errors'
import type { TxReceipt, TxResult } from '../../../panoptic/v2/types'
import { submitWrite } from '../../../panoptic/v2/writes'
import { universalRouterAbi } from '../abis/universalRouter'
import { getUniswapV4Addresses } from '../addresses'
import { buildV4ExactOutSwapExecuteArgs, buildV4SwapExecuteArgs } from './encodeSwap'
import { quoteSwapExactInViaRouter, quoteSwapExactOutViaRouter } from './quote'
import type { SwapExactInViaRouterParams, SwapExactOutViaRouterParams } from './types'

/** Default swap deadline window (30 minutes) when no deadline is provided. */
const DEFAULT_DEADLINE_SECONDS = 1800n

/**
 * Execute an exact-in spot swap via the Universal Router.
 *
 * @param params - Swap parameters.
 * @returns TxResult with hash + wait().
 *
 * @example
 * ```typescript
 * const result = await swapExactInViaRouter({
 *   client, walletClient, account, poolAddress,
 *   chainId: 1n,
 *   tokenIn: ZERO_ADDRESS,        // native ETH
 *   amountIn: 10n ** 17n,         // 0.1 ETH
 *   slippageBps: 50n,             // 0.5%
 * })
 * await result.wait()
 * ```
 */
export async function swapExactInViaRouter(params: SwapExactInViaRouterParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    chainId,
    tokenIn,
    amountIn,
    slippageBps,
    deadline,
    recipient,
    txOverrides,
    addresses,
  } = params

  if (recipient !== undefined && !isAddressEqual(recipient, account)) {
    // The Universal Router pays the configured router recipient; routing output
    // to an arbitrary recipient requires an extra action not wired in v1.
    throw new PanopticError('Custom recipient is not supported yet; output goes to the sender')
  }

  const resolved = getUniswapV4Addresses(chainId, addresses)

  const quote = await quoteSwapExactInViaRouter({
    client,
    poolAddress,
    chainId,
    tokenIn,
    amountIn,
    slippageBps,
    addresses,
  })

  if (!quote.success) {
    throw quote.error
  }

  const resolvedDeadline =
    deadline ?? (await getBlockMeta({ client })).blockTimestamp + DEFAULT_DEADLINE_SECONDS

  const { args, value } = buildV4SwapExecuteArgs({
    poolKey: quote.data.poolKey,
    zeroForOne: quote.data.zeroForOne,
    amountIn,
    amountOutMinimum: quote.data.amountOutMinimum,
    tokenIn,
    tokenOut: quote.data.tokenOut,
    deadline: resolvedDeadline,
    recipient: account,
  })

  return submitWrite({
    client,
    walletClient,
    account,
    address: resolved.universalRouter,
    abi: universalRouterAbi,
    functionName: 'execute',
    args,
    value,
    txOverrides,
  })
}

/**
 * Execute an exact-in swap via the Universal Router and wait for confirmation.
 */
export async function swapExactInViaRouterAndWait(
  params: SwapExactInViaRouterParams,
): Promise<TxReceipt> {
  const result = await swapExactInViaRouter(params)
  return result.wait()
}

/**
 * Execute an exact-out spot swap via the Universal Router.
 *
 * The caller specifies the exact `amountOut` to receive; the input (pay) amount
 * is quoted and capped at `amountInMaximum`. For native-ETH input the router is
 * funded with `amountInMaximum` and the unused surplus is swept back to the
 * sender.
 *
 * @param params - Swap parameters.
 * @returns TxResult with hash + wait().
 */
export async function swapExactOutViaRouter(
  params: SwapExactOutViaRouterParams,
): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    chainId,
    tokenIn,
    amountOut,
    slippageBps,
    deadline,
    recipient,
    txOverrides,
    addresses,
  } = params

  if (recipient !== undefined && !isAddressEqual(recipient, account)) {
    // The Universal Router pays the configured router recipient; routing output
    // to an arbitrary recipient requires an extra action not wired in v1.
    throw new PanopticError('Custom recipient is not supported yet; output goes to the sender')
  }

  const resolved = getUniswapV4Addresses(chainId, addresses)

  const quote = await quoteSwapExactOutViaRouter({
    client,
    poolAddress,
    chainId,
    tokenIn,
    amountOut,
    slippageBps,
    addresses,
  })

  if (!quote.success) {
    throw quote.error
  }

  const resolvedDeadline =
    deadline ?? (await getBlockMeta({ client })).blockTimestamp + DEFAULT_DEADLINE_SECONDS

  const { args, value } = buildV4ExactOutSwapExecuteArgs({
    poolKey: quote.data.poolKey,
    zeroForOne: quote.data.zeroForOne,
    amountOut,
    amountInMaximum: quote.data.amountInMaximum,
    tokenIn,
    tokenOut: quote.data.tokenOut,
    deadline: resolvedDeadline,
    recipient: account,
  })

  return submitWrite({
    client,
    walletClient,
    account,
    address: resolved.universalRouter,
    abi: universalRouterAbi,
    functionName: 'execute',
    args,
    value,
    txOverrides,
  })
}

/**
 * Execute an exact-out swap via the Universal Router and wait for confirmation.
 */
export async function swapExactOutViaRouterAndWait(
  params: SwapExactOutViaRouterParams,
): Promise<TxReceipt> {
  const result = await swapExactOutViaRouter(params)
  return result.wait()
}
