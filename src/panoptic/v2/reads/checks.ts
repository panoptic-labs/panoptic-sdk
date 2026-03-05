/**
 * Position and account check functions for the Panoptic v2 SDK.
 *
 * These functions check account liquidatability.
 *
 * @module v2/reads/checks
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta } from '../types'
import { decodeLeftRightUnsigned } from '../writes/utils'

/**
 * Liquidation check result with detailed margin breakdown.
 *
 * **Denomination**: all margin values are cross-converted into a single
 * token by `checkCollateral`. See {@link MarginBuffer.denominatedInToken}.
 */
export interface LiquidationCheck {
  /** Whether the account is liquidatable */
  isLiquidatable: boolean
  /** Margin shortfall for slot 0 (positive = shortfall, negative = excess) */
  marginShortfall0: bigint
  /** Margin shortfall for slot 1 (positive = shortfall, negative = excess) */
  marginShortfall1: bigint
  /** Current margin (collateral balance) for slot 0 */
  currentMargin0: bigint
  /** Current margin (collateral balance) for slot 1 */
  currentMargin1: bigint
  /** Required margin for slot 0 */
  requiredMargin0: bigint
  /** Required margin for slot 1 */
  requiredMargin1: bigint
  /**
   * Which token all margin values are denominated in.
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
  /** Optional: Tick to check liquidation at (defaults to current tick) */
  atTick?: bigint
  /** PanopticQuery address (required for margin calculations) */
  queryAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Check if an account is liquidatable with detailed margin breakdown.
 *
 * An account is liquidatable when its collateral falls below the
 * maintenance margin requirement for its open positions.
 *
 * Note: This function requires PanopticQuery for accurate margin calculations.
 * Without queryAddress, throws PanopticHelperNotDeployedError.
 *
 * @param params - The parameters
 * @returns Liquidation check result with detailed margin breakdown
 * @throws PanopticHelperNotDeployedError - PanopticQuery contract is required
 *
 * @example
 * ```typescript
 * const result = await isLiquidatable({
 *   client,
 *   poolAddress,
 *   account,
 *   tokenIds: [position1, position2],
 *   queryAddress,
 * })
 *
 * if (result.isLiquidatable) {
 *   console.log('Account is liquidatable!')
 *   console.log('Shortfall token0:', result.marginShortfall0)
 *   console.log('Shortfall token1:', result.marginShortfall1)
 * } else {
 *   console.log('Margin buffer token0:', -result.marginShortfall0)
 *   console.log('Margin buffer token1:', -result.marginShortfall1)
 * }
 * ```
 */
export async function isLiquidatable(params: IsLiquidatableParams): Promise<LiquidationCheck> {
  const { client, poolAddress, account, tokenIds, atTick, queryAddress, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

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
    effectiveTick = BigInt(currentTickResult)
  }

  // Use checkCollateral for detailed margin info
  // Returns: [collateralBalance, requiredCollateral] as LeftRightUnsigned packed values
  const [[collateralBalance, requiredCollateral], _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'checkCollateral',
      args: [poolAddress, account, tokenIds, Number(effectiveTick)],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // Decode LeftRightUnsigned packed values (right=token0, left=token1)
  const balances = decodeLeftRightUnsigned(collateralBalance)
  const required = decodeLeftRightUnsigned(requiredCollateral)

  const currentMargin0 = balances.right
  const currentMargin1 = balances.left
  const requiredMargin0 = required.right
  const requiredMargin1 = required.left

  // Calculate shortfall (positive = shortfall, negative = excess margin)
  const marginShortfall0 = requiredMargin0 - currentMargin0
  const marginShortfall1 = requiredMargin1 - currentMargin1

  // Account is liquidatable if either token has positive shortfall
  const isLiquidatableResult = marginShortfall0 > 0n || marginShortfall1 > 0n

  return {
    isLiquidatable: isLiquidatableResult,
    marginShortfall0,
    marginShortfall1,
    currentMargin0,
    currentMargin1,
    requiredMargin0,
    requiredMargin1,
    denominatedInToken: effectiveTick < 0n ? 0n : 1n,
    atTick: effectiveTick,
    _meta,
  }
}
