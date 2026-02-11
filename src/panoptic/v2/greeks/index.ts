/**
 * Client-side greeks for the Panoptic v2 SDK.
 *
 * All functions accept bigint inputs (ticks, sizes) and return bigint values
 * in the natural token units — no artificial WAD scaling. The tick-based price
 * (1.0001^tick) naturally encodes the decimal conversion between tokens.
 *
 * Uses pure sqrtPriceX96 arithmetic for exact on-chain fidelity with PanopticQuery.
 * All intermediate calculations keep X96/X192 precision until final scaling.
 *
 * - Value: in numeraire token smallest units (e.g., USDC wei if numeraire is USDC)
 * - Delta: in asset token smallest units (e.g., WETH wei if asset is WETH)
 * - Gamma (dollar-gamma): in numeraire token smallest units
 *
 * @module v2/greeks
 */

import { tickToSqrtPriceX96 } from '../formatters/tick'
import type { TokenIdLeg } from '../types'

// --- Internal Helpers ---

/** Fixed-point scale constants for sqrtPriceX96 arithmetic */
const Q96 = 1n << 96n
const Q192 = 1n << 192n

/**
 * Convert tick to quote-denominated tick based on asset direction.
 *
 * When isAssetToken0 = true (asset is token0, numeraire is token1):
 * - We want price in token0/token1 terms (inverted from tick's token1/token0)
 * - Invert by negating: 1/price = 1.0001^(-tick)
 *
 * When isAssetToken0 = false (asset is token1, numeraire is token0):
 * - We want price in token1/token0 terms (same as tick)
 * - Use tick as-is
 */
function quoteTick(tick: bigint, isAssetToken0: boolean): bigint {
  return isAssetToken0 ? -tick : tick
}

/**
 * Divide with truncation toward zero (matches Solidity division behavior).
 *
 * JavaScript bigint division uses floor (toward negative infinity), but Solidity
 * truncates toward zero. For on-chain fidelity, we must match Solidity.
 *
 * Example:
 * - Solidity: -7 / 2 = -3 (truncate toward zero)
 * - JS bigint: -7n / 2n = -4n (floor toward -∞)
 * - This function: divTrunc(-7n, 2n) = -3n ✓
 */
function divTrunc(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n

  const quotient = numerator / denominator
  const remainder = numerator % denominator

  // If signs differ and there's a remainder, JS floored when we need to truncate
  // Add 1 to move toward zero
  if (numerator < 0n !== denominator < 0n && remainder !== 0n) {
    return quotient + 1n
  }

  return quotient
}

/** Resolve isAssetToken0: optional assetIndex overrides leg.asset */
function resolveAssetDirection(leg: Pick<TokenIdLeg, 'asset'>, assetIndex?: bigint): boolean {
  return assetIndex !== undefined ? assetIndex === 0n : leg.asset === 0n
}

/**
 * Calculate value for a width=0 (loan/credit) leg.
 * Width=0 means the range is a single tick (the strike), so there's no meaningful
 * "in range" — we use the below/above formulas which avoid division by (r-1)=0.
 */
