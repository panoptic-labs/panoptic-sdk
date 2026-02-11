/**
 * Liquidation simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateLiquidate
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import type { LiquidateSimulation, SimulationResult, TokenFlow } from '../types'
import { simulateWithTokenFlow } from './tokenFlow'

/**
 * Parameters for simulating liquidation.
 */
export interface SimulateLiquidateParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Liquidator account address */
  account: Address
  /** Account being liquidated */
  liquidatee: Address
  /** Position IDs from the liquidator's account */
  positionIdListFrom: bigint[]
  /** Position IDs of the liquidatee */
  positionIdListTo: bigint[]
  /** Final position ID list for the liquidatee after liquidation */
  positionIdListToFinal: bigint[]
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate a liquidation operation.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with liquidation data or error
 */
export async function simulateLiquidate(
  params: SimulateLiquidateParams,
): Promise<SimulationResult<LiquidateSimulation>> {
  const {
    client,
    poolAddress,
    account,
    liquidatee,
    positionIdListFrom,
    positionIdListTo,
    positionIdListToFinal,
    blockNumber,
  } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  // Default token flow for failure cases
  const emptyTokenFlow: TokenFlow = {
    delta0: 0n,
    delta1: 0n,
    balanceBefore0: 0n,
    balanceBefore1: 0n,
    balanceAfter0: 0n,
    balanceAfter1: 0n,
  }

  try {
    // Encode dispatchFrom call data
    const callData = encodeFunctionData({
      abi: panopticPoolAbi,
      functionName: 'dispatchFrom',
      args: [positionIdListFrom, liquidatee, positionIdListTo, positionIdListToFinal, 0n],
    })

    // Simulate with token flow measurement using PanopticPool.multicall + getAssetsOf
    const flowResult = await simulateWithTokenFlow({
      client,
      poolAddress,
      user: account, // Measure liquidator's collateral change
      callData,
      blockNumber: targetBlockNumber,
    })

    if (!flowResult.success || !flowResult.tokenFlow) {
      // Check if it's a specific error indicating not liquidatable
      const errorMessage = flowResult.error || 'Simulation failed'
      const isNotLiquidatable =
        errorMessage.includes('NotMarginCalled') || errorMessage.includes('AccountInsolvent')

      if (isNotLiquidatable) {
        const _meta = await metaPromise
        const data: LiquidateSimulation = {
          bonus0: 0n,
          bonus1: 0n,
          positionsClosed: [],
          isLiquidatable: false,
          shortfall0: 0n,
          shortfall1: 0n,
        }
        return {
          success: true,
          data,
          gasEstimate: 0n,
          tokenFlow: emptyTokenFlow,
          _meta,
        }
      }

      throw new PanopticError(errorMessage)
    }

    const _meta = await metaPromise
    const tokenFlow: TokenFlow = flowResult.tokenFlow

    // Positions that would be closed
    const positionsClosed = positionIdListTo.filter((id) => !positionIdListToFinal.includes(id))

    // Build simulation result with actual token flow data
    // Positive delta = liquidator receives bonus
    const data: LiquidateSimulation = {
      bonus0: tokenFlow.delta0 > 0n ? tokenFlow.delta0 : 0n,
      bonus1: tokenFlow.delta1 > 0n ? tokenFlow.delta1 : 0n,
      positionsClosed,
      isLiquidatable: true,
      shortfall0: 0n, // Would need additional calculation
      shortfall1: 0n,
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
    // If simulation fails, the account might not be liquidatable
    const errorMessage = error instanceof Error ? error.message : 'Simulation failed'
    const isNotLiquidatable =
      errorMessage.includes('NotMarginCalled') || errorMessage.includes('AccountInsolvent')

    if (isNotLiquidatable) {
      const data: LiquidateSimulation = {
        bonus0: 0n,
        bonus1: 0n,
        positionsClosed: [],
        isLiquidatable: false,
        shortfall0: 0n,
        shortfall1: 0n,
      }
      return {
        success: true,
        data,
        gasEstimate: 0n,
        tokenFlow: emptyTokenFlow,
        _meta,
      }
    }

    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(errorMessage, error instanceof Error ? error : undefined),
      _meta,
    }
  }
}
