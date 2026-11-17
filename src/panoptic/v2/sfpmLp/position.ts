/**
 * Direct-LP token IDs: ranges in, token ID out, with the SFPM's exact tick and
 * liquidity rounding.
 * @module v2/sfpmLp/position
 */
import { PanopticValidationError } from '../errors'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import { createTokenIdBuilder, decodeAllLegs, decodeTickSpacing, LEG_LIMITS } from '../tokenId'

const Q96 = 1n << 96n
/** `positionSize` is a uint128 in the SFPM. */
const MAX_POSITION_SIZE = (1n << 128n) - 1n

/** One Uniswap range of a direct-LP position. */
export interface SfpmLpRange {
  tickLower: bigint
  tickUpper: bigint
  /** Token that `positionSize` is denominated in for this range: 0 = token0, 1 = token1. */
  asset: 0n | 1n
  /**
   * SFPM accounting bucket (0 or 1); defaults to {@link asset}. Two ranges with
   * the same ticks but different token types are separate chunks.
   */
  tokenType?: 0n | 1n
  /** Multiplier applied to `positionSize` for this range (1-127); defaults to 1. */
  optionRatio?: bigint
}

/** A decoded direct-LP leg with its exact Uniswap ticks. */
export interface SfpmLpLeg {
  index: bigint
  asset: bigint
  tokenType: bigint
  optionRatio: bigint
  tickLower: bigint
  tickUpper: bigint
}

export interface BuildSfpmLpTokenIdParams {
  /**
   * SFPM poolId from {@link fetchSfpmV3PoolId}. It embeds the vegoid: use one
   * poolId per underlying pool for a given account.
   */
  poolId: bigint
  /** 1-4 ranges; no two may share both ticks and token type. */
  ranges: readonly SfpmLpRange[]
}

/**
 * Build the token ID for a direct-LP position. Every leg adds liquidity
 * (short, non-zero width); the SFPM poolId fixes the tick spacing and vegoid.
 */
export function buildSfpmLpTokenId(params: BuildSfpmLpTokenIdParams): bigint {
  const { poolId, ranges } = params
  if (ranges.length === 0 || ranges.length > 4) {
    throw new PanopticValidationError(
      `a direct-LP position needs 1-4 ranges (got ${ranges.length})`,
    )
  }

  const tickSpacing = decodeTickSpacing(poolId)
  if (tickSpacing <= 0n) {
    throw new PanopticValidationError(`poolId ${poolId} does not encode a tick spacing`)
  }

  const chunks = new Set<string>()
  const builder = createTokenIdBuilder(poolId)
  for (const range of ranges) {
    const { tickLower, tickUpper, asset } = range
    const tokenType = range.tokenType ?? asset
    const span = tickUpper - tickLower
    if (span <= 0n) {
      throw new PanopticValidationError(
        `range [${tickLower}, ${tickUpper}] must have tickLower < tickUpper`,
      )
    }
    if (tickLower % tickSpacing !== 0n || tickUpper % tickSpacing !== 0n) {
      throw new PanopticValidationError(
        `range [${tickLower}, ${tickUpper}] is not aligned to tick spacing ${tickSpacing}`,
      )
    }
    const width = span / tickSpacing
    if (width > LEG_LIMITS.MAX_WIDTH) {
      throw new PanopticValidationError(
        `range [${tickLower}, ${tickUpper}] spans ${width} tick spacings; the maximum is ${LEG_LIMITS.MAX_WIDTH}`,
      )
    }

    const chunk = `${tokenType}:${tickLower}:${tickUpper}`
    if (chunks.has(chunk)) {
      throw new PanopticValidationError(
        `range [${tickLower}, ${tickUpper}] with tokenType ${tokenType} appears twice; a token ID cannot repeat a chunk`,
      )
    }
    chunks.add(chunk)

    builder.addLeg({
      asset,
      tokenType,
      optionRatio: range.optionRatio ?? 1n,
      isLong: false,
      strike: tickLower + span / 2n,
      width,
    })
  }
  return builder.build()
}

/**
 * Decode a direct-LP token ID into legs with exact ticks.
 *
 * @throws PanopticValidationError if any leg removes liquidity (long) or has zero width
 */