function getLegValueWidth0(
  leg: TokenIdLeg,
  m: bigint,
  qCurrentTick: bigint,
  qStrikeTick: bigint,
  qMintTick: bigint,
  isAssetToken0: boolean,
  definedRisk: boolean,
): bigint {
  // Base value: below or above strike
  let v: bigint
  if (qCurrentTick <= qStrikeTick) {
    // At or below strike: v = m * P
    const sqrtP = tickToSqrtPriceX96(qCurrentTick)
    const PX192 = sqrtP * sqrtP
    v = divTrunc(m * PX192, Q192)
  } else {
    // Above strike: v = m * K
    const sqrtK = tickToSqrtPriceX96(qStrikeTick)
    const KX192 = sqrtK * sqrtK
    v = divTrunc(m * KX192, Q192)
  }

  const debt = -m
  const isPut = !isCall(leg.tokenType, isAssetToken0)

  // ITM adjustment: width=0 means range is a point, so mint tick is either below or above
  let itm: bigint
  if (isPut) {
    if (qMintTick <= qStrikeTick) {
      // Below or at strike: itm = (K - Pm) * m
      const sqrtK = tickToSqrtPriceX96(qStrikeTick)
      const sqrtPm = tickToSqrtPriceX96(qMintTick)
      const KX192 = sqrtK * sqrtK
      const PmX192 = sqrtPm * sqrtPm
      itm = divTrunc(m * (KX192 - PmX192), Q192)
    } else {
      itm = 0n
    }
  } else {
    if (qMintTick <= qStrikeTick) {
      itm = 0n
    } else {
      // Above strike: itm = (1 - K/Pm) * m
      const sqrtK = tickToSqrtPriceX96(qStrikeTick)
      const sqrtPm = tickToSqrtPriceX96(qMintTick)
      const KX192 = sqrtK * sqrtK
      const PmX192 = sqrtPm * sqrtPm
      itm = divTrunc(m * (PmX192 - KX192), PmX192)
    }
  }

  // Final result
  if (isPut) {
    const sqrtK = tickToSqrtPriceX96(qStrikeTick)
    const KX192 = sqrtK * sqrtK
    const debtK = divTrunc(debt * KX192, Q192)
    return debtK + v + itm
  } else {
    const sqrtP = tickToSqrtPriceX96(qCurrentTick)
    const PX192 = sqrtP * sqrtP
    const debtP = divTrunc(debt * PX192, Q192)

    if (definedRisk) {
      const sqrtPm = tickToSqrtPriceX96(qMintTick)
      const PmX192 = sqrtPm * sqrtPm
      const itmPm = divTrunc(itm * PmX192, Q192)
      return debtP + v + itmPm
    } else {
      const itmP = divTrunc(itm * PX192, Q192)
      return debtP + v + itmP
    }
  }
}

// --- Public Helpers ---

/**
 * Check if leg is a call option (vs put).
 *
 * A call is when the leg moves the asset token:
 * - If asset is token0: call when tokenType=0
 * - If asset is token1: call when tokenType=1
 */
export function isCall(tokenType: bigint, isAssetToken0: boolean): boolean {
  return isAssetToken0 ? tokenType === 0n : tokenType === 1n
}

/**
 * Check if position has defined risk (is a spread).
 *
 * A position is defined risk if it has 2+ legs of the same tokenType
 * with both long and short exposure.
 */
export function isDefinedRisk(legs: Pick<TokenIdLeg, 'tokenType' | 'isLong'>[]): boolean {
  if (legs.length < 2) return false

  for (const tt of [0n, 1n]) {
    const group = legs.filter((l) => l.tokenType === tt)
    if (group.length >= 2 && group.some((l) => l.isLong) && group.some((l) => !l.isLong)) {
      return true
    }
  }
  return false
}

// --- Per-Leg Greeks ---

/**
 * Calculate the value of a single leg.
 *
 * Value represents the current P&L of the position in numeraire token units.
 * Combines base value (from Panoptic's piecewise formula), debt, and ITM adjustment.
 *
 * Uses sqrtPriceX96 for all calculations to maintain precision and on-chain fidelity.
 *
 * @param leg - The leg to calculate
 * @param currentTick - Current pool tick
 * @param mintTick - Tick at position mint
 * @param positionSize - Position size in asset token smallest units
 * @param poolTickSpacing - Pool tick spacing
 * @param definedRisk - Whether position is defined risk
 * @param assetIndex - Optional override for leg.asset (0n = token0 is asset, 1n = token1)
 * @returns Leg value in numeraire token smallest units
 */
