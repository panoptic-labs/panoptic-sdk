import Decimal from 'decimal.js'

const Precision = Decimal.clone({ precision: 60 })

export type VaultDonationAdjustment = {
  timestampSec: number
  blockNumber: string
  retainedFactor: string
  donatedAssetsRaw: string
}

/** Neutralizes each external contribution while retaining subsequent investment performance. */
export function adjustVaultSharePricesForDonations(
  history: readonly { timestampSec: number; sharePrice: string }[],
  adjustments: readonly VaultDonationAdjustment[],
) {
  const ordered = [...adjustments].sort((a, b) => a.timestampSec - b.timestampSec)
  let index = 0
  let retainedFactor = new Precision(1)
  return [...history]
    .sort((a, b) => a.timestampSec - b.timestampSec)
    .map((point) => {
      while (index < ordered.length) {
        const adjustment = ordered[index]
        if (adjustment === undefined || adjustment.timestampSec > point.timestampSec) break
        const factor = new Precision(adjustment.retainedFactor)
        if (!factor.isFinite() || factor.lte(0) || factor.gt(1)) {
          throw new Error('Invalid donation adjustment')
        }
        retainedFactor = retainedFactor.mul(factor)
        index++
      }
      return {
        ...point,
        sharePrice: new Precision(point.sharePrice).mul(retainedFactor).toString(),
      }
    })
}

export function donationRetainedFactor(donatedAssetsRaw: bigint, adjustedNavRaw: bigint) {
  if (donatedAssetsRaw < 0n || adjustedNavRaw <= donatedAssetsRaw) {
    throw new Error('Donation exceeds active vault NAV')
  }
  return new Precision(adjustedNavRaw.toString())
    .minus(donatedAssetsRaw.toString())
    .div(adjustedNavRaw.toString())
    .toString()
}

/** Raw token amounts already account for decimals; the tick is token1 per token0. */
export function valueDonationInUnderlying({
  assetsRaw,
  tokenIndex,
  underlyingIndex,
  tick,
}: {
  assetsRaw: bigint
  tokenIndex: 0 | 1
  underlyingIndex: 0 | 1
  tick: number
}) {
  if (assetsRaw < 0n || !Number.isInteger(tick) || Math.abs(tick) > 887272) {
    throw new Error('Invalid donation valuation')
  }
  if (tokenIndex === underlyingIndex) return assetsRaw
  const price = new Precision('1.0001').pow(tick)
  const amount = new Precision(assetsRaw.toString())
  return BigInt((tokenIndex === 0 ? amount.mul(price) : amount.div(price)).floor().toFixed(0))
}
