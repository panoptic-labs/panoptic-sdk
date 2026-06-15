/**
 * Swap simulation for the Panoptic v2 SDK.
 * @module v2/simulations/simulateSwap
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError, SwapTokenMismatchError } from '../errors'
import { tickLimits } from '../formatters/tick'
import { getPool } from '../reads/pool'
import { createTokenIdBuilder } from '../tokenId/builder'
import type { SimulationResult, TokenFlow } from '../types'
import { simulateWithTokenFlow } from './tokenFlow'

/**
 * Swap simulation data.
 */
export interface SwapSimulation {
  /** Amount of tokenIn spent (positive) */
  amountIn: bigint
  /** Amount of tokenOut received (positive) */
  amountOut: bigint
  /** Raw token flow from the simulation */
  tokenFlow: TokenFlow
}

/**
 * Parameters for simulateSwapExactOut.
 */
export interface SimulateSwapExactOutParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Chain ID */
  chainId: bigint
  /** Token address to receive */
  tokenOut: Address
  /** Exact amount of tokenOut */
  amountOut: bigint
  /** Slippage tolerance in bps */
  slippageBps: bigint
  /** Existing position IDs */
  existingPositionIds: bigint[]
  /** Optional block number */
  blockNumber?: bigint
}

/**
 * Parameters for simulateSwapExactIn.
 */
export interface SimulateSwapExactInParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Chain ID */
  chainId: bigint
  /** Token address to sell */
  tokenIn: Address
  /** Exact amount of tokenIn */
  amountIn: bigint
  /** Slippage tolerance in bps */
  slippageBps: bigint
  /** Existing position IDs */
  existingPositionIds: bigint[]
  /** Optional block number */
  blockNumber?: bigint
}

/**
 * Resolve token index, throwing SwapTokenMismatchError on mismatch.
 */
function resolveTokenIndex(tokenAddress: Address, token0: Address, token1: Address): bigint {
  const lower = tokenAddress.toLowerCase()
  if (lower === token0.toLowerCase()) return 0n
  if (lower === token1.toLowerCase()) return 1n
  throw new SwapTokenMismatchError(tokenAddress, token0, token1)
}

/**
 * Build a unique loan tokenId.
 */
function buildUniqueLoan(
  poolId: bigint,
  asset: bigint,
  tokenType: bigint,
  currentTick: bigint,
  tickSpacing: bigint,
  existingPositionIds: bigint[],
): bigint {
  const mod = currentTick % tickSpacing
  let strike = currentTick - ((mod + tickSpacing) % tickSpacing)
  const step = tickSpacing
  const existingSet = new Set(existingPositionIds)

  for (let attempt = 0; attempt < 1000; attempt++) {
    const tokenId = createTokenIdBuilder(poolId).addLoan({ asset, tokenType, strike }).build()

    if (!existingSet.has(tokenId)) {
      return tokenId
    }
    strike += step
  }

  throw new PanopticError('Could not build unique loan tokenId after 1000 attempts')
}

/**
 * Build dispatch calldata for swap simulation.
 */
function buildSwapCallData(
  loanTokenId: bigint,
  existingPositionIds: bigint[],
  amount: bigint,
  mintTickLimits: readonly [number, number, number],
  burnTickLimits: readonly [number, number, number],
): `0x${string}` {
  return encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [
      [loanTokenId, loanTokenId],
      [...existingPositionIds],
      [amount, 0n],
      [mintTickLimits, burnTickLimits],
      false,
      0n,
    ],
  })
}

/**
 * Build SwapSimulation from token flow, given which token index is "out".
 */
function buildSwapResult(tokenFlow: TokenFlow, tokenOutIndex: bigint): SwapSimulation {
  // delta is negative when user deposits, positive when user receives
  // For a swap: one delta should be negative (spent) and one positive (received)
  const delta0 = tokenFlow.delta0
  const delta1 = tokenFlow.delta1

  if (tokenOutIndex === 0n) {
    return {
      amountOut: delta0 > 0n ? delta0 : -delta0,
      amountIn: delta1 < 0n ? -delta1 : delta1,
      tokenFlow,
    }
  } else {
    return {
      amountOut: delta1 > 0n ? delta1 : -delta1,
      amountIn: delta0 < 0n ? -delta0 : delta0,
      tokenFlow,
    }
  }
}

/**
 * Simulate an exact-output swap.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with swap data or error
 */
