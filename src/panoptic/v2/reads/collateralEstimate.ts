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
import { addLegToTokenId, countLegs, decodeAllLegs } from '../tokenId/encoding'
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
  /**
   * Whether the solvency simulation may count accrued premia as collateral. MUST match the
   * mint (which uses `false`) — passing `true` credits premia the mint won't, so the search
   * returns a size larger than the account can actually mint. Defaults to `false`.
   */
  usePremiaAsCollateral?: boolean
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
    usePremiaAsCollateral = false,
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
    usePremiaAsCollateral,
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
  usePremiaAsCollateral: boolean
}): Promise<bigint> {
  const {
    client,
    poolAddress,
    account,
    tokenId,
    existingPositionIds,
    precisionDivisor,
    swapAtMint,
    usePremiaAsCollateral,
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
      usePremiaAsCollateral,
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
  usePremiaAsCollateral: boolean
}): Promise<boolean> {
  const {
    client,
    poolAddress,
    account,
    tokenId,
    existingPositionIds,
    positionSize,
    swapAtMint,
    usePremiaAsCollateral,
  } = params

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
        [positionSize],
        [tickLimits],
        usePremiaAsCollateral, // must match the mint (default false) so the max is mintable
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
  /**
   * Whether the position will be minted with a token swap (Zap). Controls the
   * dispatch tickLimit direction and therefore what the measured flow looks like:
   * - `true` (default): descending tickLimits → SFPM swap → flow consolidated to
   *   the single token the mint would swap into.
   * - `false`: ascending tickLimits → no swap → the true two-sided flow (both
   *   tokens), matching a cover-at-mint open.
   * Must match the swapAtMint used at mint for the measurement to be meaningful.
   */
  swapAtMint?: boolean
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
    swapAtMint = true,
    blockNumber,
  } = params

  // Same-block guarantee: if the caller pins both a blockNumber and a pre-fetched
  // _meta, they must agree — otherwise the simulation (targetBlockNumber) and the
  // returned metadata would describe different blocks.
  if (
    blockNumber !== undefined &&
    params._meta !== undefined &&
    params._meta.blockNumber !== blockNumber
  ) {
    throw new PanopticError(
      'getRequiredCreditForITM: blockNumber and _meta.blockNumber disagree; cannot guarantee same-block consistency',
    )
  }

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Build final position list (existing + new position)
  const finalPositionIdList = [...existingPositionIds, tokenId]

  // Encode dispatch call. The tickLimit direction encodes swapAtMint:
  // - swapAtMint=true (Zap): descending (MAX_TICK > MIN_TICK) triggers the SFPM swap,
  //   consolidating the flow into the single token the mint swaps into.
  // - swapAtMint=false (Cover): ascending (MIN_TICK < MAX_TICK) does no swap, giving the
  //   true two-sided flow. This must match the mint's swapAtMint for the measured flow to
  //   reflect what actually happens at open.
  // The 3rd element is the per-position effectiveLiquidityLimit: use the max so the contract
  // clamps to its real maxSpread() ceiling (matching the live trade). Passing 0 here collapses
  // ITM measurement for positions with a long-leg removal (see MAX_EFFECTIVE_LIQUIDITY_LIMIT).
  const tickTriplet: readonly [number, number, number] = swapAtMint
    ? [Number(MAX_TICK), Number(MIN_TICK), MAX_EFFECTIVE_LIQUIDITY_LIMIT]
    : [Number(MIN_TICK), Number(MAX_TICK), MAX_EFFECTIVE_LIQUIDITY_LIMIT]
  const callData = encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [
      [tokenId], // positionIdList: positions being minted
      finalPositionIdList,
      [positionSize],
      [tickTriplet],
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
 * Parameters for getItmAmounts.
 */
export interface GetItmAmountsParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticQuery address (holds the getItmAmounts view) */
  queryAddress: Address
  /** PanopticPool address the position would be minted on */
  poolAddress: Address
  /** The option position (may already include width=0 neutralizing legs) */
  tokenId: bigint
  /** Position size (number of contracts) */
  positionSize: bigint
  /** Optional block number */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata */
  _meta?: BlockMeta
}

