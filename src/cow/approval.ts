/**
 * ERC20 approval to the CoW vault relayer.
 *
 * Single-step plain `approve` to GPv2VaultRelayer — CoW does not use Permit2.
 *
 * @module cow/approval
 */

import { erc20Abi, maxUint256 } from 'viem'

import type { TxResult } from '../panoptic/v2/types'
import { submitWrite } from '../panoptic/v2/writes'
import { COW_VAULT_RELAYER } from './addresses'
import type { ApproveErc20ForCowParams, CheckCowApprovalParams, CowApprovalStatus } from './types'

/** Check whether the vault relayer can pull `amount` of the sell token. */
export async function checkCowApproval(params: CheckCowApprovalParams): Promise<CowApprovalStatus> {
  const { client, sellToken, owner, amount } = params

  const allowance = await client.readContract({
    address: sellToken,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, COW_VAULT_RELAYER],
  })

  return { needsApproval: allowance < amount, allowance }
}

/** Approve the sell token to the vault relayer (defaults to unlimited). */
export async function approveErc20ForCow(params: ApproveErc20ForCowParams): Promise<TxResult> {
  const { client, walletClient, account, sellToken, amount = maxUint256, txOverrides } = params

  return submitWrite({
    client,
    walletClient,
    account,
    address: sellToken,
    abi: erc20Abi,
    functionName: 'approve',
    args: [COW_VAULT_RELAYER, amount],
    txOverrides,
  })
}
