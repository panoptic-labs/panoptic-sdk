/**
 * Collateral share price read for the Panoptic v2 SDK.
 *
 * Reads totalAssets and totalSupply from two CollateralTracker contracts
 * to compute share prices. Designed for APY calculations at historical blocks.
 *
 * @module v2/reads/collateralSharePrice
 */

import type { Address, Client } from 'viem'
import { ContractFunctionExecutionError } from 'viem'
import { multicall } from 'viem/actions'

import { collateralTrackerAbi } from '../../../generated'

/**
 * Raw share price data for a single collateral tracker.
 */
export interface CollateralSharePriceData {
  totalAssets: bigint
  totalSupply: bigint
}

/**
 * Get totalAssets and totalSupply for two CollateralTracker contracts in a single multicall.
 *
 * Consumers can compute share price as `totalAssets / totalSupply` using their
 * preferred precision library (e.g. Decimal.js).
 *
 * If the collateral tracker reverts (e.g. uninitialized), returns zeros.
 *
 * @param collateralAddresses - Tuple of [token0 tracker, token1 tracker] addresses
 * @param blockNumber - Block number to query at
 * @param client - viem Client
 * @returns Tuple of raw share price data
 */
export async function getCollateralSharePrices(
  collateralAddresses: [Address, Address],
  blockNumber: bigint,
  client: Client,
): Promise<[CollateralSharePriceData, CollateralSharePriceData]> {
  try {
    const results = await multicall(client, {
      contracts: [
        {
          address: collateralAddresses[0],
          abi: collateralTrackerAbi,
          functionName: 'totalAssets',
        },
        {
          address: collateralAddresses[0],
          abi: collateralTrackerAbi,
          functionName: 'totalSupply',
        },
        {
          address: collateralAddresses[1],
          abi: collateralTrackerAbi,
          functionName: 'totalAssets',
        },
        {
          address: collateralAddresses[1],
          abi: collateralTrackerAbi,
          functionName: 'totalSupply',
        },
      ],
      blockNumber,
      allowFailure: false,
    })

    const [assets0, supply0, assets1, supply1] = results

    return [
      { totalAssets: assets0, totalSupply: supply0 },
      { totalAssets: assets1, totalSupply: supply1 },
    ]
  } catch (e: unknown) {
    if (e instanceof ContractFunctionExecutionError) {
      return [
        { totalAssets: 0n, totalSupply: 0n },
        { totalAssets: 0n, totalSupply: 0n },
      ]
    }
    throw e
  }
}
