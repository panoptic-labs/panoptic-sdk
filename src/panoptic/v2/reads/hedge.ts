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
import { PanopticValidationError } from '../errors/sdk'
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
  /**
   * TokenId of the option position to hedge.
   * Optional when both `currentDelta` and `asset` are provided (whole-portfolio hedging).
   */
  tokenId?: bigint
  /**
   * Position size in contracts.
   * Optional when both `currentDelta` and `asset` are provided.
   */
  positionSize?: bigint
  /** Target delta (WAD-scaled, 0n for delta-neutral) */
  targetDelta: bigint
  /** Optional: current delta if adjusting existing position (WAD-scaled) */
  currentDelta?: bigint
  /**
   * Primary asset index (0n or 1n). Used to determine hedge direction.
   * Required when `tokenId` is not provided; ignored when `tokenId` is provided.
   */
  asset?: bigint
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

  // --- Simulation convergence options ---

  /**
   * Simulate the hedge swap and return the post-swap tick.
   * When provided (along with `computeDeltaAtTick`), an iterative loop refines
   * the hedge size to account for AMM price impact.
   */
  simulateSwap?: (hedgeAmount: bigint, hedgeLeg: LegConfig) => Promise<{ tickAfter: bigint } | null>

  /**
   * Recompute portfolio delta at a given tick.
   * Required when `simulateSwap` is provided.
   */
  computeDeltaAtTick?: (tick: bigint) => bigint

  /** Total position size — used for convergence check (sizeDelta * 10000 / totalPositionSize) */
  totalPositionSize?: bigint

  /** Max simulation iterations (default 5) */
  maxSimIterations?: number

  /** Convergence threshold in bps (default 10). Loop stops when size change < this. */
  convergenceThresholdBps?: bigint
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
  /** Number of simulation iterations used (0 if no simulateSwap) */
  simulationIterations: number
  /** Post-swap tick from final simulation (undefined if no simulation) */
  simulatedTickAfter?: bigint
  /** Whether the convergence loop converged within threshold */
  converged: boolean
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
    asset: providedAsset,
    mintTick: providedMintTick,
    blockNumber,
    currentTick: providedCurrentTick,
    tickSpacing: providedTickSpacing,
  } = params

  // Validate: need either tokenId or (currentDelta + asset)
  const hasTokenId = tokenId !== undefined
  const hasDirectDelta = providedCurrentDelta !== undefined && providedAsset !== undefined

  if (!hasTokenId && !hasDirectDelta) {
    throw new PanopticValidationError(
      'getDeltaHedgeParams requires either `tokenId` or both `currentDelta` and `asset`',
    )
  }

  // Validate simulateSwap and computeDeltaAtTick are provided together
  if ((params.simulateSwap !== undefined) !== (params.computeDeltaAtTick !== undefined)) {
    throw new PanopticValidationError(
      'getDeltaHedgeParams: simulateSwap and computeDeltaAtTick must be provided together',
    )
  }

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

  // Determine primary asset and current delta
  let primaryAsset: bigint
  let currentDelta: bigint

  if (hasTokenId) {
    // Decode the tokenId to get legs
    const decoded = decodeTokenId(tokenId)
    primaryAsset = decoded.legs.length > 0 ? decoded.legs[0].asset : 0n

    // Use provided mintTick or default to currentTick
    const mintTick = providedMintTick ?? currentTick

    // Calculate position delta if not provided
    currentDelta =
      providedCurrentDelta ??
      calculatePositionDelta({
        legs: decoded.legs,
        currentTick,
        mintTick,
        positionSize: positionSize!,
        poolTickSpacing: tickSpacing,
      })
  } else {
    // Direct delta + asset mode (whole-portfolio hedging)
    if (providedAsset !== 0n && providedAsset !== 1n) {
      throw new PanopticValidationError(
        `getDeltaHedgeParams: asset must be 0n or 1n, got ${providedAsset}`,
      )
    }
    primaryAsset = providedAsset
    currentDelta = providedCurrentDelta!
  }

  // deltaAdjustment = targetDelta - currentDelta
  // Positive → need to add positive delta; Negative → need to add negative delta.
  const deltaAdjustment = targetDelta - currentDelta

  // Delta is in asset smallest units. A loan+swapAtMint of size X gives
  // effective delta ≈ ±X (in asset smallest units). So hedgeAmount = |deltaAdjustment|.
  const absDeltaAdjustment = deltaAdjustment < 0n ? -deltaAdjustment : deltaAdjustment
  let hedgeAmount = absDeltaAdjustment

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

  // --- Simulation convergence loop ---
  const {
    simulateSwap,
    computeDeltaAtTick,
    totalPositionSize,
    maxSimIterations = 5,
    convergenceThresholdBps = 10n,
  } = params

  let simulationIterations = 0
  let simulatedTickAfter: bigint | undefined
  let converged = true

  if (simulateSwap && computeDeltaAtTick) {
    if (totalPositionSize === undefined || totalPositionSize === 0n) {
      throw new PanopticValidationError(
        'getDeltaHedgeParams: totalPositionSize is required and must be > 0 when simulateSwap is provided',
      )
    }

    converged = false

    for (let i = 0; i < maxSimIterations; i++) {
      simulationIterations = i + 1

      const simResult = await simulateSwap(hedgeAmount, hedgeLeg)
      if (simResult == null) break

      simulatedTickAfter = simResult.tickAfter

      // Recompute portfolio delta at the post-swap tick
      const adjustedDelta = computeDeltaAtTick(simResult.tickAfter)
      const newAdjustment = targetDelta - adjustedDelta
      const newAmount = newAdjustment < 0n ? -newAdjustment : newAdjustment

      // Convergence check
      const sizeDelta = newAmount > hedgeAmount ? newAmount - hedgeAmount : hedgeAmount - newAmount
      const sizeChangeBps = (sizeDelta * 10000n) / totalPositionSize

      hedgeAmount = newAmount

      if (sizeChangeBps <= convergenceThresholdBps || sizeDelta === 0n) {
        converged = true
        break
      }
    }
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
    simulationIterations,
    simulatedTickAfter,
    converged,
  }
}
