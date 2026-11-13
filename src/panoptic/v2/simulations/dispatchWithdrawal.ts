import { type Address, type PublicClient, encodeFunctionData } from 'viem'
import { simulateCalls } from 'viem/actions'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { NotEnoughTokensError, PanopticError } from '../errors'
import { getPoolMetadata } from '../reads/pool'
import type { TokenFlow } from '../types'
import { type SettleSequenceCallsParams, buildSettleSequenceCalls } from '../writes/settleSequence'
import type { DispatchIntent } from './creditWrap'

export type RequiredWithdrawal = { tokenIndex: 0n | 1n; assets: bigint }

export class WithdrawalShortfallError extends NotEnoughTokensError {
  readonly fundingStage = 'withdrawal'
}

/** Verify the requested wallet payment against the state produced by a dispatch. */
export async function assertDispatchWithdrawal({
  client,
  poolAddress,
  account,
  dispatch,
  requiredWithdrawal,
  tokenFlow,
  blockNumber,
  settleSequence,
}: {
  client: PublicClient
  poolAddress: Address
  account: Address
  dispatch: DispatchIntent
  requiredWithdrawal: RequiredWithdrawal
  tokenFlow?: TokenFlow
  blockNumber?: bigint
  settleSequence?: Pick<SettleSequenceCallsParams, 'positionIdListFrom' | 'targets'>
}) {
  if (
    requiredWithdrawal.assets < 0n ||
    (requiredWithdrawal.tokenIndex !== 0n && requiredWithdrawal.tokenIndex !== 1n)
  )
    throw new RangeError('Invalid withdrawal amount or token')
  if (requiredWithdrawal.assets === 0n) return
  const metadata = await getPoolMetadata({ client, poolAddress })
  const tracker =
    requiredWithdrawal.tokenIndex === 0n
      ? metadata.collateralToken0Address
      : metadata.collateralToken1Address
  const balance =
    tokenFlow &&
    (requiredWithdrawal.tokenIndex === 0n ? tokenFlow.balanceAfter0 : tokenFlow.balanceAfter1)
  // Leave one raw unit for collateral-share conversion rounding.
  const minimumBalance = requiredWithdrawal.assets + 1n
  if (balance !== undefined && balance < minimumBalance)
    throw new WithdrawalShortfallError(tracker, minimumBalance, balance)
  const poolCalls = settleSequence ? buildSettleSequenceCalls(settleSequence) : []
  if (dispatch.positionIdList.length > 0)
    poolCalls.push(
      encodeFunctionData({
        abi: panopticPoolV2Abi,
        functionName: 'dispatch',
        args: [
          dispatch.positionIdList,
          dispatch.finalPositionIdList,
          dispatch.positionSizes,
          dispatch.tickAndSpreadLimits.map(
            ([low, high, spread]) => [Number(low), Number(high), Number(spread)] as const,
          ),
          dispatch.usePremiaAsCollateral,
          dispatch.builderCode,
        ],
      }),
    )
  const firstCall = poolCalls[0]
  const mintCalls =
    firstCall === undefined
      ? []
      : [
          {
            to: poolAddress,
            data:
              poolCalls.length === 1
                ? firstCall
                : encodeFunctionData({
                    abi: panopticPoolV2Abi,
                    functionName: 'multicall',
                    args: [poolCalls],
                  }),
          },
        ]
  const result = await simulateCalls(client, {
    account,
    blockNumber,
    validation: false,
    calls: [
      ...mintCalls,
      {
        to: tracker,
        data: encodeFunctionData({
          abi: collateralTrackerV2Abi,
          functionName: 'withdraw',
          args: [
            requiredWithdrawal.assets,
            account,
            account,
            dispatch.finalPositionIdList,
            dispatch.usePremiaAsCollateral,
          ],
        }),
      },
    ],
  })
  const failure = result.results.find((call) => call.status === 'failure')
  if (result.results.length !== mintCalls.length + 1)
    throw new PanopticError('The full upfront payment simulation returned incomplete results.')
  if (failure?.status === 'failure')
    throw new PanopticError(
      'The full upfront payment cannot be withdrawn after opening.',
      failure.error,
    )
}
