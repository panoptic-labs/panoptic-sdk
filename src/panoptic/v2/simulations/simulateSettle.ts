/**
 * Settle simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateSettle
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import type { SettleSimulation, SimulationResult, TokenFlow } from '../types'
import { simulateWithTokenFlow } from './tokenFlow'

/**
 * Parameters for simulating premium settlement.
 */
export interface SimulateSettleParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Current position ID list */
  positionIdList: bigint[]
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate premium settlement.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with settlement data or error
 */
export async function simulateSettle(
  params: SimulateSettleParams,
): Promise<SimulationResult<SettleSimulation>> {
  const { client, poolAddress, account, positionIdList, blockNumber } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  try {
    // For settlement, we call dispatch with unchanged position lists
    const positionSizes = positionIdList.map(() => 0n)
    const tickAndSpreadLimits = positionIdList.map(() => [-887272n, 887272n, 0n] as const)

    // Encode dispatch call data
    const callData = encodeFunctionData({
      abi: panopticPoolAbi,
      functionName: 'dispatch',
      args: [
        positionIdList,
        positionIdList,
        positionSizes.map((s) => BigInt(s) as unknown as bigint & { readonly __uint128: true }),
        tickAndSpreadLimits.map(
          (t) => [Number(t[0]), Number(t[1]), Number(t[2])] as readonly [number, number, number],
        ),
        false,
        0n,
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

    const _meta = await metaPromise

    // Build simulation result with actual token flow data
    // Positive delta = premia received
    const data: SettleSimulation = {
      premiaReceived0: tokenFlow.delta0 > 0n ? tokenFlow.delta0 : 0n,
      premiaReceived1: tokenFlow.delta1 > 0n ? tokenFlow.delta1 : 0n,
      postCollateral0: tokenFlow.balanceAfter0,
      postCollateral1: tokenFlow.balanceAfter1,
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
