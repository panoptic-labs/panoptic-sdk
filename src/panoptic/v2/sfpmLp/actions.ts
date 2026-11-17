/**
 * Direct-LP lifecycle on the v3 SFPM: prepare calldata, simulate, and write.
 * @module v2/sfpmLp/actions
 */
import {
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
  type WalletClient,
  decodeFunctionResult,
  encodeFunctionData,
} from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import {
  InvalidTickLimitsError,
  PanopticError,
  PanopticValidationError,
  parsePanopticError,
} from '../errors'
import { encodeV3PoolKeyBytes } from '../simulations/sfpm'
import type { SimulationResult, TxOverrides, TxResult } from '../types'
import { decodeLeftRightSigned, decodeLeftRightUnsigned, submitWrite } from '../writes/utils'
import {
  type SfpmLpRange,
  buildSfpmLpTokenId,
  decodeSfpmLpLegs,
  minSfpmLpPositionSize,
  planSfpmLpBurn,
} from './position'
import { getSfpmLpPosition } from './reads'

/** What to do with a direct-LP position. */
export type SfpmLpAction =
  /** Add `positionSize` contracts; creates the position if the account holds none. */
  | { kind: 'increase'; positionSize: bigint }
  /** Remove `positionSize` contracts. */
  | { kind: 'decrease'; positionSize: bigint }
  /** Remove the account's whole balance. */
  | { kind: 'close' }
  /** Pay out the pending fees of every chunk in the position without changing its size. */
  | { kind: 'collect' }

/** The position an action applies to, and the price bounds it must settle within. */
export interface SfpmLpTarget {
  /** SemiFungiblePositionManagerV3 address */
  sfpmAddress: Address
  /** Underlying Uniswap v3 pool */
  poolAddress: Address
  /** Direct-LP token ID from {@link buildSfpmLpTokenId} */
  tokenId: bigint
  /** The transaction reverts unless the pool tick ends strictly above this. */
  tickLimitLow: bigint
  /** The transaction reverts unless the pool tick ends strictly below this. */
  tickLimitHigh: bigint
}

/** One mint or burn inside a direct-LP multicall. */
export interface SfpmLpStep {
  functionName: 'mintTokenizedPosition' | 'burnTokenizedPosition'
  size: bigint
  /** Encoded call, as passed to `multicall`. */
  data: Hex
}

/** An encoded direct-LP action: one atomic `SFPM.multicall`. */
export interface SfpmLpCall {
  /** The SFPM address */
  to: Address
  /** `multicall(bytes[])` calldata */
  data: Hex
  /** The mint and burn steps inside the multicall, in order. */
  steps: SfpmLpStep[]
  /**
   * Contracts a decrease or close has to leave behind because they round to
   * more liquidity than the position's chunks hold. Zero in the common case.
   */
  unburnableSize: bigint
}

export interface PrepareSfpmLpCallParams extends SfpmLpTarget {
  client: PublicClient
  /** The caller: the address that funds mints and receives burns and fees. */
  account: Address
  action: SfpmLpAction
  /** Block to read the position at (defaults to latest). */
  blockNumber?: bigint
}

function encodeSfpmLpCall(
  target: SfpmLpTarget,
  sizedSteps: Omit<SfpmLpStep, 'data'>[],
  unburnableSize = 0n,
): SfpmLpCall {
  const { tickLimitLow, tickLimitHigh } = target
  // Inverted limits would make the SFPM swap the position to one token.
  if (tickLimitLow >= tickLimitHigh) throw new InvalidTickLimitsError(tickLimitLow, tickLimitHigh)

  const poolKey = encodeV3PoolKeyBytes(target.poolAddress)
  const steps = sizedSteps.map(({ functionName, size }) => ({
    functionName,
    size,
    data: encodeFunctionData({
      abi: sfpmV3Abi,
      functionName,
      args: [poolKey, target.tokenId, size, Number(tickLimitLow), Number(tickLimitHigh)],
    }),
  }))
  return {
    to: target.sfpmAddress,
    data: encodeFunctionData({
      abi: sfpmV3Abi,
      functionName: 'multicall',
      args: [steps.map((step) => step.data)],
    }),
    steps,
    unburnableSize,
  }
}

