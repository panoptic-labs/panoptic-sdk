/**
 * Exact-in and exact-out spot swaps via the Uniswap v3 path on the Universal Router.
 * @module uniswap/v3/router/swap
 */

import type { Address, PublicClient, WalletClient } from 'viem'
import { isAddressEqual } from 'viem'

import { getBlockMeta } from '../../../panoptic/v2/clients/blockMeta'
import { PanopticError } from '../../../panoptic/v2/errors'
import type { TxOverrides, TxResult } from '../../../panoptic/v2/types'
import { submitWrite } from '../../../panoptic/v2/writes/utils'
import { universalRouterAbi } from '../../v4/abis/universalRouter'
import { type UniswapV4Addresses, getUniswapV4Addresses } from '../../v4/addresses'
import type { UniswapV3Addresses } from '../addresses'
import { buildV3ExactOutSwapExecuteArgs, buildV3SwapExecuteArgs } from './encodeSwap'
import { quoteV3ExactIn, quoteV3ExactOut } from './quote'
import { resolveV3SwapRoute } from './resolveRoute'

const DEFAULT_DEADLINE_SECONDS = 1800n

export interface SwapExactInViaV3RouterParams {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  poolAddress: Address
  chainId: bigint
  tokenIn: Address
  amountIn: bigint
  slippageBps: bigint
  deadline?: bigint
  recipient?: Address
  txOverrides?: TxOverrides
  addresses?: Partial<UniswapV3Addresses & UniswapV4Addresses>
}

export async function swapExactInViaV3Router(
  params: SwapExactInViaV3RouterParams,
): Promise<TxResult> {
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
    throw new PanopticError('Custom recipient is not supported yet; output goes to the sender')
  }

  const resolved = getUniswapV4Addresses(chainId, addresses)
  const route = await resolveV3SwapRoute({ client, poolAddress, tokenIn })

  const quote = await quoteV3ExactIn({
    client,
    chainId,
    tokenIn: route.tokenIn,
    tokenOut: route.tokenOut,
    fee: route.fee,
    amountIn,
    slippageBps,
    addresses,
  })

  if (!quote) {
    throw new PanopticError('v3 quote failed (pool may have no liquidity)')
  }

  const resolvedDeadline =
    deadline ?? (await getBlockMeta({ client })).blockTimestamp + DEFAULT_DEADLINE_SECONDS

  const { args, value } = buildV3SwapExecuteArgs({
    tokenIn: route.tokenIn,
    tokenOut: route.tokenOut,
    fee: route.fee,
    amountIn,
    amountOutMinimum: quote.amountOutMinimum,
    deadline: resolvedDeadline,
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

export interface SwapExactOutViaV3RouterParams {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  poolAddress: Address
  chainId: bigint
  tokenIn: Address
  amountOut: bigint
  slippageBps: bigint
  deadline?: bigint
  recipient?: Address
  txOverrides?: TxOverrides
  addresses?: Partial<UniswapV3Addresses & UniswapV4Addresses>
}

export async function swapExactOutViaV3Router(
  params: SwapExactOutViaV3RouterParams,
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
    throw new PanopticError('Custom recipient is not supported yet; output goes to the sender')
  }

  const resolved = getUniswapV4Addresses(chainId, addresses)
  const route = await resolveV3SwapRoute({ client, poolAddress, tokenIn })

  const quote = await quoteV3ExactOut({
    client,
    chainId,
    tokenIn: route.tokenIn,
    tokenOut: route.tokenOut,
    fee: route.fee,
    amountOut,
    slippageBps,
    addresses,
  })

  if (!quote) {
    throw new PanopticError('v3 quote failed (pool may have no liquidity)')
  }

  const resolvedDeadline =
    deadline ?? (await getBlockMeta({ client })).blockTimestamp + DEFAULT_DEADLINE_SECONDS

  const { args, value } = buildV3ExactOutSwapExecuteArgs({
    tokenIn: route.tokenIn,
    tokenOut: route.tokenOut,
    fee: route.fee,
    amountOut,
    amountInMaximum: quote.amountInMaximum,
    deadline: resolvedDeadline,
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
