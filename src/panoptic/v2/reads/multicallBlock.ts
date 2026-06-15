import type { Address, Client, Hex } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'
import { call } from 'viem/actions'

import { Multicall3Abi } from '../../../abis/multicall3'
import {
  MulticallNoDataError,
  MulticallResultFailedError,
  MulticallResultMissingError,
} from '../errors'
import type { BlockMeta } from '../types'

export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

export interface MulticallBlockCall {
  target: Address
  callData: Hex
}

export interface MulticallBlockResult {
  success: boolean
  returnData: Hex
}

interface ClientWithCall extends Client {
  call: (parameters: { to: Address; data: Hex; blockNumber?: bigint }) => Promise<{ data?: Hex }>
}

function hasCall(client: Client): client is ClientWithCall {
  return 'call' in client && typeof (client as Record<'call', unknown>).call === 'function'
}

function requireResult(
  results: readonly MulticallBlockResult[],
  index: number,
  label: string,
): MulticallBlockResult {
  const result = results[index]
  if (result === undefined) {
    throw new MulticallResultMissingError(label, index)
  }
  if (!result.success) {
    throw new MulticallResultFailedError(label, index)
  }
  return result
}

export function requireReturnData(
  results: readonly MulticallBlockResult[],
  index: number,
  label: string,
): Hex {
  return requireResult(results, index, label).returnData
}

export async function readBlockAndAggregate({
  client,
  calls,
  blockNumber,
}: {
  client: Client
  calls: readonly MulticallBlockCall[]
  blockNumber?: bigint
}): Promise<{ _meta: BlockMeta; results: readonly MulticallBlockResult[] }> {
  const aggregateCalls = [
    ...calls,
    {
      target: MULTICALL3_ADDRESS,
      callData: encodeFunctionData({
        abi: Multicall3Abi,
        functionName: 'getCurrentBlockTimestamp',
      }),
    },
  ]

  const data = encodeFunctionData({
    abi: Multicall3Abi,
    functionName: 'blockAndAggregate',
    args: [aggregateCalls],
  })
  const parameters = { to: MULTICALL3_ADDRESS, data, blockNumber }
  const response = hasCall(client) ? await client.call(parameters) : await call(client, parameters)

  if (response.data === undefined) {
    throw new MulticallNoDataError('blockAndAggregate')
  }
  const aggregateResult = decodeFunctionResult({
    abi: Multicall3Abi,
    functionName: 'blockAndAggregate',
    data: response.data,
  })
  const [aggregateBlockNumber, blockHash, rawResults] = aggregateResult as readonly [
    bigint,
    Hex,
    readonly MulticallBlockResult[],
  ]
  const timestampResult = requireReturnData(
    rawResults,
    calls.length,
    'Multicall3.getCurrentBlockTimestamp',
  )
  const blockTimestamp = decodeFunctionResult({
    abi: Multicall3Abi,
    functionName: 'getCurrentBlockTimestamp',
    data: timestampResult,
  })

  return {
    _meta: {
      blockNumber: aggregateBlockNumber,
      blockHash,
      blockTimestamp,
    },
    results: rawResults.slice(0, calls.length),
  }
}
