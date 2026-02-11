/**
 * Block metadata utilities for the Panoptic v2 SDK.
 * @module v2/clients/blockMeta
 */

import type { PublicClient } from 'viem'

import type { BlockMeta } from '../types'

/**
 * Parameters for getBlockMeta.
 */
export interface GetBlockMetaParams {
  /** viem PublicClient */
  client: PublicClient
  /** Optional block number (defaults to latest) */
  blockNumber?: bigint
}

/**
 * Get block metadata for a given block.
 * Used to tag all read results with same-block consistency proof.
 *
 * @param params - The parameters
 * @returns Block metadata
 */
export async function getBlockMeta(params: GetBlockMetaParams): Promise<BlockMeta> {
  const { client, blockNumber } = params

  const block = await client.getBlock({
    blockNumber,
    includeTransactions: false,
  })

  return {
    blockNumber: block.number,
    blockHash: block.hash,
    blockTimestamp: block.timestamp,
  }
}
