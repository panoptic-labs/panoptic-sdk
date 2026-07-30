/**
 * Encode SFPM swap calldata (mint + burn wrapped in a single multicall).
 * @module v2/sfpmSwap/calldata
 */
import { type Hex, encodeFunctionData } from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import type { SfpmSwapPlan } from './types'

/** Encoded calldata for an SFPM swap. */
export interface SfpmSwapCalldata {
  /** The `SFPM.multicall(bytes[])` calldata to send to {@link SfpmSwapPlan.sfpmAddress}. */
  multicallData: Hex
  /** The inner `mintTokenizedPosition` calldata (index 0 of the multicall). */
  mintData: Hex
  /** The inner `burnTokenizedPosition` calldata (index 1 of the multicall). */
  burnData: Hex
}

/**
 * Encode the `multicall([mint, burn])` for a swap plan.
 *
 * The order is always `[mint, burn]` — the ERC1155 must be minted before it is
 * burned. Which call carries the inverted (swap) limits is decided in the plan.
 */
export function buildSfpmSwapCalldata(plan: SfpmSwapPlan): SfpmSwapCalldata {
  const mintData = encodeFunctionData({
    abi: sfpmV3Abi,
    functionName: 'mintTokenizedPosition',
    args: [
      plan.poolKey,
      plan.tokenId,
      plan.positionSize,
      plan.mintTickLimits[0],
      plan.mintTickLimits[1],
    ],
  })
  const burnData = encodeFunctionData({
    abi: sfpmV3Abi,
    functionName: 'burnTokenizedPosition',
    args: [
      plan.poolKey,
      plan.tokenId,
      plan.positionSize,
      plan.burnTickLimits[0],
      plan.burnTickLimits[1],
    ],
  })
  const multicallData = encodeFunctionData({
    abi: sfpmV3Abi,
    functionName: 'multicall',
    args: [[mintData, burnData]],
  })
  return { multicallData, mintData, burnData }
}
