import Decimal from 'decimal.js'

import { tickToSqrtPriceX96 } from '../formatters/tick'
import { decodeTokenId } from '../tokenId/decode'

const Precision = Decimal.clone({ precision: 80 })
const Q96 = 1n << 96n
const YEAR_SECONDS = new Precision(31_536_000)

/** The premium-free position curve, expressed in one quote token's human units. */
export function preparePositionGamma({
  tokenId,
  positionSize,
  quoteIsToken0,
  quoteDecimals,
}: {
  tokenId: bigint
  positionSize: bigint
  quoteIsToken0: boolean
  quoteDecimals: number
}) {
  if (positionSize <= 0n || positionSize >= 1n << 128n) {
    throw new RangeError('Invalid position size')
  }
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > 255) {
    throw new RangeError('Invalid quote decimals')
  }
  const decoded = decodeTokenId(tokenId)
  const chunks = decoded.legs.flatMap((leg) => {
    if (leg.width === 0n) return []
    const width = leg.width * decoded.tickSpacing
    const lowerTick = leg.strike - width / 2n
    const upperTick = leg.strike + (width + 1n) / 2n
    if (lowerTick < -887272n || upperTick > 887272n || lowerTick >= upperTick) {
      throw new RangeError('Invalid position range')
    }
    const lower = tickToSqrtPriceX96(lowerTick)
    const upper = tickToSqrtPriceX96(upperTick)
    const amount = positionSize * leg.optionRatio
    // Match the contract's intermediate truncation for token0 liquidity.
    const liquidity =
      leg.asset === 0n
        ? (amount * ((lower * upper) / Q96)) / (upper - lower)
        : (amount * Q96) / (upper - lower)
    if (liquidity >= 1n << 128n) throw new RangeError('Liquidity exceeds uint128')
    return [
      { lowerTick: Number(lowerTick), upperTick: Number(upperTick), liquidity, isLong: leg.isLong },
    ]
  })
  const scale = new Precision(10).pow(quoteDecimals)
  const atTick = (tick: bigint) => {
    const netLiquidity = chunks.reduce(
      (sum, chunk) =>
        tick >= BigInt(chunk.lowerTick) && tick < BigInt(chunk.upperTick)
          ? sum + (chunk.isLong ? -chunk.liquidity : chunk.liquidity)
          : sum,
      0n,
    )
    const sqrt = new Precision(tickToSqrtPriceX96(tick).toString()).div(Q96.toString())
    const gamma = new Precision(netLiquidity.toString()).neg().div(2).div(scale)
    return quoteIsToken0 ? gamma.div(sqrt) : gamma.mul(sqrt)
  }
  const inRange = (low: bigint, high: bigint) => {
    if (low > high) throw new RangeError('Invalid candle range')
    const ticks = new Set([low, high])
    for (const chunk of chunks) {
      for (const boundary of [BigInt(chunk.lowerTick), BigInt(chunk.upperTick)]) {
        if (boundary >= low && boundary <= high) ticks.add(boundary)
        if (boundary - 1n >= low && boundary - 1n <= high) ticks.add(boundary - 1n)
      }
    }
    return [...ticks].map(atTick)
  }
  return { chunks, atTick, inRange }
}

export interface PositionVolatilityObservation {
  timestamp: bigint
  /** Any consistent positive price scale; only log price ratios are used. */
  price: Decimal.Value
  /** Signed dollar-gamma in human quote units at this observation. */
  gamma: Decimal.Value
  /** Whole-position gamma at price regions visited since the previous observation. */
  rangeGammas?: readonly Decimal.Value[]
}

export type VolatilityComparisonReason =
  | 'insufficient-exposure'
  | 'changing-sign'
  | 'premium-unavailable'
  | 'inconsistent-premium-direction'

