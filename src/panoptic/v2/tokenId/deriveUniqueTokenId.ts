/**
 * Derive a unique tokenId to mint alongside a burn (position reduction / roll).
 *
 * dispatch() cannot partial-close a held tokenId — a same-tokenId size change
 * is interpreted as `settlePremium`. To reduce, we burn the old tokenId and
 * mint a DIFFERENT tokenId with the desired smaller size in one dispatch. The
 * new tokenId must merely be unique from the old one.
 *
 * Two derivation paths:
 *   1. **Tiny credit leg (default)** — when the base has a free leg slot
 *      (< 4 legs), append a width=0 credit (isLong=1) leg with an extreme
 *      strike so its token notional (`positionSize · 1.0001^strike`) rounds
 *      down to ~1 wei — tokenId-uniquifying but economically negligible. New
 *      positionSize can be any value ≤ current size; arbitrary reduction
 *      amounts fall out.
 *   2. **Ratio scaling (fallback)** — only when all 4 leg slots are used:
 *      multiply every leg's optionRatio by a factor `N` such that
 *      `N · max(optionRatio) ≤ 127`, then set
 *      `newPositionSize = ceil(targetSize / N)`. Per-leg preserved liquidity
 *      is `newPositionSize · N`, so the reduce still satisfies the target.
 *
 * @module v2/tokenId/deriveUniqueTokenId
 */

import { PanopticError } from '../errors'
import { sqrtPriceX96ToTick } from '../formatters/tick'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
import { LEG_LIMITS, TOKEN_ID_BITS } from './constants'
import { addLegToTokenId, countLegs, decodeAllLegs, decodeLeg } from './encoding'

const POOL_ID_MASK = (1n << 64n) - 1n
const MAX_LEGS = TOKEN_ID_BITS.MAX_LEGS
const MAX_OPTION_RATIO = LEG_LIMITS.MAX_RATIO
const Q192 = 1n << 192n

export type DeriveStrategy = 'tiny-credit' | 'ratio-scale'

export interface DeriveUniqueTokenIdParams {
  /** Base tokenId to derive a unique sibling from. */
  baseTokenId: bigint
  /**
   * Desired new positionSize. Must be > 0 and ≤ the CURRENT stored
   * positionSize on the tokenId being reduced.
   *
   * For `ratio-scale` the effective size (`newPositionSize · N`) may exceed
   * this by a rounding-up wei. `newPositionSize` in the result reflects
   * exactly what to pass to dispatch.
   */
  targetPositionSize: bigint
  /**
   * Pool tickSpacing. Used to keep the appended credit leg's tick range
   * (SFPM internally widens width=0 to a width-2 chunk: `strike ± tickSpacing`)
   * strictly inside `[MIN_POOL_TICK, MAX_POOL_TICK]`. Omit to use a
   * worst-case Uniswap-v3 default of 200.
   */
  tickSpacing?: bigint
}

export interface DeriveUniqueTokenIdResult {
  newTokenId: bigint
  /** positionSize to pass to dispatch for the new tokenId. */
  newPositionSize: bigint
  /**
   * Real per-leg liquidity the new tokenId will hold, expressed in the
   * base-token positionSize frame. Equals `newPositionSize · N` for
   * `ratio-scale` (where N is the applied optionRatio multiplier) and
   * `newPositionSize` for `tiny-credit`. Consumers should compare this
   * against the base tokenId's current stored size to validate that a
   * reduction is actually smaller (or, for `ratio-scale`, that the ceiling
   * rounding did not push effective size above the stored size).
   */
  effectivePositionSize: bigint
  strategy: DeriveStrategy
}

/**
 * Floor integer square root for bigints (Newton's method). Mirrors the isqrt
 * used in reads/collateralEstimate.ts (buildNeutralLeg).
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

const DEFAULT_TICK_SPACING = 200n

/**
 * Target notional (in wei of the tokenType-side asset) for the appended
 * tiny credit leg. Chosen at 10 wei — small enough to be economically
 * meaningless against any real position size, large enough to safely
 * clear rounding on the SFPM's width-2 internal chunk math without any
 * risk of underflowing to zero (which would revert ChunkHasZeroLiquidity).
 */