export function getLegValue(
  leg: TokenIdLeg,
  currentTick: bigint,
  mintTick: bigint,
  positionSize: bigint,
  poolTickSpacing: bigint,
  definedRisk: boolean,
  assetIndex?: bigint,
): bigint {
  const isAssetToken0 = resolveAssetDirection(leg, assetIndex)
  const qCurrentTick = quoteTick(currentTick, isAssetToken0)
  const qMintTick = quoteTick(mintTick, isAssetToken0)
  const qStrikeTick = quoteTick(leg.strike, isAssetToken0)
  const halfWidthTick = (leg.width * poolTickSpacing) / 2n

  const m = leg.isLong ? -(positionSize * leg.optionRatio) : positionSize * leg.optionRatio

  // Width=0 (loans/credits): single-tick position, no range to integrate over.
  // Use below/above-range formulas directly to avoid divide-by-zero in the in-range branch.
  if (halfWidthTick === 0n) {
    return getLegValueWidth0(
      leg,
      m,
      qCurrentTick,
      qStrikeTick,
      qMintTick,
      isAssetToken0,
      definedRisk,
    )
  }

  // Compute base value: v = f(P, K, r) from Panoptic's piecewise formula
  let v: bigint

  if (qCurrentTick < qStrikeTick - halfWidthTick) {
    // Below range: v = m * P
    const sqrtP = tickToSqrtPriceX96(qCurrentTick)
    const PX192 = sqrtP * sqrtP
    v = divTrunc(m * PX192, Q192)
  } else if (qCurrentTick > qStrikeTick + halfWidthTick) {
    // Above range: v = m * K
    const sqrtK = tickToSqrtPriceX96(qStrikeTick)
    const KX192 = sqrtK * sqrtK
    v = divTrunc(m * KX192, Q192)
  } else {
    // In range: v = m * (2*sqrt(P*K*r) - P - K) / (r - 1)
    const sqrtP = tickToSqrtPriceX96(qCurrentTick)
    const sqrtK = tickToSqrtPriceX96(qStrikeTick)
    const sqrtPKR = tickToSqrtPriceX96(qCurrentTick + qStrikeTick + halfWidthTick)
    const sqrtR = tickToSqrtPriceX96(halfWidthTick)

    const PX192 = sqrtP * sqrtP
    const KX192 = sqrtK * sqrtK
    const rX192 = sqrtR * sqrtR

    // v = m * (2*sqrtPKR/2^96 - PX192/2^192 - KX192/2^192) / ((rX192 - 2^192)/2^192)
    //   = m * (2*sqrtPKR*2^96 - PX192 - KX192) / (rX192 - 2^192)
    const numerator = m * (2n * sqrtPKR * Q96 - PX192 - KX192)
    const denominator = rX192 - Q192
    v = divTrunc(numerator, denominator)
  }

  const debt = -m
  const isPut = !isCall(leg.tokenType, isAssetToken0)

  // Compute ITM adjustment (differs for puts vs calls)
  let itm: bigint

  if (isPut) {
    // Put ITM adjustment
    if (qMintTick < qStrikeTick - halfWidthTick) {
      // Below range: itm = (K - Pm) * m
      const sqrtK = tickToSqrtPriceX96(qStrikeTick)
      const sqrtPm = tickToSqrtPriceX96(qMintTick)
      const KX192 = sqrtK * sqrtK
      const PmX192 = sqrtPm * sqrtPm
      itm = divTrunc(m * (KX192 - PmX192), Q192)
    } else if (qMintTick > qStrikeTick + halfWidthTick) {
      // Above range: itm = 0
      itm = 0n
    } else {
      // In range: itm = m * (sqrt(K*r) - sqrt(Pm))^2 / (r - 1)
      const sqrtKR = tickToSqrtPriceX96(qStrikeTick + halfWidthTick)
      const sqrtPm = tickToSqrtPriceX96(qMintTick)
      const sqrtR = tickToSqrtPriceX96(halfWidthTick)
      const rX192 = sqrtR * sqrtR

      const diff = sqrtKR - sqrtPm // X96
      const diffSqX192 = diff * diff // X192
      itm = divTrunc(m * diffSqX192, rX192 - Q192)
    }
  } else {
    // Call ITM adjustment
    if (qMintTick < qStrikeTick - halfWidthTick) {
      // Below range: itm = 0
      itm = 0n
    } else if (qMintTick > qStrikeTick + halfWidthTick) {
      // Above range: itm = (1 - K/Pm) * m
      const sqrtK = tickToSqrtPriceX96(qStrikeTick)
      const sqrtPm = tickToSqrtPriceX96(qMintTick)
      const KX192 = sqrtK * sqrtK
      const PmX192 = sqrtPm * sqrtPm
      itm = divTrunc(m * (PmX192 - KX192), PmX192)
    } else {
      // In range: itm = m * (sqrt(r) - sqrt(K/Pm))^2 / (r - 1)
      const sqrtR = tickToSqrtPriceX96(halfWidthTick)
      const sqrtK = tickToSqrtPriceX96(qStrikeTick)
      const sqrtPm = tickToSqrtPriceX96(qMintTick)
      const rX192 = sqrtR * sqrtR

      // sqrt(K/Pm) in X96 = sqrtK * 2^96 / sqrtPm
      const sqrtKPmX96 = divTrunc(sqrtK * Q96, sqrtPm)
      const diff = sqrtR - sqrtKPmX96 // X96
      const diffSqX192 = diff * diff // X192
      itm = divTrunc(m * diffSqX192, rX192 - Q192)
    }
  }

  // Compute final result based on option type
  if (isPut) {
    // Put: result = debt * K + v + itm
    const sqrtK = tickToSqrtPriceX96(qStrikeTick)
    const KX192 = sqrtK * sqrtK
    const debtK = divTrunc(debt * KX192, Q192)
    return debtK + v + itm
  } else {
    // Call: result = debt*P + v + itm*Pm (if defined risk) or debt*P + v + itm*P (if not)
    const sqrtP = tickToSqrtPriceX96(qCurrentTick)
    const PX192 = sqrtP * sqrtP
    const debtP = divTrunc(debt * PX192, Q192)

    if (definedRisk) {
      const sqrtPm = tickToSqrtPriceX96(qMintTick)
      const PmX192 = sqrtPm * sqrtPm
      const itmPm = divTrunc(itm * PmX192, Q192)
      return debtP + v + itmPm
    } else {
      const itmP = divTrunc(itm * PX192, Q192)
      return debtP + v + itmP
    }
  }
}

