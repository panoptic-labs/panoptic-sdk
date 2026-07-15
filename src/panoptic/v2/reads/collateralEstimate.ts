/**
 * Collateral estimation functions for the Panoptic v2 SDK.
 *
 * These functions require the PanopticQuery contract which provides
 * on-chain calculation capabilities for collateral requirements.
 *
 * @module v2/reads/collateralEstimate
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients/blockMeta'
import { PanopticError } from '../errors'
import { sqrtPriceX96ToTick, tickToSqrtPriceX96 } from '../formatters/tick'
import { type TokenFlow, simulateWithTokenFlow } from '../simulations/tokenFlow'
import type { StorageAdapter } from '../storage'
import { getTrackedPositionIds } from '../sync/getTrackedPositionIds'
import { addLegToTokenId, countLegs, decodeAllLegs, decodeTickSpacing } from '../tokenId/encoding'
import type { BlockMeta } from '../types'
import { MAX_TICK, MIN_TICK } from '../utils/constants'

/**
 * Max int24 (2^23 - 1), used as the per-position `effectiveLiquidityLimit` (the
 * 3rd element of the dispatch tickAndSpreadLimits triplet). Passing this lets the
 * contract clamp to its real on-chain `maxSpread()` ceiling, matching the live
 * trade. Passing 0 instead forces the limit to 0, so any long-leg removal reverts
 * with EffectiveLiquidityAboveThreshold and ITM/size measurements silently
 * collapse (see PanopticPool._mintInSFPMAndUpdateCollateral / _checkLiquiditySpread).
 */
const MAX_EFFECTIVE_LIQUIDITY_LIMIT = 8388607

/**
 * Collateral estimate result.
 */
