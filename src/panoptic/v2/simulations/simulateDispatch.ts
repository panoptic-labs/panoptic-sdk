/**
 * Dispatch simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateDispatch
 */

import type { Address, Hex, PublicClient } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import type { DispatchSimulation, SimulationResult, TokenFlow } from '../types'
import type { TickAndSpreadLimits } from '../writes/position'
import { decodeLeftRightUnsigned } from '../writes/utils'
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
  /**
   * Operation list passed to `dispatch()` — one tokenId per batch item, in
   * operation order. Mints reference NEW tokenIds the user doesn't yet own,
   * so this list is NOT safe to read against pre-dispatch storage.
   */
  positionIdList: bigint[]
  /** Final position ID list after operations */
  finalPositionIdList: bigint[]
  /**
   * The user's actual on-chain `positionIdList` BEFORE dispatch. Required to
   * populate `preMarginExcess0/1` (read via a pre-dispatch
   * `getFullPositionsData` chained in the same multicall). When omitted,
   * `preMarginExcess0/1` are returned as `null`.
   */
  existingPositionIdList?: bigint[]
  /** Position sizes for each operation */
  positionSizes: bigint[]
  /** Tick and spread limits for each operation */
  tickAndSpreadLimits: TickAndSpreadLimits[]
  /** Whether to use premia as collateral */
  usePremiaAsCollateral?: boolean
  /** Builder code */
  builderCode?: bigint
  /** Capture aggregate settled premia from atomic pre/post position snapshots. */
  measurePremia?: boolean
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
    existingPositionIdList,
    measurePremia = false,
  } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  try {
    // Encode dispatch call data
    const callData = encodeFunctionData({
      abi: panopticPoolV2Abi,
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

    // Encode getFullPositionsData against the pre-dispatch (caller-supplied
    // existing list) and post-dispatch (finalPositionIdList) position lists.
    // Running both in the same multicall — pre-call before dispatch, post-call
    // after — lets the simulation report margin excess (= assets - required
    // collateral) on both sides atomically. Required collateral is summed
    // across the per-position LeftRightUnsigned entries.
    //
    // The pre-call uses `existingPositionIdList` (the user's actual storage
    // list), NOT `positionIdList` (the operation list, which contains
    // not-yet-minted tokenIds and would revert with PositionNotOwned).
    const preFullPositionsCallData =
      existingPositionIdList !== undefined
        ? encodeFunctionData({
            abi: panopticPoolV2Abi,
            functionName: 'getFullPositionsData',
            args: [account, false, existingPositionIdList],
          })
        : undefined
    const prePremiaCallData =
      measurePremia && existingPositionIdList !== undefined
        ? encodeFunctionData({
            abi: panopticPoolV2Abi,
            functionName: 'getFullPositionsData',
            args: [account, true, existingPositionIdList],
          })
        : undefined
    const postFullPositionsCallData = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'getFullPositionsData',
      args: [account, false, finalPositionIdList],
    })
    const postPremiaCallData = measurePremia
      ? encodeFunctionData({
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          args: [account, true, finalPositionIdList],
        })
      : undefined

    // Simulate with token flow measurement using PanopticPool.multicall + getAssetsOf
    const flowResult = await simulateWithTokenFlow({
      client,
      poolAddress,
      user: account,
      callData,
      blockNumber: targetBlockNumber,
      preCallData: preFullPositionsCallData
        ? [preFullPositionsCallData, ...(prePremiaCallData ? [prePremiaCallData] : [])]
        : undefined,
      postCallData: [
        postFullPositionsCallData,
        ...(postPremiaCallData ? [postPremiaCallData] : []),
      ],
    })

    if (!flowResult.success || !flowResult.tokenFlow) {
      throw (
        flowResult.rawError ?? new PanopticError(flowResult.error || 'Token flow simulation failed')
      )
    }

    const tokenFlow: TokenFlow = flowResult.tokenFlow

    // Determine which positions were created/closed by diffing the post-dispatch
    // list against the pre-dispatch on-chain snapshot. `positionIdList` is the
    // operation list (which contains not-yet-minted tokenIds and excludes
    // unaffected pre-existing ones), so it can't be used as the "before" set.
    const preSnapshot = existingPositionIdList ?? []
    const positionsCreated = finalPositionIdList.filter((id) => !preSnapshot.includes(id))
    const positionsClosed = preSnapshot.filter((id) => !finalPositionIdList.includes(id))

    // Decode the atomic position snapshots around dispatch. Aggregate premia
    // stays separate from token flow, which may also include swaps and
    // commissions in a wrapped recovery transaction.
    const decodeFullPositions = (
      data: Hex | undefined,
    ): {
      collateralRequirements0: bigint
      collateralRequirements1: bigint
      netPremia0: bigint
      netPremia1: bigint
    } | null => {
      if (!data) return null
      try {
        const decoded = decodeFunctionResult({
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          data,
        })
        const shortPremium = decodeLeftRightUnsigned(decoded[0])
        const longPremium = decodeLeftRightUnsigned(decoded[1])
        const reqs = decoded[3] // collateralRequirements
        let collateralRequirements0 = 0n
        let collateralRequirements1 = 0n
        for (const packed of reqs) {
          const r = decodeLeftRightUnsigned(packed)
          collateralRequirements0 += r.right
          collateralRequirements1 += r.left
        }
        return {
          collateralRequirements0,
          collateralRequirements1,
          netPremia0: shortPremium.right - longPremium.right,
          netPremia1: shortPremium.left - longPremium.left,
        }
      } catch {
        return null
      }
    }

    const prePositions = decodeFullPositions(flowResult.preCallResults?.[0])
    const postPositions = decodeFullPositions(flowResult.postCallResults?.[0])
    const prePremia = decodeFullPositions(flowResult.preCallResults?.[1])
    const postPremia = decodeFullPositions(flowResult.postCallResults?.[1])

    const _meta = await metaPromise

    // Build simulation result with actual token flow data
    const data: DispatchSimulation = {
      netAmount0: tokenFlow.delta0,
      netAmount1: tokenFlow.delta1,
      premiaReceived0:
        prePremia !== null && postPremia !== null
          ? prePremia.netPremia0 - postPremia.netPremia0
          : null,
      premiaReceived1:
        prePremia !== null && postPremia !== null
          ? prePremia.netPremia1 - postPremia.netPremia1
          : null,
      positionsCreated,
      positionsClosed,
      postCollateral0: tokenFlow.balanceAfter0,
      postCollateral1: tokenFlow.balanceAfter1,
      preMarginExcess0:
        prePositions === null
          ? null
          : tokenFlow.balanceBefore0 - prePositions.collateralRequirements0,
      preMarginExcess1:
        prePositions === null
          ? null
          : tokenFlow.balanceBefore1 - prePositions.collateralRequirements1,
      postMarginExcess0:
        postPositions === null
          ? null
          : tokenFlow.balanceAfter0 - postPositions.collateralRequirements0,
      postMarginExcess1:
        postPositions === null
          ? null
          : tokenFlow.balanceAfter1 - postPositions.collateralRequirements1,
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
