/**
 * Item-based wrapper around dispatch() for batched mint/burn ops.
 * @module v2/writes/executeBatchDispatch
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { buildBatchDispatchArgs } from '../batch/build'
import type { BatchOp } from '../batch/types'
import { BatchValidationError } from '../errors'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { dispatch } from './dispatch'

export interface ExecuteBatchDispatchParams {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  poolAddress: Address
  /** Batch ops in operation order. */
  items: BatchOp[]
  /** Current on-chain positionIdList for the account (fresh). */
  existingPositionIds: bigint[]
  /** Apply across the whole dispatch. Defaults to false. */
  usePremiaAsCollateral?: boolean
  /** Apply across the whole dispatch. Defaults to 0n. */
  builderCode?: bigint
  txOverrides?: TxOverrides
}

/**
 * Build dispatch args from a batch and submit them as a single transaction.
 *
 * Throws `BatchValidationError` (with the full diagnostics list) when the batch
 * fails validation. Callers that want to render diagnostics in UI should run
 * `buildBatchDispatchArgs` or `simulateBatchDispatch` first.
 */
export async function executeBatchDispatch(params: ExecuteBatchDispatchParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    items,
    existingPositionIds,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    txOverrides,
  } = params

  const { args, diagnostics } = buildBatchDispatchArgs({
    items,
    existingPositionIds,
    usePremiaAsCollateral,
    builderCode,
  })

  if (args === null) {
    throw new BatchValidationError(diagnostics)
  }

  return dispatch({
    client,
    walletClient,
    account,
    poolAddress,
    positionIdList: args.positionIdList,
    finalPositionIdList: args.finalPositionIdList,
    positionSizes: args.positionSizes,
    tickAndSpreadLimits: args.tickAndSpreadLimits,
    usePremiaAsCollateral: args.usePremiaAsCollateral,
    builderCode: args.builderCode,
    txOverrides,
  })
}

/**
 * Execute a batch dispatch and wait for confirmation.
 */
export async function executeBatchDispatchAndWait(
  params: ExecuteBatchDispatchParams,
): Promise<TxReceipt> {
  const result = await executeBatchDispatch(params)
  return result.wait()
}
