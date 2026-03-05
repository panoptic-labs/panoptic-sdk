/**
 * Batch read of CollateralTracker.totalAssets() for multiple trackers.
 *
 * @module v2/reads/collateralTotalAssets
 */

import type { Address, Client } from 'viem'
import { getAddress, zeroAddress } from 'viem'
import { multicall } from 'viem/actions'

import { collateralTrackerAbi } from '../../../generated'

/**
 * Get totalAssets for multiple CollateralTracker contracts in a single multicall.
 *
 * @param client - viem Client
 * @param collateralTrackerAddresses - Array of CollateralTracker addresses
 * @param chainId - Chain ID (for multicall routing)
 * @param blockNumber - Optional block number for historical queries
 * @returns Array of totalAssets (bigint) in the same order as input addresses
 */
export async function getCollateralTotalAssetsBatch(
  client: Client,
  collateralTrackerAddresses: Address[],
  chainId: number,
  blockNumber?: bigint,
): Promise<bigint[]> {
  if (collateralTrackerAddresses.length === 0) return []

  try {
    const contracts = collateralTrackerAddresses.map((address) => ({
      address: getAddress(address ?? zeroAddress),
      abi: collateralTrackerAbi,
      functionName: 'totalAssets' as const,
      chainId,
    }))

    const results = await multicall(client, {
      contracts,
      blockNumber,
      allowFailure: false,
    })

    return results.map((result) => BigInt(result ?? 0))
  } catch (error) {
    console.error('Error reading collateral total assets:', error)
    return collateralTrackerAddresses.map(() => 0n)
  }
}
