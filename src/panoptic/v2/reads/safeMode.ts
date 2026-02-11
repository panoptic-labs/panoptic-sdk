/**
 * Safe mode check functions for the Panoptic v2 SDK.
 *
 * Safe mode is a protective mechanism that activates when pool conditions
 * become dangerous (e.g., extreme price movements or liquidity issues).
 *
 * @module v2/reads/safeMode
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta, SafeModeState as OracleSafeModeState } from '../types'

/**
 * Safe mode status values.
 */
export const SafeModeStatus = {
  /** Pool is operating normally */
  NORMAL: 0n,
  /** No new leveraged positions allowed */
  NO_LEVERAGE: 1n,
  /** No swaps allowed */
  NO_SWAP: 2n,
  /** Close-only mode */
  CLOSE_ONLY: 3n,
} as const

export type SafeModeStatusValue = (typeof SafeModeStatus)[keyof typeof SafeModeStatus]

/**
 * Safe mode state for bot preflight and operation guards.
 */
export type SafeModeState = OracleSafeModeState

/**
 * Parameters for getSafeMode.
 */
export interface GetSafeModeParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get the current safe mode status of a pool.
 *
 * Safe mode is activated when:
 * - Pool liquidity drops below safe thresholds
 * - Price volatility exceeds safe limits
 * - Administrative pause is triggered
 *
 * @param params - The parameters
 * @returns Safe mode state with block metadata
 */
export async function getSafeMode(params: GetSafeModeParams): Promise<SafeModeState> {
  const { client, poolAddress, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  const [safeModeRaw, _meta] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'isSafeMode',
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // isSafeMode returns uint8:
  // 0 = normal, 1 = no leverage, 2 = no swap, 3 = close only
  const status = BigInt(safeModeRaw) as SafeModeStatusValue

  switch (status) {
    case SafeModeStatus.NO_LEVERAGE:
      return {
        mode: 'restricted',
        canMint: false,
        canBurn: true,
        canForceExercise: true,
        canLiquidate: true,
        reason: 'No new leveraged positions allowed',
        _meta,
      }
    case SafeModeStatus.NO_SWAP:
      return {
        mode: 'restricted',
        canMint: true,
        canBurn: true,
        canForceExercise: true,
        canLiquidate: true,
        reason: 'Swaps are disabled',
        _meta,
      }
    case SafeModeStatus.CLOSE_ONLY:
      return {
        mode: 'emergency',
        canMint: false,
        canBurn: true,
        canForceExercise: true,
        canLiquidate: true,
        reason: 'Pool is in close-only mode',
        _meta,
      }
    default:
      return {
        mode: 'normal',
        canMint: true,
        canBurn: true,
        canForceExercise: true,
        canLiquidate: true,
        _meta,
      }
  }
}
