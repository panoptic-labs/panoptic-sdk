/**
 * Settle simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateSettle
 */

import type { Address, Hex, PublicClient } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import { getCurrentPositionSizes } from '../reads/positionSizes'
import type { SettleSimulation, SimulationResult, TokenFlow } from '../types'
import { simulateWithTokenFlow } from './tokenFlow'

/** BIT_MASK_128 = (1n << 128n) - 1n */
const BIT_MASK_128 = (1n << 128n) - 1n

/**
 * PanopticPool multicall ABI (inherited from Uniswap).
 */
const multicallAbi = [
  {
    type: 'function',
    name: 'multicall',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
    stateMutability: 'nonpayable',
  },
] as const

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
  /** TokenIds to settle in this dispatch (subset of the account's held list). */
  positionIdList: bigint[]
  /**
   * Full held tokenId list AFTER dispatch (must hash-match s_positionsHash).
   * Defaults to `positionIdList` — correct only when settling ALL held
   * positions.
   */
  finalPositionIdList?: bigint[]
  /**
   * Current stored positionSize for each tokenId in `positionIdList`. When
   * omitted, sizes are read on-chain. Must match `positionIdList` order —
   * anything other than the stored size will simulate a BURN, not a settle.
   */
  positionSizes?: bigint[]
  /** Optional tokenId to compute forfeit amounts for */
  tokenId?: bigint
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate premium settlement.
 *
 * When `tokenId` is provided, the simulation also computes forfeit amounts
 * by chaining the dispatch with `getFullPositionsData` reads
 * in a single multicall.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with settlement data or error
 */
export async function simulateSettle(
  params: SimulateSettleParams,
): Promise<SimulationResult<SettleSimulation>> {
  const {
    client,
    poolAddress,
    account,
    positionIdList,
    finalPositionIdList,
    positionSizes: providedSizes,
    tokenId,
    blockNumber,
  } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  try {
    if (providedSizes && providedSizes.length !== positionIdList.length) {
      throw new PanopticError('simulateSettle: positionSizes length must match positionIdList')
    }
    // Must be current stored sizes — dispatch treats any mismatch (incl. 0) as a burn.
    // OLD (buggy): const positionSizes = positionIdList.map(() => 0n)
    const positionSizes =
      providedSizes ??
      (await getCurrentPositionSizes({
        client,
        poolAddress,
        account,
        positionIdList,
        blockNumber: targetBlockNumber,
      }))
    const tickAndSpreadLimits = positionIdList.map(() => [-887272n, 887272n, 0n] as const)

    // Encode dispatch call data
    const callData = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'dispatch',
      args: [
        positionIdList,
        finalPositionIdList ?? positionIdList,
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
      throw (
        flowResult.rawError ?? new PanopticError(flowResult.error || 'Token flow simulation failed')
      )
    }

    const tokenFlow: TokenFlow = flowResult.tokenFlow

    // Compute forfeit amounts if tokenId is provided
    let forfeitAmounts: [bigint, bigint] | undefined
    if (tokenId !== undefined) {
      forfeitAmounts = await computeForfeitAmounts({
        client,
        poolAddress,
        account,
        positionIdList,
        tokenId,
        dispatchCallData: callData,
        blockNumber: targetBlockNumber,
      })
    }

    const _meta = await metaPromise

    // Signed flow: positive = collected, negative = paid.
    const data: SettleSimulation = {
      premiaReceived0: tokenFlow.delta0,
      premiaReceived1: tokenFlow.delta1,
      postCollateral0: tokenFlow.balanceAfter0,
      postCollateral1: tokenFlow.balanceAfter1,
      forfeitAmounts,
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

/**
 * Compute forfeit amounts by chaining dispatch + getFullPositionsData
 * in a single PanopticPool.multicall.
 */
async function computeForfeitAmounts(params: {
  client: PublicClient
  poolAddress: Address
  account: Address
  positionIdList: bigint[]
  tokenId: bigint
  dispatchCallData: Hex
  blockNumber: bigint
}): Promise<[bigint, bigint]> {
  const { client, poolAddress, account, tokenId, dispatchCallData, blockNumber } = params

  // Encode getFullPositionsData calls (available = false, total = true)
  const feesCallAvailable = encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    args: [account, false, [tokenId]],
  })
  const feesCallTotal = encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    args: [account, true, [tokenId]],
  })

  try {
    // Chain: dispatch (settle) + fees(available) + fees(total) in one multicall
    const { result } = await client.simulateContract({
      address: poolAddress,
      abi: multicallAbi,
      functionName: 'multicall',
      args: [[dispatchCallData, feesCallAvailable, feesCallTotal]],
      account,
      blockNumber,
    })

    // Decode the two fee reads (result[0] is dispatch, result[1] and result[2] are fees)
    const decodeFeesResult = (data: Hex): bigint => {
      return decodeFunctionResult({
        abi: panopticPoolV2Abi,
        functionName: 'getFullPositionsData',
        data,
      })[0]
    }

    const availablePremium = decodeFeesResult(result[1])
    const totalPremium = decodeFeesResult(result[2])

    const available0 = availablePremium & BIT_MASK_128
    const available1 = availablePremium >> 128n
    const total0 = totalPremium & BIT_MASK_128
    const total1 = totalPremium >> 128n

    return [total0 - available0, total1 - available1]
  } catch (error) {
    throw new PanopticError(
      'Forfeit amount computation failed',
      error instanceof Error ? error : undefined,
    )
  }
}
