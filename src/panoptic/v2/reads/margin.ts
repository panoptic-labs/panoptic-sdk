/**
 * Margin buffer and distance-to-liquidation convenience function.
 *
 * Sources current and required margin directly from
 * `PanopticPool.getFullPositionsData` + `CollateralTracker.assetsOf`,
 * rather than `PanopticQuery.checkCollateral`.
 *
 * Why: `checkCollateral` returns a `currentMargin` already netted of the
 * borrowing obligation of width=0 short ("loan") tokenIds, and a
 * `requiredMargin` that does NOT include the loan's collateral requirement.
 * That makes buying-power usage read 0% for accounts whose collateral
 * comes mostly from a loan, and double-subtracts the loan from Net Liq
 * when downstream callers add the position MtM (which already values the
 * loan at `-notional`).
 *
 * `getFullPositionsData.collateralRequirements[]` attributes the loan as
 * a margin requirement (the accurate primitive), and `assetsOf` returns
 * the gross collateral (deposits + borrowed shares) — pairing them yields
 * a consistent gross-collateral / gross-requirement view.
 *
 * @module v2/reads/margin
 */

import type { Address, PublicClient } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import type { BlockMeta } from '../types'
import { decodeLeftRightUnsigned } from '../writes/utils'
import { type MulticallBlockCall, readBlockAndAggregate, requireReturnData } from './multicallBlock'

// Sentinel ticks used by PanopticQuery to indicate "no liquidation at this boundary"
const MIN_TICK = -887272n
const MAX_TICK = 887272n

const FP96 = 1n << 96n
const Q128 = 1n << 128n

/**
 * Convert a token0 amount to its token1-equivalent at the given sqrtPriceX96.
 *
 * Matches the on-chain `PanopticMath.convert0to1` truncation, with an
 * overflow-safe branch when `sqrtPriceX96^2` would not fit in uint256.
 */
function convert0to1(amount: bigint, sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 < Q128) {
    return (amount * sqrtPriceX96 * sqrtPriceX96) >> 192n
  }
  // amount * (sqrtPriceX96 * sqrtPriceX96 >> 64n) >> 128n
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * sp2Hi) >> 128n
}

/**
 * Convert a token1 amount to its token0-equivalent at the given sqrtPriceX96.
 */
function convert1to0(amount: bigint, sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 < Q128) {
    const denom = sqrtPriceX96 * sqrtPriceX96
    return (amount * (1n << 192n)) / denom
  }
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * (1n << 128n)) / sp2Hi
}

/**
 * Parameters for {@link getMarginBuffer}.
 */
export interface GetMarginBufferParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds of open positions (loan/credit width=0 legs included) */
  tokenIds: bigint[]
  /** PanopticQuery address (required for liquidation prices) */
  queryAddress: Address
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
 * Margin buffer result with distance-to-liquidation.
 *
 * **Denomination**: Both slots are populated with the account total
 * cross-converted into a single token denomination so they can be
 * compared directly.
 *
 * - `currentMargin0` / `requiredMargin0` / `buffer0` are denominated in **token0**.
 * - `currentMargin1` / `requiredMargin1` / `buffer1` are denominated in **token1**.
 *
 * `denominatedInToken` indicates which of the two pairs is "preferred":
 * 0 when `currentTick < 0`, 1 otherwise — matching the historical
 * `checkCollateral` convention so downstream consumers keep working
 * without changes.
 */
