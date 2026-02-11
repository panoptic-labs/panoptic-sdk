/**
 * Additional utility functions using PanopticQuery contract.
 *
 * These functions provide enhanced analysis capabilities for portfolio management,
 * risk visualization, and TokenId optimization.
 *
 * @module v2/reads/queryUtils
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta } from '../types'

/**
 * Portfolio value result (without premia).
 */
export interface PortfolioValue {
  /** Value in token 0 */
  value0: bigint
  /** Value in token 1 */
  value1: bigint
  /** Tick at which value was calculated */
  atTick: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for getPortfolioValue.
 */
export interface GetPortfolioValueParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds of open positions */
  tokenIds: bigint[]
  /** Optional: Tick to calculate value at (defaults to current tick) */
  atTick?: bigint
  /** PanopticQuery address (required for this function) */
  queryAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get portfolio value (NAV) without premia.
 *
 * This calculates the net asset value of the portfolio based on Uniswap liquidity
 * at a given tick, excluding accumulated premia. Useful for PnL tracking separate
 * from liquidation value.
 *
 * ## Same-Block Guarantee
 * All data is fetched at a single block.
 *
 * @param params - The parameters
 * @returns Portfolio value with block metadata
 */
export async function getPortfolioValue(params: GetPortfolioValueParams): Promise<PortfolioValue> {
  const { client, poolAddress, account, tokenIds, atTick, queryAddress, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Skip getCurrentTick RPC call when atTick is provided
  const [currentTickResult, _meta] = await Promise.all([
    atTick != null
      ? Promise.resolve(atTick)
      : client
          .readContract({
            address: poolAddress,
            abi: panopticPoolAbi,
            functionName: 'getCurrentTick',
            blockNumber: targetBlockNumber,
          })
          .then((r) => BigInt(r)),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const effectiveTick = currentTickResult

  const result = await client.readContract({
    address: queryAddress,
    abi: panopticQueryAbi,
    functionName: 'getPortfolioValue',
    args: [poolAddress, account, Number(effectiveTick), tokenIds],
    blockNumber: targetBlockNumber,
  })

  const [value0, value1] = result

  return {
    value0,
    value1,
    atTick: effectiveTick,
    _meta,
  }
}

/**
 * Collateral data point across tick range.
 */
export interface CollateralDataPoint {
  /** Tick value */
  tick: bigint
  /** Collateral balance at this tick */
  balance: bigint
  /** Required collateral at this tick */
  required: bigint
}

/**
 * Collateral analysis across tick range result.
 */
export interface CollateralAcrossTicks {
  /** Array of data points (301 points from liquidation range) */
  dataPoints: CollateralDataPoint[]
  /** Liquidation price below current (null if none) */
  liquidationPriceDown: bigint | null
  /** Liquidation price above current (null if none) */
  liquidationPriceUp: bigint | null
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for checkCollateralAcrossTicks.
 */
export interface CheckCollateralAcrossTicksParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds of open positions */
  tokenIds: bigint[]
  /** PanopticQuery address (required for this function) */
  queryAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Check collateral balance vs requirement across a range of ticks.
 *
 * This function returns 301 data points spanning a range around the current price,
 * including liquidation prices. Perfect for charting liquidation risk in a UI.
 *
 * ## Same-Block Guarantee
 * All data is fetched at a single block.
 *
 * @param params - The parameters
 * @returns Collateral analysis across ticks with block metadata
 */
export async function checkCollateralAcrossTicks(
  params: CheckCollateralAcrossTicksParams,
): Promise<CollateralAcrossTicks> {
  const { client, poolAddress, account, tokenIds, queryAddress, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'checkCollateralListOutput',
      args: [poolAddress, account, tokenIds],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [balanceRequired, tickData, liquidationPrices] = result

  // MIN_TICK and MAX_TICK indicate no liquidation at that boundary
  const MIN_TICK = -887272n
  const MAX_TICK = 887272n

  // Convert to data points
  const dataPoints: CollateralDataPoint[] = balanceRequired.map((point, index) => ({
    tick: BigInt(tickData[index]),
    balance: point[0],
    required: point[1],
  }))

  // Convert from number (abitype default for int24) to bigint (viem runtime type)
  const liqPriceDown = BigInt(liquidationPrices[0])
  const liqPriceUp = BigInt(liquidationPrices[1])

  return {
    dataPoints,
    liquidationPriceDown: liqPriceDown === MIN_TICK ? null : liqPriceDown,
    liquidationPriceUp: liqPriceUp === MAX_TICK ? null : liqPriceUp,
    _meta,
  }
}

/**
 * Parameters for optimizeTokenIdRiskPartners.
 */
export interface OptimizeTokenIdRiskPartnersParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** TokenId to optimize */
  tokenId: bigint
  /** Optional: Tick to optimize at (defaults to current tick) */
  atTick?: bigint
  /** PanopticQuery address (required for this function) */
  queryAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Optimize risk partner assignments for a TokenId.
 *
 * Tests all valid risk partner permutations and returns the TokenId with
 * the lowest collateral requirement. Useful when building positions to
 * maximize capital efficiency.
 *
 * ## Same-Block Guarantee
 * Optimization is performed at a single block.
 *
 * Note: Only works for tokenIds with 2+ legs. Single-leg positions return unchanged.
 *
 * @param params - The parameters
 * @returns Optimized TokenId
 */
export async function optimizeTokenIdRiskPartners(
  params: OptimizeTokenIdRiskPartnersParams,
): Promise<bigint> {
  const { client, poolAddress, tokenId, atTick, queryAddress, blockNumber } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())

  // Get current tick if not provided
  let effectiveTick: bigint
  if (atTick !== undefined) {
    effectiveTick = atTick
  } else {
    const currentTickResult = await client.readContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'getCurrentTick',
      blockNumber: targetBlockNumber,
    })
    // Bridge type from panopticPoolAbi (number | bigint) to bigint
    effectiveTick = BigInt(currentTickResult)
  }

  const optimizedTokenId = await client.readContract({
    address: queryAddress,
    abi: panopticQueryAbi,
    functionName: 'optimizeRiskPartners',
    args: [poolAddress, Number(effectiveTick), tokenId],
    blockNumber: targetBlockNumber,
  })

  return optimizedTokenId
}
