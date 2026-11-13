import { type Address, type PublicClient, decodeFunctionResult, encodeFunctionData } from 'viem'
import { simulateCalls } from 'viem/actions'

import { collateralTrackerV2Abi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients'

/** Estimate binding-side account BPU after the exact withdrawal, including live cross-collateral buffers. */
export async function getWithdrawalPreview({
  client,
  poolAddress,
  collateralTrackerAddress,
  queryAddress,
  account,
  assets,
  positionIdList,
}: {
  client: PublicClient
  poolAddress: Address
  collateralTrackerAddress: Address
  queryAddress: Address
  account: Address
  assets: bigint
  positionIdList: bigint[]
}) {
  if (assets <= 0n) throw new RangeError('Withdrawal must be positive')
  const _meta = await getBlockMeta({ client })
  const simulation = await simulateCalls(client, {
    account,
    blockNumber: _meta.blockNumber,
    validation: false,
    calls: [
      {
        to: collateralTrackerAddress,
        data: encodeFunctionData({
          abi: collateralTrackerV2Abi,
          functionName: 'withdraw',
          args: [assets, account, account, positionIdList, false],
        }),
      },
      {
        to: queryAddress,
        data: encodeFunctionData({
          abi: panopticQueryAbi,
          functionName: 'checkCollateral',
          args: [poolAddress, account, positionIdList],
        }),
      },
    ],
  })
  if (simulation.results.length !== 2) throw new Error('Incomplete withdrawal risk preview')
  for (const result of simulation.results) if (result.status === 'failure') throw result.error
  const result = simulation.results[1]
  if (!result || result.status !== 'success') throw new Error('Withdrawal risk preview unavailable')
  const [balances0, requirements0, balances1, requirements1] = decodeFunctionResult({
    abi: panopticQueryAbi,
    functionName: 'checkCollateral',
    data: result.data,
  }) as readonly [readonly bigint[], readonly bigint[], readonly bigint[], readonly bigint[]]
  const usage = (balance: bigint | undefined, required: bigint | undefined) => {
    if (balance === undefined || required === undefined)
      throw new Error('Missing withdrawal margin data')
    if (balance === 0n) return required > 0n ? 1_000_000n : 0n
    return (required * 10_000n + balance - 1n) / balance
  }
  const usage0 = usage(balances0[0], requirements0[0])
  const usage1 = usage(balances1[0], requirements1[0])
  return { usageBps: usage0 > usage1 ? usage0 : usage1, _meta }
}
