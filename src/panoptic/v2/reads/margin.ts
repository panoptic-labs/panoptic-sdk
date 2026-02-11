/**
 * Margin buffer and distance-to-liquidation convenience function.
 *
 * Composes `checkCollateral` + `getLiquidationPrices` into a single call
 * with all RPC reads pinned to the same block.
 *
 * @module v2/reads/margin
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients/blockMeta'
import { PanopticHelperNotDeployedError } from '../errors'
import type { BlockMeta } from '../types'
import { decodeLeftRightUnsigned } from '../writes/utils'

// Sentinel ticks used by PanopticQuery to indicate "no liquidation at this boundary"
const MIN_TICK = -887272n
const MAX_TICK = 887272n

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
  /** TokenIds of open positions */
  tokenIds: bigint[]
  /** PanopticQuery address (required) */
  queryAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Margin buffer result with distance-to-liquidation.
 */
export interface MarginBuffer {
  /** Excess margin for token0 (positive = safe, negative = shortfall) */
  buffer0: bigint
  /** Excess margin for token1 (positive = safe, negative = shortfall) */
  buffer1: bigint
  /** Buffer as percentage of required margin in bps (token0). null if no requirement. */
  bufferPercent0: bigint | null
  /** Buffer as percentage of required margin in bps (token1). null if no requirement. */
  bufferPercent1: bigint | null
  /** Current collateral balance for token0 */
  currentMargin0: bigint
  /** Current collateral balance for token1 */
  currentMargin1: bigint
  /** Required margin for token0 */
  requiredMargin0: bigint
  /** Required margin for token1 */
  requiredMargin1: bigint
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
 * Composes `checkCollateral` and `getLiquidationPrices` RPC calls
 * into a single function, with all reads pinned to the same block.
 *
 * Uses a two-phase approach: first fetches the current tick (needed as
 * input for `checkCollateral`), then runs `checkCollateral`,
 * `getLiquidationPrices`, and `getBlockMeta` in parallel.
 *
 * @param params - The parameters
 * @returns Margin buffer with liquidation distance and block metadata
 * @throws PanopticHelperNotDeployedError - when queryAddress is not provided
 *
 * @example
 * ```typescript
 * const margin = await getMarginBuffer({
 *   client,
 *   poolAddress,
 *   account,
 *   tokenIds: [position1, position2],
 *   queryAddress,
 * })
 *
 * if (margin.buffer0 < 0n || margin.buffer1 < 0n) {
 *   console.log('Account has margin shortfall!')
 * }
 *
 * if (margin.liquidationDistance !== null) {
 *   console.log('Ticks to liquidation:', margin.liquidationDistance)
 * }
 * ```
 */
export async function getMarginBuffer(params: GetMarginBufferParams): Promise<MarginBuffer> {
  const { client, poolAddress, account, tokenIds, queryAddress, blockNumber } = params

  if (!queryAddress) {
    throw new PanopticHelperNotDeployedError()
  }

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Phase 1: Get current tick (needed for checkCollateral's atTick param)
  const currentTickResult = await client.readContract({
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'getCurrentTick',
    blockNumber: targetBlockNumber,
  })

  const currentTick = BigInt(currentTickResult)

  // Phase 2: checkCollateral, getLiquidationPrices, getBlockMeta in parallel
  const [checkResult, liqPricesResult, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'checkCollateral',
      args: [poolAddress, account, tokenIds, Number(currentTick)],
      blockNumber: targetBlockNumber,
    }) as Promise<[bigint, bigint]>,
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getLiquidationPrices',
      args: [poolAddress, account, tokenIds],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [collateralBalance, requiredCollateral] = checkResult

  // Decode LeftRightUnsigned packed values (right=token0, left=token1)
  const balances = decodeLeftRightUnsigned(collateralBalance)
  const required = decodeLeftRightUnsigned(requiredCollateral)

  const currentMargin0 = balances.right
  const currentMargin1 = balances.left
  const requiredMargin0 = required.right
  const requiredMargin1 = required.left

  // Buffer = current - required (positive = safe, negative = shortfall)
  const buffer0 = currentMargin0 - requiredMargin0
  const buffer1 = currentMargin1 - requiredMargin1

  // Buffer as percentage of required margin in bps (null when no requirement)
  const bufferPercent0 = requiredMargin0 === 0n ? null : (buffer0 * 10000n) / requiredMargin0
  const bufferPercent1 = requiredMargin1 === 0n ? null : (buffer1 * 10000n) / requiredMargin1

  // Decode liquidation prices (int24 → number from ABI, convert to bigint)
  const liqPriceDown = BigInt(liqPricesResult[0])
  const liqPriceUp = BigInt(liqPricesResult[1])

  const lowerLiquidationTick = liqPriceDown === MIN_TICK ? null : liqPriceDown
  const upperLiquidationTick = liqPriceUp === MAX_TICK ? null : liqPriceUp

  // Distance to nearest liquidation boundary
  let liquidationDistance: bigint | null = null
  if (lowerLiquidationTick !== null && upperLiquidationTick !== null) {
    const distLower = currentTick - lowerLiquidationTick
    const distUpper = upperLiquidationTick - currentTick
    liquidationDistance = distLower < distUpper ? distLower : distUpper
  } else if (lowerLiquidationTick !== null) {
    liquidationDistance = currentTick - lowerLiquidationTick
  } else if (upperLiquidationTick !== null) {
    liquidationDistance = upperLiquidationTick - currentTick
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
    liquidationDistance,
    lowerLiquidationTick,
    upperLiquidationTick,
    currentTick,
    _meta,
  }
}