/** Historical whole-position diagnostics, with signs retained independently of eligibility. */
export function calculatePositionVolatilityMetrics({
  observations,
  netPremium,
  baseFees,
  quoteDecimals,
}: {
  observations: readonly PositionVolatilityObservation[]
  netPremium: Decimal.Value | null
  baseFees?: Decimal.Value | null
  quoteDecimals: number
}) {
  if (observations.length < 2) throw new RangeError('At least two price observations are required')
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > 255) {
    throw new RangeError('Invalid quote decimals')
  }
  const points = observations.map((point) => ({
    ...point,
    price: new Precision(point.price),
    gamma: new Precision(point.gamma),
    rangeGammas: (point.rangeGammas ?? []).map((gamma) => new Precision(gamma)),
  }))
  for (const point of points) {
    if (
      !point.price.isFinite() ||
      point.price.lte(0) ||
      !point.gamma.isFinite() ||
      point.rangeGammas.some((gamma) => !gamma.isFinite())
    )
      throw new RangeError('Invalid price or gamma observation')
  }
  const quantum = new Precision(10).pow(-quoteDecimals)
  const gammas = points.flatMap((point) => [point.gamma, ...point.rangeGammas])
  const peak = gammas.reduce((max, gamma) => Precision.max(max, gamma.abs()), new Precision(0))
  const tolerance = Precision.max(quantum, peak.mul('1e-12'))
  const positive = gammas.some((gamma) => gamma.gt(tolerance))
  const negative = gammas.some((gamma) => gamma.lt(tolerance.neg()))
  const gammaSign =
    positive && negative ? 'changing' : positive ? 'positive' : negative ? 'negative' : 'zero'
  let exposure = new Precision(0)
  let signedConvexity = new Precision(0)
  let absoluteConvexity = new Precision(0)
  let years = new Precision(0)
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const point = points[i]
    const seconds = point.timestamp - previous.timestamp
    if (seconds <= 0n) throw new RangeError('Observations must have increasing timestamps')
    const elapsed = new Precision(seconds.toString()).div(YEAR_SECONDS)
    const squaredReturn = point.price.div(previous.price).ln().pow(2)
    exposure = exposure.plus(previous.gamma.abs().mul(elapsed))
    signedConvexity = signedConvexity.plus(previous.gamma.mul(squaredReturn).div(2))
    absoluteConvexity = absoluteConvexity.plus(previous.gamma.abs().mul(squaredReturn).div(2))
    years = years.plus(elapsed)
  }
  const sufficientExposure = exposure.gt(tolerance.mul(years).mul(100))
  const premium = netPremium === null ? null : new Precision(netPremium)
  const fees = baseFees == null ? null : new Precision(baseFees)
  if ((premium !== null && !premium.isFinite()) || (fees !== null && !fees.isFinite())) {
    throw new RangeError('Invalid accounting amount')
  }
  const consistent = (amount: Decimal) =>
    gammaSign === 'positive'
      ? amount.lte(quantum)
      : gammaSign === 'negative' && amount.gte(quantum.neg())
  const reason: VolatilityComparisonReason | null = !sufficientExposure
    ? 'insufficient-exposure'
    : gammaSign === 'changing'
      ? 'changing-sign'
      : premium === null
        ? 'premium-unavailable'
        : !consistent(premium)
          ? 'inconsistent-premium-direction'
          : null
  const equivalent = (amount: Decimal) => amount.abs().mul(2).div(exposure).sqrt().toString()
  const coverage = (amount: Decimal) =>
    absoluteConvexity.gt(quantum) ? amount.abs().div(absoluteConvexity).toString() : null
  const eligibleFees = sufficientExposure && fees !== null && consistent(fees)
  return {
    gammaSign,
    exposure: exposure.toString(),
    signedConvexity: signedConvexity.toString(),
    absoluteConvexity: absoluteConvexity.toString(),
    netPremium: premium?.toString() ?? null,
    estimatedHedgedResult: premium?.plus(signedConvexity).toString() ?? null,
    weightedRealizedVolatility: sufficientExposure ? equivalent(absoluteConvexity) : null,
    premiumEquivalentVolatility: reason === null && premium !== null ? equivalent(premium) : null,
    premiumToConvexity: reason === null && premium !== null ? coverage(premium) : null,
    baseFees: fees?.toString() ?? null,
    feeEquivalentVolatility: eligibleFees ? equivalent(fees) : null,
    feeToConvexity: eligibleFees ? coverage(fees) : null,
    comparisonReason: reason,
  }
}

/** Quote-value signed cumulative token increments, excluding revaluation of previous accrual. */
export function valuePositionAccrual({
  snapshots,
  quoteIsToken0,
  quoteDecimals,
}: {
  snapshots: readonly { token0: bigint; token1: bigint; tick: bigint }[]
  quoteIsToken0: boolean
  quoteDecimals: number
}) {
  let previous0 = 0n
  let previous1 = 0n
  let total = new Precision(0)
  for (const snapshot of snapshots) {
    const amount0 = new Precision((snapshot.token0 - previous0).toString())
    const amount1 = new Precision((snapshot.token1 - previous1).toString())
    const price = new Precision('1.0001').pow(snapshot.tick.toString())
    total = total.plus(
      quoteIsToken0 ? amount0.plus(amount1.div(price)) : amount1.plus(amount0.mul(price)),
    )
    previous0 = snapshot.token0
    previous1 = snapshot.token1
  }
  return total.div(new Precision(10).pow(quoteDecimals))
}
