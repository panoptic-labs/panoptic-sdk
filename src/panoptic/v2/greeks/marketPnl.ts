import Decimal from 'decimal.js'

/** Values and prices use raw token units, matching the net-liquidation-value read. */
export function netLiquidationValueInQuote(
  value0: bigint,
  value1: bigint,
  tick: bigint,
  isAssetToken0: boolean,
): Decimal {
  const price = new Decimal('1.0001').pow(tick.toString())
  return isAssetToken0
    ? new Decimal(value1.toString()).plus(new Decimal(value0.toString()).mul(price))
    : new Decimal(value0.toString()).plus(new Decimal(value1.toString()).div(price))
}

/** Apply the accrued-premium offset and optional asset collateral to a relative NLV curve. */
export function marketPnlInQuote({
  relativeValue,
  premium,
  assetBalance = 0n,
  price,
  baselinePrice,
}: {
  relativeValue: Decimal.Value
  premium: Decimal.Value
  assetBalance?: bigint
  price: Decimal.Value
  baselinePrice: Decimal.Value
}): Decimal {
  return new Decimal(relativeValue)
    .plus(premium)
    .plus(new Decimal(assetBalance.toString()).mul(new Decimal(price).minus(baselinePrice)))
}

/** Map a common reference-asset shock into a pool tick and quote-token USD multiplier. */
export function marketScenario({
  currentTick,
  isAssetToken0,
  assetBeta,
  quoteBeta,
  shock,
}: {
  currentTick: bigint
  isAssetToken0: boolean
  assetBeta: Decimal.Value
  quoteBeta: Decimal.Value
  shock: Decimal.Value
}): { tick: bigint; quoteFactor: Decimal } | null {
  const assetFactor = new Decimal(assetBeta).mul(shock).plus(1)
  const quoteFactor = new Decimal(quoteBeta).mul(shock).plus(1)
  if (
    !assetFactor.isFinite() ||
    !quoteFactor.isFinite() ||
    assetFactor.lte(0) ||
    quoteFactor.lte(0)
  ) {
    return null
  }
  const shift = assetFactor.div(quoteFactor).ln().div(new Decimal('1.0001').ln())
  const tick =
    currentTick +
    BigInt(
      shift
        .mul(isAssetToken0 ? 1 : -1)
        .round()
        .toFixed(0),
    )
  return tick < -887272n || tick > 887272n ? null : { tick, quoteFactor }
}

/** Finite-difference risk in raw asset/quote units from three ordered quote prices. */
export function marketRiskFromValues({
  lower,
  current,
  upper,
}: {
  lower: { price: Decimal.Value; value: Decimal.Value }
  current: { price: Decimal.Value; value: Decimal.Value }
  upper: { price: Decimal.Value; value: Decimal.Value }
}) {
  const left = new Decimal(current.price).minus(lower.price)
  const right = new Decimal(upper.price).minus(current.price)
  if (left.lte(0) || right.lte(0)) return null
  const leftSlope = new Decimal(current.value).minus(lower.value).div(left)
  const rightSlope = new Decimal(upper.value).minus(current.value).div(right)
  const delta = leftSlope.mul(right).plus(rightSlope.mul(left)).div(left.plus(right))
  const gamma = rightSlope
    .minus(leftSlope)
    .mul(2)
    .div(left.plus(right))
    .mul(new Decimal(current.price).pow(2))
  return { asset: delta, quote: new Decimal(current.value).minus(delta.mul(current.price)), gamma }
}
