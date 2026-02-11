/**
 * Dispatch simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateDispatch
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import type { DispatchSimulation, SimulationResult, TokenFlow } from '../types'
import type { TickAndSpreadLimits } from '../writes/position'
import { simulateWithTokenFlow } from './tokenFlow'

/**
 * Parameters for simulating dispatch.
 */
export interface SimulateDispatchParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
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
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate a raw dispatch operation.
 *
 * Uses PanopticPool.multicall with getAssetsOf-dispatch-getAssetsOf pattern
 * to measure exact collateral asset movements.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with dispatch data or error
 */
export async function simulateDispatch(
  params: SimulateDispatchParams,
): Promise<SimulationResult<DispatchSimulation>> {
  const {
    client,
    poolAddress,
    account,
    positionIdList,
    finalPositionIdList,
    positionSizes,
    tickAndSpreadLimits,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    blockNumber,
  } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  try {
    // Encode dispatch call data
    const callData = encodeFunctionData({
      abi: panopticPoolAbi,
      functionName: 'dispatch',
      args: [
        positionIdList,
        finalPositionIdList,
        positionSizes,
        tickAndSpreadLimits.map(
          (t) => [Number(t[0]), Number(t[1]), Number(t[2])] as readonly [number, number, number],
        ),
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

    const tokenFlow: TokenFlow = flowResult.tokenFlow

    // Determine which positions were created/closed
    const positionsCreated = finalPositionIdList.filter((id) => !positionIdList.includes(id))
    const positionsClosed = positionIdList.filter((id) => !finalPositionIdList.includes(id))

    const _meta = await metaPromise

    // Build simulation result with actual token flow data
    const data: DispatchSimulation = {
      netAmount0: tokenFlow.delta0,
      netAmount1: tokenFlow.delta1,
      positionsCreated,
      positionsClosed,
      postCollateral0: tokenFlow.balanceAfter0,
      postCollateral1: tokenFlow.balanceAfter1,
      postMarginExcess0: null, // Requires PanopticQuery.checkCollateral
      postMarginExcess1: null,
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
