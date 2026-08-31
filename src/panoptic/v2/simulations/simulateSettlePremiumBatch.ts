/**
 * Batch settle-premium simulation for the Panoptic v2 SDK.
 *
 * Simulates settling each buyer independently (same block), partitioning them
 * into settleable buyers (to include in a settle sequence) and unsettleable
 * ones (insolvent / missing tokens — their owed premium is forfeited if the
 * seller closes), plus a full-sequence simulation measuring the caller's
 * total token flow.
 * @module v2/simulations/simulateSettlePremiumBatch
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import type { BlockMeta, SettlePremiumFromSimulation, SimulationResult, TokenFlow } from '../types'
import type { SettleSequenceCallsParams, SettleSequenceTarget } from '../writes/settleSequence'
import { buildSettleSequenceCalls } from '../writes/settleSequence'
import { simulateSettlePremiumFrom } from './simulateSettlePremiumFrom'
import { simulateWithTokenFlow } from './tokenFlow'

/**
 * Per-target result of a batch settle simulation.
 */
export interface SettlePremiumBatchTargetResult {
  /** The simulated target */
  target: SettleSequenceTarget
  /** The individual simulation outcome */
  simulation: SettlePremiumFromSimulation
}

/**
 * Result of simulating a batch of settles.
 */
export interface SettlePremiumBatchResult {
  /** Per-target outcomes, in input order */
  results: SettlePremiumBatchTargetResult[]
  /** Targets whose settle succeeds (include these in the sequence) */
  settleable: SettleSequenceTarget[]
  /** Number of targets that cannot be settled */
  unsettleableCount: number
  /** Total premium the caller receives from the settleable targets (token 0) */
  premium0: bigint
  /** Total premium the caller receives from the settleable targets (token 1) */
  premium1: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for simulateSettlePremiumBatch.
 */
export interface SimulateSettlePremiumBatchParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Caller (settler) account address */
  account: Address
  /** Position IDs from the caller's account (full held list) */
  positionIdListFrom: bigint[]
  /** Buyers to simulate settling */
  targets: SettleSequenceTarget[]
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate settling each target buyer's owed long premium, all at one block.
 *
 * Individual failures (insolvent buyer, stale list, …) are soft: the target
 * lands in the unsettleable partition instead of failing the batch. Only
 * unexpected errors reject.
 *
 * @param params - Simulation parameters
 * @returns Partitioned targets with per-target premium and totals
 */
export async function simulateSettlePremiumBatch(
  params: SimulateSettlePremiumBatchParams,
): Promise<SettlePremiumBatchResult> {
  const { client, poolAddress, account, positionIdListFrom, targets, blockNumber } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  const simulations = await Promise.all(
    targets.map((target) =>
      simulateSettlePremiumFrom({
        client,
        poolAddress,
        account,
        user: target.user,
        positionIdListFrom,
        positionIdList: target.positionIdList,
        tokenId: target.tokenId,
        blockNumber: targetBlockNumber,
      }),
    ),
  )

  const results: SettlePremiumBatchTargetResult[] = []
  const settleable: SettleSequenceTarget[] = []
  let unsettleableCount = 0
  let premium0 = 0n
  let premium1 = 0n

  simulations.forEach((sim, i) => {
    const simulation: SettlePremiumFromSimulation = sim.success
      ? sim.data
      : {
          premium0: 0n,
          premium1: 0n,
          settled0: 0n,
          settled1: 0n,
          canSettle: false,
          reason: sim.error.message,
        }
    results.push({ target: targets[i], simulation })

    if (simulation.canSettle) {
      settleable.push(targets[i])
      premium0 += simulation.premium0
      premium1 += simulation.premium1
    } else {
      unsettleableCount += 1
    }
  })

  const _meta = await metaPromise

  return { results, settleable, unsettleableCount, premium0, premium1, _meta }
}

/**
 * Result of simulating a full settle sequence.
 */
export interface SettleSequenceSimulation {
  /** Caller's net token 0 flow across the whole sequence */
  delta0: bigint
  /** Caller's net token 1 flow across the whole sequence */
  delta1: bigint
}

/**
 * Parameters for simulateSettleSequence.
 */
export interface SimulateSettleSequenceParams extends SettleSequenceCallsParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Caller (settler) account address */
  account: Address
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate a full settle sequence (all settles + optional close) as the one
 * multicall that `executeSettleSequence` submits, measuring the caller's
 * total token flow and gas.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with the caller's net flow, or error
 */
export async function simulateSettleSequence(
  params: SimulateSettleSequenceParams,
): Promise<SimulationResult<SettleSequenceSimulation>> {
  const { client, poolAddress, account, blockNumber } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  try {
    const calls = buildSettleSequenceCalls(params)

    // The sequence is submitted as PanopticPool.multicall(calls); nesting it
    // inside the flow-measuring multicall preserves identical semantics.
    const callData = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'multicall',
      args: [calls],
    })

    const flowResult = await simulateWithTokenFlow({
      client,
      poolAddress,
      user: account,
      callData,
      blockNumber: targetBlockNumber,
    })

    if (!flowResult.success || !flowResult.tokenFlow) {
      throw new PanopticError(flowResult.error || 'Simulation failed')
    }

    const _meta = await metaPromise
    const tokenFlow: TokenFlow = flowResult.tokenFlow

    return {
      success: true,
      data: { delta0: tokenFlow.delta0, delta1: tokenFlow.delta1 },
      gasEstimate: flowResult.gasEstimate,
      tokenFlow,
      _meta,
    }
  } catch (error) {
    const _meta = await metaPromise
    const errorMessage = error instanceof Error ? error.message : 'Simulation failed'
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
