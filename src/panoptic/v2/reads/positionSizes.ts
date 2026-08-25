/**
 * Read current on-chain positionSize for a list of tokenIds.
 *
 * PanopticPool.dispatch() treats `positionSizes[i] == storedSize` as a
 * settlePremium self-call and any mismatch (including 0) as a burn. Callers
 * that want to trigger settle without changing size must pass the CURRENT
 * stored size for each held tokenId — hence this helper.
 *
 * @module v2/reads/positionSizes
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'

const BIT_MASK_128 = (1n << 128n) - 1n

export interface GetCurrentPositionSizesParams {
  client: PublicClient
  poolAddress: Address
  account: Address
  positionIdList: bigint[]
  blockNumber?: bigint
}

/**
 * Returns the current stored positionSize for each tokenId, in the same order
 * as the input `positionIdList`. Reverts (via the contract) if any tokenId is
 * not held by `account`.
 */
export async function getCurrentPositionSizes(
  params: GetCurrentPositionSizesParams,
): Promise<bigint[]> {
  const { client, poolAddress, account, positionIdList, blockNumber } = params

  if (positionIdList.length === 0) return []

  const [, , positionBalances] = await client.readContract({
    address: poolAddress,
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    args: [account, false, positionIdList],
    blockNumber,
  })

  return positionBalances.map((packed) => packed & BIT_MASK_128)
}
