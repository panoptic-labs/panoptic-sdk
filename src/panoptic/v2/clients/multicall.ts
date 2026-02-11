/**
 * Multicall utilities for the Panoptic v2 SDK.
 * Uses viem's built-in multicall for same-block consistency.
 * @module v2/clients/multicall
 */

import type { Abi, Address, ContractFunctionArgs, ContractFunctionName, PublicClient } from 'viem'

import type { BlockMeta } from '../types'
import { getBlockMeta } from './blockMeta'

/**
 * A contract call to include in a multicall batch.
 */
export interface MulticallContract<
  TAbi extends Abi = Abi,
  TFunctionName extends ContractFunctionName<TAbi, 'pure' | 'view'> = ContractFunctionName<
    TAbi,
    'pure' | 'view'
  >,
> {
  /** Contract address */
  address: Address
  /** Contract ABI */
  abi: TAbi
  /** Function name to call */
  functionName: TFunctionName
  /** Function arguments */
  args?: ContractFunctionArgs<TAbi, 'pure' | 'view', TFunctionName>
}

/**
 * Parameters for multicallRead.
 */
export interface MulticallReadParams<TContracts extends readonly MulticallContract[]> {
  /** viem PublicClient */
  client: PublicClient
  /** Array of contract calls to batch */
  contracts: TContracts
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Whether to allow failures (default: false) */
  allowFailure?: boolean
}

/**
 * Result type for a single multicall contract result.
 */
export type MulticallResult<T> =
  | { status: 'success'; result: T }
  | { status: 'failure'; error: Error }

/**
 * Perform a batched multicall read with block metadata.
 * All calls are executed at the same block for consistency.
 *
 * @param params - The multicall parameters
 * @returns Results array with block metadata
 */
export async function multicallRead<TContracts extends readonly MulticallContract[]>(
  params: MulticallReadParams<TContracts>,
): Promise<{
  results: MulticallResult<unknown>[]
  _meta: BlockMeta
}> {
  const { client, contracts, blockNumber, allowFailure = false } = params

  // Get the block number to use (latest if not specified)
  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())

  // Execute multicall and get block meta in parallel
  const [multicallResults, _meta] = await Promise.all([
    client.multicall({
      contracts: contracts as unknown as Parameters<typeof client.multicall>['0']['contracts'],
      blockNumber: targetBlockNumber,
      allowFailure: true, // Always allow failure internally to handle gracefully
    }),
    getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // Map results to our format
  const results: MulticallResult<unknown>[] = multicallResults.map((result) => {
    if (result.status === 'success') {
      return { status: 'success' as const, result: result.result }
    } else {
      // If allowFailure is false and we have a failure, throw
      if (!allowFailure) {
        throw result.error
      }
      return { status: 'failure' as const, error: result.error }
    }
  })

  return { results, _meta }
}
