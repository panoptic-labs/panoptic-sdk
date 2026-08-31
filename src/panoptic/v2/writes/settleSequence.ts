/**
 * Settle-sequence write for the Panoptic v2 SDK.
 *
 * Settles the long premium owed by one or more buyers (dispatchFrom settle
 * mode per buyer), optionally followed by closing the caller's own position,
 * all in a single `PanopticPool.multicall` transaction.
 * @module v2/writes/settleSequence
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { PanopticError } from '../errors'
import type { DispatchIntent } from '../simulations/creditWrap'
import type { StorageAdapter } from '../storage'
import { syncPositions } from '../sync/syncPositions'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { orderListForSettle } from './settlePremiumFrom'
import { submitWrite } from './utils'

/**
 * One buyer whose long premium is settled by the sequence.
 */
export interface SettleSequenceTarget {
  /** Account whose long premium is being settled */
  user: Address
  /** The target user's full held position ID list */
  positionIdList: bigint[]
  /** The position to settle premium on (reordered to the end of the list) */
  tokenId: bigint
}

/**
 * Optional close of the caller's own position appended to the sequence.
 */
export interface SettleSequenceClose {
  /** The caller's position to close */
  tokenId: bigint
  /** The caller's position list after the close (excludes `tokenId`) */
  finalPositionIdList: bigint[]
  /** Lower tick limit */
  tickLimitLow: bigint
  /** Upper tick limit */
  tickLimitHigh: bigint
  /** Spread limit (default 0) */
  spreadLimit?: bigint
  /** Whether to swap at mint/burn (descending tick limits). Default false */
  swapAtMint?: boolean
  /** Whether to use premia as collateral for the close. Default false */
  usePremiaAsCollateral?: boolean
  /** Builder code (default 0) */
  builderCode?: bigint
}

/**
 * Parameters shared by the settle-sequence write and simulation.
 */
export interface SettleSequenceCallsParams {
  /** Position IDs from the caller's account (full held list) */
  positionIdListFrom: bigint[]
  /** Buyers to settle */
  targets: SettleSequenceTarget[]
  /** Optional close of the caller's own position, appended last */
  close?: SettleSequenceClose
  /**
   * Optional arbitrary dispatch appended last (e.g. a reduce-size mint+burn
   * or a batch dispatch). Mutually exclusive with `close`.
   */
  dispatch?: DispatchIntent
  /** Packed value for using premia as collateral in the settles */
  usePremiaAsCollateral?: bigint
}

/**
 * Build the encoded PanopticPool calls for a settle sequence: one settle-mode
 * `dispatchFrom` per target (equal To/ToFinal lists, settled tokenId last),
 * then the caller's own close `dispatch` when provided.
 *
 * A pure settle changes no position list, so targets need no cross-call
 * bookkeeping (unlike a force-exercise sequence).
 */
export function buildSettleSequenceCalls(params: SettleSequenceCallsParams): Hex[] {
  const { positionIdListFrom, targets, close, dispatch, usePremiaAsCollateral = 0n } = params

  if (close !== undefined && dispatch !== undefined) {
    throw new PanopticError('SettleSequence: provide either `close` or `dispatch`, not both')
  }

  if (targets.length === 0 && close === undefined && dispatch === undefined) {
    throw new PanopticError('SettleSequence: nothing to do (no targets, close, or dispatch)')
  }

  const calls: Hex[] = targets.map((target) => {
    const orderedList = orderListForSettle(target.positionIdList, target.tokenId)
    return encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'dispatchFrom',
      args: [positionIdListFrom, target.user, orderedList, orderedList, usePremiaAsCollateral],
    })
  })

  if (close !== undefined) {
    const {
      tokenId,
      finalPositionIdList,
      tickLimitLow,
      tickLimitHigh,
      spreadLimit = 0n,
      swapAtMint = false,
      usePremiaAsCollateral: closeUsePremia = false,
      builderCode = 0n,
    } = close

    // swapAtMint=true: descending order (high, low) triggers the SFPM swap
    const tickLimits: readonly [number, number, number] = swapAtMint
      ? [Number(tickLimitHigh), Number(tickLimitLow), Number(spreadLimit)]
      : [Number(tickLimitLow), Number(tickLimitHigh), Number(spreadLimit)]

    calls.push(
      encodeFunctionData({
        abi: panopticPoolV2Abi,
        functionName: 'dispatch',
        args: [[tokenId], finalPositionIdList, [0n], [tickLimits], closeUsePremia, builderCode],
      }),
    )
  }

  if (dispatch !== undefined) {
    calls.push(
      encodeFunctionData({
        abi: panopticPoolV2Abi,
        functionName: 'dispatch',
        args: [
          dispatch.positionIdList,
          dispatch.finalPositionIdList,
          dispatch.positionSizes,
          dispatch.tickAndSpreadLimits.map(
            (t) => [Number(t[0]), Number(t[1]), Number(t[2])] as readonly [number, number, number],
          ),
          dispatch.usePremiaAsCollateral,
          dispatch.builderCode,
        ],
      }),
    )
  }

  return calls
}

/**
 * Parameters for executing a settle sequence.
 */
export interface ExecuteSettleSequenceParams extends SettleSequenceCallsParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Caller (settler) account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
  /** Storage adapter for auto-syncing positions after confirmation */
  storage?: StorageAdapter
  /** Chain ID (required when storage is provided) */
  chainId?: bigint
}

/**
 * Execute a settle sequence: settle each target buyer's owed long premium,
 * then optionally close the caller's own position, in one multicall.
 *
 * @param params - Settle sequence parameters
 * @returns TxResult
 */
export async function executeSettleSequence(
  params: ExecuteSettleSequenceParams,
): Promise<TxResult> {
  const { client, walletClient, account, poolAddress, txOverrides } = params

  const calls = buildSettleSequenceCalls(params)

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolV2Abi,
    functionName: 'multicall',
    args: [calls],
    txOverrides,
  })
}

/**
 * Execute a settle sequence and wait for confirmation.
 *
 * When `storage` and `chainId` are provided, automatically syncs the
 * caller's positions after the transaction confirms.
 */
export async function executeSettleSequenceAndWait(
  params: ExecuteSettleSequenceParams,
): Promise<TxReceipt> {
  const result = await executeSettleSequence(params)
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
