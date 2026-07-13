import Decimal from 'decimal.js'

export function computeSharePriceFromNavSnapshot({
  nav,
  assetsDeposited,
  reservedWithdrawalAssets,
  shares,
}: {
  nav: bigint
  assetsDeposited: bigint
  reservedWithdrawalAssets: bigint
  shares: bigint
}): Decimal | null {
  if (shares <= 0n) {
    return null
  }

  // The `+ 1n` is an intentional rounding correction that mirrors the on-chain
  // share-price math (round-up favoring the vault), not an off-by-one.
  const adjustedAssets = nav + 1n - assetsDeposited - reservedWithdrawalAssets
  if (adjustedAssets <= 0n) {
    return null
  }

  return new Decimal(adjustedAssets.toString()).div(new Decimal(shares.toString()))
}

export function calculateAnnualizedApyPct({
  currentSharePrice,
  previousSharePrice,
  days,
}: {
  currentSharePrice: Decimal
  previousSharePrice: Decimal
  days: number
}): number | null {
  if (days <= 0 || !Number.isFinite(days)) {
    return null
  }

  if (currentSharePrice.lte(0) || previousSharePrice.lte(0)) {
    return null
  }

  const annualizationExponent = new Decimal(365).div(new Decimal(days))
  const growthFactor = currentSharePrice.div(previousSharePrice)
  return Decimal.pow(growthFactor, annualizationExponent).minus(1).times(100).toNumber()
}
