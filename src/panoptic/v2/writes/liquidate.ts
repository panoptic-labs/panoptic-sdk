/**
 * Liquidation functions for the Panoptic v2 SDK.
 * @module v2/writes/liquidate
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { submitWrite } from './utils'

/**
 * Parameters for liquidating an account.
 */
export interface LiquidateParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Liquidator account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Account being liquidated */
  liquidatee: Address
  /** Position IDs from the liquidator's account */
  positionIdListFrom: bigint[]
  /** Position IDs of the liquidatee (positions to liquidate) */
  positionIdListTo: bigint[]
  /** Final position ID list for the liquidatee after liquidation */
  positionIdListToFinal: bigint[]
  /** Packed value for using premia as collateral */
  usePremiaAsCollateral?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Liquidate an undercollateralized account using dispatchFrom.
 *
 * The liquidator calls dispatchFrom to close the liquidatee's positions
 * and receive a bonus.
 *
 * @param params - Liquidation parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * const result = await liquidate({
 *   client,
 *   walletClient,
 *   account: liquidatorAddress,
 *   poolAddress,
 *   liquidatee: undercollateralizedAccount,
 *   positionIdListFrom: liquidatorPositions,
 *   positionIdListTo: liquidateePositions,
 *   positionIdListToFinal: [], // Close all positions
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function liquidate(params: LiquidateParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    liquidatee,
    positionIdListFrom,
    positionIdListTo,
    positionIdListToFinal,
    usePremiaAsCollateral = 0n,
    txOverrides,
  } = params

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'dispatchFrom',
    args: [
      positionIdListFrom,
      liquidatee,
      positionIdListTo,
      positionIdListToFinal,
      usePremiaAsCollateral,
    ],
    txOverrides,
  })
}

/**
 * Liquidate and wait for confirmation.
 */
export async function liquidateAndWait(params: LiquidateParams): Promise<TxReceipt> {
  const result = await liquidate(params)
  return result.wait()
}