/**
 * Calculate the delta of a single leg.
 *
 * Delta is the rate of change of position value with respect to price.
 * For puts: delta = vDelta
 * For calls: delta = debtDelta + vDelta + itmDelta (if not defined risk)
 *
 * Uses sqrtPriceX96 for all price calculations to maintain precision.
 *
 * @param leg - The leg to calculate
 * @param currentTick - Current pool tick
 * @param positionSize - Position size in asset token smallest units
 * @param poolTickSpacing - Pool tick spacing
 * @param mintTick - Tick at mint (optional, for ITM adjustment)
 * @param definedRisk - Whether position is defined risk
 * @param assetIndex - Optional override for leg.asset (0n = token0 is asset, 1n = token1)
 * @returns Leg delta in asset token smallest units
 */
export function getLegDelta(
  leg: TokenIdLeg,
  currentTick: bigint,
  positionSize: bigint,
  poolTickSpacing: bigint,
  mintTick: bigint | undefined,
  definedRisk: boolean,
  assetIndex?: bigint,
): bigint {
  const isAssetToken0 = resolveAssetDirection(leg, assetIndex)
  const qCurrentTick = quoteTick(currentTick, isAssetToken0)
  const qStrikeTick = quoteTick(leg.strike, isAssetToken0)
  const halfWidthTick = (leg.width * poolTickSpacing) / 2n

  const m = leg.isLong ? -(positionSize * leg.optionRatio) : positionSize * leg.optionRatio

  // Width=0: single-tick position, skip in-range branch that divides by (r-1)=0
  if (halfWidthTick === 0n) {
    const vDelta = qCurrentTick <= qStrikeTick ? m : 0n
    const isPut = !isCall(leg.tokenType, isAssetToken0)
    if (isPut) return vDelta

    // Call: add debt delta and ITM delta (same as normal path but no in-range branch)
    const debtDelta = -m
    let itmDelta = 0n
    if (mintTick !== undefined && !definedRisk) {
      const qMintTick = quoteTick(mintTick, isAssetToken0)
      if (qMintTick > qStrikeTick) {
        const sqrtPm = tickToSqrtPriceX96(qMintTick)
        const sqrtK = tickToSqrtPriceX96(qStrikeTick)
        const PmX192 = sqrtPm * sqrtPm
        const KX192 = sqrtK * sqrtK
        itmDelta = divTrunc((PmX192 - KX192) * m, PmX192)
      }
    }
    return definedRisk ? debtDelta + vDelta : debtDelta + vDelta + itmDelta
  }

  // Compute vDelta: derivative of value with respect to price
  // vDelta = P < lo ? m : P > hi ? 0 : (m * (sqrt(K*r)/sqrt(P) - 1)) / (r - 1)
  let vDelta: bigint

  if (qCurrentTick < qStrikeTick - halfWidthTick) {
    // Below range: vDelta = m
    vDelta = m
  } else if (qCurrentTick > qStrikeTick + halfWidthTick) {
    // Above range: vDelta = 0
    vDelta = 0n
  } else {
    // In range: vDelta = m * (sqrt(K*r) - sqrt(P)) / (sqrt(P) * (r - 1))
    const sqrtP = tickToSqrtPriceX96(qCurrentTick) // X96
    const sqrtKR = tickToSqrtPriceX96(qStrikeTick + halfWidthTick) // sqrt(K*r) in X96
    const sqrtR = tickToSqrtPriceX96(halfWidthTick) // X96
    const rX192 = sqrtR * sqrtR // X192

    // vDelta = m * (sqrtKR - sqrtP)/2^96 / (sqrtP/2^96 * (rX192 - 2^192)/2^192)
    //        = m * (sqrtKR - sqrtP) * 2^192 / (sqrtP * (rX192 - 2^192))
    const numerator = m * (sqrtKR - sqrtP) * Q192
    const denominator = sqrtP * (rX192 - Q192)
    vDelta = divTrunc(numerator, denominator)
  }

  const isPut = !isCall(leg.tokenType, isAssetToken0)

  if (isPut) {
    return vDelta
  }

  // Call: add debt delta and ITM delta
  const debtDelta = -m

  const itmDelta =
    mintTick === undefined
      ? 0n
      : (() => {
          const qMintTick = quoteTick(mintTick, isAssetToken0)

          if (qMintTick < qStrikeTick - halfWidthTick) {
            // Below range: itmDelta = 0
            return 0n
          } else if (qMintTick > qStrikeTick + halfWidthTick) {
            // Above range: itmDelta = (1 - K/Pm) * m = (Pm - K) * m / Pm
            const sqrtPm = tickToSqrtPriceX96(qMintTick) // X96
            const sqrtK = tickToSqrtPriceX96(qStrikeTick) // X96
            const PmX192 = sqrtPm * sqrtPm // X192
            const KX192 = sqrtK * sqrtK // X192

            // itmDelta = (1 - K/Pm) * m = (PmX192 - KX192) * m / PmX192
            return divTrunc((PmX192 - KX192) * m, PmX192)
          } else {
            // In range: itmDelta = m * (sqrt(r) - sqrt(K/Pm))^2 / (r - 1)
            const sqrtR = tickToSqrtPriceX96(halfWidthTick) // X96
            const sqrtK = tickToSqrtPriceX96(qStrikeTick) // X96
            const sqrtPm = tickToSqrtPriceX96(qMintTick) // X96
            const rX192 = sqrtR * sqrtR // X192

            // sqrt(K/Pm) = sqrtK / sqrtPm (both X96, so scale cancels)
            // But we need (sqrt(r) - sqrt(K/Pm))^2, so work in X96:
            // sqrtKPm = sqrt(K/Pm) in X96 = sqrtK * 2^96 / sqrtPm
            const sqrtKPmX96 = (sqrtK * Q96) / sqrtPm // X96

            // (sqrt(r) - sqrt(K/Pm))^2 = (sqrtR - sqrtKPmX96)^2 / 2^192
            const diff = sqrtR - sqrtKPmX96 // X96
            const diffSqX192 = diff * diff // X192

            // itmDelta = m * diffSqX192 / 2^192 / (rX192 / 2^192 - 1)
            //          = m * diffSqX192 / (rX192 - 2^192)
            return divTrunc(m * diffSqX192, rX192 - Q192)
          }
        })()

  return definedRisk ? debtDelta + vDelta : debtDelta + vDelta + itmDelta
}