export function decodeSfpmLpLegs(tokenId: bigint): SfpmLpLeg[] {
  const tickSpacing = decodeTickSpacing(tokenId)
  const legs = decodeAllLegs(tokenId)
  if (legs.length === 0) throw new PanopticValidationError(`token ID ${tokenId} has no legs`)

  return legs.map((leg) => {
    if (leg.isLong || leg.width === 0n) {
      throw new PanopticValidationError(
        `token ID ${tokenId} leg ${leg.index} is not a liquidity-adding range; direct-LP positions hold short, non-zero-width legs only`,
      )
    }
    // The SFPM rounds the half-range down below the strike and up above it.
    const span = leg.width * tickSpacing
    return {
      index: leg.index,
      asset: leg.asset,
      tokenType: leg.tokenType,
      optionRatio: leg.optionRatio,
      tickLower: leg.strike - span / 2n,
      tickUpper: leg.strike + (span + 1n) / 2n,
    }
  })
}

/** Uniswap liquidity the SFPM mints or burns in `leg` for `positionSize` contracts. */
export function sfpmLpLegLiquidity(leg: SfpmLpLeg, positionSize: bigint): bigint {
  const sqrtLower = tickToSqrtPriceX96(leg.tickLower)
  const sqrtUpper = tickToSqrtPriceX96(leg.tickUpper)
  const amount = positionSize * leg.optionRatio
  return leg.asset === 0n
    ? (amount * ((sqrtUpper * sqrtLower) / Q96)) / (sqrtUpper - sqrtLower)
    : (amount * Q96) / (sqrtUpper - sqrtLower)
}

/**
 * Smallest position size that gives every leg at least one unit of liquidity.
 *
 * @throws PanopticValidationError if a range cannot hold liquidity at any supported size
 */
export function minSfpmLpPositionSize(legs: readonly SfpmLpLeg[]): bigint {
  const hasLiquidity = (size: bigint) => legs.every((leg) => sfpmLpLegLiquidity(leg, size) > 0n)
  if (!hasLiquidity(MAX_POSITION_SIZE)) {
    const leg = legs.find((candidate) => sfpmLpLegLiquidity(candidate, MAX_POSITION_SIZE) === 0n)
    throw new PanopticValidationError(
      `range [${leg?.tickLower}, ${leg?.tickUpper}] cannot hold liquidity at any position size`,
    )
  }
  let high = 1n
  while (!hasLiquidity(high)) high *= 2n
  let low = high / 2n
  while (high - low > 1n) {
    const mid = (low + high) / 2n
    if (hasLiquidity(mid)) high = mid
    else low = mid
  }
  return high
}

/** How a requested burn splits into `burnTokenizedPosition` calls. */
export interface SfpmLpBurnPlan {
  /** Size of each burn call, in order. Empty when nothing can be burned. */
  burnSizes: bigint[]
  /** Contracts that cannot be burned because they round to more liquidity than the chunks hold. */
  unburnableSize: bigint
}

const MAX_BURN_CALLS = 4

/**
 * Split a burn of `positionSize` contracts so no call removes more liquidity
 * than a chunk holds.
 *
 * Liquidity is floored per mint, so a position built from several increases can
 * hold slightly less liquidity than one burn of the full size would remove, and
 * the SFPM reverts that burn with `NotEnoughLiquidityInChunk`.
 *
 * @param netLiquidities - The account's net liquidity per leg chunk, in leg order
 */
export function planSfpmLpBurn(
  legs: readonly SfpmLpLeg[],
  netLiquidities: readonly bigint[],
  positionSize: bigint,
): SfpmLpBurnPlan {
  const minSize = minSfpmLpPositionSize(legs)
  const remainingLiquidity = [...netLiquidities]
  const fits = (size: bigint) =>
    legs.every((leg, i) => sfpmLpLegLiquidity(leg, size) <= (remainingLiquidity[i] ?? 0n))

  const burnSizes: bigint[] = []
  let remaining = positionSize
  while (remaining >= minSize && burnSizes.length < MAX_BURN_CALLS && fits(minSize)) {
    let low = minSize
    let high = remaining
    while (low < high) {
      const mid = (low + high + 1n) / 2n
      if (fits(mid)) low = mid
      else high = mid - 1n
    }
    burnSizes.push(low)
    remaining -= low
    legs.forEach((leg, i) => {
      remainingLiquidity[i] = (remainingLiquidity[i] ?? 0n) - sfpmLpLegLiquidity(leg, low)
    })
  }
  return { burnSizes, unburnableSize: remaining }
}
