/**
 * Pool liquidity distribution read function using PanopticQuery.
 *
 * @module v2/reads/liquidity
 */

import type { Address, PublicClient } from 'viem'

import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta } from '../types'

/**
 * Result of getPoolLiquidities.
 */
export interface PoolLiquidities {
  /** Tick values for each data point */
  ticks: bigint[]
  /** Net liquidity at each tick */
  liquidityNets: bigint[]
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for getPoolLiquidities.
 */
export interface GetPoolLiquiditiesParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** PanopticQuery address */
  queryAddress: Address
  /** Starting tick of the range */
  startTick: bigint
  /** Number of ticks to query */
  nTicks: bigint
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get cumulative liquidity distribution across a tick range.
 *
 * Wraps `PanopticQuery.getTickNets()` to return tick data and net liquidity
 * for each tick in the specified range.
 *
 * ## Same-Block Guarantee
 * All data is fetched at a single block.
 *
 * @param params - The parameters
 * @returns Tick data and liquidity nets with block metadata
 */
export async function getPoolLiquidities(
  params: GetPoolLiquiditiesParams,
): Promise<PoolLiquidities> {
  const { client, poolAddress, queryAddress, startTick, nTicks, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getTickNets',
      args: [poolAddress, Number(startTick), nTicks],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [tickData, liquidityNets] = result

  return {
    ticks: [...tickData],
    liquidityNets: [...liquidityNets],
    _meta,
  }
}
