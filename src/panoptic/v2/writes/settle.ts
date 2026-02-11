/**
 * Premium settlement functions for the Panoptic v2 SDK.
 * @module v2/writes/settle
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
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
  /** Current position ID list */
  positionIdList: bigint[]
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
    usePremiaAsCollateral = false,
    builderCode = 0n,
    txOverrides,
  } = params

  // For settlement, we call dispatch with:
  // - Same position lists (no change)
  // - Zero position sizes (no size change, just settle)
  // - Wide tick limits
  const positionSizes: bigint[] = positionIdList.map(() => 0n)
  const tickAndSpreadLimits: TickAndSpreadLimits[] = positionIdList.map(
    () => [-887272n, 887272n, 0n] as const,
  )

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'dispatch',
    args: [
      positionIdList,
      positionIdList, // Same list - no change
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
