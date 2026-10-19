import { getLegLiquidityRange } from '../greeks/legLiquidity'
import { decodeTokenId } from '../tokenId/decode'

const Q96 = 1n << 96n
const Q192 = 1n << 192n
const BPS = 10_000n
const FEE_SCALE = 1_000_000n

const max = (a: bigint, b: bigint) => (a > b ? a : b)
const ceilDiv = (n: bigint, d: bigint) => (n > 0n ? (n + d - 1n) / d : n / d)

export interface PositionMintFundingParams {
  tokenId: bigint
  positionSize: bigint
  /** Execution price, in native token1/token0 units. */
  sqrtPriceX96: bigint
  /** Oracle price used to value collateral and the margin requirement. */
  valuationSqrtPriceX96: bigint
  swapAtMint: boolean
  /** CollateralTracker notional commission, in basis points. */
  commissionRate: bigint
  /** Uniswap fee, in millionths. */
  swapFee: bigint
  slippageBps: bigint
  /** Buffered margin requirements in native token units. */
  required0: bigint
  required1: bigint
}

/**
 * Estimate deposit-independent mint funding, including settlement and commission.
 * Swaps use spot conversion with fees and slippage allowance; execution still needs a live quote.
 * Received tokens cover post-mint margin but cannot fund the other tracker's upfront payment.
 * Each requiredValue is the starting balance when funding entirely in that token.
 */
export function getPositionMintFunding(params: PositionMintFundingParams) {
  const {
    tokenId,
    positionSize,
    sqrtPriceX96,
    valuationSqrtPriceX96,
    swapAtMint,
    commissionRate,
    swapFee,
    slippageBps,
    required0,
    required1,
  } = params
  if (
    positionSize < 0n ||
    sqrtPriceX96 <= 0n ||
    valuationSqrtPriceX96 <= 0n ||
    commissionRate < 0n ||
    swapFee < 0n ||
    swapFee >= FEE_SCALE ||
    slippageBps < 0n ||
    slippageBps >= BPS ||
    required0 < 0n ||
    required1 < 0n
  )
    throw new RangeError('Invalid mint funding inputs')

  const { legs, tickSpacing } = decodeTokenId(tokenId)
  const firstLeg = legs[0]
  if (!firstLeg || tickSpacing <= 0n) throw new RangeError('Invalid position')
  let paid0 = 0n
  let paid1 = 0n
  let itm0 = 0n
  let itm1 = 0n
  let notional0 = 0n
  let notional1 = 0n

  for (const leg of legs) {
    // PanopticMath prices width-zero loans/credits using a synthetic width of two.
    const { sqrtLower, sqrtUpper, liquidity } = getLegLiquidityRange(
      leg.width === 0n ? { ...leg, width: 2n } : leg,
      positionSize,
      tickSpacing,
    )
    const round = !leg.isLong || leg.width === 0n ? ceilDiv : (n: bigint, d: bigint) => n / d
    const moved0 = round((liquidity << 96n) * (sqrtUpper - sqrtLower), sqrtUpper * sqrtLower)
    const moved1 = round(liquidity * (sqrtUpper - sqrtLower), Q96)
    const sign = leg.isLong ? -1n : 1n
    let amm0 = 0n
    let amm1 = 0n
    if (leg.width > 0n) {
      const price = max(sqrtLower, sqrtPriceX96 < sqrtUpper ? sqrtPriceX96 : sqrtUpper)
      amm0 = sign * round((liquidity << 96n) * (sqrtUpper - price), sqrtUpper * price)
      amm1 = sign * round(liquidity * (price - sqrtLower), Q96)
      itm0 += leg.tokenType === 1n ? amm0 : 0n
      itm1 += leg.tokenType === 0n ? amm1 : 0n
    } else {
      itm0 -= leg.tokenType === 0n ? sign * moved0 : 0n
      itm1 -= leg.tokenType === 1n ? sign * moved1 : 0n
    }
    paid0 += amm0 - (leg.tokenType === 0n ? sign * moved0 : 0n)
    paid1 += amm1 - (leg.tokenType === 1n ? sign * moved1 : 0n)
    notional0 += leg.tokenType === 0n ? moved0 : 0n
    notional1 += leg.tokenType === 1n ? moved1 : 0n
  }

  if (swapAtMint && (itm0 !== 0n || itm1 !== 0n)) {
    // SFPM chooses the first leg's asset when both ITM slots are nonzero.
    const swapToken0 = itm0 !== 0n && (itm1 === 0n || firstLeg.asset === 0n)
    const priceSquared = sqrtPriceX96 * sqrtPriceX96
    const itm = swapToken0 ? itm0 : itm1
    const numerator = swapToken0 ? priceSquared : Q192
    const denominator = swapToken0 ? Q192 : priceSquared
    const retained = (FEE_SCALE - swapFee) * (BPS - slippageBps)
    const scale = FEE_SCALE * BPS
    const payment =
      itm > 0n
        ? ceilDiv(itm * numerator * scale, denominator * retained)
        : (itm * numerator * retained) / (denominator * scale)
    paid0 += swapToken0 ? -itm : payment
    paid1 += swapToken0 ? payment : -itm
  }
  paid0 += ceilDiv(notional0 * commissionRate, BPS)
  paid1 += ceilDiv(notional1 * commissionRate, BPS)

  const priceSquared = valuationSqrtPriceX96 * valuationSqrtPriceX96
  const inToken0 = (amount0: bigint, amount1: bigint) =>
    amount0 + ceilDiv(amount1 * Q192, priceSquared)
  const inToken1 = (amount0: bigint, amount1: bigint) =>
    amount1 + ceilDiv(amount0 * priceSquared, Q192)
  const retained = (FEE_SCALE - swapFee) * (BPS - slippageBps)
  const scale = FEE_SCALE * BPS
  const spotSquared = sqrtPriceX96 * sqrtPriceX96
  // Funding in either numeraire must also pay to acquire the other token before minting.
  const upfront0 = max(paid0, 0n) + ceilDiv(max(paid1, 0n) * Q192 * scale, spotSquared * retained)
  const upfront1 = max(paid1, 0n) + ceilDiv(max(paid0, 0n) * spotSquared * scale, Q192 * retained)
  const requiredValue0 =
    upfront0 + max(0n, inToken0(required0 - max(-paid0, 0n), required1 - max(-paid1, 0n)))
  const requiredValue1 =
    upfront1 + max(0n, inToken1(required0 - max(-paid0, 0n), required1 - max(-paid1, 0n)))

  return { paid0, paid1, requiredValue0, requiredValue1 }
}
