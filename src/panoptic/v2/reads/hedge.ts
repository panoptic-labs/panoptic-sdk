/**
 * Delta hedging utilities for the Panoptic v2 SDK.
 *
 * Provides functions to calculate loan parameters needed
 * to achieve a target delta for option positions.
 *
 * @module v2/reads/hedge
 */

import type { Address, PublicClient } from 'viem'

import { getBlockMeta } from '../clients/blockMeta'
import { calculatePositionDelta } from '../greeks'
import { decodeTokenId } from '../tokenId'
import type { LegConfig } from '../tokenId/builder'
import type { BlockMeta } from '../types'
import { getPool } from './pool'

/**
 * Parameters for getDeltaHedgeParams.
 */
export interface GetDeltaHedgeParamsInput {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Chain ID */
  chainId: bigint
  /** TokenId of the option position to hedge */
  tokenId: bigint
  /** Position size in contracts */
  positionSize: bigint
  /** Target delta (WAD-scaled, 0n for delta-neutral) */
  targetDelta: bigint
  /** Optional: current delta if adjusting existing position (WAD-scaled) */
  currentDelta?: bigint
  /** Optional: tick at mint (defaults to current tick if not provided) */
  mintTick?: bigint
  /** Optional: block number for historical queries */
  blockNumber?: bigint
  /** Optional: current tick (skips getPool() when both currentTick and tickSpacing are provided) */
  currentTick?: bigint
  /** Optional: pool tick spacing (skips getPool() when both currentTick and tickSpacing are provided) */
  tickSpacing?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Result of getDeltaHedgeParams.
 */
export interface DeltaHedgeResult {
  /** LegConfig to add to the position for hedging */
  hedgeLeg: LegConfig
  /** The hedge amount (in position size units) */
  hedgeAmount: bigint
  /** Always 'loan' — the tokenType determines the delta direction */
  hedgeType: 'loan' | 'credit'
  /** Whether the hedge position should be opened with swapAtMint */
  swapAtMint: boolean
  /** Current position delta (WAD-scaled) */
  currentDelta: bigint
  /** Target delta (WAD-scaled) */
  targetDelta: bigint
  /** Delta adjustment needed (WAD-scaled) */
  deltaAdjustment: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Calculate loan parameters to achieve target delta via swapAtMint.
 *
 * Both delta directions use loans with swapAtMint — the tokenType
 * determines whether delta is added or removed:
 *
 * - **Need positive delta** (e.g. hedging a short call):
 *   Loan with tokenType = numeraire + swapAtMint.
 *   Borrows numeraire (e.g. USDC), swaps to asset (e.g. ETH).
 *   Net: +asset exposure → positive delta.
 *
 * - **Need negative delta** (e.g. hedging a short put):
 *   Loan with tokenType = asset + swapAtMint.
 *   Borrows asset (e.g. ETH), swaps to numeraire (e.g. USDC).
 *   Net: −asset exposure → negative delta.
 *
 * ## Example: Delta-neutral short call
 * ```typescript
 * const hedge = await getDeltaHedgeParams({
 *   client, poolAddress, chainId,
 *   tokenId: shortCallTokenId,
 *   positionSize: 1000000000000000n,
 *   targetDelta: 0n,
 * })
 *
 * // Open the hedge as a separate position with swapAtMint
 * const hedgeTokenId = builder
 *   .addLoan({ tokenType: hedge.hedgeLeg.tokenType, strike: hedge.hedgeLeg.strike })
 *   .build()
 *
 * await openPosition({ ..., tokenId: hedgeTokenId,
 *   positionSize: hedge.hedgeAmount, swapAtMint: hedge.swapAtMint })
 * ```
 *
 * @param params - The parameters
 * @returns Delta hedge result with LegConfig (always a loan)
 */
export async function getDeltaHedgeParams(
  params: GetDeltaHedgeParamsInput,
): Promise<DeltaHedgeResult> {
  const {
    client,
    poolAddress,
    chainId,
    tokenId,
    positionSize,
    targetDelta,
    currentDelta: providedCurrentDelta,
    mintTick: providedMintTick,
    blockNumber,
    currentTick: providedCurrentTick,
    tickSpacing: providedTickSpacing,
  } = params

  // If both currentTick and tickSpacing are provided, skip the full getPool() call
  let currentTick: bigint
  let tickSpacing: bigint
  let poolMeta: BlockMeta

  if (providedCurrentTick !== undefined && providedTickSpacing !== undefined) {
    currentTick = providedCurrentTick
    tickSpacing = providedTickSpacing
    poolMeta =
      params._meta ??
      (await getBlockMeta({ client, blockNumber: blockNumber ?? (await client.getBlockNumber()) }))
  } else {
    const pool = await getPool({
      client,
      poolAddress,
      chainId,
      blockNumber,
    })
    currentTick = pool.currentTick
    tickSpacing = pool.poolKey.tickSpacing
    poolMeta = pool._meta
  }

  // Decode the tokenId to get legs
  const decoded = decodeTokenId(tokenId)

  // Use provided mintTick or default to currentTick
  const mintTick = providedMintTick ?? currentTick

  // Calculate position delta if not provided
  const currentDelta =
    providedCurrentDelta ??
    calculatePositionDelta({
      legs: decoded.legs,
      currentTick,
      mintTick,
      positionSize,
      poolTickSpacing: tickSpacing,
    })

  // deltaAdjustment = targetDelta - currentDelta
  // Positive → need to add positive delta; Negative → need to add negative delta.
  const deltaAdjustment = targetDelta - currentDelta

  // Delta is in asset smallest units. A loan+swapAtMint of size X gives
  // effective delta ≈ ±X (in asset smallest units). So hedgeAmount = |deltaAdjustment|.
  const absDeltaAdjustment = deltaAdjustment < 0n ? -deltaAdjustment : deltaAdjustment
  const hedgeAmount = absDeltaAdjustment

  // Determine the primary asset from the position being hedged
  const primaryAsset = decoded.legs.length > 0 ? decoded.legs[0].asset : 0n
  const numeraire = primaryAsset === 0n ? 1n : 0n

  // Both directions use a loan + swapAtMint.  The tokenType determines direction:
  //   deltaAdjustment > 0 (need +delta): loan numeraire → swap to asset → +asset exposure
  //   deltaAdjustment < 0 (need −delta): loan asset    → swap to numeraire → −asset exposure
  const needPositiveDelta = deltaAdjustment > 0n
  const hedgeTokenType = needPositiveDelta ? numeraire : primaryAsset

  const hedgeLeg: LegConfig = {
    asset: primaryAsset,
    optionRatio: 1n,
    isLong: false, // Always a loan
    tokenType: hedgeTokenType,
    strike: (currentTick / tickSpacing) * tickSpacing, // Round to tick spacing
    width: 0n, // Loan/credit indicator
  }
  return {
    hedgeLeg,
    hedgeAmount,
    hedgeType: 'loan',
    swapAtMint: true,
    currentDelta,
    targetDelta,
    deltaAdjustment,
    _meta: poolMeta,
  }
}