const TINY_CREDIT_TARGET_NOTIONAL_WEI = 10n

/**
 * Pick a signedStrike for the appended width=0 credit leg such that:
 *   1. positionSize · 1.0001^signedStrike ≈ TINY_CREDIT_TARGET_NOTIONAL_WEI
 *      (~10 wei — economically meaningless but comfortably above any
 *      SFPM width-2 chunk rounding);
 *   2. the leg's tick range (SFPM internally treats width=0 as width=2, so
 *      the range is `strike ± tickSpacing`) stays strictly inside
 *      `[MIN_POOL_TICK, MAX_POOL_TICK]` — otherwise the getSqrtRatioAtTick
 *      call reverts with `InvalidTick`.
 *
 * Closed form: `1.0001^signedStrike = target/positionSize`, so
 * `sqrtKrawX96 = isqrt(target · 2^192 / positionSize)` and
 * `signedStrike = sqrtPriceX96ToTick(sqrtKrawX96)`. If the notional-optimal
 * strike falls outside the safe range, we clamp inward. Clamping raises the
 * notional but keeps it << position size for any reasonable strike.
 */
function computeTinyCreditSignedStrike(positionSize: bigint, tickSpacing: bigint): bigint {
  if (positionSize <= 0n) {
    throw new PanopticError('computeTinyCreditSignedStrike: positionSize must be > 0')
  }
  // Leave one tickSpacing of buffer on each side + 1 tick of headroom so the
  // width-2 chunk (strike ± tickSpacing) stays strictly inside the pool bounds.
  const minSafe = MIN_TICK + tickSpacing + 1n
  const maxSafe = MAX_TICK - tickSpacing - 1n

  let signedStrike: bigint
  try {
    const sqrtKrawX96 = isqrt((TINY_CREDIT_TARGET_NOTIONAL_WEI * Q192) / positionSize)
    signedStrike = sqrtPriceX96ToTick(sqrtKrawX96)
  } catch {
    // sqrtPriceX96ToTick rejects out-of-bounds sqrt prices; that only happens
    // for extreme (>> 2^128) or dust positionSizes. Fall back to the min-safe
    // edge, which still gives a tiny notional relative to any real position.
    signedStrike = minSafe
  }

  if (signedStrike < minSafe) return minSafe
  if (signedStrike > maxSafe) return maxSafe
  return signedStrike
}

/**
 * Assemble the tiny credit leg struct, picking a strike that avoids
 * colliding with any existing width=0 credit leg on the same (asset,
 * tokenType) pair.
 *
 * The encoded strike stored in the tokenId is
 * `asset === 0 ? signedStrike : -signedStrike` (mirrors
 * {@link buildNeutralLeg} in reads/collateralEstimate.ts).
 */
function pickUniqueTinyCreditLeg(
  baseTokenId: bigint,
  legIndex: bigint,
  positionSize: bigint,
  tickSpacing: bigint,
): {
  index: bigint
  asset: bigint
  tokenType: bigint
  optionRatio: bigint
  isLong: bigint
  riskPartner: bigint
  strike: bigint
  width: bigint
} {
  const asset: bigint = 1n
  const tokenType: bigint = 0n

  const existingLegs = decodeAllLegs(baseTokenId)
  const maxSafe = MAX_TICK - tickSpacing - 1n

  let signedStrike = computeTinyCreditSignedStrike(positionSize, tickSpacing)
  while (signedStrike <= maxSafe) {
    const candidate = asset === 0n ? signedStrike : -signedStrike
    let collides = false
    for (const leg of existingLegs) {
      if (
        leg.width === 0n &&
        leg.isLong &&
        leg.asset === asset &&
        leg.tokenType === tokenType &&
        leg.strike === candidate
      ) {
        collides = true
        break
      }
    }
    if (!collides) break
    signedStrike += 1n
  }
  if (signedStrike > maxSafe) {
    throw new PanopticError(
      'deriveUniqueTokenId: exhausted strike space picking a unique tiny credit leg',
    )
  }

  const encodedStrike = asset === 0n ? signedStrike : -signedStrike

  return {
    index: legIndex,
    asset,
    tokenType,
    optionRatio: 1n,
    isLong: 1n,
    riskPartner: legIndex,
    strike: encodedStrike,
    width: 0n,
  }
}

