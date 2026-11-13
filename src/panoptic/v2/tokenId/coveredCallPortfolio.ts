import { isEarnCoveredCallTokenId, isUpfrontCoveredCallTokenId } from './coveredCall'
import { decodeTokenId } from './decode'

/** Earn call shapes whose short call is backed by the account's deposited asset. */
const isEarnBackedCall = (tokenId: bigint) =>
  isEarnCoveredCallTokenId(tokenId) || isUpfrontCoveredCallTokenId(tokenId)

/** Deposited backing and additional funding for Earn's covered call positions. */
export function getEarnCollateralFunding({
  positions,
  collateral0,
  collateral1,
  assetIdx,
  walletBalance,
  requestedAmount,
  expectedLegCount,
}: {
  positions: readonly { tokenId: bigint; positionSize: bigint }[]
  collateral0: bigint
  collateral1: bigint
  assetIdx: 0n | 1n
  walletBalance: bigint
  requestedAmount: bigint
  expectedLegCount?: bigint
}) {
  if (walletBalance < 0n || requestedAmount < 0n) throw new RangeError('Invalid funding amount')
  let legCount = 0n
  let coveredNotional = 0n
  for (const position of positions) {
    if (position.positionSize <= 0n) continue
    const { legs } = decodeTokenId(position.tokenId)
    legCount += BigInt(legs.length)
    if (!isEarnBackedCall(position.tokenId)) continue
    const call = legs.find((leg) => leg.width > 0n && leg.asset === assetIdx)
    if (call) coveredNotional += position.positionSize * call.optionRatio
  }
  if (expectedLegCount !== undefined && legCount !== expectedLegCount)
    throw new Error('Incomplete position list. Refresh collateral before continuing.')
  const balance = assetIdx === 0n ? collateral0 : collateral1
  const deposited = balance > 0n ? balance : 0n
  const covered = deposited < coveredNotional ? deposited : coveredNotional
  const uncovered = deposited - covered
  const coverageDeficit = coveredNotional - covered
  const available = walletBalance + uncovered - coverageDeficit
  const required = requestedAmount + coverageDeficit - uncovered
  // Share conversion can leave one raw unit of dust; cap this allowance at one ppm of the call.
  const roundingDust = deposited > 0n && required === 1n && requestedAmount >= 1_000_000n
  return {
    deposited,
    covered,
    coveredNotional,
    uncovered,
    coverageDeficit,
    walletBalance,
    maximumAmount: available > 0n ? available : 0n,
    depositRequired: required > 0n && !roundingDust ? required : 0n,
  }
}

/** Matches pooled asset collateral to short calls without allocating a token twice. */
export function allocateCoveredCallCollateral({
  positions,
  collateral0,
  collateral1,
}: {
  positions: readonly { tokenId: bigint; positionSize: bigint }[]
  collateral0: bigint
  collateral1: bigint
}) {
  const calls = positions.flatMap(({ tokenId, positionSize }) => {
    if (positionSize <= 0n) return []
    const { legs } = decodeTokenId(tokenId)
    const leg = legs.find((leg) => leg.width > 0n)
    if (
      (legs.length !== 1 && !isEarnBackedCall(tokenId)) ||
      !leg ||
      leg.isLong ||
      leg.width === 0n ||
      leg.tokenType !== leg.asset
    )
      return []
    return [
      {
        tokenId,
        assetIdx: leg.asset === 0n ? (0n as const) : (1n as const),
        positionSize: positionSize * leg.optionRatio,
        strike: leg.strike,
        width: leg.width,
      },
    ]
  })
  const total0 = calls
    .filter((call) => call.assetIdx === 0n)
    .reduce((sum, call) => sum + call.positionSize, 0n)
  const total1 = calls
    .filter((call) => call.assetIdx === 1n)
    .reduce((sum, call) => sum + call.positionSize, 0n)
  return calls.map((call) => {
    const total = call.assetIdx === 0n ? total0 : total1
    const balance = call.assetIdx === 0n ? collateral0 : collateral1
    const available = balance < 0n ? 0n : balance > total ? total : balance
    const allocatedAsset = (available * call.positionSize) / total
    return {
      ...call,
      allocatedAsset,
      uncoveredAsset: call.positionSize - allocatedAsset,
      additionalAssetRequired: total - available,
    }
  })
}
