/** Fee-protected premium settlement simulation. @module v2/simulations/simulateSettle */

import type { Address, Hex, PublicClient } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError, UnsafePremiumSettlementError } from '../errors'
import { getCurrentPositionSizes } from '../reads/positionSizes'
import { getForfeitablePremium } from '../reads/premia'
import type { SettleSimulation, SimulationResult, TokenFlow } from '../types'
import { buildProtectedSettlePlan } from '../writes/protectedSettle'
import type { SettleSequenceTarget } from '../writes/settleSequence'
import { buildSettleSequenceCalls } from '../writes/settleSequence'
import { simulateSettlePremiumBatch } from './simulateSettlePremiumBatch'
import { simulateWithTokenFlow } from './tokenFlow'

const BIT_MASK_128 = (1n << 128n) - 1n
const multicallAbi = [
  {
    type: 'function',
    name: 'multicall',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
    stateMutability: 'nonpayable',
  },
] as const

export interface SimulateSettleParams {
  client: PublicClient
  poolAddress: Address
  account: Address
  positionIdList: bigint[]
  finalPositionIdList?: bigint[]
  positionSizes?: bigint[]
  /** Buyers holding longs against the short chunks being settled. */
  targets?: SettleSequenceTarget[]
  usePremiaAsCollateral?: boolean
  builderCode?: bigint
  /**
   * Allow settlement when premium remains but no buyer settlement or chunk
   * poke can collect it (for example, width-zero legs). Avoidable forfeiture
   * still fails closed. Default false.
   */
  allowForfeit?: boolean
  blockNumber?: bigint
}

function encodeDispatch(plan: ReturnType<typeof buildProtectedSettlePlan>): Hex {
  const dispatch = plan.dispatch
  return encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [
      dispatch.positionIdList,
      dispatch.finalPositionIdList,
      dispatch.positionSizes,
      dispatch.tickAndSpreadLimits.map(
        (limits) =>
          [Number(limits[0]), Number(limits[1]), Number(limits[2])] as readonly [
            number,
            number,
            number,
          ],
      ),
      dispatch.usePremiaAsCollateral,
      dispatch.builderCode,
    ],
  })
}

function decodeShortPremium(data: Hex): readonly [bigint, bigint] {
  const packed = decodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    data,
  })[0]
  return [packed & BIT_MASK_128, packed >> 128n]
}

async function remainingForfeitAfterProtection(params: {
  client: PublicClient
  poolAddress: Address
  account: Address
  positionIdList: bigint[]
  finalPositionIdList: bigint[]
  targets: SettleSequenceTarget[]
  plan: ReturnType<typeof buildProtectedSettlePlan>
  blockNumber: bigint
  initial: readonly [bigint, bigint]
}): Promise<[bigint, bigint]> {
  const { client, poolAddress, account, positionIdList, targets, plan, blockNumber, initial } =
    params
  if (targets.length === 0 && plan.collectionDispatch === undefined) return [...initial]

  const protectionCalls = buildSettleSequenceCalls({
    positionIdListFrom: params.finalPositionIdList,
    targets,
    dispatch: plan.collectionDispatch,
  })
  const availableCall = encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    args: [account, false, positionIdList],
  })
  const totalCall = encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    args: [account, true, positionIdList],
  })
  const { result } = await client.simulateContract({
    address: poolAddress,
    abi: multicallAbi,
    functionName: 'multicall',
    args: [[...protectionCalls, availableCall, totalCall]],
    account,
    blockNumber,
  })
  const available = decodeShortPremium(result[result.length - 2])
  const total = decodeShortPremium(result[result.length - 1])
  return [
    total[0] > available[0] ? total[0] - available[0] : 0n,
    total[1] > available[1] ? total[1] - available[1] : 0n,
  ]
}

export async function simulateSettle(
  params: SimulateSettleParams,
): Promise<SimulationResult<SettleSimulation>> {
  const {
    client,
    poolAddress,
    account,
    positionIdList,
    finalPositionIdList = positionIdList,
    positionSizes: providedSizes,
    targets = [],
    usePremiaAsCollateral = false,
    builderCode = 0n,
    allowForfeit = false,
    blockNumber,
  } = params
  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  try {
    if (providedSizes && providedSizes.length !== positionIdList.length) {
      throw new PanopticError('simulateSettle: positionSizes length must match positionIdList')
    }
    const positionSizes =
      providedSizes ??
      (await getCurrentPositionSizes({
        client,
        poolAddress,
        account,
        positionIdList,
        blockNumber: targetBlockNumber,
      }))
    const plan = buildProtectedSettlePlan({
      positionIdList,
      finalPositionIdList,
      positionSizes,
      usePremiaAsCollateral,
      builderCode,
    })
    const initialForfeit = await getForfeitablePremium({
      client,
      poolAddress,
      account,
      tokenIds: positionIdList,
      blockNumber: targetBlockNumber,
    })
    const initial: [bigint, bigint] = [initialForfeit.forfeit0, initialForfeit.forfeit1]

    if (targets.length > 0) {
      const buyers = await simulateSettlePremiumBatch({
        client,
        poolAddress,
        account,
        positionIdListFrom: finalPositionIdList,
        targets,
        blockNumber: targetBlockNumber,
      })
      if (buyers.unsettleableCount > 0) {
        throw new UnsafePremiumSettlementError(initial, buyers.unsettleableCount)
      }
    }

    const remainingForfeit = await remainingForfeitAfterProtection({
      client,
      poolAddress,
      account,
      positionIdList,
      finalPositionIdList,
      targets,
      plan,
      blockNumber: targetBlockNumber,
      initial,
    })
    if ((remainingForfeit[0] > 0n || remainingForfeit[1] > 0n) && !allowForfeit) {
      throw new UnsafePremiumSettlementError(remainingForfeit, 0)
    }

    const callData =
      targets.length === 0
        ? encodeDispatch(plan)
        : encodeFunctionData({
            abi: panopticPoolV2Abi,
            functionName: 'multicall',
            args: [
              buildSettleSequenceCalls({
                positionIdListFrom: finalPositionIdList,
                targets,
                dispatch: plan.dispatch,
              }),
            ],
          })
    const flowResult = await simulateWithTokenFlow({
      client,
      poolAddress,
      user: account,
      callData,
      blockNumber: targetBlockNumber,
    })
    if (!flowResult.success || !flowResult.tokenFlow) {
      throw flowResult.rawError ?? new PanopticError(flowResult.error || 'Simulation failed')
    }

    const tokenFlow: TokenFlow = flowResult.tokenFlow
    return {
      success: true,
      data: {
        premiaReceived0: tokenFlow.delta0,
        premiaReceived1: tokenFlow.delta1,
        postCollateral0: tokenFlow.balanceAfter0,
        postCollateral1: tokenFlow.balanceAfter1,
        premiumProtected: [initial[0] - remainingForfeit[0], initial[1] - remainingForfeit[1]],
        remainingForfeit,
        usesPoke: plan.pokingTokenIds.length > 0,
        settledBuyerCount: targets.length,
      },
      gasEstimate: flowResult.gasEstimate,
      tokenFlow,
      _meta: await metaPromise,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(
              error instanceof Error ? error.message : 'Simulation failed',
              error instanceof Error ? error : undefined,
            ),
      _meta: await metaPromise,
    }
  }
}
