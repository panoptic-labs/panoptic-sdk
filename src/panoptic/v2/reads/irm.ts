/**
 * Interest rate model (IRM) reads for Panoptic v2.
 * @module v2/reads/irm
 */

import type { Address, PublicClient } from 'viem'

import { collateralTrackerV2Abi, riskEngineAbi } from '../../../generated'
import { PanopticValidationError } from '../errors/sdk'
import type { IrmCurrent, IrmMarketStateInputs, IrmPoint } from '../types/irm'
export type { IrmCurrent, IrmMarketStateInputs, IrmPoint } from '../types/irm'

export const WAD = 10n ** 18n
export const BPS_SCALE = 10_000n
export const SECONDS_PER_YEAR = 31_536_000n
export const MARKET_EPOCH_SHIFT = 2n
export const BORROW_INDEX_BITS = 80n
export const MARKET_EPOCH_BITS = 32n
export const RATE_AT_TARGET_BITS = 38n
export const UNREALIZED_INTEREST_BITS = 106n

const BORROW_INDEX_SHIFT = 0n
const MARKET_EPOCH_FIELD_SHIFT = BORROW_INDEX_BITS
const RATE_AT_TARGET_FIELD_SHIFT = BORROW_INDEX_BITS + MARKET_EPOCH_BITS
const UNREALIZED_INTEREST_FIELD_SHIFT = RATE_AT_TARGET_FIELD_SHIFT + RATE_AT_TARGET_BITS
const MAX_IRM_CURVE_POINTS = 500

const clampUtilizationBps = (utilizationBps: bigint): bigint => {
  if (utilizationBps < 0n) {
    return 0n
  }
  if (utilizationBps > BPS_SCALE) {
    return BPS_SCALE
  }
  return utilizationBps
}

const getMaxValue = (bits: bigint): bigint => (1n << bits) - 1n

const assertFitsBits = (value: bigint, bits: bigint, fieldName: string): void => {
  if (value < 0n) {
    throw new PanopticValidationError(`${fieldName} must be >= 0`)
  }
  if (value > getMaxValue(bits)) {
    throw new PanopticValidationError(`${fieldName} exceeds ${bits.toString()} bits`)
  }
}

export function packMarketState(inputs: IrmMarketStateInputs): bigint {
  const { borrowIndex, lastInteractionTimestamp, rateAtTarget, unrealizedGlobalInterest } = inputs
  const marketEpoch = lastInteractionTimestamp >> MARKET_EPOCH_SHIFT

  assertFitsBits(borrowIndex, BORROW_INDEX_BITS, 'borrowIndex')
  assertFitsBits(marketEpoch, MARKET_EPOCH_BITS, 'marketEpoch')
  assertFitsBits(rateAtTarget, RATE_AT_TARGET_BITS, 'rateAtTarget')
  assertFitsBits(unrealizedGlobalInterest, UNREALIZED_INTEREST_BITS, 'unrealizedGlobalInterest')

  return (
    (borrowIndex << BORROW_INDEX_SHIFT) +
    (marketEpoch << MARKET_EPOCH_FIELD_SHIFT) +
    (rateAtTarget << RATE_AT_TARGET_FIELD_SHIFT) +
    (unrealizedGlobalInterest << UNREALIZED_INTEREST_FIELD_SHIFT)
  )
}

export function utilizationPctToWad(utilizationPct: number): bigint {
  if (!Number.isFinite(utilizationPct)) {
    throw new PanopticValidationError('utilizationPct must be finite')
  }
  if (utilizationPct < 0 || utilizationPct > 100) {
    throw new PanopticValidationError('utilizationPct must be between 0 and 100')
  }

  const scaledPct = Math.round(utilizationPct * 1_000_000)
  return (BigInt(scaledPct) * WAD) / 100_000_000n
}

export function utilizationBpsToWad(utilizationBps: bigint): bigint {
  return (clampUtilizationBps(utilizationBps) * WAD) / BPS_SCALE
}

export function ratePerSecWadToAprPct(ratePerSecWad: bigint): number {
  return (Number(ratePerSecWad) * Number(SECONDS_PER_YEAR) * 100) / Number(WAD)
}

export function deriveSupplyRatePerSecWad(
  borrowRatePerSecWad: bigint,
  utilizationWad: bigint,
): bigint {
  return (borrowRatePerSecWad * utilizationWad) / WAD
}

