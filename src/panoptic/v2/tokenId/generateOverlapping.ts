/**
 * Pure generation of fixed-price TokenId ladders overlapping the current tick.
 * @module v2/tokenId/generateOverlapping
 */

import { PanopticValidationError } from '../errors'
import { priceToTick, roundToTickSpacing, tickToSqrtPriceX96 } from '../formatters'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
import { createTokenIdBuilder } from './builder'
import { type Timescale, LEG_LIMITS, STANDARD_TICK_WIDTHS, TOKEN_ID_BITS } from './constants'
import { decodeTickSpacing } from './encoding'

const MAX_UINT64 = (1n << 64n) - 1n
const MAX_UINT128 = (1n << 128n) - 1n
const Q192 = 1n << 192n
const MAX_TOKEN_DECIMALS = 255n
const MAX_DECIMAL_EXPONENT = 512n

export type OverlappingOptionType = 'call' | 'put'

/** One option leg repeated at every generated strike. */
export interface OverlappingOptionLegConfig {
  optionType: OverlappingOptionType
  optionRatio: bigint
  isLong: boolean
  /** Defaults to this leg's index. */
  riskPartner?: bigint
}

/** Parameters for {@link generateOverlappingTokenIds}. */
export interface GenerateOverlappingTokenIdsParams {
  /** Encoded 64-bit Panoptic pool ID, including tick spacing. */
  poolId: bigint
  /** Current Uniswap pool tick. */
  currentTick: bigint
  /** Standard option timescale used to derive every leg's width. */
  timescale: Timescale
  /** Positive quote-token price interval, such as "25" or "50". */
  strikePriceSpacing: string
  /** Asset token index in the pool (0 or 1). */
  asset: bigint
  assetDecimals: bigint
  quoteDecimals: bigint
  /** One to four call/put legs sharing each generated strike. */
  legs: readonly OverlappingOptionLegConfig[]
  /** Total size divided across all generated TokenIds. */
  positionSize: bigint
}

/** TokenIds and sizes aligned with the corresponding `dispatch()` arguments. */
export interface GenerateOverlappingTokenIdsResult {
  positionIdList: bigint[]
  positionSizes: bigint[]
}

interface ResolvedLegConfig extends OverlappingOptionLegConfig {
  riskPartner: bigint
}

interface DecimalSpacing {
  units: bigint
  scale: bigint
  denominator: bigint
}

interface Fraction {
  numerator: bigint
  denominator: bigint
}

function invalid(message: string): never {
  throw new PanopticValidationError(`generateOverlappingTokenIds: ${message}`)
}

function pow10(exponent: bigint): bigint {
  return 10n ** exponent
}

function parsePriceSpacing(value: string, quoteDecimals: bigint): DecimalSpacing {
  const match = /^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(value.trim())
  if (match === null) invalid('strikePriceSpacing must be a positive decimal string')

  const integerPart = match[1] ?? '0'
  const fractionalPart = match[2] ?? match[3] ?? ''
  const exponent = BigInt(match[4] ?? '0')
  if (exponent < -MAX_DECIMAL_EXPONENT || exponent > MAX_DECIMAL_EXPONENT) {
    invalid('strikePriceSpacing exponent is too large')
  }

  let units = BigInt(`${integerPart}${fractionalPart}`)
  let scale = BigInt(fractionalPart.length) - exponent
  if (scale < 0n) {
    units *= pow10(-scale)
    scale = 0n
  }

  while (scale > 0n && units % 10n === 0n) {
    units /= 10n
    scale -= 1n
  }

  if (units <= 0n) invalid('strikePriceSpacing must be positive')
  if (scale > quoteDecimals) {
    invalid('strikePriceSpacing exceeds the quote token decimal precision')
  }

  return { units, scale, denominator: pow10(scale) }
}

function formatGridPrice(multiple: bigint, spacing: DecimalSpacing): string {
  const scaledPrice = multiple * spacing.units
  if (spacing.scale === 0n) return scaledPrice.toString()

  const scale = Number(spacing.scale)
  const digits = scaledPrice.toString().padStart(scale + 1, '0')
  const decimalIndex = digits.length - scale
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
}

