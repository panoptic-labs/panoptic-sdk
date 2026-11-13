import Decimal from 'decimal.js'

/** Fee-only performance against opening notional; borrowing costs and price PnL are excluded. */
export function getCoveredCallPerformance({
  earnedPremium,
  openingNotionalQuote,
  advancePrincipal,
  mintTimestamp,
  nowTimestamp,
  timescaleSeconds,
}: {
  earnedPremium: bigint
  openingNotionalQuote: bigint
  advancePrincipal?: bigint
  mintTimestamp?: bigint
  nowTimestamp: bigint
  timescaleSeconds?: bigint
}) {
  const elapsedSeconds =
    mintTimestamp === undefined || nowTimestamp < mintTimestamp
      ? undefined
      : nowTimestamp - mintTimestamp
  const endTimestamp =
    mintTimestamp === undefined || timescaleSeconds === undefined
      ? undefined
      : mintTimestamp + timescaleSeconds
  const remainingSeconds =
    endTimestamp === undefined
      ? undefined
      : endTimestamp > nowTimestamp
        ? endTimestamp - nowTimestamp
        : 0n
  const earnedApr =
    elapsedSeconds === undefined || elapsedSeconds === 0n || openingNotionalQuote <= 0n
      ? undefined
      : new Decimal(earnedPremium.toString())
          .div(openingNotionalQuote.toString())
          .mul(365 * 86400 * 100)
          .div(elapsedSeconds.toString())
          .toFixed(1)
  const advanceProgressBps =
    advancePrincipal === undefined || advancePrincipal <= 0n
      ? undefined
      : (earnedPremium * 10000n) / advancePrincipal
  return { elapsedSeconds, endTimestamp, remainingSeconds, earnedApr, advanceProgressBps }
}
