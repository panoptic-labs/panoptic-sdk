/**
 * Force exercise functions for the Panoptic v2 SDK.
 * @module v2/writes/forceExercise
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { submitWrite } from './utils'

/**
 * Parameters for force exercising a position.
 */
export interface ForceExerciseParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Exercisor account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Account whose position is being exercised */
  user: Address
  /** Position IDs from the exercisor's account */
  positionIdListFrom: bigint[]
  /** Position IDs of the target user */
  positionIdListTo: bigint[]
  /** Final position ID list for the user after exercise */
  positionIdListToFinal: bigint[]
  /** Packed value for using premia as collateral */
  usePremiaAsCollateral?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Force exercise an ITM (in-the-money) long position.
 *
 * The exercisor calls dispatchFrom to exercise another user's ITM long positions,
 * paying the exercise fee.
 *
 * @param params - Force exercise parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * const result = await forceExercise({
 *   client,
 *   walletClient,
 *   account: exercisorAddress,
 *   poolAddress,
 *   user: targetAccount,
 *   positionIdListFrom: exercisorPositions,
 *   positionIdListTo: targetPositions,
 *   positionIdListToFinal: [], // Exercise all ITM positions
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function forceExercise(params: ForceExerciseParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    user,
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
      user,
      positionIdListTo,
      positionIdListToFinal,
      usePremiaAsCollateral,
    ],
    txOverrides,
  })
}

/**
 * Force exercise and wait for confirmation.
 */
export async function forceExerciseAndWait(params: ForceExerciseParams): Promise<TxReceipt> {
  const result = await forceExercise(params)
  return result.wait()
}
