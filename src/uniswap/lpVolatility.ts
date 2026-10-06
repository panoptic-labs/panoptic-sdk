import Decimal from 'decimal.js'

import {
  type PositionVolatilityObservation,
  calculatePositionVolatilityMetrics,
  valuePositionAccrual,
} from '../panoptic/v2/greeks/positionVolatility'
import type { UniswapFeeSnapshot } from '../panoptic/v2/reads/uniswapFeeHistory'
import { getLpGreeks } from './lpGreeks'

const Precision = Decimal.clone({ precision: 80 })
const Q192 = (1n << 192n).toString()

/** Historical convexity and fee coverage at constant LP liquidity, in human quote units. */
export function calculateLpPositionVolatility({
  liquidity,
  tickLower,
  tickUpper,
  quoteIsToken0,
  quoteDecimals,
  snapshots,
  observations: priceObservations,
}: {
  liquidity: bigint
  tickLower: bigint
  tickUpper: bigint
  quoteIsToken0: boolean
  quoteDecimals: number
  snapshots: readonly UniswapFeeSnapshot[]
  observations?: readonly PositionVolatilityObservation[]
}) {
  if (liquidity <= 0n || liquidity >= 1n << 128n) throw new RangeError('Invalid LP liquidity')
  if (tickLower < -887272n || tickUpper > 887272n || tickLower >= tickUpper)
    throw new RangeError('Invalid LP range')
  if (
    snapshots.some(
      (point, index) => index > 0 && point.blockTimestamp <= snapshots[index - 1].blockTimestamp,
    )
  ) {
    throw new RangeError('Fee snapshots must have increasing timestamps')
  }
  const scale = new Decimal(10).pow(quoteDecimals)
  if (
    priceObservations &&
    (priceObservations.length < 2 ||
      priceObservations[0].timestamp !== snapshots[0]?.blockTimestamp ||
      priceObservations.at(-1)?.timestamp !== snapshots.at(-1)?.blockTimestamp)
  )
    throw new RangeError('Price and fee history must cover the same window')
  const observations =
    priceObservations ??
    snapshots.map((snapshot) => ({
      timestamp: snapshot.blockTimestamp,
      price: quoteIsToken0
        ? new Precision(Q192).div(new Precision(snapshot.sqrtPriceX96.toString()).pow(2))
        : new Precision(snapshot.sqrtPriceX96.toString()).pow(2).div(Q192),
      gamma: new Decimal(
        getLpGreeks({
          liquidity,
          tickLower,
          tickUpper,
          currentTick: BigInt(snapshot.currentTick),
          sqrtPriceX96: snapshot.sqrtPriceX96,
          assetIndex: quoteIsToken0 ? 1 : 0,
        }).gamma.toString(),
      ).div(scale),
    }))
  const netPremium = valuePositionAccrual({
    snapshots: snapshots.map((snapshot, index) => ({
      token0: snapshot.fees.token0,
      token1: snapshot.fees.token1,
      tick: BigInt(snapshots[Math.max(0, index - 1)].currentTick),
      sqrtPriceX96: snapshots[Math.max(0, index - 1)].sqrtPriceX96,
    })),
    quoteIsToken0,
    quoteDecimals,
  })
  return calculatePositionVolatilityMetrics({
    observations,
    quoteDecimals,
    netPremium,
  })
}