function quotePriceAtTick(
  tick: bigint,
  asset: bigint,
  assetDecimals: bigint,
  quoteDecimals: bigint,
): Fraction {
  const orientedTick = asset === 0n ? tick : -tick
  const sqrtPriceX96 = tickToSqrtPriceX96(orientedTick)
  let numerator = sqrtPriceX96 * sqrtPriceX96
  let denominator = Q192
  const decimalDifference = assetDecimals - quoteDecimals

  if (decimalDifference > 0n) {
    numerator *= pow10(decimalDifference)
  } else if (decimalDifference < 0n) {
    denominator *= pow10(-decimalDifference)
  }

  return { numerator, denominator }
}

function isPriceGridStrike(
  strike: bigint,
  params: Pick<GenerateOverlappingTokenIdsParams, 'asset' | 'assetDecimals' | 'quoteDecimals'>,
  spacing: DecimalSpacing,
  tickSpacing: bigint,
): boolean {
  const price = quotePriceAtTick(strike, params.asset, params.assetDecimals, params.quoteDecimals)
  const floorMultiple =
    (price.numerator * spacing.denominator) / (price.denominator * spacing.units)

  for (const multiple of [floorMultiple, floorMultiple + 1n]) {
    if (multiple <= 0n) continue

    const orientedTick = priceToTick(
      formatGridPrice(multiple, spacing),
      params.assetDecimals,
      params.quoteDecimals,
    )
    const poolTick = params.asset === 0n ? orientedTick : -orientedTick
    if (roundToTickSpacing(poolTick, tickSpacing) === strike) return true
  }

  return false
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor
  const remainder = value % divisor
  return remainder > 0n ? quotient + 1n : quotient
}

function floorDiv(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor
  const remainder = value % divisor
  return remainder < 0n ? quotient - 1n : quotient
}

function resolveLegs(legs: readonly OverlappingOptionLegConfig[]): ResolvedLegConfig[] {
  if (legs.length === 0 || legs.length > Number(TOKEN_ID_BITS.MAX_LEGS)) {
    invalid('legs must contain between 1 and 4 entries')
  }

  const resolved = legs.map((leg, index) => {
    if (leg.optionType !== 'call' && leg.optionType !== 'put') {
      invalid(`leg ${index} has an invalid optionType`)
    }
    if (typeof leg.isLong !== 'boolean') invalid(`leg ${index} has an invalid isLong value`)
    if (leg.optionRatio < 1n || leg.optionRatio > LEG_LIMITS.MAX_RATIO) {
      invalid(`leg ${index} optionRatio must be between 1 and ${LEG_LIMITS.MAX_RATIO}`)
    }

    const riskPartner = leg.riskPartner ?? BigInt(index)
    if (riskPartner < 0n || riskPartner >= BigInt(legs.length)) {
      invalid(`leg ${index} references an inactive risk partner`)
    }

    return { ...leg, riskPartner }
  })

  for (const [index, leg] of resolved.entries()) {
    if (leg.riskPartner === BigInt(index)) continue
    const partner = resolved[Number(leg.riskPartner)]
    if (partner === undefined || partner.riskPartner !== BigInt(index)) {
      invalid(`leg ${index} has a non-mutual risk partner`)
    }
  }

  return resolved
}

function getCandidateStrikes(
  params: GenerateOverlappingTokenIdsParams,
  spacing: DecimalSpacing,
  tickSpacing: bigint,
  halfWidth: bigint,
): bigint[] {
  const lower =
    MIN_TICK + halfWidth > params.currentTick - halfWidth + 1n
      ? MIN_TICK + halfWidth
      : params.currentTick - halfWidth + 1n
  const upper =
    MAX_TICK - halfWidth < params.currentTick + halfWidth - 1n
      ? MAX_TICK - halfWidth
      : params.currentTick + halfWidth - 1n
  const firstStrike = ceilDiv(lower, tickSpacing) * tickSpacing
  const lastStrike = floorDiv(upper, tickSpacing) * tickSpacing
  const strikes: bigint[] = []

  for (let strike = firstStrike; strike <= lastStrike; strike += tickSpacing) {
    if (isPriceGridStrike(strike, params, spacing, tickSpacing)) strikes.push(strike)
  }

  if (params.asset === 1n) strikes.reverse()
  return strikes
}