/**
 * Encode a direct-LP action for `account`. Reads the position when the action
 * depends on it (decrease, close, collect).
 *
 * The account must have approved the SFPM for both pool tokens before any
 * action that mints (increase, collect).
 */
export async function prepareSfpmLpCall(params: PrepareSfpmLpCallParams): Promise<SfpmLpCall> {
  const { action, tokenId } = params
  const legs = decodeSfpmLpLegs(tokenId)
  const minSize = minSfpmLpPositionSize(legs)

  if (action.kind === 'increase') {
    if (action.positionSize < minSize) {
      throw new PanopticValidationError(
        `position size ${action.positionSize} rounds to zero liquidity in at least one range; the minimum is ${minSize}`,
      )
    }
    return encodeSfpmLpCall(params, [
      { functionName: 'mintTokenizedPosition', size: action.positionSize },
    ])
  }

  const position = await getSfpmLpPosition(params)
  const netLiquidities = position.legs.map((leg) => leg.chunk.netLiquidity)

  if (action.kind === 'collect') {
    if (netLiquidities.some((liquidity) => liquidity === 0n)) {
      throw new PanopticValidationError(
        `account ${params.account} has no liquidity in at least one range of token ID ${tokenId}; there are no fees to collect`,
      )
    }
    return encodeSfpmLpCall(params, [
      { functionName: 'mintTokenizedPosition', size: minSize },
      { functionName: 'burnTokenizedPosition', size: minSize },
    ])
  }

  const burnSize = action.kind === 'close' ? position.positionSize : action.positionSize
  if (burnSize <= 0n || burnSize > position.positionSize) {
    throw new PanopticValidationError(
      `cannot burn ${burnSize} contracts of token ID ${tokenId}: account ${params.account} holds ${position.positionSize}`,
    )
  }
  const { burnSizes, unburnableSize } = planSfpmLpBurn(legs, netLiquidities, burnSize)
  if (burnSizes.length === 0) {
    throw new PanopticValidationError(
      `${burnSize} contracts of token ID ${tokenId} round to more liquidity than account ${params.account} holds in its ranges`,
    )
  }
  return encodeSfpmLpCall(
    params,
    burnSizes.map((size) => ({ functionName: 'burnTokenizedPosition', size })),
    unburnableSize,
  )
}

/** Outcome of a simulated direct-LP action. */
export interface SfpmLpSimulation {
  call: SfpmLpCall
  /** Net token0 the account pays (positive) or receives (negative), fees included. */
  amount0: bigint
  /** Net token1 the account pays (positive) or receives (negative), fees included. */
  amount1: bigint
  /** Uniswap fees paid out to the account by this action. */
  fees0: bigint
  fees1: bigint
  /** Pool tick after the action. */
  finalTick: bigint
}

export interface SimulateSfpmLpParams extends PrepareSfpmLpCallParams {
  /** Overrides to simulate before the account is funded or has approved the SFPM. */
  stateOverride?: StateOverride
}

function toPanopticError(error: unknown): PanopticError {
  if (error instanceof PanopticError) return error
  const parsed = parsePanopticError(error)
  if (parsed) return parsed.error
  return new PanopticError(
    error instanceof Error ? error.message : 'SFPM direct-LP simulation failed',
    error instanceof Error ? error : undefined,
  )
}

/** Simulate a direct-LP action as `account` and report the resulting token flows. */
export async function simulateSfpmLp(
  params: SimulateSfpmLpParams,
): Promise<SimulationResult<SfpmLpSimulation>> {
  const { client, account, stateOverride, blockNumber } = params
  const _meta = await getBlockMeta({ client, blockNumber })

  try {
    const call = await prepareSfpmLpCall({ ...params, blockNumber: _meta.blockNumber })
    const { data } = await client.call({
      account,
      to: call.to,
      data: call.data,
      blockNumber: _meta.blockNumber,
      stateOverride,
    })
    if (data === undefined) throw new PanopticError('SFPM direct-LP simulation returned no data')

    const results = decodeFunctionResult({ abi: sfpmV3Abi, functionName: 'multicall', data })
    const simulation: SfpmLpSimulation = {
      call,
      amount0: 0n,
      amount1: 0n,
      fees0: 0n,
      fees1: 0n,
      finalTick: 0n,
    }
    call.steps.forEach((step, i) => {
      const result = results[i]
      if (result === undefined) throw new PanopticError('SFPM multicall returned too few results')
      const [collectedByLeg, totalMoved, finalTick] = decodeFunctionResult({
        abi: sfpmV3Abi,
        functionName: step.functionName,
        data: result,
      })
      const moved = decodeLeftRightSigned(totalMoved)
      simulation.amount0 += moved.right
      simulation.amount1 += moved.left
      for (const collected of collectedByLeg) {
        const fees = decodeLeftRightUnsigned(collected)
        simulation.fees0 += fees.right
        simulation.fees1 += fees.left
      }
      simulation.finalTick = BigInt(finalTick)
    })
    simulation.amount0 -= simulation.fees0
    simulation.amount1 -= simulation.fees1

    return { success: true, data: simulation, gasEstimate: 0n, _meta }
  } catch (error) {
    return { success: false, error: toPanopticError(error), _meta }
  }
}

