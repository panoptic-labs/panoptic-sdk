/**
 * Settle premium functions for the Panoptic v2 SDK.
 *
 * In v2 there is no standalone `settleLongPremium` entrypoint (v1). Settling
 * another account's accumulated long premium is a mode of `dispatchFrom`,
 * selected when `positionIdListTo.length == positionIdListToFinal.length`.
 * @module v2/writes/settlePremiumFrom
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { PanopticError } from '../errors'
import type { StorageAdapter } from '../storage'
import { syncPositions } from '../sync/syncPositions'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { submitWrite } from './utils'

/**
 * Reorder a position ID list so `tokenId` is the last element.
 *
 * The position list fingerprint is an XOR hash, so ordering is free to change.
 * The contract settles premium on the last element of `positionIdListTo`.
 *
 * @throws PanopticError if `tokenId` is not in the list
 */
export function orderListForSettle(positionIdList: bigint[], tokenId: bigint): bigint[] {
  if (!positionIdList.includes(tokenId)) {
    throw new PanopticError('tokenId to settle is not in the target position list')
  }
  return [...positionIdList.filter((id) => id !== tokenId), tokenId]
}

/**
 * Parameters for settling another account's long premium.
 */
export interface SettlePremiumFromParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Caller (settler) account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Account whose long premium is being settled */
  user: Address
  /** Position IDs from the caller's account (full held list) */
  positionIdListFrom: bigint[]
  /** The target user's full held position ID list (passed as both To and ToFinal) */
  positionIdList: bigint[]
  /**
   * The target position to settle premium on. The contract settles the LAST
   * element of the list; when provided, the list is reordered to end with
   * this tokenId. When omitted, the last element of `positionIdList` is settled.
   */
  tokenId?: bigint
  /** Packed value for using premia as collateral */
  usePremiaAsCollateral?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
  /** Storage adapter for auto-syncing positions after confirmation */
  storage?: StorageAdapter
  /** Chain ID (required when storage is provided) */
  chainId?: bigint
}

/**
 * Settle another account's accumulated long premium.
 *
 * Calls `dispatchFrom` with the target's position list passed as both
 * `positionIdListTo` and `positionIdListToFinal` (equal lengths select the
 * settle-premium mode and cannot force-exercise or liquidate). Requires the
 * target account to be solvent; the settled premium is credited to the
 * sellers of the corresponding chunks.
 *
 * @param params - Settle premium parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * const result = await settlePremiumFrom({
 *   client,
 *   walletClient,
 *   account: sellerAddress,
 *   poolAddress,
 *   user: buyerAccount,
 *   positionIdListFrom: sellerPositions,
 *   positionIdList: buyerPositions,
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function settlePremiumFrom(params: SettlePremiumFromParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    user,
    positionIdListFrom,
    positionIdList,
    tokenId,
    usePremiaAsCollateral = 0n,
    txOverrides,
  } = params

  const orderedList =
    tokenId !== undefined ? orderListForSettle(positionIdList, tokenId) : positionIdList

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolV2Abi,
    functionName: 'dispatchFrom',
    args: [positionIdListFrom, user, orderedList, orderedList, usePremiaAsCollateral],
    txOverrides,
  })
}

/**
 * Settle another account's premium and wait for confirmation.
 *
 * When `storage` and `chainId` are provided, automatically syncs the
 * caller's positions after the transaction confirms.
 */
export async function settlePremiumFromAndWait(
  params: SettlePremiumFromParams,
): Promise<TxReceipt> {
  const result = await settlePremiumFrom(params)
  const receipt = await result.wait()

  const { storage, chainId, client, poolAddress, account } = params
  if (storage && chainId !== undefined) {
    await syncPositions({
      client,
      chainId,
      poolAddress,
      account,
      storage,
    })
  }

  return receipt
}