function appendTinyCreditLeg(
  baseTokenId: bigint,
  baseLegCount: bigint,
  positionSize: bigint,
  tickSpacing: bigint,
): bigint {
  const newLeg = pickUniqueTinyCreditLeg(baseTokenId, baseLegCount, positionSize, tickSpacing)
  return addLegToTokenId(baseTokenId, newLeg)
}

function scaleRatios(baseTokenId: bigint, targetPositionSize: bigint): DeriveUniqueTokenIdResult {
  const legs = decodeAllLegs(baseTokenId)
  const maxRatio = legs.reduce<bigint>((m, leg) => (leg.optionRatio > m ? leg.optionRatio : m), 0n)
  const N = MAX_OPTION_RATIO / maxRatio
  if (N < 2n) {
    throw new PanopticError(
      'deriveUniqueTokenId: cannot derive a unique tokenId — all 4 leg slots used and optionRatios already near the 127 ceiling',
    )
  }
  // Preserved per-leg liquidity = newSize · N. ceil ensures effective size ≥ target.
  const newPositionSize = (targetPositionSize + N - 1n) / N

  const poolId = baseTokenId & POOL_ID_MASK
  let out = poolId
  for (const leg of legs) {
    out = addLegToTokenId(out, {
      index: leg.index,
      asset: leg.asset,
      tokenType: leg.tokenType,
      optionRatio: leg.optionRatio * N,
      isLong: leg.isLong ? 1n : 0n,
      riskPartner: leg.riskPartner,
      strike: leg.strike,
      width: leg.width,
    })
  }
  return {
    newTokenId: out,
    newPositionSize,
    effectivePositionSize: newPositionSize * N,
    strategy: 'ratio-scale',
  }
}

/**
 * Derive a tokenId unique from `baseTokenId` for a partial reduction.
 *
 * Prefers a tiny-credit-leg extension (arbitrary new size). Falls back to
 * optionRatio scaling only when the base tokenId already occupies all 4 leg
 * slots.
 */
export function deriveUniqueTokenId(params: DeriveUniqueTokenIdParams): DeriveUniqueTokenIdResult {
  const { baseTokenId, targetPositionSize, tickSpacing = DEFAULT_TICK_SPACING } = params

  if (targetPositionSize <= 0n) {
    throw new PanopticError('deriveUniqueTokenId: targetPositionSize must be > 0')
  }

  const legCount = countLegs(baseTokenId)
  if (legCount === 0n) {
    throw new PanopticError('deriveUniqueTokenId: baseTokenId has no legs')
  }

  if (legCount < MAX_LEGS) {
    const newTokenId = appendTinyCreditLeg(baseTokenId, legCount, targetPositionSize, tickSpacing)
    return {
      newTokenId,
      newPositionSize: targetPositionSize,
      effectivePositionSize: targetPositionSize,
      strategy: 'tiny-credit',
    }
  }

  return scaleRatios(baseTokenId, targetPositionSize)
}

/**
 * Test hook: exposed only to make the tiny-credit leg strike inspectable.
 * @internal
 */
export function _pickUniqueTinyCreditLegForTests(
  baseTokenId: bigint,
  legIndex: bigint,
  positionSize: bigint = 10n ** 18n,
  tickSpacing: bigint = DEFAULT_TICK_SPACING,
) {
  return pickUniqueTinyCreditLeg(baseTokenId, legIndex, positionSize, tickSpacing)
}

/**
 * Re-export decoded leg count so callers can gate UI on the strategy that
 * would be chosen (e.g. show a divisibility hint on ratio-scale positions).
 */
export function planDeriveStrategy(baseTokenId: bigint): DeriveStrategy {
  return countLegs(baseTokenId) < MAX_LEGS ? 'tiny-credit' : 'ratio-scale'
}

// Re-export used by consumers who only need the leg-count helper.
export { decodeLeg }
