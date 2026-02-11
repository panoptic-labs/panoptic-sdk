/**
 * Raw dispatch function for the Panoptic v2 SDK.
 * @module v2/writes/dispatch
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import type { TickAndSpreadLimits } from './position'
import { submitWrite } from './utils'

/**
 * Parameters for dispatch function.
 */
export interface DispatchParams {
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
  /** Final position ID list after operations */
  finalPositionIdList: bigint[]
  /** Position sizes for each operation */
  positionSizes: bigint[]
  /** Tick and spread limits for each operation */
  tickAndSpreadLimits: TickAndSpreadLimits[]
  /** Whether to use premia as collateral */
  usePremiaAsCollateral?: boolean
  /** Builder code */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Execute a raw dispatch operation.
 * This is the low-level function for multi-position operations.
 *
 * @param params - Dispatch parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * // Open multiple positions atomically
 * const result = await dispatch({
 *   client,
 *   walletClient,
 *   account,
 *   poolAddress,
 *   positionIdList: [],
 *   finalPositionIdList: [tokenId1, tokenId2],
 *   positionSizes: [size1, size2],
 *   tickAndSpreadLimits: [limits1, limits2],
 * })
 * ```
 */
export async function dispatch(params: DispatchParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    positionIdList,
    finalPositionIdList,
    positionSizes,
    tickAndSpreadLimits,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    txOverrides,
  } = params

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'dispatch',
    args: [
      positionIdList,
      finalPositionIdList,
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
 * Execute dispatch and wait for confirmation.
 */
export async function dispatchAndWait(params: DispatchParams): Promise<TxReceipt> {
  const result = await dispatch(params)
  return result.wait()
}