export interface CollateralEstimate {
  /** Required collateral for token 0 */
  required0: bigint
  /** Required collateral for token 1 */
  required1: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for estimateCollateralRequired.
 */
export interface EstimateCollateralRequiredParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenId to estimate collateral for */
  tokenId: bigint
  /** Position size (number of contracts) */
  positionSize: bigint
  /** Optional: Tick to calculate collateral at (defaults to current tick) */
  atTick?: bigint
  /** PanopticQuery address */
  queryAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Maximum value of a Solidity `uint64`. `PanopticQuery.getRequiredBase` computes
 * the requirement for a synthetic position sized at `type(uint64).max`, so the
 * returned value must be scaled down to the caller's actual `positionSize`.
 */
const MAX_UINT64 = 2n ** 64n - 1n

/**
 * `getRequiredBase` returns `type(uint128).max` as an error sentinel (invalid
 * tokenId or reverting `getMargin`). Detect it so we don't scale a garbage value.
 */
export const REQUIRED_BASE_ERROR_SENTINEL = 2n ** 128n - 1n

/**
 * Estimate the collateral required to open a position.
 *
 * Note: This function uses PanopticQuery.getRequiredBase for estimation, which
 * computes the requirement at `type(uint64).max` size and 0% utilization. Since
 * the requirement is linear in size, the raw result is scaled by
 * `positionSize / type(uint64).max` to yield the requirement for the requested
 * size. Returns collateral requirement in terms of token0.
 *
 * @param params - The parameters
 * @returns Estimated collateral requirements with block metadata
 */
export async function estimateCollateralRequired(
  params: EstimateCollateralRequiredParams,
): Promise<CollateralEstimate> {
  const { client, poolAddress, tokenId, positionSize, atTick, queryAddress, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Get current tick if not provided
  let effectiveTick: bigint
  if (atTick !== undefined) {
    effectiveTick = atTick
  } else {
    const currentTickResult = await client.readContract({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      functionName: 'getCurrentTick',
      blockNumber: targetBlockNumber,
    })
    // Bridge type from panopticPoolV2Abi (number | bigint) to bigint
    effectiveTick = BigInt(currentTickResult)
  }

  const [required0, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getRequiredBase',
      args: [poolAddress, tokenId, Number(effectiveTick)],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // getRequiredBase computes the requirement at type(uint64).max size. The
  // requirement is linear in size, so scale down to the requested positionSize.
  // Guard against the error sentinel (type(uint128).max) so we don't scale it.
  const scaled0 =
    required0 >= REQUIRED_BASE_ERROR_SENTINEL ? required0 : (required0 * positionSize) / MAX_UINT64

  // PanopticQuery.getRequiredBase returns collateral requirement in terms of token0
  // For token1 requirement, would need additional conversion or separate call
  return {
    required0: scaled0,
    required1: 0n, // Not available from getRequiredBase (token0-denominated only)
    _meta,
  }
}

/**
 * Max position size result.
 */
export interface MaxPositionSize {
  /** Refined maximum position size at current market conditions */
  maxSize: bigint
  /** Maximum position size at 0% utilization (best case / upper bound) */
  maxSizeAtMinUtil: bigint
  /** Maximum position size at 100% utilization (worst case / lower bound) */
  maxSizeAtMaxUtil: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for getMaxPositionSize.
 */
export interface GetMaxPositionSizeParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenId to check max size for */
  tokenId: bigint
  /** PanopticQuery address (required for this function) */
  queryAddress: Address
  /**
   * Existing position IDs held by the account.
   * - If provided, uses these directly
   * - If not provided but storage + chainId given, fetches from getTrackedPositionIds()
   * - If neither provided, assumes empty array (new account with no positions)
   */
  existingPositionIds?: bigint[]
  /** Storage adapter for auto-fetching positions (requires chainId) */
  storage?: StorageAdapter
  /** Chain ID (required if using storage) */
  chainId?: bigint
  /** Whether to refine with dispatch simulation (default: true) */
  refine?: boolean
  /** Precision for binary search as percentage (default: 1 = 1%) */
  precisionPct?: number
  /** Whether to swap tokens at mint (affects collateral requirements, default: false) */
  swapAtMint?: boolean
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get the maximum position size an account can open given their current collateral.
 *
 * Uses PanopticQuery.getMaxPositionSizeBounds to get bounds at 0% and 100% utilization,
 * then refines with dispatch simulations to find the exact max at current conditions.
 *
 * @param params - The parameters
 * @returns Maximum position size with bounds and block metadata
 */
export async function getMaxPositionSize(
  params: GetMaxPositionSizeParams,
): Promise<MaxPositionSize> {
  const {
    client,
    poolAddress,
    account,
    tokenId,
    queryAddress,
    existingPositionIds,
    storage,
    chainId,
    refine = true,
    precisionPct = 1,
    swapAtMint = false,
    blockNumber,
  } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Get existing position IDs
  let positionIds: bigint[]
  if (existingPositionIds !== undefined) {
    // Use explicitly provided position IDs
    positionIds = existingPositionIds
  } else if (storage && chainId !== undefined) {
    // Fetch from local cache via getTrackedPositionIds
    positionIds = await getTrackedPositionIds({
      chainId,
      poolAddress,
      account,
      storage,
    })
  } else {
    // Assume new account with no existing positions
    positionIds = []
  }
  // Get bounds and block meta in parallel
  const [boundsResult, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getMaxPositionSizeBounds',
      args: [poolAddress, positionIds, account, tokenId],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [maxSizeAtMinUtil, maxSizeAtMaxUtil] = boundsResult

  // If bounds are equal or very close, or refinement disabled, return conservative estimate
  const precisionDivisor = BigInt(Math.floor(100 / precisionPct))
  if (
    !refine ||
    maxSizeAtMinUtil === maxSizeAtMaxUtil ||
    maxSizeAtMinUtil - maxSizeAtMaxUtil <= maxSizeAtMaxUtil / precisionDivisor
  ) {
    return {
      maxSize: maxSizeAtMaxUtil,
      maxSizeAtMinUtil,
      maxSizeAtMaxUtil,
      _meta,
    }
  }

  // Binary search between widened bounds using dispatch simulation
  // Widen by 2x in each direction to account for swapAtMint price impact
  const maxSize = await binarySearchMaxSize({
    client,
    poolAddress,
    account,
    tokenId,
    existingPositionIds: positionIds,
    low: maxSizeAtMaxUtil / 2n,
    high: maxSizeAtMinUtil * 2n,
    precisionDivisor,
    swapAtMint,
  })

  return {
    maxSize,
    maxSizeAtMinUtil,
    maxSizeAtMaxUtil,
    _meta,
  }
}

/**
 * Parallel search to find max position size using dispatch simulation.
 * Tests 5 points per round (sextiles), narrowing the range by 6x each iteration.
 */
async function binarySearchMaxSize(params: {
  client: PublicClient
  poolAddress: Address
  account: Address
  tokenId: bigint
  existingPositionIds: bigint[]
  low: bigint
  high: bigint
  precisionDivisor: bigint
  swapAtMint: boolean
}): Promise<bigint> {
  const {
    client,
    poolAddress,
    account,
    tokenId,
    existingPositionIds,
    precisionDivisor,
    swapAtMint,
  } = params
  let { low, high } = params

  const trySize = (positionSize: bigint) =>
    tryDispatchSimulation({
      client,
      poolAddress,
      account,
      tokenId,
      existingPositionIds,
      positionSize,
      swapAtMint,
    })

  while (high - low > 1n && high - low > low / precisionDivisor) {
    const range = high - low
    const p1 = low + range / 6n
    const p2 = low + (range * 2n) / 6n
    const p3 = low + (range * 3n) / 6n
    const p4 = low + (range * 4n) / 6n
    const p5 = low + (range * 5n) / 6n

    const [s1, s2, s3, s4, s5] = await Promise.all([
      trySize(p1),
      trySize(p2),
      trySize(p3),
      trySize(p4),
      trySize(p5),
    ])

    if (s5) {
      low = p5
    } else if (s4) {
      low = p4
      high = p5
    } else if (s3) {
      low = p3
      high = p4
    } else if (s2) {
      low = p2
      high = p3
    } else if (s1) {
      low = p1
      high = p2
    } else {
      high = p1
    }
  }

  return low
}

/**
 * Try to simulate opening a position with the given size.
 */
async function tryDispatchSimulation(params: {
  client: PublicClient
  poolAddress: Address
  account: Address
  tokenId: bigint
  existingPositionIds: bigint[]
  positionSize: bigint
  swapAtMint: boolean
}): Promise<boolean> {
  const { client, poolAddress, account, tokenId, existingPositionIds, positionSize, swapAtMint } =
    params

  try {
    // Build final position list (existing + new position)
    const finalPositionIdList = [...existingPositionIds, tokenId]

    // Build tick limits based on swapAtMint flag:
    // - swapAtMint=true: descending order (high, low) triggers SFPM swap
    // - swapAtMint=false: ascending order (low, high) no swap
    //
    // The third element is the per-position `effectiveLiquidityLimit`; see the
    // MAX_EFFECTIVE_LIQUIDITY_LIMIT definition for why 0 must not be used here.
    const tickLimits: readonly [number, number, number] = swapAtMint
      ? [887272, -887272, MAX_EFFECTIVE_LIQUIDITY_LIMIT]
      : [-887272, 887272, MAX_EFFECTIVE_LIQUIDITY_LIMIT]

    // Encode dispatch call
    const callData = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'dispatch',
      args: [
        [tokenId],
        finalPositionIdList,
        [positionSize as unknown as bigint & { readonly __uint128: true }],
        [tickLimits],
        true, // usePremiaAsCollateral
        0n, // builderCode
      ],
    })

    // Use PanopticPool.multicall to simulate
    await client.simulateContract({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      functionName: 'multicall',
      args: [[callData]],
      account,
    })

    return true
  } catch {
    return false
  }
}

/**
 * Parameters for getRequiredCreditForITM.
 */
export interface GetRequiredCreditForITMParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenId to check */
  tokenId: bigint
  /** Position size (number of contracts) */
  positionSize: bigint
  /** Existing position IDs held by the account (defaults to empty) */
  existingPositionIds?: bigint[]
  /** Optional block number for simulation */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Result for getRequiredCreditForITM.
 */
export interface RequiredCreditForITM {
  /**
   * Required credit in token0 to neutralize ITM exposure.
   * Positive = credit needed (deposit), negative = loan proceeds (receive).
   */
  creditAmount0: bigint
  /**
   * Required credit in token1 to neutralize ITM exposure.
   * Positive = credit needed (deposit), negative = loan proceeds (receive).
   */
  creditAmount1: bigint
  /** The raw token flow from simulation */
  tokenFlow: TokenFlow
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Get the required credit (or loan) amount for an ITM position.
 *
 * Simulates opening the position with swapAtMint=true (descending tickLimits)
 * to get single-sided token flow. The token flow represents the ITM amount
 * that would need to be neutralized with a credit (or loan if negative).
 *
 * @param params - The parameters
 * @returns Required credit amounts with token flow and block metadata
 * @throws PanopticError - If simulation fails
 *
 * @example
 * ```typescript
 * const result = await getRequiredCreditForITM({
 *   client,
 *   poolAddress,
 *   account,
 *   tokenId,
 *   positionSize: 1n,
 * })
 *
 * if (result.creditAmount0 > 0n) {
 *   console.log('Need credit of', result.creditAmount0, 'token0')
 * } else if (result.creditAmount0 < 0n) {
 *   console.log('Position yields loan of', -result.creditAmount0, 'token0')
 * }
 * ```
 */
export async function getRequiredCreditForITM(
  params: GetRequiredCreditForITMParams,
): Promise<RequiredCreditForITM> {
  const {
    client,
    poolAddress,
    account,
    tokenId,
    positionSize,
    existingPositionIds = [],
    blockNumber,
  } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Build final position list (existing + new position)
  const finalPositionIdList = [...existingPositionIds, tokenId]

  // Encode dispatch call with swapAtMint=true (descending tickLimits)
  // Descending order (MAX_TICK > MIN_TICK) triggers SFPM swap, giving single-sided token flow.
  // The 3rd element is the per-position effectiveLiquidityLimit: use the max so the contract
  // clamps to its real maxSpread() ceiling (matching the live trade). Passing 0 here collapses
  // ITM measurement for positions with a long-leg removal (see MAX_EFFECTIVE_LIQUIDITY_LIMIT).
  const callData = encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [
      [tokenId], // positionIdList: positions being minted
      finalPositionIdList,
      [positionSize as unknown as bigint & { readonly __uint128: true }],
      [
        [Number(MAX_TICK), Number(MIN_TICK), MAX_EFFECTIVE_LIQUIDITY_LIMIT] as readonly [
          number,
          number,
          number,
        ],
      ], // Descending = swapAtMint
      false, // usePremiaAsCollateral
      0n, // builderCode
    ],
  })

  // Simulate with token flow measurement and get block meta in parallel
  const [result, _meta] = await Promise.all([
    simulateWithTokenFlow({
      client,
      poolAddress,
      user: account,
      callData,
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  if (!result.success || !result.tokenFlow) {
    throw new PanopticError(result.error ?? 'Token flow simulation failed')
  }

  // The token flow deltas represent the ITM amount:
  // - Negative delta = user deposits (credit needed)
  // - Positive delta = user receives (loan proceeds)
  // We invert the sign so positive = credit needed, negative = loan
  return {
    creditAmount0: -result.tokenFlow.delta0,
    creditAmount1: -result.tokenFlow.delta1,
    tokenFlow: result.tokenFlow,
    _meta,
  }
}

/**
 * Dust threshold (raw token units) below which an ITM measurement is treated as
 * zero. Token-flow deltas carry sub-unit rounding noise from on-chain math and
 * the sqrt/tick conversions below; 1000n raw units swallows that noise while
 * staying many orders of magnitude below any real ITM credit (which is on the
 * order of `positionSize`).
 */
const FLOW_NEUTRAL_DUST_THRESHOLD = 1000n

const Q192 = 1n << 192n
const POOL_ID_MASK = (1n << 64n) - 1n

/**
 * Floor integer square root for bigints (Newton's method). Exact for all
 * non-negative inputs — no float precision loss for values above 2^53.
 */
function isqrt(value: bigint): bigint {
  if (value < 0n) throw new PanopticError('isqrt of negative number')
  if (value < 2n) return value
  let x = value
  let y = (x + 1n) >> 1n
  while (y < x) {
    x = y
    y = (x + value / x) >> 1n
  }
  return x
}

/**
 * Round a signed tick to the nearest multiple of `spacing` (bigint, nearest).
 */
function roundToSpacing(tick: bigint, spacing: bigint): bigint {
  if (spacing <= 1n) return tick
  const half = spacing / 2n
  // bigint division truncates toward zero, so bias by ±half before dividing.
  const quotient = tick >= 0n ? (tick + half) / spacing : (tick - half) / spacing
  return quotient * spacing
}

/**
 * Parameters for createFlowNeutralTokenId.
 */
export interface CreateFlowNeutralTokenIdParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** The base tokenId (without neutralizing leg) */
  tokenId: bigint
  /** Position size (number of contracts) — unchanged by this function */
  positionSize: bigint
  /** Existing position IDs held by the account (defaults to empty) */
  existingPositionIds?: bigint[]
  /** Optional block number for simulation */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata */
  _meta?: BlockMeta
}

/**
 * Result of createFlowNeutralTokenId.
 */
export interface FlowNeutralTokenId {
  /**
   * New tokenId with a single width=0 neutralizing leg prepended at index 0
   * (existing legs shifted to 1..n). Equals the original tokenId if OTM.
   */
  tokenId: bigint
  /**
   * Position size to use when opening this tokenId. Always equal to the input
   * `positionSize` — the neutralizing leg is sized via its strike, not by
   * rescaling the position.
   */
  positionSize: bigint
  /** The computed strike of the neutralizing leg (0n if OTM). */
  neutralStrike: bigint
  /** Asset (0n or 1n) of the neutralizing leg (0n if OTM). */
  neutralAsset: bigint
  /** Token type (0n or 1n) of the neutralizing leg (0n if OTM). */
  neutralTokenType: bigint
  /** true = credit leg (isLong), false = loan leg; only meaningful when a leg was added. */
  neutralIsCredit: boolean
  /** The raw ITM measurement that drove the leg sizing. */
  originalCredit: RequiredCreditForITM
  /**
   * Tick-spacing rounding residual (solved tick − rounded tick) for diagnostics.
   * The achieved notional differs from the exact ITM amount by at most ~half a
   * tick-spacing in basis points (each tick ≈ 1bp) — an intended approximation.
   */
  strikeResidualTick: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Create a flow-neutral tokenId by prepending a width=0 credit/loan leg that
 * offsets the net ITM token flow.
 *
 * When a position is ITM, opening it produces an imbalanced single-sided token
 * flow. This function measures that net flow via {@link getRequiredCreditForITM}
 * and prepends a single width=0 leg (at index 0, with `asset !== tokenType` so
 * its notional scales continuously by strike) sized so its token flow is equal
 * and opposite. The result has net flow ~zero at mint.
 *
 * The leg occupies index 0; existing legs are shifted to indices 1..n with their
 * `riskPartner` references remapped (self-partners stay self, cross-partners +1).
 * The input `positionSize` is never modified — the leg is sized via its strike.
 *
 * @param params - The parameters
 * @returns The flow-neutral tokenId with metadata
 * @throws PanopticError if the tokenId already has 4 legs, positionSize <= 0, or
 *   the required neutralizing strike falls outside the valid tick range.
 */
export async function createFlowNeutralTokenId(
  params: CreateFlowNeutralTokenIdParams,
): Promise<FlowNeutralTokenId> {
  const { client, poolAddress, account, tokenId, positionSize, existingPositionIds, blockNumber } =
    params

  if (positionSize <= 0n) {
    throw new PanopticError('positionSize must be positive to create flow-neutral position')
  }

  const legCount = countLegs(tokenId)
  if (legCount >= 4n) {
    throw new PanopticError('Cannot prepend neutralizing leg: tokenId already has 4 legs')
  }

  // Measure net ITM exposure. positive = user deposits (credit needed),
  // negative = user receives (loan proceeds).
  const credit = await getRequiredCreditForITM({
    client,
    poolAddress,
    account,
    tokenId,
    positionSize,
    existingPositionIds,
    blockNumber,
    _meta: params._meta,
  })

  // Select the token carrying the dominant ITM flow. Compare by VALUE, not raw
  // integer magnitude: token0 and token1 typically have different decimals (e.g.
  // 18 vs 6), so a tiny residual flow in the higher-decimal token would otherwise
  // out-number the real ITM in the lower-decimal token. Convert token0 into
  // token1 units via the current price (P = 1.0001^tick = sqrtP^2 / 2^192).
  const abs0 = credit.creditAmount0 < 0n ? -credit.creditAmount0 : credit.creditAmount0
  const abs1 = credit.creditAmount1 < 0n ? -credit.creditAmount1 : credit.creditAmount1
  const tickBefore = credit.tokenFlow.tickBefore
  if (tickBefore === null) {
    throw new PanopticError('Cannot create flow-neutral position: current tick unavailable')
  }
  const sqrtPX96 = tickToSqrtPriceX96(tickBefore)
  const abs0InToken1 = (abs0 * sqrtPX96 * sqrtPX96) / Q192

  let itmTokenIndex: 0n | 1n
  let amount: bigint
  if (abs0InToken1 <= FLOW_NEUTRAL_DUST_THRESHOLD && abs1 <= FLOW_NEUTRAL_DUST_THRESHOLD) {
    // OTM — no neutralizing leg needed (both flows are dust in token1 terms).
    return {
      tokenId,
      positionSize,
      neutralStrike: 0n,
      neutralAsset: 0n,
      neutralTokenType: 0n,
      neutralIsCredit: false,
      originalCredit: credit,
      strikeResidualTick: 0n,
      _meta: credit._meta,
    }
  } else if (abs0InToken1 >= abs1) {
    itmTokenIndex = 0n
    amount = credit.creditAmount0
  } else {
    itmTokenIndex = 1n
    amount = credit.creditAmount1
  }

  const absAmount = amount < 0n ? -amount : amount

  // The neutralizing leg moves the ITM token (tokenType = itmTokenIndex) and is
  // priced in the opposite asset so its notional scales by strike.
  const legTokenType = itmTokenIndex
  const legAsset = itmTokenIndex === 0n ? 1n : 0n
  // The neutralizing leg must produce the OPPOSITE flow of the ITM.
  // `amount` is creditAmount = -delta (positive = user deposits / credit needed;
  // negative = user receives / loan proceeds), so:
  //   amount < 0 (user receives) → CREDIT (isLong) makes them deposit it back.
  //   amount > 0 (user deposits) → LOAN (short) pays it out to them.
  const legIsLong = amount < 0n

  // Solve the strike so the leg notional matches absAmount.
  // notional_tokenType = positionSize * 1.0001^signedStrike, so
  //   1.0001^signedStrike = absAmount / positionSize
  //   sqrtKrawX96 = sqrt(absAmount / positionSize) * 2^96
  //              = isqrt(absAmount * 2^192 / positionSize)
  const sqrtKrawX96 = isqrt((absAmount * Q192) / positionSize)

  let signedTick: bigint
  try {
    signedTick = sqrtPriceX96ToTick(sqrtKrawX96)
  } catch {
    throw new PanopticError(
      'Cannot create flow-neutral position: neutralizing strike out of bounds',
    )
  }

  const tickSpacing = decodeTickSpacing(tokenId)
  const roundedTick = roundToSpacing(signedTick, tickSpacing)
  const strikeResidualTick = signedTick - roundedTick

  // After grid rounding the strike must still be a valid in-range tick. Clamping to
  // MIN_TICK/MAX_TICK would (a) likely be off the tick-spacing grid and (b) materially
  // change the notional, producing a non-neutral leg — so throw instead.
  if (roundedTick < MIN_TICK || roundedTick > MAX_TICK) {
    throw new PanopticError(
      'Cannot create flow-neutral position: neutralizing strike out of bounds',
    )
  }

  // signedStrike = (asset === 0 ? strike : -strike) — invert to recover the
  // encoded strike (mirrors getLegValueWidth0's convention).
  const neutralStrike = legAsset === 0n ? roundedTick : -roundedTick

  // Rebuild the tokenId: neutralizing leg at index 0, existing legs shifted +1.
  const poolId = tokenId & POOL_ID_MASK
  let newTokenId = addLegToTokenId(poolId, {
    index: 0n,
    asset: legAsset,
    tokenType: legTokenType,
    optionRatio: 1n,
    isLong: legIsLong ? 1n : 0n,
    riskPartner: 0n,
    strike: neutralStrike,
    width: 0n,
  })

  for (const leg of decodeAllLegs(tokenId)) {
    const newIndex = leg.index + 1n
    const newRiskPartner = leg.riskPartner === leg.index ? newIndex : leg.riskPartner + 1n
    newTokenId = addLegToTokenId(newTokenId, {
      index: newIndex,
      asset: leg.asset,
      tokenType: leg.tokenType,
      optionRatio: leg.optionRatio,
      isLong: leg.isLong ? 1n : 0n,
      riskPartner: newRiskPartner,
      strike: leg.strike,
      width: leg.width,
    })
  }

  return {
    tokenId: newTokenId,
    positionSize,
    neutralStrike,
    neutralAsset: legAsset,
    neutralTokenType: legTokenType,
    neutralIsCredit: legIsLong,
    originalCredit: credit,
    strikeResidualTick,
    _meta: credit._meta,
  }
}

/**
 * Parameters for getMaxWithdrawable.
 */
export interface GetMaxWithdrawableParams {
  /** viem PublicClient */
  client: PublicClient
  /** CollateralTracker address */
  collateralTrackerAddress: Address
  /** Account address */
  account: Address
  /** Position IDs held by the account (required for solvency-checked withdraw) */
  positionIdList: bigint[]
  /** Upper bound for the binary search (e.g. user's total assets in this tracker) */
  totalAssets: bigint
  /** Whether to use premia as collateral (default: false) */
  usePremiaAsCollateral?: boolean
  /** Precision for binary search as percentage (default: 1 = 1%) */
  precisionPct?: number
}

/**
 * Find the maximum withdrawable amount from a CollateralTracker using binary search.
 *
 * When a user has open positions, the standard `maxWithdraw()` returns 0 because
 * the basic ERC4626 withdraw doesn't check solvency. The overloaded
 * `withdraw(assets, receiver, owner, positionIdList, usePremiaAsCollateral)` does
 * check solvency, so we binary search for the largest amount that doesn't revert.
 *
 * @param params - The parameters
 * @returns Maximum withdrawable amount in underlying asset units
 */
export async function getMaxWithdrawable(
  params: GetMaxWithdrawableParams,
): Promise<{ maxWithdrawable: bigint; _meta: BlockMeta }> {
  const {
    client,
    collateralTrackerAddress,
    account,
    positionIdList,
    totalAssets,
    usePremiaAsCollateral = false,
    precisionPct = 1,
  } = params

  const _meta = await getBlockMeta({ client })

  if (totalAssets <= 0n || positionIdList.length === 0) {
    // No positions: use the standard maxWithdraw
    const maxWithdraw = await client.readContract({
      address: collateralTrackerAddress,
      abi: collateralTrackerV2Abi,
      functionName: 'maxWithdraw',
      args: [account],
    })
    return { maxWithdrawable: maxWithdraw, _meta }
  }

  const precisionDivisor = BigInt(Math.floor(100 / precisionPct))
  let low = 0n
  let high = totalAssets

  while (high - low > 1n && high - low > low / precisionDivisor) {
    const mid = low + (high - low) / 2n

    const success = await tryWithdrawSimulation({
      client,
      collateralTrackerAddress,
      account,
      assets: mid,
      positionIdList,
      usePremiaAsCollateral,
    })

    if (success) {
      low = mid
    } else {
      high = mid
    }
  }

  return { maxWithdrawable: low, _meta }
}

/**
 * Try to simulate a solvency-checked withdraw with the given amount.
 */
async function tryWithdrawSimulation(params: {
  client: PublicClient
  collateralTrackerAddress: Address
  account: Address
  assets: bigint
  positionIdList: bigint[]
  usePremiaAsCollateral: boolean
}): Promise<boolean> {
  const {
    client,
    collateralTrackerAddress,
    account,
    assets,
    positionIdList,
    usePremiaAsCollateral,
  } = params

  try {
    await client.estimateContractGas({
      address: collateralTrackerAddress,
      abi: collateralTrackerV2Abi,
      functionName: 'withdraw',
      args: [assets, account, account, positionIdList, usePremiaAsCollateral],
      account,
    })
    return true
  } catch {
    return false
  }
}
