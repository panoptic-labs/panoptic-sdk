import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import { decodeAllLegs } from '../panoptic/v2/tokenId'
import type { LpFeeRange } from './estimateLpFees'

const Q96 = 1n << 96n
const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d

/** Uniswap mint principal in raw token units, rounded up per leg, plus 5% headroom. */
export function getLpDepositAmounts(ranges: readonly LpFeeRange[], sqrtPriceX96: bigint) {
  return getLpDepositBreakdown(ranges, sqrtPriceX96).total
}

/** Principal and separately identified funding headroom, in native token units. */
export function getLpDepositBreakdown(ranges: readonly LpFeeRange[], sqrtPriceX96: bigint) {
  if (sqrtPriceX96 <= 0n) throw new Error('Invalid pool price')
  let amount0 = 0n
  let amount1 = 0n
  for (const { tickLower, tickUpper, liquidity } of ranges) {
    if (
      !Number.isInteger(tickLower) ||
      !Number.isInteger(tickUpper) ||
      tickLower < -887272 ||
      tickUpper > 887272 ||
      tickLower >= tickUpper ||
      liquidity < 0n
    )
      throw new Error('Invalid LP range')
    const lower = tickToSqrtPriceX96(BigInt(tickLower))
    const upper = tickToSqrtPriceX96(BigInt(tickUpper))
    const price = sqrtPriceX96 < lower ? lower : sqrtPriceX96 > upper ? upper : sqrtPriceX96
    amount0 += ceilDiv(liquidity * Q96 * (upper - price), upper * price)
    amount1 += ceilDiv(liquidity * (price - lower), Q96)
  }
  const buffer = { amount0: ceilDiv(amount0 * 5n, 100n), amount1: ceilDiv(amount1 * 5n, 100n) }
  return {
    principal: { amount0, amount1 },
    buffer,
    total: { amount0: amount0 + buffer.amount0, amount1: amount1 + buffer.amount1 },
  }
}

export interface LpPositionFundingParams {
  tokenId: bigint
  positionSize: bigint
  tickSpacing: bigint
  sqrtPriceX96: bigint
  /** Price used consistently to value funding and account collateral. */
  valuationSqrtPriceX96: bigint
  quoteTokenIndex: 0 | 1
}

export function getUnhedgedLpRanges({
  tokenId,
  positionSize,
  tickSpacing,
}: Pick<LpPositionFundingParams, 'tokenId' | 'positionSize' | 'tickSpacing'>): LpFeeRange[] {
  if (positionSize < 0n || tickSpacing <= 0n) throw new Error('Invalid LP range input')
  return decodeAllLegs(tokenId).flatMap((leg) => {
    if (leg.isLong || leg.width === 0n) return []
    const width = leg.width * tickSpacing
    const tickLower = leg.strike - width / 2n
    const tickUpper = leg.strike + (width + 1n) / 2n
    const lower = tickToSqrtPriceX96(tickLower)
    const upper = tickToSqrtPriceX96(tickUpper)
    const amount = positionSize * leg.optionRatio
    const liquidity =
      leg.asset === 0n
        ? (amount * ((lower * upper) / Q96)) / (upper - lower)
        : (amount * Q96) / (upper - lower)
    return liquidity <= 0n
      ? []
      : [{ tickLower: Number(tickLower), tickUpper: Number(tickUpper), liquidity }]
  })
}

/** Full deployed liquidity value; never a leveraged protocol margin estimate. */
export function getLpPositionFunding(params: LpPositionFundingParams) {
  const {
    tokenId,
    positionSize,
    tickSpacing,
    sqrtPriceX96,
    valuationSqrtPriceX96,
    quoteTokenIndex,
  } = params
  if (positionSize < 0n || tickSpacing <= 0n || valuationSqrtPriceX96 <= 0n)
    throw new Error('Invalid LP funding input')
  const legs = decodeAllLegs(tokenId)
  if (legs.length === 0 || legs.some((leg) => leg.isLong || leg.width === 0n))
    throw new Error('AMM Liquidity requires short liquidity legs without loans or credits')
  const ranges = getUnhedgedLpRanges({ tokenId, positionSize, tickSpacing })
  const breakdown = getLpDepositBreakdown(ranges, sqrtPriceX96)
  const priceSquared = valuationSqrtPriceX96 * valuationSqrtPriceX96
  const value = ({ amount0, amount1 }: { amount0: bigint; amount1: bigint }) =>
    quoteTokenIndex === 0
      ? amount0 + ceilDiv(amount1 * Q96 * Q96, priceSquared)
      : amount1 + ceilDiv(amount0 * priceSquared, Q96 * Q96)
  const principalInQuote = value(breakdown.principal)
  const totalInQuote = value(breakdown.total)
  return {
    ...breakdown,
    principalInQuote,
    bufferInQuote: totalInQuote - principalInQuote,
    totalInQuote,
  }
}

