/**
 * Submit a covered call resize (collect fees or increase) built by
 * {@link buildCoveredCallCollectDispatch} / {@link buildCoveredCallIncreaseDispatch}.
 *
 * @module v2/writes/coveredCallResize
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import type { CoveredCallResizeDispatch } from '../tokenId/coveredCallResize'
import type { TxOverrides, TxResult } from '../types'
import { submitWrite } from './utils'

export interface ResizeCoveredCallParams {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  poolAddress: Address
  dispatch: CoveredCallResizeDispatch
  usePremiaAsCollateral?: boolean
  builderCode?: bigint
  txOverrides?: TxOverrides
}

/** One dispatch: mint the replacement covered call, then burn the old one. */
export async function resizeCoveredCall(params: ResizeCoveredCallParams): Promise<TxResult> {
  const { dispatch } = params
  return submitWrite({
    client: params.client,
    walletClient: params.walletClient,
    account: params.account,
    address: params.poolAddress,
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [
      dispatch.positionIdList,
      dispatch.finalPositionIdList,
      dispatch.positionSizes,
      dispatch.tickAndSpreadLimits.map(
        ([low, high, spread]) => [Number(low), Number(high), Number(spread)] as const,
      ),
      params.usePremiaAsCollateral ?? false,
      params.builderCode ?? 0n,
    ],
    txOverrides: params.txOverrides,
  })
}
