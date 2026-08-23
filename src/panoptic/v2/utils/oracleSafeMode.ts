import { PanopticValidationError } from '../errors'
import type { OracleState } from '../types'
import { ORACLE_EPOCH_SECONDS } from './constants'

const UINT24_MASK = (1n << 24n) - 1n

export interface OracleEmaPeriods {
  spot: bigint
  fast: bigint
  slow: bigint
  eons: bigint
}

export interface OracleRiskParameters {
  emaPeriods: OracleEmaPeriods
  maxTicksDelta: bigint
  /** Informational observation clamp; not used by SafeMode diagnosis. May be zero. */
  maxClampDelta: bigint
}

export type OracleSafeModeCause =
  | 'externalShock'
  | 'internalDisagreement'
  | 'highDivergence'
  | 'guardianLock'
  | 'unknown'

export interface OracleSafeModeDiagnosis {
  /** Authoritative value returned by PanopticPool.isSafeMode(). */
  level: bigint
  /** Value reproduced using the known RiskEngine formula and live constants. */
  reproducedLevel: bigint
  matchesOnchain: boolean
  causes: readonly OracleSafeModeCause[]
  externalShockDelta: bigint
  internalDisagreementDelta: bigint
  highDivergenceDelta: bigint
  guardianLocked: boolean
  /** Minimum whole 64-second oracle epochs to wait after the last observation. */
  minimumPokeEpochs: bigint
  shouldPoke: boolean
}

type DiagnosticOracleState = Pick<
  OracleState,
  'currentTick' | 'spotEMA' | 'fastEMA' | 'slowEMA' | 'medianTick' | 'lockMode'
>

function absoluteDelta(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left
}

function epochsForPeriod(period: bigint): bigint {
  return (period + ORACLE_EPOCH_SECONDS - 1n) / ORACLE_EPOCH_SECONDS
}

/** Decode the four uint24 periods packed by RiskEngine.EMA_PERIODS(). */
export function decodeOracleRiskParameters(
  emaPeriods: bigint,
  maxTicksDelta: bigint,
  maxClampDelta: bigint,
): OracleRiskParameters {
  const decodedPeriods = {
    spot: emaPeriods & UINT24_MASK,
    fast: (emaPeriods >> 24n) & UINT24_MASK,
    slow: (emaPeriods >> 48n) & UINT24_MASK,
    eons: (emaPeriods >> 72n) & UINT24_MASK,
  }
  if (
    decodedPeriods.spot === 0n ||
    decodedPeriods.fast === 0n ||
    decodedPeriods.slow === 0n ||
    decodedPeriods.eons === 0n ||
    maxTicksDelta <= 0n ||
    maxClampDelta < 0n
  ) {
    throw new PanopticValidationError(
      `RiskEngine returned invalid oracle parameters: EMA_PERIODS=${emaPeriods}, ` +
        `MAX_TICKS_DELTA=${maxTicksDelta}, MAX_CLAMP_DELTA=${maxClampDelta}`,
    )
  }
  return { emaPeriods: decodedPeriods, maxTicksDelta, maxClampDelta }
}

/** Explain the on-chain SafeMode level using this deployment's RiskEngine constants. */
export function diagnoseOracleSafeMode(
  state: DiagnosticOracleState,
  parameters: OracleRiskParameters,
  onchainLevel: bigint,
): OracleSafeModeDiagnosis {
  const externalShockDelta = absoluteDelta(state.currentTick, state.spotEMA)
  const internalDisagreementDelta = absoluteDelta(state.spotEMA, state.fastEMA)
  const highDivergenceDelta = absoluteDelta(state.medianTick, state.slowEMA)
  const internalThreshold = parameters.maxTicksDelta / 2n
  const externalShock = externalShockDelta > parameters.maxTicksDelta
  const internalDisagreement = internalDisagreementDelta > internalThreshold
  const highDivergence = highDivergenceDelta > internalThreshold
  const guardianLocked = state.lockMode !== 0n

  const algorithmicLevel =
    (externalShock ? 1n : 0n) + (internalDisagreement ? 1n : 0n) + (highDivergence ? 1n : 0n)
  const reproducedLevel = algorithmicLevel + state.lockMode
  const matchesOnchain = reproducedLevel === onchainLevel
  const causes: OracleSafeModeCause[] = []
  if (matchesOnchain) {
    if (externalShock) causes.push('externalShock')
    if (internalDisagreement) causes.push('internalDisagreement')
    if (highDivergence) causes.push('highDivergence')
  } else {
    causes.push('unknown')
  }
  if (guardianLocked) causes.push('guardianLock')

  const candidateEpochs: bigint[] = []
  if (!matchesOnchain) candidateEpochs.push(1n)
  if (highDivergence) candidateEpochs.push(1n)
  if (externalShock) candidateEpochs.push(epochsForPeriod(parameters.emaPeriods.spot))
  if (internalDisagreement) candidateEpochs.push(epochsForPeriod(parameters.emaPeriods.fast))
  const minimumPokeEpochs = candidateEpochs.reduce(
    (minimum, epochs) => (minimum === 0n || epochs < minimum ? epochs : minimum),
    0n,
  )

  return {
    level: onchainLevel,
    reproducedLevel,
    matchesOnchain,
    causes,
    externalShockDelta,
    internalDisagreementDelta,
    highDivergenceDelta,
    guardianLocked,
    minimumPokeEpochs,
    shouldPoke: onchainLevel > 0n && !guardianLocked,
  }
}
