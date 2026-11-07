import Decimal from 'decimal.js'

import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import type { PositionValueCurve } from '../panoptic/v2/reads/positionValueCurve'
import { VOLUSDC_HEDGE_FEE_POLICY } from './adaptiveHedgeFees'

const D = Decimal.clone({ precision: 110 })
const Q192 = new D(2).pow(192)
const decimal = (value: bigint) => new D(value.toString())

export type FrozenHedgeBook = {
  curve: PositionValueCurve
  balances: readonly [bigint, bigint]
  numeraireIndex: 0n | 1n
  sqrtPriceX96: bigint
}

function priceAt(sqrtPriceX96: bigint, numeraireIndex: 0n | 1n) {
  if (sqrtPriceX96 <= 0n) throw new RangeError('Hedge valuation requires a positive price')
  const squared = decimal(sqrtPriceX96).pow(2)
  return numeraireIndex === 0n ? Q192.div(squared) : squared.div(Q192)
}

function prepareBook(book: FrozenHedgeBook) {
  const quoteIndex = Number(book.numeraireIndex)
  const assetIndex = 1 - quoteIndex
  const points = book.curve
    .filter(({ tick }) => tick > -887272n && tick < 887272n)
    .map(({ tick, value0, value1 }) => {
      const values = [value0 + book.balances[0], value1 + book.balances[1]]
      return {
        price: priceAt(tickToSqrtPriceX96(tick), book.numeraireIndex),
        quote: decimal(values[quoteIndex]),
        asset: decimal(values[assetIndex]),
      }
    })
    .sort((a, b) => a.price.cmp(b.price))
  if (points.length < 2) throw new RangeError('Incomplete option value curve')
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) throw new RangeError('Missing curve endpoints')
  const segments = points.slice(1).map((right, index) => {
    const left = points[index]
    if (left === undefined || !left.price.lt(right.price))
      throw new RangeError('Invalid option value curve')
    const lo = left.price.sqrt()
    const hi = right.price.sqrt()
    const quoteSlope = right.quote.minus(left.quote).div(hi.minus(lo))
    const assetSlope = right.asset.minus(left.asset).div(new D(1).div(hi).minus(new D(1).div(lo)))
    return {
      lo,
      hi,
      a: left.quote.minus(quoteSlope.mul(lo)),
      b: quoteSlope.plus(assetSlope),
      c: left.asset.minus(assetSlope.div(lo)),
    }
  })
  const valueAt = (sqrtPriceX96: bigint) => {
    const price = priceAt(sqrtPriceX96, book.numeraireIndex)
    const x = price.sqrt()
    const segment = segments.find((candidate) => x.gte(candidate.lo) && x.lte(candidate.hi))
    if (segment !== undefined) return segment.a.plus(segment.b.mul(x)).plus(segment.c.mul(price))
    const endpoint = price.lt(first.price) ? first : last
    return endpoint.quote.plus(endpoint.asset.mul(price))
  }
  const minimum = () => {
    if (last.asset.lt(0)) return undefined
    let value = first.quote
    for (const point of points) value = D.min(value, point.quote.plus(point.asset.mul(point.price)))
    for (const segment of segments) {
      if (segment.c.lte(0)) continue
      const x = segment.b.neg().div(segment.c.mul(2))
      if (x.gt(segment.lo) && x.lt(segment.hi))
        value = D.min(value, segment.a.plus(segment.b.mul(x)).plus(segment.c.mul(x.pow(2))))
    }
    return value
  }
  return { valueAt, minimum }
}

export function valueFrozenHedgeBook(book: FrozenHedgeBook, sqrtPriceX96 = book.sqrtPriceX96) {
  return BigInt(prepareBook(book).valueAt(sqrtPriceX96).floor().toFixed(0))
}

/** Current price protection; future interest, liquidation and execution are not guaranteed. */
export function estimateProtectedHedgeGain({
  before,
  after,
  anchor,
  roundingReserve,
}: {
  before: FrozenHedgeBook
  after: FrozenHedgeBook
  anchor?: { sqrtPriceX96: bigint; actualValue: bigint }
  roundingReserve: bigint
}) {
  if (roundingReserve < 0n) throw new RangeError('Negative hedge rounding reserve')
  if (before.numeraireIndex !== after.numeraireIndex)
    throw new RangeError('Hedge books must use the same numeraire')
  if (anchor === undefined)
    return { valid: false as const, protectedGain: 0n, reason: 'Missing confirmed gain anchor' }
  const current = prepareBook(before)
  const proposed = prepareBook(after)
  const beforeFloor = current.minimum()
  const afterFloor = proposed.minimum()
  if (beforeFloor === undefined || afterFloor === undefined)
    return { valid: false as const, protectedGain: 0n, reason: 'Unbounded hedge price tail' }
  if (
    proposed
      .valueAt(before.sqrtPriceX96)
      .gt(current.valueAt(before.sqrtPriceX96).plus(decimal(roundingReserve)))
  )
    return {
      valid: false as const,
      protectedGain: 0n,
      reason: 'Unfunded post-hedge value increase',
    }
  const anchorMark = current.valueAt(anchor.sqrtPriceX96)
  const basis = D.max(beforeFloor, anchorMark, decimal(anchor.actualValue))
  const gain = D.max(0, afterFloor.minus(basis).minus(decimal(roundingReserve)))
  return {
    valid: true as const,
    protectedGain: BigInt(gain.floor().toFixed(0)),
    floorAfter: BigInt(afterFloor.floor().toFixed(0)),
    basis: BigInt(basis.ceil().toFixed(0)),
    negativeCarry: BigInt(
      D.max(0, decimal(anchor.actualValue).minus(anchorMark)).ceil().toFixed(0),
    ),
  }
}

/** Round the two-thirds allowance down and convert at the most expensive allowed gas-asset price. */
export function getProtectedHedgeGasBudget({
  protectedGain,
  gasAlreadyPaid,
  numeraireIndex,
  gasAssetIndex,
  sqrtPriceLowerX96,
  sqrtPriceUpperX96,
}: {
  protectedGain: bigint
  gasAlreadyPaid: bigint
  numeraireIndex: 0n | 1n
  gasAssetIndex: 0n | 1n
  sqrtPriceLowerX96: bigint
  sqrtPriceUpperX96: bigint
}) {
  if (
    protectedGain < 0n ||
    gasAlreadyPaid < 0n ||
    sqrtPriceLowerX96 <= 0n ||
    sqrtPriceUpperX96 < sqrtPriceLowerX96
  )
    throw new RangeError('Invalid protected hedge gas budget')
  const allowance = (protectedGain * 2n) / 3n
  const remaining = allowance > gasAlreadyPaid ? allowance - gasAlreadyPaid : 0n
  const budget =
    numeraireIndex === gasAssetIndex
      ? remaining
      : numeraireIndex === 0n
        ? (remaining * sqrtPriceLowerX96 ** 2n) / (1n << 192n)
        : (remaining * (1n << 192n)) / sqrtPriceUpperX96 ** 2n
  const maximum = VOLUSDC_HEDGE_FEE_POLICY.maxTransactionGasCost
  return {
    allowance,
    remaining,
    maxTransactionGasCost: budget < maximum ? budget : maximum,
  }
}
