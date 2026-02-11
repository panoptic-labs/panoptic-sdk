/**
 * Open position simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateOpenPosition
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import { calculatePositionGreeks } from '../greeks'
import { getPool } from '../reads/pool'
import { decodeTokenId } from '../tokenId/decode'
import type { OpenPositionSimulation, SimulationResult } from '../types'
import { simulateWithTokenFlow } from './tokenFlow'

/**
 * Parameters for simulating position opening.
 */
export interface SimulateOpenPositionParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Existing position IDs held by the account (before this mint) */
  existingPositionIds: bigint[]
  /** TokenId of position to open */
  tokenId: bigint
  /** Position size */
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
   * Whether to swap tokens at mint to achieve single-sided exposure.
   * When true, tickLimits are passed to dispatch in descending order (high, low).
   * When false (default), tickLimits are passed in ascending order (low, high).
   */
  swapAtMint?: boolean
  /** Whether to use premia as collateral */
  usePremiaAsCollateral?: boolean
  /** Builder code */
  builderCode?: bigint
  /** Chain ID (required for pool data fetch used in greeks) */
  chainId?: bigint
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate opening a position.
 *
 * Uses PanopticPool.multicall with getAssetsOf-dispatch-getAssetsOf pattern
 * to measure exact collateral asset movements, then enriches with decoded
 * position data and client-side greeks.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with position data or error
 *
 * @example
 * ```typescript
 * import { MIN_TICK, MAX_TICK } from '@panoptic/sdk'
 *
 * const result = await simulateOpenPosition({
 *   client,
 *   poolAddress,
 *   account,
 *   existingPositionIds: [],
 *   tokenId,
 *   positionSize: 1n,
 *   tickLimitLow: MIN_TICK,
 *   tickLimitHigh: MAX_TICK,
 *   swapAtMint: false,
 *   chainId: 11155111n, // Sepolia
 * })
 *
 * if (result.success) {
 *   console.log('Gas estimate:', result.gasEstimate)
 *   console.log('Token 0 required:', result.data.amount0Required)
 *   console.log('Token 1 required:', result.data.amount1Required)
 *   console.log('Delta:', result.data.greeks.delta)
 * } else {
 *   console.log('Error:', result.error)
 * }
 * ```
 */
export async function simulateOpenPosition(
  params: SimulateOpenPositionParams,
): Promise<SimulationResult<OpenPositionSimulation>> {
  const {
    client,
    poolAddress,
    account,
    existingPositionIds,
    tokenId,
    positionSize,
    tickLimitLow,
    tickLimitHigh,
    spreadLimit = 0n,
    swapAtMint = false,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    chainId,
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
    // Prepare position lists for dispatch:
    // - positionIdList: positions being minted in this call (just the new tokenId)
    // - finalPositionIdList: all positions the user will have after the mint
    const positionIdList = [tokenId]
    const finalPositionIdList = [...existingPositionIds, tokenId]

    // Encode dispatch call data
    const callData = encodeFunctionData({
      abi: panopticPoolAbi,
      functionName: 'dispatch',
      args: [
        positionIdList,
        finalPositionIdList,
        // ABI declares uint128 but TS only knows bigint — viem/abitype limitation
        [BigInt(positionSize) as unknown as bigint & { readonly __uint128: true }],
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

    // Decode tokenId to get legs and tick spacing
    const decoded = decodeTokenId(tokenId)

    // Fetch pool state for greeks (currentTick, tickSpacing) if chainId provided
    let currentTick = 0n
    let poolTickSpacing = decoded.tickSpacing
    let utilization0 = 0n
    let utilization1 = 0n

    if (chainId !== undefined) {
      try {
        const pool = await getPool({ client, poolAddress, chainId, blockNumber: targetBlockNumber })
        currentTick = pool.currentTick
        poolTickSpacing = pool.poolKey.tickSpacing
        utilization0 = pool.collateralTracker0.utilization
        utilization1 = pool.collateralTracker1.utilization
      } catch {
        // Pool fetch failed - use decoded tickSpacing, skip greeks
      }
    }

    // Calculate greeks if we have legs and pool data
    const greeks =
      decoded.legs.length > 0 && (chainId !== undefined || currentTick !== 0n)
        ? calculatePositionGreeks({
            legs: decoded.legs,
            currentTick,
            mintTick: currentTick, // At simulation time, mintTick = currentTick
            positionSize,
            poolTickSpacing,
          })
        : { value: 0n, delta: 0n, gamma: 0n }

    const _meta = await metaPromise

    // Map token flow to simulation fields:
    // Negative delta = user deposits (required), so amount required = -delta
    const amount0Required = -tokenFlow.delta0
    const amount1Required = -tokenFlow.delta1

    const data: OpenPositionSimulation = {
      position: {
        tokenId,
        positionSize,
        owner: account,
        poolAddress,
        legs: decoded.legs,
        poolUtilization0AtMint: utilization0,
        poolUtilization1AtMint: utilization1,
        tickAtMint: currentTick,
        timestampAtMint: _meta.blockTimestamp,
        blockNumberAtMint: _meta.blockNumber,
        swapAtMint,
        premiaOwed0: 0n,
        premiaOwed1: 0n,
        assetIndex: 0n,
        _meta,
      },
      greeks,
      amount0Required,
      amount1Required,
      postCollateral0: tokenFlow.balanceAfter0,
      postCollateral1: tokenFlow.balanceAfter1,
      postMarginExcess0: null, // Requires PanopticQuery.checkCollateral
      postMarginExcess1: null,
      commission0: null, // Embedded in contract logic, not extractable from token flow
      commission1: null,
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