/** Remaining deposit in the requested token mix, rounded up to cover the shortfall. */
export function getLpFundingDeposit({
  funding,
  availableInQuote,
  minimumInQuote = 0n,
  quoteTokenIndex,
  valuationSqrtPriceX96,
  quotePercent,
}: {
  funding: ReturnType<typeof getLpPositionFunding>
  availableInQuote: bigint
  minimumInQuote?: bigint
  quoteTokenIndex: 0 | 1
  valuationSqrtPriceX96: bigint
  quotePercent?: bigint
}) {
  if (
    valuationSqrtPriceX96 <= 0n ||
    (quotePercent !== undefined && (quotePercent < 0n || quotePercent > 100n))
  )
    throw new Error('Invalid LP funding split')
  const requiredInQuote =
    minimumInQuote > funding.totalInQuote ? minimumInQuote : funding.totalInQuote
  const shortfallInQuote =
    requiredInQuote > availableInQuote ? requiredInQuote - availableInQuote : 0n
  const defaultQuotePercent =
    funding.totalInQuote > 0n
      ? ((quoteTokenIndex === 0 ? funding.total.amount0 : funding.total.amount1) * 100n) /
        funding.totalInQuote
      : 100n
  if (quotePercent === undefined) {
    return {
      requiredInQuote,
      shortfallInQuote,
      defaultQuotePercent,
      amount0:
        funding.totalInQuote > 0n
          ? ceilDiv(funding.total.amount0 * shortfallInQuote, funding.totalInQuote)
          : 0n,
      amount1:
        funding.totalInQuote > 0n
          ? ceilDiv(funding.total.amount1 * shortfallInQuote, funding.totalInQuote)
          : 0n,
    }
  }
  const quoteAmount = (shortfallInQuote * quotePercent) / 100n
  const assetValue = shortfallInQuote - quoteAmount
  const priceSquared = valuationSqrtPriceX96 * valuationSqrtPriceX96
  return {
    requiredInQuote,
    shortfallInQuote,
    defaultQuotePercent,
    amount0: quoteTokenIndex === 0 ? quoteAmount : ceilDiv(assetValue * Q96 * Q96, priceSquared),
    amount1: quoteTokenIndex === 1 ? quoteAmount : ceilDiv(assetValue * priceSquared, Q96 * Q96),
  }
}

/** Largest raw size funded by available collateral, including native-token rounding. */
export function getMaxLpPositionSize(
  params: Omit<LpPositionFundingParams, 'positionSize'> & {
    availableInQuote: bigint
    minimumRequirement?: { referenceSize: bigint; requiredInQuote: bigint }
  },
) {
  if (
    params.minimumRequirement &&
    (params.minimumRequirement.referenceSize <= 0n ||
      params.minimumRequirement.requiredInQuote < 0n)
  )
    throw new Error('Invalid reference requirement')
  if (params.availableInQuote <= 0n) return 0n
  let low = 0n
  let high = (1n << 128n) - 1n
  while (low < high) {
    const mid = (low + high + 1n) / 2n
    const funding = getLpPositionFunding({ ...params, positionSize: mid })
    const minimum = params.minimumRequirement
      ? ceilDiv(
          params.minimumRequirement.requiredInQuote * mid,
          params.minimumRequirement.referenceSize,
        )
      : 0n
    if (funding.totalInQuote <= params.availableInQuote && minimum <= params.availableInQuote)
      low = mid
    else high = mid - 1n
  }
  return low
}