/**
 * Calculate the gamma (dollar gamma) of a single leg.
 *
 * Formula: gamma = (m * sqrt(K * P * r)) / (2 * (r - 1))
 * where:
 * - m = positionSize * optionRatio (with sign based on long/short)
 * - K = strike price (numeraire/asset)
 * - P = current price (numeraire/asset)
 * - r = 1.0001^(width*tickSpacing/2) ≈ 1 (dimensionless ratio)
 *
 * Uses sqrtPriceX96 arithmetic:
 * - sqrt(K*P*r) = tickToSqrtPriceX96(strikeₜ + currentₜ + widthₜ/2)
 * - Keeps X96/X192 precision until final division
 *
 * @param leg - The leg to calculate
 * @param currentTick - Current pool tick
 * @param positionSize - Position size in asset token smallest units
 * @param poolTickSpacing - Pool tick spacing
 * @param assetIndex - Optional override for leg.asset (0n = token0 is asset, 1n = token1)
 * @returns Leg gamma in numeraire token smallest units
 */
export function getLegGamma(
  leg: TokenIdLeg,
  currentTick: bigint,
  positionSize: bigint,
  poolTickSpacing: bigint,
  assetIndex?: bigint,
): bigint {
  const isAssetToken0 = resolveAssetDirection(leg, assetIndex)

  // Convert to quote-denominated ticks (negate if asset is token0)
  const qCurrentTick = quoteTick(currentTick, isAssetToken0)
  const qStrikeTick = quoteTick(leg.strike, isAssetToken0)
  const halfWidthTick = (leg.width * poolTickSpacing) / 2n

  // Width=0: no curvature for a point position (denominator 2*(r-1)=0)
  if (halfWidthTick === 0n) return 0n

  // Range check: gamma is zero outside [strike - halfWidth, strike + halfWidth]
  // This works in both normal and inverted tick space
  if (qCurrentTick < qStrikeTick - halfWidthTick || qCurrentTick > qStrikeTick + halfWidthTick) {
    return 0n
  }

  // Position size with sign: gamma uses inverted multiplier (long = positive, short = negative)
  const m = leg.isLong ? positionSize * leg.optionRatio : -(positionSize * leg.optionRatio)

  // sqrt(K * P * r) using tick addition: sqrt(K*P*r) = sqrt(1.0001^(K_tick + P_tick + r_tick))
  const sqrtKPR = tickToSqrtPriceX96(qStrikeTick + qCurrentTick + halfWidthTick) // X96 scale

  // r = 1.0001^(halfWidthTick), compute as (sqrtR)^2 to maintain precision
  const sqrtR = tickToSqrtPriceX96(halfWidthTick) // X96 scale
  const rX192 = sqrtR * sqrtR // X192 scale: r * 2^192

  // gamma = m * sqrt(K*P*r) / (2 * (r - 1))
  //       = m * (sqrtKPR / 2^96) / (2 * (rX192/2^192 - 1))
  //       = m * sqrtKPR * 2^192 / (2^96 * 2 * (rX192 - 2^192))
  //       = m * sqrtKPR * 2^96 / (2 * (rX192 - 2^192))
  const numerator = m * sqrtKPR * Q96 // [asset] * [numeraire/asset * 2^96] * 2^96 = [numeraire * 2^192]
  const denominator = 2n * (rX192 - Q192) // 2 * (r - 1) in X192 scale

  return divTrunc(numerator, denominator) // [numeraire]
}

