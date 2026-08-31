/**
 * Settle premium (on another account) simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateSettlePremiumFrom
 */

import type { Address, Hex, PublicClient } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import type { SettlePremiumFromSimulation, SimulationResult, TokenFlow } from '../types'
import { orderListForSettle } from '../writes/settlePremiumFrom'
import { decodeLeftRightUnsigned } from '../writes/utils'
import { simulateWithTokenFlow } from './tokenFlow'

/**
 * Parameters for simulating settling another account's long premium.
 */
export interface SimulateSettlePremiumFromParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Caller (settler) account address */
  account: Address
  /** Account whose long premium is being settled */
  user: Address
  /** Position IDs from the caller's account (full held list) */
  positionIdListFrom: bigint[]
  /** The target user's full held position ID list (passed as both To and ToFinal) */
  positionIdList: bigint[]
  /** The target position to settle; reordered to the end of the list when provided */
  tokenId?: bigint
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/** Soft-failure revert markers for settle premium (target-state issues, not caller errors). */
const SOFT_FAILURES: Array<{ marker: string; reason: string }> = [
  { marker: 'AccountInsolvent', reason: 'Target account is insolvent; premium cannot be settled' },
  { marker: 'PositionNotOwned', reason: 'Target account no longer owns the position' },
  { marker: 'StaleOracle', reason: 'Oracle price is stale; settlement temporarily unavailable' },
  { marker: 'InputListFail', reason: 'Position list is stale (target positions changed)' },
]

/**
 * Simulate settling another account's accumulated long premium via `dispatchFrom`
 * (equal-length `positionIdListTo`/`positionIdListToFinal` selects the settle mode).
 *
 * The measured token flow is the CALLER's collateral delta — i.e. the premium
 * the caller receives from the settlement (for chunks they sold).
 *
 * @param params - Simulation parameters
 * @returns Simulation result with settled premium data or error
 */
export async function simulateSettlePremiumFrom(
  params: SimulateSettlePremiumFromParams,
): Promise<SimulationResult<SettlePremiumFromSimulation>> {
  const {
    client,
    poolAddress,
    account,
    user,
    positionIdListFrom,
    positionIdList,
    tokenId,
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
    tickBefore: null,
    tickAfter: null,
  }

  const softFailure = (errorMessage: string): SettlePremiumFromSimulation | null => {
    const match = SOFT_FAILURES.find(({ marker }) => errorMessage.includes(marker))
    return match
      ? {
          premium0: 0n,
          premium1: 0n,
          settled0: 0n,
          settled1: 0n,
          canSettle: false,
          reason: match.reason,
        }
      : null
  }

  try {
    const orderedList =
      tokenId !== undefined ? orderListForSettle(positionIdList, tokenId) : positionIdList

    // Encode dispatchFrom call data (to == toFinal selects settle-premium mode)
    const callData = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'dispatchFrom',
      args: [positionIdListFrom, user, orderedList, orderedList, 0n],
    })

    // Settling does NOT move assets into the seller's collateral — the buyer
    // pays into the chunk and the seller's premium becomes AVAILABLE to
    // collect (realized at their own burn/settle). So the settled amount is
    // measured as the change in the caller's available short premium
    // (includePendingPremium=false), read before and after the settle within
    // the same multicall. The getAssetsOf token flow is kept only for gas and
    // incidental dust.
    const availablePremiumCallData = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'getFullPositionsData',
      args: [account, false, positionIdListFrom],
    })

    // Total settled = drop in the buyer's owed long premium (pending
    // included): everything the buyer pays into the chunk, across all its
    // sellers — not just the caller's share.
    const buyerOwedCallData = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'getFullPositionsData',
      args: [user, true, orderedList],
    })

    // Simulate with token flow measurement using PanopticPool.multicall + getAssetsOf
    const flowResult = await simulateWithTokenFlow({
      client,
      poolAddress,
      user: account,
      callData,
      blockNumber: targetBlockNumber,
      preCallData: [availablePremiumCallData, buyerOwedCallData],
      postCallData: [availablePremiumCallData, buyerOwedCallData],
    })

    if (!flowResult.success || !flowResult.tokenFlow) {
      const errorMessage = flowResult.error || 'Simulation failed'
      const soft = softFailure(errorMessage)
      if (soft) {
        const _meta = await metaPromise
        return { success: true, data: soft, gasEstimate: 0n, tokenFlow: emptyTokenFlow, _meta }
      }
      throw new PanopticError(errorMessage)
    }

    const _meta = await metaPromise
    const tokenFlow: TokenFlow = flowResult.tokenFlow

    // Decode a getFullPositionsData result to its packed premium slots
    const decodePremia = (
      raw: Hex,
    ): { short0: bigint; short1: bigint; long0: bigint; long1: bigint } => {
      const [shortPremiumPacked, longPremiumPacked] = decodeFunctionResult({
        abi: panopticPoolV2Abi,
        functionName: 'getFullPositionsData',
        data: raw,
      })
      const short = decodeLeftRightUnsigned(shortPremiumPacked)
      const long = decodeLeftRightUnsigned(longPremiumPacked)
      return { short0: short.right, short1: short.left, long0: long.right, long1: long.left }
    }

    // Caller's available short premium delta = premium the settle unlocked
    let premium0 = 0n
    let premium1 = 0n
    const preRaw = flowResult.preCallResults?.[0]
    const postRaw = flowResult.postCallResults?.[0]
    if (preRaw !== undefined && postRaw !== undefined) {
      const pre = decodePremia(preRaw)
      const post = decodePremia(postRaw)
      premium0 = post.short0 > pre.short0 ? post.short0 - pre.short0 : 0n
      premium1 = post.short1 > pre.short1 ? post.short1 - pre.short1 : 0n
    }

    // Buyer's owed long premium drop = total premium settled into the chunk
    let settled0 = 0n
    let settled1 = 0n
    const preBuyerRaw = flowResult.preCallResults?.[1]
    const postBuyerRaw = flowResult.postCallResults?.[1]
    if (preBuyerRaw !== undefined && postBuyerRaw !== undefined) {
      const pre = decodePremia(preBuyerRaw)
      const post = decodePremia(postBuyerRaw)
      settled0 = pre.long0 > post.long0 ? pre.long0 - post.long0 : 0n
      settled1 = pre.long1 > post.long1 ? pre.long1 - post.long1 : 0n
    }

    const data: SettlePremiumFromSimulation = {
      premium0,
      premium1,
      settled0,
      settled1,
      canSettle: true,
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
    const errorMessage = error instanceof Error ? error.message : 'Simulation failed'

    const soft = softFailure(errorMessage)
    if (soft) {
      return { success: true, data: soft, gasEstimate: 0n, tokenFlow: emptyTokenFlow, _meta }
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
