/**
 * Premia read functions for the Panoptic v2 SDK.
 * @module v2/reads/premia
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta, Position, TokenIdLeg } from '../types'
import { decodePosition, decodeTickSpacing } from '../utils/option-encoding-v2'
import { decodeLeftRightUnsigned } from '../writes/utils'

/**
 * Premia data for an account.
 */
export interface AccountPremia {
  /** Total short premium owed to the account for token 0 */
  shortPremium0: bigint
  /** Total short premium owed to the account for token 1 */
  shortPremium1: bigint
  /** Total long premium owed by the account for token 0 */
  longPremium0: bigint
  /** Total long premium owed by the account for token 1 */
  longPremium1: bigint
  /** Whether pending (unsettled) premium was included */
  includePendingPremium: boolean
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for getAccountPremia.
 */
export interface GetAccountPremiaParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds held by the account */
  tokenIds: bigint[]
  /** Whether to include pending (unsettled) premium (default: true) */
  includePendingPremium?: boolean
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get premia totals for an account.
 *
 * Returns the total short and long premium across all positions.
 * Short premium is owed TO the account (earned from selling options).
 * Long premium is owed BY the account (paid for buying options).
 *
 * @param params - The parameters
 * @returns Premia totals with block metadata
 *
 * @example
 * ```typescript
 * const premia = await getAccountPremia({
 *   client,
 *   poolAddress,
 *   account,
 *   tokenIds: [tokenId1, tokenId2],
 *   includePendingPremium: true,
 * })
 *
 * console.log('Short premium earned:', premia.shortPremium0, premia.shortPremium1)
 * console.log('Long premium owed:', premia.longPremium0, premia.longPremium1)
 * ```
 */
export async function getAccountPremia(params: GetAccountPremiaParams): Promise<AccountPremia> {
  const {
    client,
    poolAddress,
    account,
    tokenIds,
    includePendingPremium = true,
    blockNumber,
  } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Handle empty position list
  if (tokenIds.length === 0) {
    const _meta = params._meta ?? (await getBlockMeta({ client, blockNumber: targetBlockNumber }))
    return {
      shortPremium0: 0n,
      shortPremium1: 0n,
      longPremium0: 0n,
      longPremium1: 0n,
      includePendingPremium,
      _meta,
    }
  }

  const [[shortPremiumPacked, longPremiumPacked], _meta] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'getAccumulatedFeesAndPositionsData',
      args: [account, includePendingPremium, tokenIds],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // Decode LeftRightUnsigned values (right = token0, left = token1)
  const shortPremium = decodeLeftRightUnsigned(shortPremiumPacked)
  const longPremium = decodeLeftRightUnsigned(longPremiumPacked)

  return {
    shortPremium0: shortPremium.right,
    shortPremium1: shortPremium.left,
    longPremium0: longPremium.right,
    longPremium1: longPremium.left,
    includePendingPremium,
    _meta,
  }
}

/**
 * Position with premia data.
 */
export interface PositionWithPremia extends Position {
  // Position already has all fields from the base Position interface
}

/**
 * Result from getPositionsWithPremia.
 */
export interface PositionsWithPremiaResult {
  /** Positions with full data */
  positions: PositionWithPremia[]
  /** Total short premium owed to the account for token 0 */
  shortPremium0: bigint
  /** Total short premium owed to the account for token 1 */
  shortPremium1: bigint
  /** Total long premium owed by the account for token 0 */
  longPremium0: bigint
  /** Total long premium owed by the account for token 1 */
  longPremium1: bigint
  /** Whether pending (unsettled) premium was included */
  includePendingPremium: boolean
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for getPositionsWithPremia.
 */
export interface GetPositionsWithPremiaParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds held by the account */
  tokenIds: bigint[]
  /** Whether to include pending (unsettled) premium (default: true) */
  includePendingPremium?: boolean
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get positions with per-position premia data.
 *
 * Uses multicall to batch individual getAccumulatedFeesAndPositionsData calls
 * for each position, giving us per-position premia in a single RPC request.
 *
 * @param params - The parameters
 * @returns Positions with premia and totals with block metadata
 *
 * @example
 * ```typescript
 * const result = await getPositionsWithPremia({
 *   client,
 *   poolAddress,
 *   account,
 *   tokenIds: [tokenId1, tokenId2],
 * })
 *
 * for (const position of result.positions) {
 *   console.log('Position:', position.tokenId)
 *   console.log('Premia:', position.premiaOwed0, position.premiaOwed1)
 * }
 * console.log('Total short premium:', result.shortPremium0, result.shortPremium1)
 * ```
 */
export async function getPositionsWithPremia(
  params: GetPositionsWithPremiaParams,
): Promise<PositionsWithPremiaResult> {
  const {
    client,
    poolAddress,
    account,
    tokenIds,
    includePendingPremium = true,
    blockNumber,
  } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Handle empty position list
  if (tokenIds.length === 0) {
    const _meta = params._meta ?? (await getBlockMeta({ client, blockNumber: targetBlockNumber }))
    return {
      positions: [],
      shortPremium0: 0n,
      shortPremium1: 0n,
      longPremium0: 0n,
      longPremium1: 0n,
      includePendingPremium,
      _meta,
    }
  }

  // Build multicall contracts - one getAccumulatedFeesAndPositionsData call per tokenId
  // This gives us per-position premia
  const contracts = tokenIds.map((tokenId) => ({
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'getAccumulatedFeesAndPositionsData' as const,
    args: [account, includePendingPremium, [tokenId]] as const,
  }))

  // Execute multicall and get block metadata
  const [multicallResults, _meta] = await Promise.all([
    client.multicall({
      contracts,
      blockNumber: targetBlockNumber,
      allowFailure: true,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // Build positions and accumulate totals
  const positions: PositionWithPremia[] = []
  let totalShortPremium0 = 0n
  let totalShortPremium1 = 0n
  let totalLongPremium0 = 0n
  let totalLongPremium1 = 0n

  for (let i = 0; i < tokenIds.length; i++) {
    const tokenId = tokenIds[i]
    const result = multicallResults[i]

    // Skip failed calls
    if (result.status !== 'success') {
      continue
    }

    const [shortPremiumPacked, longPremiumPacked, balances] = result.result

    // Decode per-position premia
    const shortPremium = decodeLeftRightUnsigned(shortPremiumPacked)
    const longPremium = decodeLeftRightUnsigned(longPremiumPacked)

    // Accumulate totals
    totalShortPremium0 += shortPremium.right
    totalShortPremium1 += shortPremium.left
    totalLongPremium0 += longPremium.right
    totalLongPremium1 += longPremium.left

    // Get balance data (should be single element array)
    const balanceData = balances[0]
    if (balanceData === undefined) {
      continue
    }

    // Decode the PositionBalance
    const positionSize = balanceData & ((1n << 128n) - 1n)

    // Skip positions with zero size
    if (positionSize === 0n) {
      continue
    }

    const poolUtilization0 = (balanceData >> 128n) & 0xffffn
    const poolUtilization1 = (balanceData >> 144n) & 0xffffn

    // tickAtMint is int24 at bits 160-183
    let tickAtMint = (balanceData >> 160n) & 0xffffffn
    if (tickAtMint > 0x7fffffn) {
      tickAtMint = tickAtMint - 0x1000000n
    }

    const timestampAtMint = (balanceData >> 184n) & 0xffffffffn
    const blockAtMint = (balanceData >> 216n) & ((1n << 39n) - 1n)
    const swapAtMint = balanceData >> 255n === 1n

    // Decode the tokenId to get legs
    const decoded = decodePosition(tokenId)
    const tickSpacing = decodeTickSpacing(tokenId)

    // Convert decoded legs to TokenIdLeg format
    const legs: TokenIdLeg[] = decoded.legs.map((leg) => {
      const width = leg.width
      const strike = leg.strike
      const tickLower = strike - (width * tickSpacing) / 2n
      const tickUpper = strike + (width * tickSpacing) / 2n

      return {
        index: BigInt(leg.index),
        asset: leg.asset,
        optionRatio: leg.optionRatio,
        isLong: leg.isLong === 1n,
        tokenType: leg.tokenType,
        riskPartner: leg.riskPartner,
        strike,
        width,
        tickLower,
        tickUpper,
      }
    })

    // Calculate net premia for this position
    // Positive = position has earned premium (short), Negative = position owes premium (long)
    const premiaOwed0 = shortPremium.right - longPremium.right
    const premiaOwed1 = shortPremium.left - longPremium.left

    positions.push({
      tokenId,
      positionSize,
      owner: account,
      poolAddress,
      legs,
      poolUtilization0AtMint: poolUtilization0,
      poolUtilization1AtMint: poolUtilization1,
      tickAtMint,
      timestampAtMint,
      blockNumberAtMint: blockAtMint,
      swapAtMint,
      premiaOwed0,
      premiaOwed1,
      assetIndex: legs.length > 0 ? legs[0].asset : 0n,
      _meta,
    })
  }

  return {
    positions,
    shortPremium0: totalShortPremium0,
    shortPremium1: totalShortPremium1,
    longPremium0: totalLongPremium0,
    longPremium1: totalLongPremium1,
    includePendingPremium,
    _meta,
  }
}