interface SfpmLpWriteParams extends SfpmLpTarget {
  client: PublicClient
  walletClient: WalletClient
  /** The caller: funds mints and receives burns and fees. */
  account: Address
  txOverrides?: TxOverrides
}

/** A sent burn, with the contracts it had to leave behind. */
export type SfpmLpBurnTxResult = TxResult & {
  /** See {@link SfpmLpCall.unburnableSize}. */
  unburnableSize: bigint
}

async function executeSfpmLp(
  params: SfpmLpWriteParams,
  action: SfpmLpAction,
): Promise<SfpmLpBurnTxResult> {
  const call = await prepareSfpmLpCall({ ...params, action })
  const tx = await submitWrite({
    client: params.client,
    walletClient: params.walletClient,
    account: params.account,
    address: call.to,
    abi: sfpmV3Abi,
    functionName: 'multicall',
    args: [call.steps.map((step) => step.data)],
    txOverrides: params.txOverrides,
  })
  return { ...tx, unburnableSize: call.unburnableSize }
}

export interface CreateSfpmLpPositionParams extends Omit<SfpmLpWriteParams, 'tokenId'> {
  /** SFPM poolId from {@link fetchSfpmV3PoolId}; use one per underlying pool for a given account. */
  poolId: bigint
  ranges: readonly SfpmLpRange[]
  positionSize: bigint
}

/** Open a direct-LP position over `ranges`. Returns the token ID that identifies it. */
export async function createSfpmLpPosition(
  params: CreateSfpmLpPositionParams,
): Promise<TxResult & { tokenId: bigint }> {
  const tokenId = buildSfpmLpTokenId(params)
  const { hash, wait } = await executeSfpmLp(
    { ...params, tokenId },
    { kind: 'increase', positionSize: params.positionSize },
  )
  return { hash, wait, tokenId }
}

export interface ResizeSfpmLpPositionParams extends SfpmLpWriteParams {
  positionSize: bigint
}

/** Add `positionSize` contracts to a direct-LP position. Pays out the ranges' pending fees. */
export async function increaseSfpmLpPosition(
  params: ResizeSfpmLpPositionParams,
): Promise<TxResult> {
  const { hash, wait } = await executeSfpmLp(params, {
    kind: 'increase',
    positionSize: params.positionSize,
  })
  return { hash, wait }
}

/** Remove `positionSize` contracts from a direct-LP position. Pays out the ranges' pending fees. */
export function decreaseSfpmLpPosition(
  params: ResizeSfpmLpPositionParams,
): Promise<SfpmLpBurnTxResult> {
  return executeSfpmLp(params, { kind: 'decrease', positionSize: params.positionSize })
}

export type CloseSfpmLpPositionParams = SfpmLpWriteParams

/** Remove the account's whole balance of a direct-LP position, with its pending fees. */
export function closeSfpmLpPosition(
  params: CloseSfpmLpPositionParams,
): Promise<SfpmLpBurnTxResult> {
  return executeSfpmLp(params, { kind: 'close' })
}

export type CollectSfpmLpFeesParams = SfpmLpWriteParams

/** Pay out a direct-LP position's pending fees without changing its size. */
export async function collectSfpmLpFees(params: CollectSfpmLpFeesParams): Promise<TxResult> {
  const { hash, wait } = await executeSfpmLp(params, { kind: 'collect' })
  return { hash, wait }
}