export interface MarginBuffer {
  /** Excess margin in token0 units (positive = safe, negative = shortfall) */
  buffer0: bigint
  /** Excess margin in token1 units (positive = safe, negative = shortfall) */
  buffer1: bigint
  /** Buffer as percentage of required margin in bps (slot 0). null if no requirement. */
  bufferPercent0: bigint | null
  /** Buffer as percentage of required margin in bps (slot 1). null if no requirement. */
  bufferPercent1: bigint | null
  /** Current (gross) account collateral, denominated in token0 */
  currentMargin0: bigint
  /** Current (gross) account collateral, denominated in token1 */
  currentMargin1: bigint
  /**
   * Sum of per-position collateral requirements from
   * `getFullPositionsData.collateralRequirements[]`, denominated in token0.
   * Loans/credits (width=0) contribute correctly.
   */
  requiredMargin0: bigint
  /** Same, denominated in token1 */
  requiredMargin1: bigint
  /**
   * Which token the "preferred" margin values are denominated in.
   * 0 = token0 (when currentTick < 0), 1 = token1 (when currentTick >= 0).
   */
  denominatedInToken: 0 | 1
  /** Tick distance to nearest liquidation boundary (null if no liquidation boundaries) */
  liquidationDistance: bigint | null
  /** Lower liquidation tick (null if safe at MIN_TICK) */
  lowerLiquidationTick: bigint | null
  /** Upper liquidation tick (null if safe at MAX_TICK) */
  upperLiquidationTick: bigint | null
  /** Current tick */
  currentTick: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Get margin buffer and distance-to-liquidation for an account.
 *
 * Reads, all pinned to the same block:
 * - `getCurrentTick` (sequencing dependency for sqrtPrice conversion)
 * - `getFullPositionsData(account, true, tokenIds)` → collateralRequirements
 * - `CollateralTracker.assetsOf(account)` on both trackers → gross collateral
 * - `PanopticQuery.getLiquidationPrices(...)` → liquidation boundaries
 *
 * @param params - The parameters
 * @returns Margin buffer with liquidation distance and block metadata
 */
export async function getMarginBuffer(params: GetMarginBufferParams): Promise<MarginBuffer> {
  const { client, poolAddress, account, tokenIds, queryAddress, blockNumber } = params

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

  const hasPositions = tokenIds.length > 0
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

  const positionDataIndex = hasPositions ? calls.length : null
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

  const liqPricesIndex = hasPositions ? calls.length : null
  if (liqPricesIndex !== null) {
    calls.push({
      target: queryAddress,
      callData: encodeFunctionData({
        abi: panopticQueryAbi,
        functionName: 'getLiquidationPrices',
        args: [poolAddress, account, tokenIds],
      }),
    })
  }

  const { _meta, results } = await readBlockAndAggregate({
    client,
    calls,
    blockNumber: targetBlockNumber,
  })

  const currentTickResult = decodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getCurrentTick',
    data: requireReturnData(results, 0, 'PanopticPool.getCurrentTick'),
  })
  const currentTick = BigInt(currentTickResult)
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
  const positionDataResult =
    positionDataIndex === null
      ? null
      : (decodeFunctionResult({
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          data: requireReturnData(results, positionDataIndex, 'PanopticPool.getFullPositionsData'),
        }) as readonly [bigint, bigint, readonly bigint[], readonly bigint[], readonly bigint[]])
  const liqPricesResult =
    liqPricesIndex === null
      ? null
      : (decodeFunctionResult({
          abi: panopticQueryAbi,
          functionName: 'getLiquidationPrices',
          data: requireReturnData(results, liqPricesIndex, 'PanopticQuery.getLiquidationPrices'),
        }) as readonly [number, number])

  // Sum collateral requirements across all positions, per token.
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

  // Cross-convert into a single denomination at current tick.
  // The conversion mirrors PanopticQuery.checkCollateral's effective-balance
  // shape so downstream callers keep their existing per-slot interpretation.
  const sqrtPriceX96 = tickToSqrtPriceX96(currentTick)
  const denominatedInToken: 0 | 1 = sqrtPriceX96 < FP96 ? 0 : 1

  // Token0-denominated totals
  const currentMargin0 = assets0 + convert1to0(assets1, sqrtPriceX96)
  const requiredMargin0 = required0Native + convert1to0(required1Native, sqrtPriceX96)
  // Token1-denominated totals
  const currentMargin1 = assets1 + convert0to1(assets0, sqrtPriceX96)
  const requiredMargin1 = required1Native + convert0to1(required0Native, sqrtPriceX96)

  const buffer0 = currentMargin0 - requiredMargin0
  const buffer1 = currentMargin1 - requiredMargin1
  const bufferPercent0 = requiredMargin0 === 0n ? null : (buffer0 * 10000n) / requiredMargin0
  const bufferPercent1 = requiredMargin1 === 0n ? null : (buffer1 * 10000n) / requiredMargin1

  // Liquidation prices: present only when the account has positions.
  let lowerLiquidationTick: bigint | null = null
  let upperLiquidationTick: bigint | null = null
  let liquidationDistance: bigint | null = null
  if (liqPricesResult) {
    const liqPriceDown = BigInt(liqPricesResult[0])
    const liqPriceUp = BigInt(liqPricesResult[1])
    lowerLiquidationTick = liqPriceDown === MIN_TICK ? null : liqPriceDown
    upperLiquidationTick = liqPriceUp === MAX_TICK ? null : liqPriceUp
    if (lowerLiquidationTick !== null && upperLiquidationTick !== null) {
      const distLower = currentTick - lowerLiquidationTick
      const distUpper = upperLiquidationTick - currentTick
      liquidationDistance = distLower < distUpper ? distLower : distUpper
    } else if (lowerLiquidationTick !== null) {
      liquidationDistance = currentTick - lowerLiquidationTick
    } else if (upperLiquidationTick !== null) {
      liquidationDistance = upperLiquidationTick - currentTick
    }
  }

  return {
    buffer0,
    buffer1,
    bufferPercent0,
    bufferPercent1,
    currentMargin0,
    currentMargin1,
    requiredMargin0,
    requiredMargin1,
    denominatedInToken,
    liquidationDistance,
    lowerLiquidationTick,
    upperLiquidationTick,
    currentTick,
    _meta,
  }
}
