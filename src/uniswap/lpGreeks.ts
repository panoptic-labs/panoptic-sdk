/**
 * Greeks for plain (non-Panoptic) Uniswap v3/v4 concentrated-liquidity LP
 * positions. Pure math over on-chain position fields (liquidity + tick range)
 * and the pool's current price — no RPC, no protocol dependency.
 *
 * Units follow the Panoptic v2 greeks convention (see
 * `packages/sdk/src/panoptic/v2/greeks/index.ts`) so a caller can present LP
 * and Panoptic greeks side by side:
 *   - `value`  → numeraire-token smallest units
 *   - `delta`  → asset-token smallest units (the asset held by the LP)
 *   - `gamma`  → numeraire-token smallest units (dollar-gamma `P²·d²V/dP²`;
 *                always ≤ 0 because an LP is short gamma)
 *
 * `assetIndex` selects which token is the "asset" (the volatile leg being
 * hedged): `0` → token0 is the asset / token1 the numeraire; `1` → the reverse.
 *
 * @module uniswap/lpGreeks
 */

import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'

const Q96 = 1n << 96n
const Q192 = 1n << 192n

/** Token amounts currently backing a concentrated-liquidity position. */
export interface LpAmounts {
  /** token0 amount in its smallest units. */
  amount0: bigint
  /** token1 amount in its smallest units. */
  amount1: bigint
}

/** Greeks of a Uniswap LP position in one asset frame (see module docs for units). */
export interface LpGreeks {
  /** Position value in numeraire-token smallest units. */
  value: bigint
  /** Delta in asset-token smallest units (the asset amount the LP is long). */
  delta: bigint
  /** Dollar-gamma in numeraire-token smallest units; ≤ 0 (LP is short gamma). */
  gamma: bigint
}

/** Inputs describing a single LP position + the pool's current price. */
export interface LpGreeksInput {
  /** Position liquidity `L`. */
  liquidity: bigint
  /** Lower tick of the range. */
  tickLower: bigint
  /** Upper tick of the range. */
  tickUpper: bigint
  /** Pool's current tick. */
  currentTick: bigint
  /** Which token is the asset: `0` (token0) or `1` (token1). */
  assetIndex: 0 | 1
}

/**
 * Compute the token0/token1 amounts backing `liquidity` over `[sqrtA, sqrtB]`
 * at the current price `sqrtP`, mirroring Uniswap's `LiquidityAmounts`
 * (`getAmountsForLiquidity`). All sqrt prices are X96. The current price is
 * clamped into the range, so out-of-range positions collapse to a single token.
 */
export function getAmountsForLiquidity(
  sqrtPriceX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): LpAmounts {
  // Normalize so A <= B.
  const [sqrtA, sqrtB] =
    sqrtRatioAX96 <= sqrtRatioBX96 ? [sqrtRatioAX96, sqrtRatioBX96] : [sqrtRatioBX96, sqrtRatioAX96]

  // Clamp the current price into [A, B].
  const sqrtC = sqrtPriceX96 < sqrtA ? sqrtA : sqrtPriceX96 > sqrtB ? sqrtB : sqrtPriceX96

  // amount0 = L * (sqrtB - sqrtC) * 2^96 / (sqrtC * sqrtB)
  const amount0 = sqrtC < sqrtB ? (liquidity * (sqrtB - sqrtC) * Q96) / (sqrtC * sqrtB) : 0n

  // amount1 = L * (sqrtC - sqrtA) / 2^96
  const amount1 = sqrtC > sqrtA ? (liquidity * (sqrtC - sqrtA)) / Q96 : 0n

  return { amount0, amount1 }
}

/**
 * Greeks (value, delta, gamma) for a Uniswap LP position in the chosen asset
 * frame. See the module docs for the unit conventions.
 *
 * Closed forms (in-range, numeraire = token1 / asset = token0):
 *   value = amount1 + amount0·P               (P = sqrtP² / 2^192)
 *   delta = amount0                            (= dV/dP)
 *   gamma = P²·d²V/dP² = -L·sqrt(P)/2          (short gamma)
 * The `assetIndex = 1` frame is the symmetric inverse (numeraire = token0).
 * Gamma is zero when the price is outside the range (no curvature there).
 */
export function getLpGreeks(input: LpGreeksInput): LpGreeks {
  const { liquidity, tickLower, tickUpper, currentTick, assetIndex } = input

  const sqrtP = tickToSqrtPriceX96(currentTick)
  const sqrtA = tickToSqrtPriceX96(tickLower)
  const sqrtB = tickToSqrtPriceX96(tickUpper)

  const { amount0, amount1 } = getAmountsForLiquidity(sqrtP, sqrtA, sqrtB, liquidity)

  const sqrtP2 = sqrtP * sqrtP // P in X192
  const inRange = sqrtP > sqrtA && sqrtP < sqrtB

  if (assetIndex === 0) {
    // numeraire = token1, asset = token0
    const value = amount1 + (amount0 * sqrtP2) / Q192
    const delta = amount0
    // gamma = -L·sqrt(P)/2, sqrt(P) = sqrtP / 2^96 → in token1 units
    const gamma = inRange ? -(liquidity * sqrtP) / (2n * Q96) : 0n
    return { value, delta, gamma }
  }

  // numeraire = token0, asset = token1
  const value = amount0 + (amount1 * Q192) / sqrtP2
  const delta = amount1
  // gamma = -L·sqrt(1/P)/2, sqrt(1/P) = 2^96 / sqrtP → in token0 units
  const gamma = inRange ? -(liquidity * Q96) / (2n * sqrtP) : 0n
  return { value, delta, gamma }
}
