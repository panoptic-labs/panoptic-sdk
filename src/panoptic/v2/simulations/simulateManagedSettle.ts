import { type Hex, decodeFunctionResult, encodeFunctionData, parseEventLogs } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { PanopticError, UnsafePremiumSettlementError } from '../errors'
import { getCurrentPositionSizes } from '../reads/positionSizes'
import { decodeTokenId } from '../tokenId'
import type { SimulationResult } from '../types'
import { buildProtectedSettlePlan } from '../writes/protectedSettle'
import { buildSettleSequenceCalls } from '../writes/settleSequence'
import { decodeLeftRightSigned } from '../writes/utils'
import { getPremiumDustTolerance } from './premiumDust'
import {
  type SimulateClosePremiumProtectionParams,
  simulateClosePremiumProtection,
} from './simulateClosePremiumProtection'

export type SimulateManagedSettleParams = Omit<
  SimulateClosePremiumProtectionParams,
  'closingTokenIds' | 'buildCollectionCall'
> & {
  tokenIds: bigint[]
  token0Decimals: bigint
  token1Decimals: bigint
  buildManageCall: SimulateClosePremiumProtectionParams['buildCollectionCall']
}

export interface ManagedSettleSimulation {
  dispatchData: Hex
  positionSizes: bigint[]
  collateralDelta0: bigint
  collateralDelta1: bigint
  settledBuyerCount: number
  forfeit0: bigint
  forfeit1: bigint
}

/** Simulate protected collection through an account's manager using the actual signer. */
export async function simulateManagedSettle(
  params: SimulateManagedSettleParams,
): Promise<SimulationResult<ManagedSettleSimulation>> {
  const { client, poolAddress, account, signerAddress, tokenIds, targets } = params
  const protection = await simulateClosePremiumProtection({
    ...params,
    closingTokenIds: tokenIds,
    buildCollectionCall: params.buildManageCall,
  })
  if (!protection.success) return protection
  const { _meta } = protection

  try {
    const { forfeit0, forfeit1 } = protection.data
    const [dust0, dust1] = getPremiumDustTolerance(params.token0Decimals, params.token1Decimals)
    if (forfeit0 > dust0 || forfeit1 > dust1) {
      throw new UnsafePremiumSettlementError([forfeit0, forfeit1], 0)
    }
    const positionSizes = await getCurrentPositionSizes({
      client,
      poolAddress,
      account,
      positionIdList: tokenIds,
      blockNumber: _meta.blockNumber,
    })
    if (positionSizes.length !== tokenIds.length || positionSizes.some((size) => size <= 0n)) {
      throw new PanopticError('Premium collection requires currently held, non-zero positions')
    }
    const { dispatch } = buildProtectedSettlePlan({
      positionIdList: tokenIds,
      finalPositionIdList: params.positionIdList,
      positionSizes,
      builderCode: params.builderCode,
    })
    const dispatchData = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'dispatch',
      args: [
        dispatch.positionIdList,
        dispatch.finalPositionIdList,
        dispatch.positionSizes,
        dispatch.tickAndSpreadLimits.map(
          (limits) => [Number(limits[0]), Number(limits[1]), Number(limits[2])] as const,
        ),
        dispatch.usePremiaAsCollateral,
        dispatch.builderCode,
      ],
    })
    const assetsCall = {
      to: poolAddress,
      account: signerAddress,
      data: encodeFunctionData({
        abi: panopticPoolV2Abi,
        functionName: 'getAssetsOf',
        args: [account],
      }),
    }
    const buyerCalls = targets.length
      ? buildSettleSequenceCalls({
          positionIdListFrom: params.signerPositionIdList,
          targets,
        }).map((data) => ({ to: poolAddress, account: signerAddress, data }))
      : []
    const calls = [
      assetsCall,
      ...buyerCalls,
      { ...params.buildManageCall(dispatchData), account: signerAddress },
      assetsCall,
    ]
    const blocks = await client.simulateBlocks({
      blocks: [{ calls }],
      blockNumber: _meta.blockNumber,
    })
    const results = blocks[0]?.calls
    if (results === undefined || results.length !== calls.length) {
      throw new PanopticError('Premium collection simulation returned incomplete results')
    }
    for (const result of results) {
      if (result.status === 'failure') throw result.error
    }
    const settlementLogs = parseEventLogs({
      abi: panopticPoolV2Abi,
      eventName: 'PremiumSettled',
      logs: (results[buyerCalls.length + 1]?.logs ?? []).filter(
        (log) => log.address.toLowerCase() === poolAddress.toLowerCase(),
      ),
    })
    let settled0 = 0n
    let settled1 = 0n
    for (const { args } of settlementLogs) {
      if (args.user.toLowerCase() !== account.toLowerCase() || !tokenIds.includes(args.tokenId))
        continue
      const leg = decodeTokenId(args.tokenId).legs[Number(args.legIndex)]
      if (leg === undefined || leg.isLong) continue
      const settled = decodeLeftRightSigned(args.settledAmounts)
      if (settled.right > 0n) settled0 += settled.right
      if (settled.left > 0n) settled1 += settled.left
    }
    const unpaid0 = protection.data.owed0 > settled0 ? protection.data.owed0 - settled0 : 0n
    const unpaid1 = protection.data.owed1 > settled1 ? protection.data.owed1 - settled1 : 0n
    const remaining0 = unpaid0 > forfeit0 ? unpaid0 : forfeit0
    const remaining1 = unpaid1 > forfeit1 ? unpaid1 : forfeit1
    if (remaining0 > dust0 || remaining1 > dust1) {
      throw new UnsafePremiumSettlementError([remaining0, remaining1], 0)
    }
    const before = results[0]?.data
    const after = results[results.length - 1]?.data
    if (before === undefined || after === undefined) {
      throw new PanopticError('Premium collection simulation returned incomplete balances')
    }
    const decodeAssets = (data: Hex) =>
      decodeFunctionResult({ abi: panopticPoolV2Abi, functionName: 'getAssetsOf', data })
    const [before0, before1] = decodeAssets(before)
    const [after0, after1] = decodeAssets(after)
    return {
      success: true,
      gasEstimate: 0n,
      data: {
        dispatchData,
        positionSizes,
        collateralDelta0: after0 - before0,
        collateralDelta1: after1 - before1,
        settledBuyerCount: targets.length,
        forfeit0: remaining0,
        forfeit1: remaining1,
      },
      _meta,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof PanopticError ? error : new PanopticError(String(error)),
      _meta,
    }
  }
}