/**
 * Result of getItmAmounts: the net in-the-money amounts a mint of `tokenId` would
 * accumulate in the SFPM before the mint-time netting swap.
 */
export interface ItmAmounts {
  /** Net ITM amount of token0 (SFPM sign convention). */
  itm0: bigint
  /** Net ITM amount of token1. */
  itm1: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Read the net `itmAmounts` a mint of `tokenId` would produce, via
 * `PanopticQuery.getItmAmounts`. This is the swap-independent, per-leg-linear
 * projection that drives the SFPM's mint-time netting swap: the swap only fires
 * when `itmAmounts != 0`. Sizing width=0 legs so the combined tokenId returns
 * (~0, ~0) here makes the mint swap dust — regardless of Zap vs cover.
 *
 * @param params - The parameters
 * @returns The net itm0/itm1 with block metadata
 */
export async function getItmAmounts(params: GetItmAmountsParams): Promise<ItmAmounts> {
  const { client, queryAddress, poolAddress, tokenId, positionSize, blockNumber } = params

  // Same-block guarantee (see getRequiredCreditForITM): a pinned blockNumber and a
  // pre-fetched _meta must describe the same block.
  if (
    blockNumber !== undefined &&
    params._meta !== undefined &&
    params._meta.blockNumber !== blockNumber
  ) {
    throw new PanopticError(
      'getItmAmounts: blockNumber and _meta.blockNumber disagree; cannot guarantee same-block consistency',
    )
  }

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getItmAmounts',
      args: [poolAddress, tokenId, positionSize],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [itm0, itm1] = result as readonly [bigint, bigint]
  return { itm0, itm1, _meta }
}

/**
 * Dust threshold (token1 value units) below which an itm amount is treated as
 * zero — negligible token flow not worth a neutralizing leg. token0 amounts are
 * converted to token1 value at the current tick before comparison so a tiny
 * high-decimal amount can't masquerade as real flow.
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
 * Solve a single width=0 neutralizing leg sized to offset a token's signed itm.
 *
 * The leg moves `tokenIndex`'s token (`tokenType = tokenIndex`) and is denominated
 * in the opposite asset (`asset = 1 - tokenIndex`) so `asset ≠ tokenType` and the
 * notional scales continuously by strike: `notional ≈ positionSize · 1.0001^signed`.
 * `signedAmount` is the itm to cancel (the leg's itm contribution is `-signedAmount`):
 * positive itm ⇒ a short LOAN leg (isLong=0), negative itm ⇒ a long CREDIT leg (isLong=1).
 *
 * Width=0 legs never mint Uniswap liquidity (see SFPM `_createPositionInAMM`), so their
 * strike is NOT grid-constrained — we use full 1-tick granularity for the tightest sizing.
 * The closed form `positionSize·1.0001^strike` matches the contract's width-2-chunk
 * `getAmountsMoved` to within ~dust, so no correction loop is needed.
 * Throws `PanopticError` if the required strike leaves the valid (exclusive) tick range.
 */
function buildNeutralLeg(
  tokenIndex: 0n | 1n,
  signedAmount: bigint,
  positionSize: bigint,
): NeutralLeg {
  const absAmount = signedAmount < 0n ? -signedAmount : signedAmount
  const legAsset = tokenIndex === 0n ? 1n : 0n
  const legIsLong = signedAmount < 0n

  // 1.0001^signedStrike = absAmount / positionSize
  // sqrtKrawX96 = sqrt(absAmount / positionSize) · 2^96 = isqrt(absAmount · 2^192 / positionSize)
  const sqrtKrawX96 = isqrt((absAmount * Q192) / positionSize)

  let signedTick: bigint
  try {
    signedTick = sqrtPriceX96ToTick(sqrtKrawX96)
  } catch {
    throw new PanopticError(
      'Cannot create flow-neutral position: neutralizing strike out of bounds',
    )
  }

  // TokenId.validate() rejects strike == MIN_TICK/MAX_TICK, so keep strictly inside.
  if (signedTick <= MIN_TICK || signedTick >= MAX_TICK) {
    throw new PanopticError(
      'Cannot create flow-neutral position: neutralizing strike out of bounds',
    )
  }

  // signedStrike = (asset === 0 ? strike : -strike) — invert to recover the encoded
  // strike (mirrors getLegValueWidth0's convention).
  const strike = legAsset === 0n ? signedTick : -signedTick

  return {
    strike,
    asset: legAsset,
    tokenType: tokenIndex,
    isCredit: legIsLong,
  }
}

/**
 * Assemble a tokenId with the neutralizing legs (self-partnered, width=0) placed either
 * BEFORE or AFTER the base legs.
 *
 * The leg at index 0 sets the position's swap frame (the token the Zap sources) and the
 * canonical `positionSize` denomination, so placement is asset-directed:
 *   - `prepend=false` (default, e.g. PUTs): base legs keep their indices (option leg stays
 *     at index 0); neutral legs are appended at `baseLegCount..`.
 *   - `prepend=true` (e.g. CALLs): neutral legs occupy indices `0..k-1` and the base legs
 *     shift by `k` (riskPartner remapped: self-partners follow their new index, cross
 *     partners +k). This puts the credit leg first so the mint swap is asset-token
 *     friendly for a call.
 */
function assembleNeutralTokenId(
  poolId: bigint,
  baseTokenId: bigint,
  neutralLegs: NeutralLeg[],
  prepend: boolean,
): bigint {
  let out = poolId
  const baseLegs = decodeAllLegs(baseTokenId)
  const k = BigInt(neutralLegs.length)
  const shift = prepend ? k : 0n

  if (prepend) {
    neutralLegs.forEach((leg, i) => {
      const index = BigInt(i)
      out = addLegToTokenId(out, {
        index,
        asset: leg.asset,
        tokenType: leg.tokenType,
        optionRatio: 1n,
        isLong: leg.isCredit ? 1n : 0n,
        riskPartner: index,
        strike: leg.strike,
        width: 0n,
      })
    })
  }

  for (const leg of baseLegs) {
    const newIndex = leg.index + shift
    const newRiskPartner = leg.riskPartner === leg.index ? newIndex : leg.riskPartner + shift
    out = addLegToTokenId(out, {
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

  if (!prepend) {
    const base = BigInt(baseLegs.length)
    neutralLegs.forEach((leg, i) => {
      const index = base + BigInt(i)
      out = addLegToTokenId(out, {
        index,
        asset: leg.asset,
        tokenType: leg.tokenType,
        optionRatio: 1n,
        isLong: leg.isCredit ? 1n : 0n,
        riskPartner: index,
        strike: leg.strike,
        width: 0n,
      })
    })
  }

  return out
}

/**
 * Parameters for createFlowNeutralTokenId.
 */
export interface CreateFlowNeutralTokenIdParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address the position would be minted on */
  poolAddress: Address
  /** Account address (whose collateral flow the neutralization targets) */
  account: Address
  /** The base tokenId (without neutralizing legs) */
  tokenId: bigint
  /** Position size (number of contracts) — unchanged by this function */
  positionSize: bigint
  /**
   * PanopticQuery address. When provided, the position's true intrinsic (`getItmAmounts`)
   * gates neutralization: an OTM position (no ITM) gets NO leg, even though its realized
   * flow is non-zero from the open commission. Without it, OTM detection falls back to the
   * commission-inclusive realized flow, which spuriously neutralizes the fee.
   */
  queryAddress?: Address
  /** Existing position IDs held by the account (defaults to empty) */
  existingPositionIds?: bigint[]
  /**
   * Whether the position will be minted with a token swap (Zap). Must match the
   * mint: the neutralization targets the NET token flow under this swap mode, so a
   * mismatch would neutralize the wrong quantity. Defaults to `true`.
   */
  swapAtMint?: boolean
  /**
   * Size at which to MEASURE the base flow that sizes the neutralizing leg(s). The leg
   * strikes are position-size-independent (the flow is linear in size), so measuring at a
   * small affordable reference and reusing the result for `positionSize` yields the same
   * legs. Set this below `positionSize` to avoid the un-neutralized base dispatch reverting
   * with NotEnoughTokens at large sizes under Cover (the gross ITM would exceed the
   * account's balance even though the neutralized mint nets ~0). Defaults to `positionSize`;
   * clamped to `positionSize` if larger.
   */
  referenceSize?: bigint
  /** Optional block number (pins base + verify measurements to one block) */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata */
  _meta?: BlockMeta
}

/**
 * A single width=0 neutralizing leg emitted by {@link createFlowNeutralTokenId}.
 */
export interface NeutralLeg {
  /** The encoded strike of the leg (sign follows the `asset === 0 ? +t : -t` convention). */
  strike: bigint
  /** Asset (0n or 1n) of the leg. Always `1n - tokenType` (asset ≠ tokenType, so it is strike-tunable). */
  asset: bigint
  /** Token type (0n or 1n) — the token this leg neutralizes (its itm slot). */
  tokenType: bigint
  /** true = credit leg (isLong, offsets negative itm), false = loan leg (short, offsets positive itm). */
  isCredit: boolean
}

/**
 * Result of createFlowNeutralTokenId.
 */
export interface FlowNeutralTokenId {
  /**
   * New tokenId with the neutralizing legs appended after the base legs (base legs keep
   * their original indices, so the option leg stays at index 0). Equals the original
   * tokenId when OTM (`neutralLegs` empty).
   */
  tokenId: bigint
  /**
   * Position size to use when opening this tokenId. Always equal to the input
   * `positionSize` — neutralizing legs are sized via their strike, not by
   * rescaling the position.
   */
  positionSize: bigint
  /**
   * The neutralizing legs added, appended after the base legs. 0 entries = OTM/no leg;
   * 1 = the single dominant-token neutralizing leg (single-leg neutralization).
   */
  neutralLegs: NeutralLeg[]
  /** The BASE position's net-flow measurement (what the legs offset). */
  originalCredit: RequiredCreditForITM
  /**
   * The COMBINED (neutralized) position's actual token flow under the mint's swap,
   * from a verify re-measurement. Use this for the Account-Balances display and to
   * gate the mint — its `delta0/delta1` are the residual net transfer (≈ dust).
   */
  neutralizedTokenFlow: TokenFlow
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Create a flow-neutral tokenId by adding width=0 credit/loan leg(s) that zero the
 * position's NET token transfer at mint — the amount the user would otherwise send/receive
 * (and be surprised by at burn).
 *
 * Each leg is sized against the **realized net flow**, measured by
 * {@link getRequiredCreditForITM} under the mint's own `swapAtMint`. Verified on-chain: a
 * width=0 leg's marginal effect on its token's flow is LINEAR and 1:1 with its notional
 * (`positionSize · 1.0001^strike`, matching the contract's `getAmountsMoved`). So sizing the
 * notional to `|net flow|` and solving the strike directly drives the residual to ~dust in
 * ONE shot — no fixed-point loop. (Example: flow 122.08 USDC → strike −228275 → residual
 * −0.032 USDC.)
 *
 * How many legs, keyed on swap mode:
 *  - **Zap** (`swapAtMint=true`): the mint swap consolidates the flow into ONE token and a
 *    width=0 leg can only move the asset axis afterwards, so we add a single leg on the
 *    dominant token; the smaller side is a swap artifact left as dust.
 *  - **Cover** (`swapAtMint=false`): no swap, so the flow is genuinely two-sided and each
 *    token's flow is independent — we add one leg PER token above dust (up to 2), each
 *    sized 1:1 to its own side. This neutralizes both sides of e.g. a two-leg straddle.
 * Each width=0 leg has `asset ≠ tokenType` (strike-tunable):
 *   - token0 flow ← width=0 call leg (tokenType0, asset1)
 *   - token1 flow ← width=0 put  leg (tokenType1, asset0)
 * `creditAmount = −delta`: a positive amount (user would deposit) → a short LOAN leg;
 * negative (user would receive) → a long CREDIT leg. `neutralizedTokenFlow` is a single
 * verify measurement of the combined position under the ACTUAL mint swap mode.
 *
 * Neutral legs (self-partnered, width=0) are placed so index 0 carries the correct swap
 * frame: for a single-leg CALL (option `tokenType === asset`) they are PREPENDED so the
 * credit leg leads and the mint swap is asset-token friendly; for a PUT (and any multi-leg
 * base) they are APPENDED so the option leg stays at index 0. `positionSize` is never
 * modified.
 *
 * @param params - The parameters
 * @returns The flow-neutral tokenId, the neutralizing legs, the base net-flow
 *   measurement, and the combined position's residual flow. `neutralLegs` is empty
 *   when the position is OTM (input tokenId returned unchanged).
 * @throws PanopticError if positionSize <= 0, base legs + 1 > 4, the current tick
 *   is unavailable, or a neutralizing strike falls outside the valid tick range.
 */
export async function createFlowNeutralTokenId(
  params: CreateFlowNeutralTokenIdParams,
): Promise<FlowNeutralTokenId> {
  const {
    client,
    poolAddress,
    account,
    tokenId,
    positionSize,
    existingPositionIds,
    swapAtMint = true,
    referenceSize,
    queryAddress,
    blockNumber,
  } = params

  if (positionSize <= 0n) {
    throw new PanopticError('positionSize must be positive to create flow-neutral position')
  }

  // Measure the base flow at a (possibly smaller) reference size to keep the un-neutralized
  // dispatch affordable; strikes are size-independent so the legs are identical. Verify runs
  // on the neutralized position at the full positionSize (which nets ~0, so it's affordable).
  const measureSize =
    referenceSize !== undefined && referenceSize > 0n && referenceSize < positionSize
      ? referenceSize
      : positionSize

  const legCount = countLegs(tokenId)
  if (legCount >= 4n) {
    throw new PanopticError('Cannot append neutralizing leg: tokenId already has 4 legs')
  }

  const poolId = tokenId & POOL_ID_MASK

  // Leg-0 placement of the neutral leg is asset-directed (it sets the mint's swap frame /
  // positionSize denomination). For a single-leg CALL (option leg's tokenType === asset)
  // the credit leg must lead so the swap sources the asset token; for a PUT the option leg
  // stays at index 0 and the neutral leg is appended. Multi-leg bases always append (their
  // neutralization is handled in a separate commit).
  const baseLegs = decodeAllLegs(tokenId)
  const prependNeutral = baseLegs.length === 1 && baseLegs[0].tokenType === baseLegs[0].asset

  // Size the neutral leg against the REALIZED (post-swap) net flow, measured by dispatch
  // under the mint's own `swapAtMint`. Empirically (verified on-chain against a live pool)
  // the leg's marginal effect on this flow is LINEAR and 1:1 with its notional: a width=0
  // leg of notional N (positionSize·1.0001^strike) shifts the measured net flow by exactly
  // N in that token. So sizing notional = |base net flow| and computing the strike directly
  // drives the residual to ~dust in ONE shot — no fixed-point loop.
  // creditAmount = −delta: positive = user deposits, negative = user receives.
  const credit = await getRequiredCreditForITM({
    client,
    poolAddress,
    account,
    tokenId,
    positionSize: measureSize,
    existingPositionIds,
    swapAtMint,
    blockNumber,
    _meta: params._meta,
  })

  const tickBefore = credit.tokenFlow.tickBefore
  if (tickBefore === null) {
    throw new PanopticError('Cannot create flow-neutral position: current tick unavailable')
  }
  // Value-aware compare: convert a token0 amount into token1 at the current price
  // (P = 1.0001^tick = sqrtP^2 / 2^192) so token0/token1 flows compare in one unit.
  const sqrtPX96 = tickToSqrtPriceX96(tickBefore)
  const valueAbs = (index: 0n | 1n, amount: bigint): bigint => {
    const abs = amount < 0n ? -amount : amount
    return index === 0n ? (abs * sqrtPX96 * sqrtPX96) / Q192 : abs
  }
  const flowFor = (index: 0n | 1n): bigint =>
    index === 0n ? credit.creditAmount0 : credit.creditAmount1

  // OTM gate on true INTRINSIC (getItmAmounts), not the realized flow. The realized
  // getAssetsOf flow includes the open commission, so an OTM position shows non-zero flow
  // (a fee, not ITM) — neutralizing it builds a spurious leg and moves tokens the mint
  // wouldn't. `getItmAmounts` is 0 for an OTM position, so this correctly skips it. Falls
  // back to the realized-flow dust check when no queryAddress is supplied.
  if (queryAddress !== undefined) {
    const itm = await getItmAmounts({
      client,
      queryAddress,
      poolAddress,
      tokenId,
      positionSize: measureSize,
      blockNumber: blockNumber ?? credit._meta.blockNumber,
      _meta: credit._meta,
    })
    if (
      valueAbs(0n, itm.itm0) <= FLOW_NEUTRAL_DUST_THRESHOLD &&
      valueAbs(1n, itm.itm1) <= FLOW_NEUTRAL_DUST_THRESHOLD
    ) {
      return {
        tokenId,
        positionSize,
        neutralLegs: [],
        originalCredit: credit,
        neutralizedTokenFlow: credit.tokenFlow,
        _meta: credit._meta,
      }
    }
  }

  // OTM — no net flow to neutralize (both sides negligible). This guard only avoids
  // building a leg with an out-of-bounds (log of ~0) strike; it is NOT a convergence
  // threshold.
  if (
    valueAbs(0n, credit.creditAmount0) <= FLOW_NEUTRAL_DUST_THRESHOLD &&
    valueAbs(1n, credit.creditAmount1) <= FLOW_NEUTRAL_DUST_THRESHOLD
  ) {
    return {
      tokenId,
      positionSize,
      neutralLegs: [],
      originalCredit: credit,
      neutralizedTokenFlow: credit.tokenFlow,
      _meta: credit._meta,
    }
  }

  // Which token(s) get a neutralizing leg:
  //  - Zap (swapAtMint=true): the mint swap consolidates the flow to ONE token, and a
  //    width=0 leg can only move the asset axis afterwards, so we neutralize just the
  //    SINGLE dominant token; the smaller side is a swap artifact left as dust.
  //  - Cover (swapAtMint=false): there is NO swap, so the flow is genuinely two-sided and
  //    each token's flow is independent — neutralize EACH side above dust (up to 2 legs),
  //    every leg sized 1:1 to its own token's net flow.
  const indices: (0n | 1n)[] = swapAtMint
    ? [valueAbs(0n, credit.creditAmount0) >= valueAbs(1n, credit.creditAmount1) ? 0n : 1n]
    : ([0n, 1n] as const).filter((i) => valueAbs(i, flowFor(i)) > FLOW_NEUTRAL_DUST_THRESHOLD)

  if (legCount + BigInt(indices.length) > 4n) {
    throw new PanopticError(
      `Cannot add ${indices.length} neutralizing leg(s): tokenId would exceed 4 legs`,
    )
  }

  // Legs sized from the flow measured at `measureSize`; strikes are size-independent so
  // they hold at the full positionSize.
  const neutralLegs = indices.map((i) => buildNeutralLeg(i, flowFor(i), measureSize))
  const combined = assembleNeutralTokenId(poolId, tokenId, neutralLegs, prependNeutral)

  // Verify/display: measure the COMBINED (neutralized) position's residual flow under the
  // ACTUAL mint swap mode at the FULL positionSize so the Account-Balances display and mint
  // gating reflect what the user will experience. The neutralized position nets ~0, so this
  // is affordable even when the un-neutralized base at full size would not be. If it still
  // reverts (edge: sits exactly at the solvency limit), fall back to the reference-size
  // measurement so we return a valid tokenId rather than throwing.
  const pinnedBlock = blockNumber ?? credit._meta.blockNumber
  let residual: RequiredCreditForITM
  try {
    residual = await getRequiredCreditForITM({
      client,
      poolAddress,
      account,
      tokenId: combined,
      positionSize,
      existingPositionIds,
      swapAtMint,
      blockNumber: pinnedBlock,
      _meta: credit._meta,
    })
  } catch {
    residual = await getRequiredCreditForITM({
      client,
      poolAddress,
      account,
      tokenId: combined,
      positionSize: measureSize,
      existingPositionIds,
      swapAtMint,
      blockNumber: pinnedBlock,
      _meta: credit._meta,
    })
  }

  return {
    tokenId: combined,
    positionSize,
    neutralLegs,
    originalCredit: credit,
    neutralizedTokenFlow: residual.tokenFlow,
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
