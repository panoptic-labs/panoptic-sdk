/**
 * Account buying power read function for the Panoptic v2 SDK.
 *
 * Sources gross collateral from `CollateralTracker.assetsOf` and per-position
 * required margin from `PanopticPool.getFullPositionsData.collateralRequirements[]`,
 * cross-converted to both token denominations at the current tick.
 *
 * This replaces the prior `PanopticQuery.checkCollateral` (3-arg, oracle-ticks
 * overload) implementation that netted loan tokenId debt out of the balance
 * and excluded loans from required-collateral, causing buying-power readouts
 * to be wildly wrong for any account that had borrowed.
 *
 * @module v2/reads/buyingPower
 */

import type { Address, Client } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'
import { multicall } from 'viem/actions'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import type { BlockMeta } from '../types'
import { decodeLeftRightUnsigned } from '../writes/utils'
import { type MulticallBlockCall, readBlockAndAggregate, requireReturnData } from './multicallBlock'

const Q128 = 1n << 128n

function convert0to1(amount: bigint, sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 < Q128) {
    return (amount * sqrtPriceX96 * sqrtPriceX96) >> 192n
  }
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * sp2Hi) >> 128n
}

function convert1to0(amount: bigint, sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 < Q128) {
    const denom = sqrtPriceX96 * sqrtPriceX96
    return (amount * (1n << 192n)) / denom
  }
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * (1n << 128n)) / sp2Hi
}

/**
 * Parameters for getAccountBuyingPower.
 */
export interface GetAccountBuyingPowerParams {
  /** viem Client (PublicClient or basic Client with transport) */
  client: Client
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds of open positions */
  tokenIds: bigint[]
  /** PanopticQuery address (kept for backwards compatibility; unused). */
  queryAddress?: Address
  /**
   * Optional pre-fetched collateral tracker addresses (saves an RPC).
   * If omitted, they are fetched from the pool.
   */
  collateralAddresses?: { collateralToken0: Address; collateralToken1: Address }
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips block metadata fetch) */
  _meta?: BlockMeta
}

/**
 * Result of getAccountBuyingPower.
 *
 * Both per-token values are the **gross** account total cross-converted
 * into the respective single-token denomination at the current tick:
 *   - `collateralBalance0` / `requiredCollateral0` are in token0 units
 *   - `collateralBalance1` / `requiredCollateral1` are in token1 units
 */
export interface AccountBuyingPower {
  /** Gross collateral (deposits + borrowed shares), denominated in token0 */
  collateralBalance0: bigint
  /** Sum of per-position collateral requirements, denominated in token0 */
  requiredCollateral0: bigint
  /** Gross collateral (deposits + borrowed shares), denominated in token1 */
  collateralBalance1: bigint
  /** Sum of per-position collateral requirements, denominated in token1 */
  requiredCollateral1: bigint
  /** Block metadata for the Multicall3 aggregate read */
  _meta: BlockMeta
}

/**
 * Get account-level buying power.
 *
 * Uses {@link https://github.com/panoptic-xyz CollateralTracker.assetsOf} for
 * gross collateral and `PanopticPool.getFullPositionsData.collateralRequirements[]`
 * for the per-position required margin — so loan tokenIds (width=0 shorts)
 * contribute to the requirement instead of being netted out of the balance.
 *
 * Accepts a plain viem `Client` (not just `PublicClient`) so it works with wagmi's
 * `useClient()` without needing a cast.
 *
 * @param params - The parameters
 * @returns Account buying power data with optional block metadata
 */
export async function getAccountBuyingPower(
  params: GetAccountBuyingPowerParams,
): Promise<AccountBuyingPower> {
  const { client, poolAddress, account, tokenIds } = params
  const blockNumber = params.blockNumber ?? params._meta?.blockNumber

  // Resolve collateral tracker addresses (immutable; cache-friendly).
  let collateralToken0: Address
  let collateralToken1: Address
  if (params.collateralAddresses) {
    collateralToken0 = params.collateralAddresses.collateralToken0
    collateralToken1 = params.collateralAddresses.collateralToken1
  } else {
    const addrs = await multicall(client, {
      contracts: [
        { address: poolAddress, abi: panopticPoolV2Abi, functionName: 'collateralToken0' },
        { address: poolAddress, abi: panopticPoolV2Abi, functionName: 'collateralToken1' },
      ],
      blockNumber,
      allowFailure: false,
    })
    collateralToken0 = addrs[0]
    collateralToken1 = addrs[1]
  }

  const calls: MulticallBlockCall[] = [
    {
      target: poolAddress,
      callData: encodeFunctionData({
        abi: panopticPoolV2Abi,
        functionName: 'getCurrentTick',
      }),
    },
    {
      target: collateralToken0,
      callData: encodeFunctionData({
        abi: collateralTrackerV2Abi,
        functionName: 'assetsOf',
        args: [account],
      }),
    },
    {
      target: collateralToken1,
      callData: encodeFunctionData({
        abi: collateralTrackerV2Abi,
        functionName: 'assetsOf',
        args: [account],
      }),
    },
  ]

  const positionDataIndex = tokenIds.length > 0 ? calls.length : null
  if (positionDataIndex !== null) {
    calls.push({
      target: poolAddress,
      callData: encodeFunctionData({
        abi: panopticPoolV2Abi,
        functionName: 'getFullPositionsData',
        args: [account, true, tokenIds],
      }),
    })
  }

  const { _meta, results } = await readBlockAndAggregate({ client, calls, blockNumber })

  const currentTickResult = decodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getCurrentTick',
    data: requireReturnData(results, 0, 'PanopticPool.getCurrentTick'),
  })
  const assets0 = decodeFunctionResult({
    abi: collateralTrackerV2Abi,
    functionName: 'assetsOf',
    data: requireReturnData(results, 1, 'CollateralTracker.assetsOf token0'),
  })
  const assets1 = decodeFunctionResult({
    abi: collateralTrackerV2Abi,
    functionName: 'assetsOf',
    data: requireReturnData(results, 2, 'CollateralTracker.assetsOf token1'),
  })
  const currentTick = BigInt(currentTickResult)
  const positionDataResult =
    positionDataIndex === null
      ? null
      : (decodeFunctionResult({
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          data: requireReturnData(results, positionDataIndex, 'PanopticPool.getFullPositionsData'),
        }) as readonly [bigint, bigint, readonly bigint[], readonly bigint[], readonly bigint[]])

  // Sum collateral requirements across positions, per token.
  let required0Native = 0n
  let required1Native = 0n
  if (positionDataResult) {
    const collateralRequirements = positionDataResult[3]
    for (const packed of collateralRequirements) {
      const decoded = decodeLeftRightUnsigned(packed)
      required0Native += decoded.right // token0
      required1Native += decoded.left // token1
    }
  }

  // Cross-convert into each single-token denomination at current tick.
  const sqrtPriceX96 = tickToSqrtPriceX96(currentTick)
  const collateralBalance0 = assets0 + convert1to0(assets1, sqrtPriceX96)
  const requiredCollateral0 = required0Native + convert1to0(required1Native, sqrtPriceX96)
  const collateralBalance1 = assets1 + convert0to1(assets0, sqrtPriceX96)
  const requiredCollateral1 = required1Native + convert0to1(required0Native, sqrtPriceX96)

  return {
    collateralBalance0,
    requiredCollateral0,
    collateralBalance1,
    requiredCollateral1,
    _meta,
  }
}
