import { type Address, type PublicClient, parseAbi } from 'viem'

import { tickToSqrtPriceX96 } from '../formatters/tick'
import { decodeTokenId } from '../tokenId/decode'

export type PositionValueInput = { tokenId: bigint; positionSize: bigint }
export type PositionValueCurve = { tick: bigint; value0: bigint; value1: bigint }[]

const abi = parseAbi([
  'function computeNetLiquidationValue(uint256[] positionIdList, uint256 shortPremium, uint256 longPremium, uint256[] positionBalanceArray, int24[] atTicks) pure returns (int256[] value0, int256[] value1)',
])

/** Stable identity for a position-dependent curve; premiums and spot are separate inputs. */
export function positionValueKey(positions: readonly PositionValueInput[]): string {
  return [...positions]
    .sort((a, b) => (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0))
    .map(({ tokenId, positionSize }) => `${tokenId}:${positionSize}`)
    .join(',')
}

/** All changes in the curve's active liquidity, independent of the current market tick. */
export function positionValueTicks(positions: readonly PositionValueInput[]): bigint[] {
  const ticks = new Set([-887272n, 887272n])
  for (const { tokenId, positionSize } of positions) {
    if (tokenId < 0n || tokenId >= 1n << 256n || positionSize <= 0n || positionSize >= 1n << 128n)
      throw new RangeError('Invalid position id or size')
    const { legs, tickSpacing } = decodeTokenId(tokenId)
    for (const leg of legs) {
      if (leg.width === 0n) continue
      const width = leg.width * tickSpacing
      const lower = leg.strike - width / 2n
      const upper = leg.strike + (width + 1n) / 2n
      if (lower < -887272n || upper > 887272n || lower >= upper)
        throw new RangeError('Invalid position range')
      ticks.add(lower)
      ticks.add(upper)
    }
  }
  return [...ticks].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Read the immutable, premium-free part of NLV from the deployed pure calculation. */
export async function getPositionValueCurve({
  client,
  queryAddress,
  positions,
}: {
  client: PublicClient
  queryAddress: Address
  positions: readonly PositionValueInput[]
}): Promise<PositionValueCurve> {
  const ticks = positionValueTicks(positions)
  const [values0, values1] = await client.readContract({
    address: queryAddress,
    abi,
    functionName: 'computeNetLiquidationValue',
    // PositionBalance's low 128 bits contain size; this pure function ignores its other fields.
    args: [
      positions.map((p) => p.tokenId),
      0n,
      0n,
      positions.map((p) => p.positionSize),
      ticks.map(Number),
    ],
  })
  return ticks.map((tick, i) => ({ tick, value0: values0[i], value1: values1[i] }))
}

/**
 * Between leg boundaries, token0 is affine in inverse sqrt price and token1 in sqrt price.
 * Endpoint interpolation differs from contract integer rounding by at most a few wei per leg.
 */
export function preparePositionValueCurve(curve: PositionValueCurve) {
  if (curve.length < 2) throw new RangeError('Incomplete position value curve')
  for (let i = 0; i < curve.length; i++) {
    if (
      curve[i].tick < -887272n ||
      curve[i].tick > 887272n ||
      (i > 0 && curve[i].tick <= curve[i - 1].tick)
    )
      throw new RangeError('Invalid position value curve ticks')
  }
  const points = curve.map((point) => ({
    ...point,
    sqrt: tickToSqrtPriceX96(point.tick),
  }))
  return (tick: bigint) => {
    if (tick < points[0].tick || tick > points[points.length - 1].tick)
      throw new RangeError('Tick outside position value curve')
    let lo = 0
    let hi = points.length - 1
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if (points[mid].tick <= tick) lo = mid
      else hi = mid
    }
    const left = points[lo]
    const right = points[hi]
    const sqrt = tickToSqrtPriceX96(tick)
    const numerator = sqrt - left.sqrt
    const denominator = right.sqrt - left.sqrt
    return {
      value0:
        left.value0 +
        ((right.value0 - left.value0) * numerator * right.sqrt) / (denominator * sqrt),
      value1: left.value1 + ((right.value1 - left.value1) * numerator) / denominator,
    }
  }
}
