/**
 * Simulate and send a direct-SFPM covered call open or close.
 * @module v2/sfpmCoveredCall/execute
 */
import {
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
  type WalletClient,
  decodeFunctionResult,
} from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import { PanopticError, parsePanopticError } from '../errors'
import type { SimulationResult, TxOverrides, TxResult } from '../types'
import { decodeLeftRightSigned, decodeLeftRightUnsigned, submitWrite } from '../writes/utils'

/** An encoded SFPM multicall: an open from `planSfpmCoveredCallOpen` or a close. */
export interface SfpmCoveredCallCall {
  to: Address
  calls: Hex[]
}

export interface SfpmCoveredCallFlows {
  /** Net token0 the account pays (positive) or receives (negative), fees included. */
  amount0: bigint
  /** Net token1 the account pays (positive) or receives (negative), fees included. */
  amount1: bigint
  finalTick: bigint
}

export interface SimulateSfpmCoveredCallParams {
  client: PublicClient
  account: Address
  call: SfpmCoveredCallCall
  /** Overrides to simulate before the account is funded or has approved the SFPM. */
  stateOverride?: StateOverride
  blockNumber?: bigint
}

function toPanopticError(error: unknown): PanopticError {
  if (error instanceof PanopticError) return error
  const parsed = parsePanopticError(error)
  if (parsed) return parsed.error
  return new PanopticError(
    error instanceof Error ? error.message : 'SFPM covered call simulation failed',
    error instanceof Error ? error : undefined,
  )
}

/** Simulate the multicall as `account` and report the net token flows. */
export async function simulateSfpmCoveredCall(
  params: SimulateSfpmCoveredCallParams,
): Promise<SimulationResult<SfpmCoveredCallFlows>> {
  const { client, account, call, stateOverride, blockNumber } = params
  const _meta = await getBlockMeta({ client, blockNumber })
  try {
    const { result } = await client.simulateContract({
      account,
      address: call.to,
      abi: sfpmV3Abi,
      functionName: 'multicall',
      args: [call.calls],
      blockNumber: _meta.blockNumber,
      stateOverride,
    })
    const flows: SfpmCoveredCallFlows = { amount0: 0n, amount1: 0n, finalTick: 0n }
    for (const data of result) {
      // Mint and burn share one return shape: (collectedByLeg, totalMoved, finalTick).
      const [collectedByLeg, totalMoved, finalTick] = decodeFunctionResult({
        abi: sfpmV3Abi,
        functionName: 'mintTokenizedPosition',
        data,
      })
      const moved = decodeLeftRightSigned(totalMoved)
      flows.amount0 += moved.right
      flows.amount1 += moved.left
      for (const collected of collectedByLeg) {
        const fees = decodeLeftRightUnsigned(collected)
        flows.amount0 -= fees.right
        flows.amount1 -= fees.left
      }
      flows.finalTick = BigInt(finalTick)
    }
    return { success: true, data: flows, gasEstimate: 0n, _meta }
  } catch (error) {
    return { success: false, error: toPanopticError(error), _meta }
  }
}

export interface ExecuteSfpmCoveredCallParams {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  call: SfpmCoveredCallCall
  txOverrides?: TxOverrides
}

/** Send the multicall. Its only price protection is the tick band encoded in each call. */
export function executeSfpmCoveredCall(params: ExecuteSfpmCoveredCallParams): Promise<TxResult> {
  const { client, walletClient, account, call, txOverrides } = params
  return submitWrite({
    client,
    walletClient,
    account,
    address: call.to,
    abi: sfpmV3Abi,
    functionName: 'multicall',
    args: [call.calls],
    txOverrides,
  })
}
