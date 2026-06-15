/**
 * Position and account check functions for the Panoptic v2 SDK.
 *
 * These functions check account liquidatability.
 *
 * @module v2/reads/checks
 */

import type { Address, PublicClient } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import type { BlockMeta } from '../types'
import { decodeLeftRightUnsigned } from '../writes/utils'
import { type MulticallBlockCall, readBlockAndAggregate, requireReturnData } from './multicallBlock'

const FP96 = 1n << 96n
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
 * Liquidation check result with detailed margin breakdown.
 *
 * **Denomination**: both per-token pairs hold the gross account total
 * cross-converted to that single token denomination at `atTick`.
 *   - `currentMargin0` / `requiredMargin0` are in token0 units
 *   - `currentMargin1` / `requiredMargin1` are in token1 units
 *
 * `denominatedInToken` indicates which pair is "preferred": 0n when
 * `atTick < 0` (token0), 1n otherwise.
 */
export interface LiquidationCheck {
  /** Whether the account is liquidatable */
  isLiquidatable: boolean
  /** Margin shortfall for slot 0 (positive = shortfall, negative = excess) */
  marginShortfall0: bigint
  /** Margin shortfall for slot 1 (positive = shortfall, negative = excess) */
  marginShortfall1: bigint
  /** Current (gross) margin (collateral balance), denominated in token0 */
  currentMargin0: bigint
  /** Current (gross) margin, denominated in token1 */
  currentMargin1: bigint
  /** Required margin (sum of per-position requirements), denominated in token0 */
  requiredMargin0: bigint
  /** Required margin, denominated in token1 */
  requiredMargin1: bigint
  /**
   * Which token the "preferred" margin pair is denominated in.
   * 0n = token0 (when atTick < 0), 1n = token1 (when atTick >= 0).
   */
  denominatedInToken: bigint
  /** Tick at which liquidation was checked */
  atTick: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for isLiquidatable.
 */
export interface IsLiquidatableParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account to check */
  account: Address
  /** TokenIds of open positions */
  tokenIds: bigint[]
  /**
   * Optional: Tick to check liquidation at (defaults to current tick).
   * Note: collateral requirements are evaluated by the contract at the
   * pool's current tick — `atTick` here governs only the cross-token
   * sqrtPrice used to express the totals in a single denomination.
   */
  atTick?: bigint
  /** PanopticQuery address (kept for backwards compatibility; unused). */
  queryAddress?: Address
  /**
   * Optional pre-fetched collateral tracker addresses (saves an RPC).
   * If omitted, they are fetched from the pool.
   */
  collateralAddresses?: { collateralToken0: Address; collateralToken1: Address }
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Check if an account is liquidatable with detailed margin breakdown.
 *
 * Sources gross collateral from `CollateralTracker.assetsOf` and per-position
 * required margin from `PanopticPool.getFullPositionsData.collateralRequirements[]`,
 * cross-converted to each token denomination at `atTick`. Loan tokenIds
 * (width=0 shorts) contribute correctly to required margin.
 *
 * @param params - The parameters
 * @returns Liquidation check result with detailed margin breakdown
 *
 * @example
 * ```typescript
 * const result = await isLiquidatable({
 *   client,
 *   poolAddress,
 *   account,
 *   tokenIds: [position1, position2],
 * })
 *
 * if (result.isLiquidatable) {
 *   console.log('Account is liquidatable!')
 * }
 * ```
 */
export async function isLiquidatable(params: IsLiquidatableParams): Promise<LiquidationCheck> {
  const { client, poolAddress, account, tokenIds, atTick, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Resolve collateral tracker addresses (immutable; cache-friendly).
  let collateralToken0: Address
  let collateralToken1: Address
  if (params.collateralAddresses) {
    collateralToken0 = params.collateralAddresses.collateralToken0
    collateralToken1 = params.collateralAddresses.collateralToken1
  } else {
    const addrs = await client.multicall({
      contracts: [
        { address: poolAddress, abi: panopticPoolV2Abi, functionName: 'collateralToken0' },
        { address: poolAddress, abi: panopticPoolV2Abi, functionName: 'collateralToken1' },
      ],
      blockNumber: targetBlockNumber,
      allowFailure: false,
    })
    collateralToken0 = addrs[0]
    collateralToken1 = addrs[1]
  }

  const calls: MulticallBlockCall[] = []
  const currentTickIndex = atTick === undefined ? calls.length : null
  if (currentTickIndex !== null) {
    calls.push({
      target: poolAddress,
      callData: encodeFunctionData({
        abi: panopticPoolV2Abi,
        functionName: 'getCurrentTick',
      }),
    })
  }

  const assets0Index = calls.length
  calls.push({
    target: collateralToken0,
    callData: encodeFunctionData({
      abi: collateralTrackerV2Abi,
      functionName: 'assetsOf',
      args: [account],
    }),
  })

  const assets1Index = calls.length
  calls.push({
    target: collateralToken1,
    callData: encodeFunctionData({
      abi: collateralTrackerV2Abi,
      functionName: 'assetsOf',
      args: [account],
    }),
  })

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

  const { _meta, results } = await readBlockAndAggregate({
    client,
    calls,
    blockNumber: targetBlockNumber,
  })

  let effectiveTick = atTick
  if (effectiveTick === undefined) {
    if (currentTickIndex === null) {
      throw new Error('Missing current tick Multicall3 result index')
    }
    effectiveTick = BigInt(
      decodeFunctionResult({
        abi: panopticPoolV2Abi,
        functionName: 'getCurrentTick',
        data: requireReturnData(results, currentTickIndex, 'PanopticPool.getCurrentTick'),
      }),
    )
  }
  const assets0 = decodeFunctionResult({
    abi: collateralTrackerV2Abi,
    functionName: 'assetsOf',
    data: requireReturnData(results, assets0Index, 'CollateralTracker.assetsOf token0'),
  })
  const assets1 = decodeFunctionResult({
    abi: collateralTrackerV2Abi,
    functionName: 'assetsOf',
    data: requireReturnData(results, assets1Index, 'CollateralTracker.assetsOf token1'),
  })
  const positionDataResult =
    positionDataIndex === null
      ? null
      : (decodeFunctionResult({
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          data: requireReturnData(results, positionDataIndex, 'PanopticPool.getFullPositionsData'),
        }) as readonly [bigint, bigint, readonly bigint[], readonly bigint[], readonly bigint[]])

  let required0Native = 0n
  let required1Native = 0n
  if (positionDataResult) {
    const collateralRequirements = positionDataResult[3]
    for (const packed of collateralRequirements) {
      const decoded = decodeLeftRightUnsigned(packed)
      required0Native += decoded.right
      required1Native += decoded.left
    }
  }

  const sqrtPriceX96 = tickToSqrtPriceX96(effectiveTick)
  const currentMargin0 = assets0 + convert1to0(assets1, sqrtPriceX96)
  const requiredMargin0 = required0Native + convert1to0(required1Native, sqrtPriceX96)
  const currentMargin1 = assets1 + convert0to1(assets0, sqrtPriceX96)
  const requiredMargin1 = required1Native + convert0to1(required0Native, sqrtPriceX96)

  const marginShortfall0 = requiredMargin0 - currentMargin0
  const marginShortfall1 = requiredMargin1 - currentMargin1
  const denominatedInToken: bigint = sqrtPriceX96 < FP96 ? 0n : 1n
  const isLiquidatableResult =
    denominatedInToken === 0n ? marginShortfall0 > 0n : marginShortfall1 > 0n

  return {
    isLiquidatable: isLiquidatableResult,
    marginShortfall0,
    marginShortfall1,
    currentMargin0,
    currentMargin1,
    requiredMargin0,
    requiredMargin1,
    denominatedInToken,
    atTick: effectiveTick,
    _meta,
  }
}