// --- Position-Level Aggregates ---

/**
 * Parameters for position-level greek calculations.
 */
export interface PositionGreeksInput {
  /** Position legs */
  legs: TokenIdLeg[]
  /** Current pool tick */
  currentTick: bigint
  /** Tick at position mint */
  mintTick: bigint
  /** Position size in asset token smallest units */
  positionSize: bigint
  /** Pool tick spacing */
  poolTickSpacing: bigint
  /** Optional override for leg.asset on all legs (0n = token0 is asset, 1n = token1) */
  assetIndex?: bigint
}

/**
 * Calculate total value across all legs.
 */
export function calculatePositionValue(input: PositionGreeksInput): bigint {
  const { legs, currentTick, mintTick, positionSize, poolTickSpacing, assetIndex } = input
  const definedRisk = isDefinedRisk(legs)

  return legs.reduce(
    (sum, leg) =>
      sum +
      getLegValue(
        leg,
        currentTick,
        mintTick,
        positionSize,
        poolTickSpacing,
        definedRisk,
        assetIndex,
      ),
    0n,
  )
}

/**
 * Calculate total delta across all legs.
 */
export function calculatePositionDelta(input: PositionGreeksInput): bigint {
  const { legs, currentTick, mintTick, positionSize, poolTickSpacing, assetIndex } = input
  const definedRisk = isDefinedRisk(legs)

  return legs.reduce(
    (sum, leg) =>
      sum +
      getLegDelta(
        leg,
        currentTick,
        positionSize,
        poolTickSpacing,
        mintTick,
        definedRisk,
        assetIndex,
      ),
    0n,
  )
}

/**
 * Calculate total gamma across all legs.
 */
export function calculatePositionGamma(input: PositionGreeksInput): bigint {
  const { legs, currentTick, positionSize, poolTickSpacing, assetIndex } = input

  return legs.reduce(
    (sum, leg) => sum + getLegGamma(leg, currentTick, positionSize, poolTickSpacing, assetIndex),
    0n,
  )
}

/**
 * Position greeks result.
 */
export interface PositionGreeksResult {
  /** Position value in numeraire token smallest units */
  value: bigint
  /** Position delta in asset token smallest units */
  delta: bigint
  /** Position gamma in numeraire token smallest units */
  gamma: bigint
}

/**
 * Calculate all greeks for a position.
 */
export function calculatePositionGreeks(input: PositionGreeksInput): PositionGreeksResult {
  return {
    value: calculatePositionValue(input),
    delta: calculatePositionDelta(input),
    gamma: calculatePositionGamma(input),
  }
}
