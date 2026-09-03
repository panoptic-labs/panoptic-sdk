/**
 * Premium settlement functions for the Panoptic v2 SDK.
 * @module v2/writes/settle
 */

import type { Address, ContractFunctionArgs, PublicClient, WalletClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { PanopticError } from '../errors'
import { getCurrentPositionSizes } from '../reads/positionSizes'
import { simulateSettle } from '../simulations/simulateSettle'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { buildProtectedSettlePlan } from './protectedSettle'
import type { SettleSequenceTarget } from './settleSequence'
import { executeSettleSequence } from './settleSequence'
import { submitWrite } from './utils'

type DispatchPositionSizes = ContractFunctionArgs<
  typeof panopticPoolV2Abi,
  'nonpayable',
  'dispatch'
>[2]

/**
 * Parameters for settling accumulated premia.
 */
export interface SettleParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /**
   * TokenIds to settle in this dispatch — a subset of the account's held
   * positions. Only these are touched; the rest of the account is untouched.
   */
  positionIdList: bigint[]
  /**
   * Full held tokenId list AFTER this dispatch. Must hash-match the on-chain
   * `s_positionsHash`; a pure settle doesn't change holdings, so this is just
   * the account's current full held list. When omitted, defaults to
   * `positionIdList` (correct only if the caller is settling ALL held
   * positions).
   */
  finalPositionIdList?: bigint[]
  /**
   * Current stored positionSize for each tokenId in `positionIdList`, in the
   * same order. When omitted, the SDK reads them via `getFullPositionsData`
   * against the latest block just before submission.
   *
   * dispatch() treats `positionSizes[i] == storedSize` as a settlePremium
   * self-call and any mismatch (including 0) as a burn — so this MUST be the
   * current stored size to avoid burning the position.
   *
   * ⚠ Burn risk on the latest-block fallback: if a position's stored size
   * changes on-chain between the fallback read and inclusion of this tx (e.g.
   * a size reduction from another dispatch in the intervening blocks), the
   * stale positionSize will no longer match `storedSize` and dispatch will
   * BURN the position instead of settling premium. Callers that already hold
   * the stored sizes (e.g. from a same-block snapshot) SHOULD pass them
   * explicitly to eliminate that window.
   */
  positionSizes?: bigint[]
  /** Buyers holding longs against the short chunks being settled. */
  targets?: SettleSequenceTarget[]
  /**
   * Skip the SDK preflight when the caller already simulated or intentionally
   * accepts settlement risk. The transaction itself is still simulated by
   * the write client. Default false.
   */
  skipPreflight?: boolean
  /** Allow irreducible forfeiture on positions with no available protection. */
  allowForfeit?: boolean
  /** Whether to use premia as collateral */
  usePremiaAsCollateral?: boolean
  /** Builder code */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Settle accumulated premia on existing positions.
 *
 * This function triggers premium collection without changing position size.
 * It calls dispatch with unchanged position lists.
 *
 * @param params - Settlement parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * const result = await settleAccumulatedPremia({
 *   client,
 *   walletClient,
 *   account,
 *   poolAddress,
 *   positionIdList: existingPositions,
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function settleAccumulatedPremia(params: SettleParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    positionIdList,
    finalPositionIdList,
    positionSizes: providedSizes,
    targets = [],
    skipPreflight = false,
    allowForfeit = false,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    txOverrides,
  } = params

  // dispatch() interprets positionSizes[i] == storedSize as a settlePremium
  // self-call; anything else (including 0) BURNS the position. So we must
  // pass current stored sizes. Callers can supply them (UI already has them
  // in-store) to skip the extra RPC.
  // OLD (buggy): const positionSizes: bigint[] = positionIdList.map(() => 0n)
  if (providedSizes && providedSizes.length !== positionIdList.length) {
    throw new PanopticError(
      'settleAccumulatedPremia: positionSizes length must match positionIdList',
    )
  }
  const positionSizes: bigint[] =
    providedSizes ??
    (await getCurrentPositionSizes({ client, poolAddress, account, positionIdList }))
  const heldPositions = finalPositionIdList ?? positionIdList
  if (!skipPreflight) {
    const simulation = await simulateSettle({
      client,
      poolAddress,
      account,
      positionIdList,
      finalPositionIdList: heldPositions,
      positionSizes,
      targets,
      usePremiaAsCollateral,
      builderCode,
      allowForfeit,
    })
    if (!simulation.success) throw simulation.error
  }

  const { dispatch } = buildProtectedSettlePlan({
    positionIdList,
    finalPositionIdList: heldPositions,
    positionSizes,
    usePremiaAsCollateral,
    builderCode,
  })

  if (targets.length > 0) {
    return executeSettleSequence({
      client,
      walletClient,
      account,
      poolAddress,
      positionIdListFrom: heldPositions,
      targets,
      dispatch,
      txOverrides,
    })
  }

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [
      dispatch.positionIdList,
      dispatch.finalPositionIdList,
      dispatch.positionSizes as DispatchPositionSizes,
      dispatch.tickAndSpreadLimits.map(
        (t) => [Number(t[0]), Number(t[1]), Number(t[2])] as readonly [number, number, number],
      ),
      dispatch.usePremiaAsCollateral,
      dispatch.builderCode,
    ],
    txOverrides,
  })
}

/**
 * Settle premia and wait for confirmation.
 */
export async function settleAccumulatedPremiaAndWait(params: SettleParams): Promise<TxReceipt> {
  const result = await settleAccumulatedPremia(params)
  return result.wait()
}
