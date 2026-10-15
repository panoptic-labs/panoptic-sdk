import {
  type Address,
  type Hex,
  type PublicClient,
  decodeFunctionResult,
  encodeFunctionData,
} from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import { getCurrentPositionSizes } from '../reads/positionSizes'
import type { SimulationResult } from '../types'
import { buildProtectedSettlePlan } from '../writes/protectedSettle'
import { type SettleSequenceTarget, buildSettleSequenceCalls } from '../writes/settleSequence'
import { decodeLeftRightUnsigned } from '../writes/utils'

export interface SimulateClosePremiumProtectionParams {
  client: PublicClient
  poolAddress: Address
  account: Address
  signerAddress: Address
  signerPositionIdList: bigint[]
  buildCollectionCall: (dispatchData: Hex) => { to: Address; data: Hex }
  positionIdList: bigint[]
  closingTokenIds: bigint[]
  targets: SettleSequenceTarget[]
  builderCode?: bigint
  blockNumber?: bigint
}

export interface ClosePremiumProtectionSimulation {
  owed0: bigint
  owed1: bigint
  available0: bigint
  available1: bigint
  forfeit0: bigint
  forfeit1: bigint
}

/** Estimate unfunded short premium after buyer settlement and collection of chunk fees. */
export async function simulateClosePremiumProtection(
  params: SimulateClosePremiumProtectionParams,
): Promise<SimulationResult<ClosePremiumProtectionSimulation>> {
  const { client, poolAddress, account, positionIdList, closingTokenIds, targets } = params
  let metaPromise: ReturnType<typeof getBlockMeta> | undefined

  try {
    const blockNumber = params.blockNumber ?? (await client.getBlockNumber())
    metaPromise = getBlockMeta({ client, blockNumber })
    void metaPromise.catch(() => {})
    if (
      closingTokenIds.length === 0 ||
      closingTokenIds.some((id) => !positionIdList.includes(id))
    ) {
      throw new PanopticError('Premium protection requires currently held positions to close')
    }
    const positionSizes = await getCurrentPositionSizes({
      client,
      poolAddress,
      account,
      positionIdList: closingTokenIds,
      blockNumber,
    })
    const { collectionDispatch } = buildProtectedSettlePlan({
      positionIdList: closingTokenIds,
      finalPositionIdList: positionIdList,
      positionSizes,
      builderCode: params.builderCode,
    })
    const calls = (
      targets.length
        ? buildSettleSequenceCalls({ positionIdListFrom: params.signerPositionIdList, targets })
        : []
    ).map((data) => ({ to: poolAddress, data, account: params.signerAddress }))
    // The temporary poke collects Uniswap fees without clearing the seller's premium accumulator.
    if (collectionDispatch !== undefined) {
      const [dispatchData] = buildSettleSequenceCalls({
        positionIdListFrom: positionIdList,
        targets: [],
        dispatch: collectionDispatch,
      })
      if (dispatchData === undefined) {
        throw new PanopticError('Premium protection collection dispatch is missing')
      }
      calls.push({ ...params.buildCollectionCall(dispatchData), account: params.signerAddress })
    }
    for (const includePendingPremium of [true, false]) {
      calls.push({
        to: poolAddress,
        account: params.signerAddress,
        data: encodeFunctionData({
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          args: [account, includePendingPremium, closingTokenIds],
        }),
      })
    }
    const blocks = await client.simulateBlocks({
      blocks: [{ calls }],
      blockNumber,
    })
    const results = blocks[0]?.calls
    if (results === undefined || results.length !== calls.length) {
      throw new PanopticError('Premium protection simulation returned incomplete results')
    }
    for (const result of results) {
      if (result.status === 'failure') throw result.error
    }
    const result = results.map((call) => call.data)
    const owedResult = result[result.length - 2]
    const availableResult = result[result.length - 1]
    if (owedResult === undefined || availableResult === undefined) {
      throw new PanopticError('Premium protection simulation returned incomplete results')
    }
    const decodeShortPremium = (data: typeof owedResult) =>
      decodeLeftRightUnsigned(
        decodeFunctionResult({
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          data,
        })[0],
      )
    const owed = decodeShortPremium(owedResult)
    const available = decodeShortPremium(availableResult)
    return {
      success: true,
      gasEstimate: 0n,
      data: {
        owed0: owed.right,
        owed1: owed.left,
        available0: available.right,
        available1: available.left,
        forfeit0: owed.right > available.right ? owed.right - available.right : 0n,
        forfeit1: owed.left > available.left ? owed.left - available.left : 0n,
      },
      _meta: await metaPromise,
    }
  } catch (error) {
    const simulationError =
      error instanceof PanopticError ? error : new PanopticError(String(error))
    if (metaPromise === undefined) throw simulationError
    return {
      success: false,
      error: simulationError,
      _meta: await metaPromise,
    }
  }
}
