import type { Address, Client, Hex } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'
import { call, getBlock } from 'viem/actions'

import { Multicall3Abi } from '../../../abis/multicall3'
import {
  MulticallNoDataError,
  MulticallResultFailedError,
  MulticallResultMissingError,
  PanopticError,
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

interface ClientWithGetBlock extends Client {
  getBlock: (parameters: {
    blockNumber?: bigint
    includeTransactions?: false
  }) => Promise<{ number: bigint | null; hash: Hex | null; timestamp: bigint }>
}

function hasGetBlock(client: Client): client is ClientWithGetBlock {
  return (
    'getBlock' in client && typeof (client as Record<'getBlock', unknown>).getBlock === 'function'
  )
}

/**
 * Header of the block the aggregate is pinned to: `blockNumber`, or the latest block.
 *
 * `blockAndAggregate`'s own block number and hash are not usable as block metadata:
 * its hash is `blockhash(block.number)`, which is always zero, and on Arbitrum
 * chains (Arbitrum One, Robinhood Chain) `block.number` is the parent chain's
 * block number, not the number `eth_call` and `eth_getBlockByNumber` use.
 */
async function readBlockHeader(client: Client, blockNumber?: bigint): Promise<BlockMeta> {
  const parameters = { blockNumber, includeTransactions: false as const }
  const block = hasGetBlock(client)
    ? await client.getBlock(parameters)
    : await getBlock(client, parameters)
  if (block.number === null || block.hash === null) {
    throw new PanopticError('eth_getBlockByNumber returned a block without a number or hash')
  }
  return { blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp }
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
  const _meta = await readBlockHeader(client, blockNumber)

  const data = encodeFunctionData({
    abi: Multicall3Abi,
    functionName: 'blockAndAggregate',
    args: [calls],
  })
  const parameters = { to: MULTICALL3_ADDRESS, data, blockNumber: blockNumber ?? _meta.blockNumber }
  const response = hasCall(client) ? await client.call(parameters) : await call(client, parameters)

  if (response.data === undefined) {
    throw new MulticallNoDataError('blockAndAggregate')
  }
  const aggregateResult = decodeFunctionResult({
    abi: Multicall3Abi,
    functionName: 'blockAndAggregate',
    data: response.data,
  })
  const [, , rawResults] = aggregateResult as readonly [
    bigint,
    Hex,
    readonly MulticallBlockResult[],
  ]

  return {
    _meta,
    results: rawResults.slice(0, calls.length),
  }
}
