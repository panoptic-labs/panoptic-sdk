/**
 * Permit2 approval helpers for the Universal Router ERC20 input side.
 *
 * Two-step on-chain flow (only when `tokenIn` is an ERC20):
 * 1. ERC20 `approve(Permit2, amount)` — lets Permit2 pull the token.
 * 2. `Permit2.approve(token, universalRouter, amount, expiration)` — lets the
 *    router spend via Permit2.
 *
 * Native ETH skips both steps.
 *
 * @module uniswap/v4/router/permit2
 */

import { erc20Abi, maxUint256 } from 'viem'

import { getBlockMeta } from '../../../panoptic/v2/clients'
import type { TxReceipt, TxResult } from '../../../panoptic/v2/types'
import { submitWrite } from '../../../panoptic/v2/writes'
import { permit2Abi } from '../abis/permit2'
import { getUniswapV4Addresses } from '../addresses'
import type {
  ApproveErc20ForPermit2Params,
  ApproveRouterViaPermit2Params,
  CheckRouterApprovalParams,
  RouterApprovalStatus,
} from './types'

/** uint160 max — the largest Permit2 allowance amount. */
const UINT160_MAX = (1n << 160n) - 1n
/** Default Permit2 allowance expiration window (30 days). */
const DEFAULT_EXPIRATION_SECONDS = 2_592_000n
/** uint48 max — the largest Permit2 expiration. */
const UINT48_MAX = (1n << 48n) - 1n

/**
 * Check whether the ERC20 → Permit2 → Universal Router allowance chain is
 * sufficient for an exact-in swap of `amount`.
 */
export async function checkRouterApproval(
  params: CheckRouterApprovalParams,
): Promise<RouterApprovalStatus> {
  const { client, chainId, tokenIn, owner, amount, addresses } = params
  const { permit2, universalRouter } = getUniswapV4Addresses(chainId, addresses)

  const [erc20Allowance, permit2Allowance, blockMeta] = await Promise.all([
    client.readContract({
      address: tokenIn,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, permit2],
    }),
    client.readContract({
      address: permit2,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [owner, tokenIn, universalRouter],
    }),
    getBlockMeta({ client }),
  ])

  const [permit2Amount, permit2Expiration] = permit2Allowance

  const needsErc20Approval = erc20Allowance < amount
  const needsPermit2Approval =
    permit2Amount < amount || BigInt(permit2Expiration) <= blockMeta.blockTimestamp

  return {
    needsErc20Approval,
    needsPermit2Approval,
    erc20Allowance,
    permit2Amount,
    permit2Expiration: BigInt(permit2Expiration),
  }
}

/**
 * Step 1: approve the ERC20 token to Permit2 (defaults to unlimited).
 */
export async function approveErc20ForPermit2(
  params: ApproveErc20ForPermit2Params,
): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    chainId,
    tokenIn,
    amount = maxUint256,
    txOverrides,
    addresses,
  } = params
  const { permit2 } = getUniswapV4Addresses(chainId, addresses)

  return submitWrite({
    client,
    walletClient,
    account,
    address: tokenIn,
    abi: erc20Abi,
    functionName: 'approve',
    args: [permit2, amount],
    txOverrides,
  })
}

/**
 * Step 1 (and wait): approve the ERC20 token to Permit2.
 */
export async function approveErc20ForPermit2AndWait(
  params: ApproveErc20ForPermit2Params,
): Promise<TxReceipt> {
  const result = await approveErc20ForPermit2(params)
  return result.wait()
}

/**
 * Step 2: approve the Universal Router as a Permit2 spender for the token.
 */
export async function approveRouterViaPermit2(
  params: ApproveRouterViaPermit2Params,
): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    chainId,
    tokenIn,
    amount = UINT160_MAX,
    expiration,
    txOverrides,
    addresses,
  } = params
  const { permit2, universalRouter } = getUniswapV4Addresses(chainId, addresses)

  const resolvedExpiration =
    expiration ?? (await getBlockMeta({ client })).blockTimestamp + DEFAULT_EXPIRATION_SECONDS
  const cappedExpiration = resolvedExpiration > UINT48_MAX ? UINT48_MAX : resolvedExpiration

  return submitWrite({
    client,
    walletClient,
    account,
    address: permit2,
    abi: permit2Abi,
    functionName: 'approve',
    args: [tokenIn, universalRouter, amount, cappedExpiration],
    txOverrides,
  })
}

/**
 * Step 2 (and wait): approve the Universal Router via Permit2.
 */
export async function approveRouterViaPermit2AndWait(
  params: ApproveRouterViaPermit2Params,
): Promise<TxReceipt> {
  const result = await approveRouterViaPermit2(params)
  return result.wait()
}
