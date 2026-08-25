/**
 * Premium settlement functions for the Panoptic v2 SDK.
 * @module v2/writes/settle
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { PanopticError } from '../errors'
import { getCurrentPositionSizes } from '../reads/positionSizes'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import type { TickAndSpreadLimits } from './position'
import { submitWrite } from './utils'

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
  const tickAndSpreadLimits: TickAndSpreadLimits[] = positionIdList.map(
    () => [-887272n, 887272n, 0n] as const,
  )

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [
      positionIdList,
      finalPositionIdList ?? positionIdList,
      positionSizes.map((s) => BigInt(s) as unknown as bigint & { readonly __uint128: true }),
      tickAndSpreadLimits.map(
        (t) => [Number(t[0]), Number(t[1]), Number(t[2])] as readonly [number, number, number],
      ),
      usePremiaAsCollateral,
      builderCode,
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