export async function simulateSwapExactOut(
  params: SimulateSwapExactOutParams,
): Promise<SimulationResult<SwapSimulation>> {
  const {
    client,
    poolAddress,
    account,
    chainId,
    tokenOut,
    amountOut,
    slippageBps,
    existingPositionIds,
    blockNumber,
  } = params

  try {
    const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
    const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

    const pool = await getPool({ client, poolAddress, chainId, blockNumber: targetBlockNumber })
    const token0 = pool.collateralTracker0.token
    const token1 = pool.collateralTracker1.token
    const tokenOutIndex = resolveTokenIndex(tokenOut, token0, token1)
    const tokenType = tokenOutIndex === 0n ? 1n : 0n

    const { low: tickLimitLow, high: tickLimitHigh } = tickLimits(pool.currentTick, slippageBps)

    const loanTokenId = buildUniqueLoan(
      pool.poolId,
      tokenOutIndex,
      tokenType,
      pool.currentTick,
      pool.tickSpacing,
      existingPositionIds,
    )

    // Mint: swapAtMint=true (descending), Burn: swapAtMint=false (ascending)
    const mintTickLimits: readonly [number, number, number] = [
      Number(tickLimitHigh),
      Number(tickLimitLow),
      0,
    ]
    const burnTickLimits: readonly [number, number, number] = [
      Number(tickLimitLow),
      Number(tickLimitHigh),
      0,
    ]

    const callData = buildSwapCallData(
      loanTokenId,
      existingPositionIds,
      amountOut,
      mintTickLimits,
      burnTickLimits,
    )

    const flowResult = await simulateWithTokenFlow({
      client,
      poolAddress,
      user: account,
      callData,
      blockNumber: targetBlockNumber,
    })

    if (!flowResult.success || !flowResult.tokenFlow) {
      throw flowResult.rawError ?? new PanopticError(flowResult.error || 'Swap simulation failed')
    }

    const _meta = await metaPromise
    const data = buildSwapResult(flowResult.tokenFlow, tokenOutIndex)

    return {
      success: true,
      data,
      gasEstimate: flowResult.gasEstimate,
      tokenFlow: flowResult.tokenFlow,
      _meta,
    }
  } catch (error) {
    // Build a fallback _meta if getBlockMeta also failed
    const fallbackMeta = { blockNumber: 0n, blockTimestamp: 0n, blockHash: '0x0' as `0x${string}` }
    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(
              error instanceof Error ? error.message : 'Simulation failed',
              error instanceof Error ? error : undefined,
            ),
      _meta: fallbackMeta,
    }
  }
}

/**
 * Simulate an exact-input swap.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with swap data or error
 */
export async function simulateSwapExactIn(
  params: SimulateSwapExactInParams,
): Promise<SimulationResult<SwapSimulation>> {
  const {
    client,
    poolAddress,
    account,
    chainId,
    tokenIn,
    amountIn,
    slippageBps,
    existingPositionIds,
    blockNumber,
  } = params

  try {
    const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
    const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

    const pool = await getPool({ client, poolAddress, chainId, blockNumber: targetBlockNumber })
    const token0 = pool.collateralTracker0.token
    const token1 = pool.collateralTracker1.token
    const tokenInIndex = resolveTokenIndex(tokenIn, token0, token1)
    const tokenType = tokenInIndex

    const { low: tickLimitLow, high: tickLimitHigh } = tickLimits(pool.currentTick, slippageBps)

    const loanTokenId = buildUniqueLoan(
      pool.poolId,
      tokenInIndex,
      tokenType,
      pool.currentTick,
      pool.tickSpacing,
      existingPositionIds,
    )

    // Mint: swapAtMint=false (ascending), Burn: swapAtMint=true (descending)
    const mintTickLimits: readonly [number, number, number] = [
      Number(tickLimitLow),
      Number(tickLimitHigh),
      0,
    ]
    const burnTickLimits: readonly [number, number, number] = [
      Number(tickLimitHigh),
      Number(tickLimitLow),
      0,
    ]

    // tokenOut is the OTHER token
    const tokenOutIndex = tokenInIndex === 0n ? 1n : 0n

    const callData = buildSwapCallData(
      loanTokenId,
      existingPositionIds,
      amountIn,
      mintTickLimits,
      burnTickLimits,
    )

    const flowResult = await simulateWithTokenFlow({
      client,
      poolAddress,
      user: account,
      callData,
      blockNumber: targetBlockNumber,
    })

    if (!flowResult.success || !flowResult.tokenFlow) {
      throw flowResult.rawError ?? new PanopticError(flowResult.error || 'Swap simulation failed')
    }

    const _meta = await metaPromise
    const data = buildSwapResult(flowResult.tokenFlow, tokenOutIndex)

    return {
      success: true,
      data,
      gasEstimate: flowResult.gasEstimate,
      tokenFlow: flowResult.tokenFlow,
      _meta,
    }
  } catch (error) {
    const fallbackMeta = { blockNumber: 0n, blockTimestamp: 0n, blockHash: '0x0' as `0x${string}` }
    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(
              error instanceof Error ? error.message : 'Simulation failed',
              error instanceof Error ? error : undefined,
            ),
      _meta: fallbackMeta,
    }
  }
}
