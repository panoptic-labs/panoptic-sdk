/**
 * Interest rate model (IRM) types for Panoptic v2.
 * @module v2/types/irm
 */

import type { Address } from 'viem'

export type IrmPoint = {
  utilizationWad: bigint
  utilizationPct: number
  borrowRatePerSecWad: bigint
  supplyRatePerSecWad: bigint
  borrowAprPct: number
  supplyAprPct: number
}

export type IrmCurrent = {
  collateralTrackerAddress: Address
  riskEngineAddress: Address
  currentUtilizationBps: bigint
  currentUtilizationWad: bigint
  currentUtilizationPct: number
  borrowRatePerSecWad: bigint
  supplyRatePerSecWad: bigint
  borrowAprPct: number
  supplyAprPct: number
  marketStatePacked: bigint
}

export type IrmMarketStateInputs = {
  borrowIndex: bigint
  lastInteractionTimestamp: bigint
  rateAtTarget: bigint
  unrealizedGlobalInterest: bigint
}
