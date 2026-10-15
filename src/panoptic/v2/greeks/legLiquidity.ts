import { getAmountsForLiquidity } from '../../../uniswap/lpGreeks'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import type { TokenIdLeg } from '../types'

const Q96 = 1n << 96n

function divCeil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}

/** The Uniswap range and liquidity backing one option leg, with the contract's rounding. */
export function getLegLiquidityRange(
  leg: Pick<TokenIdLeg, 'asset' | 'optionRatio' | 'strike' | 'width'>,
  positionSize: bigint,
  tickSpacing: bigint,
) {
  const width = leg.width * tickSpacing
  // PanopticMath.getTicks uses floor below the strike and ceil above it.
  const lowerTick = leg.strike - width / 2n
  const upperTick = leg.strike + (width + 1n) / 2n
  if (lowerTick < -887272n || upperTick > 887272n || lowerTick >= upperTick) {
    throw new RangeError('Invalid position range')
  }
  const sqrtLower = tickToSqrtPriceX96(lowerTick)
  const sqrtUpper = tickToSqrtPriceX96(upperTick)
  const amount = positionSize * leg.optionRatio
  // Match the contract's intermediate truncation for token0 liquidity.
  const liquidity =
    leg.asset === 0n
      ? (amount * ((sqrtLower * sqrtUpper) / Q96)) / (sqrtUpper - sqrtLower)
      : (amount * Q96) / (sqrtUpper - sqrtLower)
  return { lowerTick, upperTick, sqrtLower, sqrtUpper, liquidity }
}

/**
 * One option leg's signed holding of `tokenIndex` at `currentTick`: the amount
 * its liquidity holds minus the amount the leg moved, positive for short legs.
 */
export function getLegTokenInventory(
  leg: Pick<TokenIdLeg, 'asset' | 'optionRatio' | 'strike' | 'width' | 'tokenType' | 'isLong'>,
  currentTick: bigint,
  positionSize: bigint,
  tickSpacing: bigint,
  tokenIndex: 0n | 1n,
): bigint {
  const { sqrtLower, sqrtUpper, liquidity } = getLegLiquidityRange(leg, positionSize, tickSpacing)
  const held = getAmountsForLiquidity(
    tickToSqrtPriceX96(currentTick),
    sqrtLower,
    sqrtUpper,
    liquidity,
  )
  const heldAmount = tokenIndex === 0n ? held.amount0 : held.amount1

  let movedAmount = 0n
  if (leg.tokenType === tokenIndex) {
    const span = sqrtUpper - sqrtLower
    // Short legs owe the moved amount rounded up, as the contract does.
    if (tokenIndex === 0n) {
      const scaled = (liquidity << 96n) * span
      movedAmount = leg.isLong
        ? scaled / sqrtUpper / sqrtLower
        : divCeil(divCeil(scaled, sqrtUpper), sqrtLower)
    } else {
      movedAmount = leg.isLong ? (liquidity * span) / Q96 : divCeil(liquidity * span, Q96)
    }
  }

  const net = heldAmount - movedAmount
  return leg.isLong ? -net : net
}