function buildTokenId(
  poolId: bigint,
  strike: bigint,
  width: bigint,
  asset: bigint,
  legs: readonly ResolvedLegConfig[],
): bigint {
  const builder = createTokenIdBuilder(poolId)
  for (const leg of legs) {
    const config = {
      strike,
      width,
      optionRatio: leg.optionRatio,
      isLong: leg.isLong,
      riskPartner: leg.riskPartner,
      asset,
    }
    if (leg.optionType === 'call') builder.addCall(config)
    else builder.addPut(config)
  }
  return builder.build()
}

function dividePositionSize(positionSize: bigint, count: bigint): bigint[] {
  if (positionSize < count) {
    invalid(`positionSize ${positionSize} is too small for ${count} nonzero positions`)
  }

  const quotient = positionSize / count
  const remainder = positionSize % count
  const sizes: bigint[] = []
  for (let index = 0n; index < count; index += 1n) {
    sizes.push(quotient + (index < remainder ? 1n : 0n))
  }
  return sizes
}

/**
 * Generate a fixed quote-price lattice of co-strike TokenIds whose liquidity
 * ranges strictly contain the current tick. Returned arrays are ordered by
 * ascending quote strike price and are ready for `dispatch()`.
 */
export function generateOverlappingTokenIds(
  params: GenerateOverlappingTokenIdsParams,
): GenerateOverlappingTokenIdsResult {
  if (params.poolId < 0n || params.poolId > MAX_UINT64) invalid('poolId must fit in uint64')
  if (params.currentTick < MIN_TICK || params.currentTick > MAX_TICK) {
    invalid(`currentTick must be between ${MIN_TICK} and ${MAX_TICK}`)
  }
  if (params.asset !== 0n && params.asset !== 1n) invalid('asset must be 0 or 1')
  if (
    params.assetDecimals < 0n ||
    params.assetDecimals > MAX_TOKEN_DECIMALS ||
    params.quoteDecimals < 0n ||
    params.quoteDecimals > MAX_TOKEN_DECIMALS
  ) {
    invalid('assetDecimals and quoteDecimals must be between 0 and 255')
  }
  if (params.positionSize <= 0n || params.positionSize > MAX_UINT128) {
    invalid('positionSize must be between 1 and uint128.max')
  }

  const tickSpacing = decodeTickSpacing(params.poolId)
  if (tickSpacing <= 0n) invalid('poolId tick spacing must be positive')

  const standardTickWidth = STANDARD_TICK_WIDTHS[params.timescale]
  if (standardTickWidth === undefined) invalid(`unknown timescale ${String(params.timescale)}`)
  const width = (standardTickWidth + tickSpacing - 1n) / tickSpacing
  if (width <= 0n || width > LEG_LIMITS.MAX_WIDTH) {
    invalid(
      `timescale width does not fit in the TokenId width field for tick spacing ${tickSpacing}`,
    )
  }

  const halfWidth = (width * tickSpacing) / 2n
  if (halfWidth <= 0n) invalid('timescale width must span at least two ticks')

  const spacing = parsePriceSpacing(params.strikePriceSpacing, params.quoteDecimals)
  const legs = resolveLegs(params.legs)
  const strikes = getCandidateStrikes(params, spacing, tickSpacing, halfWidth)
  if (strikes.length === 0) invalid('no price-grid strikes overlap the current tick')

  return {
    positionIdList: strikes.map((strike) =>
      buildTokenId(params.poolId, strike, width, params.asset, legs),
    ),
    positionSizes: dividePositionSize(params.positionSize, BigInt(strikes.length)),
  }
}
