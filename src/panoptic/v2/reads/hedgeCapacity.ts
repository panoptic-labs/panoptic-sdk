import { tickToSqrtPriceX96 } from '../formatters/tick'
import { calculatePositionDeltaDebtOnly, toVaultFrameAtTick } from '../greeks'
import { decodeTokenId } from '../tokenId'
import { addLegToTokenId } from '../tokenId/encoding'
import { decodePositionBalance } from '../writes/utils'
import { applyMintBufferPerToken } from './mintBuffer'

const SCALE = 10_000_000n
const FEE_SCALE = 10_000n
const Q192 = 1n << 192n
const MASK128 = (1n << 128n) - 1n
export const ceilDiv = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor

export function accountHedgeDelta({
  positionIds,
  balances,
  collateralDelta,
  tick,
  tickSpacing,
  assetIndex,
}: {
  positionIds: readonly bigint[]
  balances: readonly bigint[]
  collateralDelta: bigint
  tick: bigint
  tickSpacing: bigint
  assetIndex: 0n | 1n
}) {
  return positionIds.reduce((sum, id, index) => {
    const balance = balances[index]
    if (balance === undefined) throw new Error('Missing position balance')
    const { positionSize, tickAtMint } = decodePositionBalance(balance)
    return (
      sum +
      calculatePositionDeltaDebtOnly({
        legs: decodeTokenId(id).legs,
        positionSize,
        mintTick: tickAtMint,
        currentTick: tick,
        poolTickSpacing: tickSpacing,
        assetIndex,
      })
    )
  }, collateralDelta)
}

/** A separate loan leaves existing option legs and their risk partners unchanged. */
export function buildCapacityHedge({
  delta,
  assetIndex,
  tick,
  tickSpacing,
  poolId,
  notionalFee,
  swapFee,
}: {
  delta: bigint
  assetIndex: 0n | 1n
  tick: bigint
  tickSpacing: bigint
  poolId: bigint
  notionalFee: bigint
  swapFee: bigint
}) {
  const borrowToken = delta >= 0n ? assetIndex : assetIndex === 0n ? 1n : 0n
  const receiveToken = borrowToken === 0n ? 1n : 0n
  const amount =
    delta >= 0n
      ? delta
      : ceilDiv(
          (toVaultFrameAtTick(-delta, assetIndex, borrowToken, tick) + 1n) * 1_000_000n * FEE_SCALE,
          (1_000_000n - swapFee) * (FEE_SCALE - notionalFee),
        )
  const commission = ceilDiv(amount * notionalFee, FEE_SCALE)
  // Pay commission from the loan, then swap the remaining borrowed tokens.
  const proceeds = toVaultFrameAtTick(
    ((amount - commission) * (1_000_000n - swapFee)) / 1_000_000n,
    borrowToken,
    receiveToken,
    tick,
  )
  const tokenId = addLegToTokenId(poolId, {
    index: 0n,
    asset: borrowToken,
    tokenType: borrowToken,
    width: 0n,
    strike: (tick / tickSpacing) * tickSpacing,
    optionRatio: 1n,
    riskPartner: 0n,
    isLong: 0n,
  })
  return { tokenId, amount, borrowToken, receiveToken, commission, proceeds }
}

/** Both cross-collateral constraints, with conversion and mint-buffer rounding matching RiskEngine. */
export function hedgeMargin({
  tokenData,
  balanceChanges,
  crossRatios,
  tick,
  buffer,
}: {
  tokenData: readonly [bigint, bigint]
  balanceChanges: readonly [bigint, bigint]
  crossRatios: readonly [bigint, bigint]
  tick: bigint
  buffer: bigint
}) {
  const balances = tokenData.map((data, i) => (data & MASK128) + balanceChanges[i])
  const [required0, required1] = applyMintBufferPerToken(
    tokenData[0] >> 128n,
    tokenData[1] >> 128n,
    { numerator: buffer, denominator: SCALE },
  )
  const surplus0 =
    balances[0] > required0 ? ((balances[0] - required0) * crossRatios[0]) / SCALE : 0n
  const surplus1 =
    balances[1] > required1 ? ((balances[1] - required1) * crossRatios[1]) / SCALE : 0n
  const sqrt = tickToSqrtPriceX96(tick)
  const price = sqrt * sqrt
  const pairs =
    sqrt < 1n << 96n
      ? [
          [balances[0] + (surplus1 * Q192) / price, required0],
          [(balances[1] * Q192) / price + surplus0, ceilDiv(required1 * Q192, price)],
        ]
      : [
          [(balances[0] * price) / Q192 + surplus1, ceilDiv(required0 * price, Q192)],
          [balances[1] + (surplus0 * price) / Q192, required1],
        ]
  const headroom = pairs.map(([balance, required]) => balance - required)
  return {
    solvent: balances.every((balance) => balance >= 0n) && headroom.every((value) => value >= 0n),
    headroom: headroom[0] < headroom[1] ? headroom[0] : headroom[1],
    denomination: sqrt < 1n << 96n ? (0n as const) : (1n as const),
  }
}

export async function findHedgeBoundary<T extends { tick: number; affordable: boolean }>(
  current: T,
  samples: T[],
  direction: -1 | 1,
  evaluate: (tick: number) => Promise<T>,
): Promise<number | null> {
  if (!current.affordable) return current.tick
  const ordered = samples
    .filter((point) => direction * (point.tick - current.tick) > 0)
    .sort((a, b) => direction * (a.tick - b.tick))
  let affordableTick = current.tick
  for (const point of ordered) {
    if (point.affordable) {
      affordableTick = point.tick
      continue
    }
    let failedTick = point.tick
    while (Math.abs(failedTick - affordableTick) > 1) {
      const middle = Math.floor((failedTick + affordableTick) / 2)
      const result = await evaluate(middle)
      if (result.affordable) affordableTick = middle
      else failedTick = middle
    }
    return failedTick
  }
  return null
}
