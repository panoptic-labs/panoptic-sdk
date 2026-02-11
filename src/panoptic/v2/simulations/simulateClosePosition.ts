/**
 * Close position simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateClosePosition
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import type { ClosePositionSimulation, SimulationResult } from '../types'
import { simulateWithTokenFlow } from './tokenFlow'

/**
 * Parameters for simulating position closing.
 */
export interface SimulateClosePositionParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Current position ID list */
  positionIdList: bigint[]
  /** TokenId of position to close */
  tokenId: bigint
  /** Position size to close */
  positionSize: bigint
  /**
   * Lower tick limit (always <= tickLimitHigh).
   * Use MIN_TICK (-887272n) to allow any downward price movement.
   */
  tickLimitLow: bigint
  /**
   * Upper tick limit (always >= tickLimitLow).
   * Use MAX_TICK (887272n) to allow any upward price movement.
   */
  tickLimitHigh: bigint
  /** Spread limit tick (use 0n for no spread limit) */
  spreadLimit?: bigint
  /**
   * Whether to swap tokens at burn to achieve single-sided exposure.
   * When true, tickLimits are passed to dispatch in descending order (high, low).
   * When false (default), tickLimits are passed in ascending order (low, high).
   */
  swapAtMint?: boolean
  /** Whether to use premia as collateral */
  usePremiaAsCollateral?: boolean
  /** Builder code */
  builderCode?: bigint
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate closing a position.
 *
 * Uses PanopticPool.multicall with getAssetsOf-dispatch-getAssetsOf pattern
 * to measure exact collateral asset movements from the burn.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with close data or error
 */
export async function simulateClosePosition(
  params: SimulateClosePositionParams,
): Promise<SimulationResult<ClosePositionSimulation>> {
  const {
    client,
    poolAddress,
    account,
    positionIdList,
    tokenId,
    tickLimitLow,
    tickLimitHigh,
    spreadLimit = 0n,
    swapAtMint = false,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    blockNumber,
  } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  // Build tick limits based on swapAtMint flag:
  // - swapAtMint=true: descending order (high, low) triggers SFPM swap
  // - swapAtMint=false: ascending order (low, high) no swap
  const tickLimits: readonly [number, number, number] = swapAtMint
    ? [Number(tickLimitHigh), Number(tickLimitLow), Number(spreadLimit)]
    : [Number(tickLimitLow), Number(tickLimitHigh), Number(spreadLimit)]

  try {
    // Prepare final position list (without the closed position)
    const finalPositionIdList = positionIdList.filter((id) => id !== tokenId)

    // Encode dispatch call data for burn (positionSize = 0 signals close)
    const callData = encodeFunctionData({
      abi: panopticPoolAbi,
      functionName: 'dispatch',
      args: [
        [tokenId],
        finalPositionIdList,
        [0n],
        [tickLimits],
        usePremiaAsCollateral,
        builderCode,
      ],
    })

    // Simulate with token flow measurement using PanopticPool.multicall + getAssetsOf
    const flowResult = await simulateWithTokenFlow({
      client,
      poolAddress,
      user: account,
      callData,
      blockNumber: targetBlockNumber,
    })

    if (!flowResult.success || !flowResult.tokenFlow) {
      throw new PanopticError(flowResult.error || 'Token flow simulation failed')
    }

    const tokenFlow = flowResult.tokenFlow
    const _meta = await metaPromise

    // Map token flow to simulation fields:
    // Positive delta = user receives collateral back
    const data: ClosePositionSimulation = {
      amount0Received: tokenFlow.delta0,
      amount1Received: tokenFlow.delta1,
      premiaCollected0: null, // Requires pre-close premia snapshot
      premiaCollected1: null,
      postCollateral0: tokenFlow.balanceAfter0,
      postCollateral1: tokenFlow.balanceAfter1,
      realizedPnL0: null, // Requires open position cost basis
      realizedPnL1: null,
    }

    return {
      success: true,
      data,
      gasEstimate: flowResult.gasEstimate,
      tokenFlow,
      _meta,
    }
  } catch (error) {
    const _meta = await metaPromise
    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(
              error instanceof Error ? error.message : 'Simulation failed',
              error instanceof Error ? error : undefined,
            ),
      _meta,
    }
  }
}