export async function getIrmCurrent(params: {
  client: PublicClient
  collateralTrackerAddress: Address
  blockNumber?: bigint
}): Promise<IrmCurrent> {
  const { client, collateralTrackerAddress, blockNumber } = params
  const [
    borrowIndex,
    lastInteractionTimestamp,
    rateAtTarget,
    unrealizedGlobalInterest,
    poolData,
    riskEngineAddress,
  ] = await client.multicall({
    contracts: [
      {
        address: collateralTrackerAddress,
        abi: collateralTrackerV2Abi,
        functionName: 'borrowIndex',
      },
      {
        address: collateralTrackerAddress,
        abi: collateralTrackerV2Abi,
        functionName: 'lastInteractionTimestamp',
      },
      {
        address: collateralTrackerAddress,
        abi: collateralTrackerV2Abi,
        functionName: 'rateAtTarget',
      },
      {
        address: collateralTrackerAddress,
        abi: collateralTrackerV2Abi,
        functionName: 'unrealizedGlobalInterest',
      },
      {
        address: collateralTrackerAddress,
        abi: collateralTrackerV2Abi,
        functionName: 'getPoolData',
      },
      {
        address: collateralTrackerAddress,
        abi: collateralTrackerV2Abi,
        functionName: 'riskEngine',
      },
    ],
    blockNumber,
    allowFailure: false,
  })

  const currentUtilizationBps = clampUtilizationBps(poolData[3])
  const currentUtilizationWad = utilizationBpsToWad(currentUtilizationBps)
  const currentUtilizationPct = Number(currentUtilizationBps) / 100

  const marketStatePacked = packMarketState({
    borrowIndex,
    lastInteractionTimestamp,
    rateAtTarget,
    unrealizedGlobalInterest,
  })

  const borrowRatePerSecWad = await client.readContract({
    address: riskEngineAddress,
    abi: riskEngineAbi,
    functionName: 'interestRate',
    args: [currentUtilizationWad, marketStatePacked],
    blockNumber,
  })

  const supplyRatePerSecWad = deriveSupplyRatePerSecWad(borrowRatePerSecWad, currentUtilizationWad)

  return {
    collateralTrackerAddress,
    riskEngineAddress,
    currentUtilizationBps,
    currentUtilizationWad,
    currentUtilizationPct,
    borrowRatePerSecWad,
    supplyRatePerSecWad,
    borrowAprPct: ratePerSecWadToAprPct(borrowRatePerSecWad),
    supplyAprPct: ratePerSecWadToAprPct(supplyRatePerSecWad),
    marketStatePacked,
  }
}

export async function getIrmCurve(params: {
  client: PublicClient
  collateralTrackerAddress: Address
  points?: number
  blockNumber?: bigint
}): Promise<{
  current: IrmCurrent
  points: IrmPoint[]
}> {
  const { client, collateralTrackerAddress, points = 201, blockNumber } = params

  if (!Number.isInteger(points) || points < 2) {
    throw new PanopticValidationError('points must be an integer >= 2')
  }
  if (points > MAX_IRM_CURVE_POINTS) {
    throw new PanopticValidationError(`points must be <= ${MAX_IRM_CURVE_POINTS}`)
  }

  const current = await getIrmCurrent({
    client,
    collateralTrackerAddress,
    blockNumber,
  })

  const denominator = BigInt(points - 1)
  const contracts = Array.from({ length: points }, (_, idx) => {
    const i = BigInt(idx)
    const utilizationWad = (i * WAD) / denominator

    return {
      address: current.riskEngineAddress,
      abi: riskEngineAbi,
      functionName: 'interestRate' as const,
      args: [utilizationWad, current.marketStatePacked] as const,
    }
  })

  const borrowRatesPerSecWad = await client.multicall({
    contracts,
    blockNumber,
    allowFailure: false,
  })

  const curvePoints: IrmPoint[] = borrowRatesPerSecWad.map((borrowRatePerSecWad, idx) => {
    const i = BigInt(idx)
    const utilizationWad = (i * WAD) / denominator
    const supplyRatePerSecWad = deriveSupplyRatePerSecWad(borrowRatePerSecWad, utilizationWad)

    return {
      utilizationWad,
      utilizationPct: (idx * 100) / (points - 1),
      borrowRatePerSecWad,
      supplyRatePerSecWad,
      borrowAprPct: ratePerSecWadToAprPct(borrowRatePerSecWad),
      supplyAprPct: ratePerSecWadToAprPct(supplyRatePerSecWad),
    }
  })

  return {
    current,
    points: curvePoints,
  }
}
