/**
 * Force exercise simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateForceExercise
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import type { ForceExerciseSimulation, SimulationResult, TokenFlow } from '../types'
import { simulateWithTokenFlow } from './tokenFlow'

/**
 * Parameters for simulating force exercise.
 */
export interface SimulateForceExerciseParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Exercisor account address */
  account: Address
  /** Account whose position is being exercised */
  user: Address
  /** Position IDs from the exercisor's account */
  positionIdListFrom: bigint[]
  /** Position IDs of the target user */
  positionIdListTo: bigint[]
  /** Final position ID list for the user after exercise */
  positionIdListToFinal: bigint[]
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate a force exercise operation.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with exercise data or error
 */
export async function simulateForceExercise(
  params: SimulateForceExerciseParams,
): Promise<SimulationResult<ForceExerciseSimulation>> {
  const {
    client,
    poolAddress,
    account,
    user,
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
      args: [positionIdListFrom, user, positionIdListTo, positionIdListToFinal, 0n],
    })

    // Simulate with token flow measurement using PanopticPool.multicall + getAssetsOf
    const flowResult = await simulateWithTokenFlow({
      client,
      poolAddress,
      user: account, // Measure exercisor's collateral change
      callData,
      blockNumber: targetBlockNumber,
    })

    if (!flowResult.success || !flowResult.tokenFlow) {
      // Check for specific exercise-related errors
      const errorMessage = flowResult.error || 'Simulation failed'
      const isNotExercisable =
        errorMessage.includes('NoLegsExercisable') || errorMessage.includes('NotALongLeg')

      if (isNotExercisable) {
        const _meta = await metaPromise
        const data: ForceExerciseSimulation = {
          exerciseFee0: 0n,
          exerciseFee1: 0n,
          canExercise: false,
          reason: errorMessage.includes('NoLegsExercisable')
            ? 'No legs are exercisable (not ITM)'
            : 'Position does not have a long leg',
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

    // Build simulation result with actual token flow data
    // Exercise fee is what the exercisor receives (positive delta)
    const data: ForceExerciseSimulation = {
      exerciseFee0: tokenFlow.delta0,
      exerciseFee1: tokenFlow.delta1,
      canExercise: true,
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
    // If simulation fails, check the reason
    const errorMessage = error instanceof Error ? error.message : 'Simulation failed'

    // Check for specific exercise-related errors
    const isNotExercisable =
      errorMessage.includes('NoLegsExercisable') || errorMessage.includes('NotALongLeg')

    if (isNotExercisable) {
      const data: ForceExerciseSimulation = {
        exerciseFee0: 0n,
        exerciseFee1: 0n,
        canExercise: false,
        reason: errorMessage.includes('NoLegsExercisable')
          ? 'No legs are exercisable (not ITM)'
          : 'Position does not have a long leg',
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
