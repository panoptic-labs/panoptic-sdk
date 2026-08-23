import { describe, expect, it } from 'vitest'

import { PanopticValidationError } from '../errors'
import { decodeOracleRiskParameters, diagnoseOracleSafeMode } from './oracleSafeMode'

const base = {
  currentTick: 1_000n,
  spotEMA: 1_000n,
  fastEMA: 1_000n,
  slowEMA: 1_000n,
  medianTick: 1_000n,
  lockMode: 0n,
}

const packedPeriods = 60n | (120n << 24n) | (240n << 48n) | (960n << 72n)
const parameters = decodeOracleRiskParameters(packedPeriods, 724n, 149n)

describe('diagnoseOracleSafeMode', () => {
  it('matches the RiskEngine strict thresholds', () => {
    expect(diagnoseOracleSafeMode({ ...base, currentTick: 1_724n }, parameters, 0n)).toMatchObject({
      reproducedLevel: 0n,
      causes: [],
    })
    expect(diagnoseOracleSafeMode({ ...base, currentTick: 1_725n }, parameters, 1n)).toMatchObject({
      level: 1n,
      reproducedLevel: 1n,
      matchesOnchain: true,
      causes: ['externalShock'],
      minimumPokeEpochs: 1n,
      shouldPoke: true,
    })
  })

  it('uses the fast EMA cadence for isolated internal disagreement', () => {
    expect(diagnoseOracleSafeMode({ ...base, spotEMA: 1_363n }, parameters, 1n)).toMatchObject({
      level: 1n,
      causes: ['internalDisagreement'],
      minimumPokeEpochs: 2n,
      shouldPoke: true,
    })
  })

  it('prioritizes consecutive epochs when the median queue is trailing', () => {
    expect(diagnoseOracleSafeMode({ ...base, medianTick: 1_363n }, parameters, 1n)).toMatchObject({
      level: 1n,
      causes: ['highDivergence'],
      minimumPokeEpochs: 1n,
      shouldPoke: true,
    })
  })

  it('reports additive causes but does not poke through a guardian lock', () => {
    expect(
      diagnoseOracleSafeMode(
        { ...base, currentTick: 1_725n, medianTick: 1_363n, lockMode: 3n },
        parameters,
        5n,
      ),
    ).toMatchObject({
      level: 5n,
      causes: ['externalShock', 'highDivergence', 'guardianLock'],
      guardianLocked: true,
      shouldPoke: false,
    })
  })

  it('uses the deployed RiskEngine threshold and EMA periods', () => {
    const xStocks = decodeOracleRiskParameters(
      120n | (240n << 24n) | (600n << 48n) | (1_800n << 72n),
      953n,
      149n,
    )

    expect(diagnoseOracleSafeMode({ ...base, currentTick: 1_900n }, xStocks, 0n)).toMatchObject({
      level: 0n,
      matchesOnchain: true,
      causes: [],
    })
    expect(diagnoseOracleSafeMode({ ...base, currentTick: 1_954n }, xStocks, 1n)).toMatchObject({
      causes: ['externalShock'],
      minimumPokeEpochs: 2n,
    })
  })

  it('treats the on-chain level as authoritative when the formula differs', () => {
    expect(diagnoseOracleSafeMode(base, parameters, 1n)).toMatchObject({
      level: 1n,
      reproducedLevel: 0n,
      matchesOnchain: false,
      causes: ['unknown'],
      minimumPokeEpochs: 1n,
      shouldPoke: true,
    })
  })

  it('rejects invalid periods and risk deltas with a typed validation error', () => {
    expect(() => decodeOracleRiskParameters(0n, 724n, 149n)).toThrow(PanopticValidationError)
    expect(() => decodeOracleRiskParameters(60n | (120n << 24n), 0n, 149n)).toThrow(
      PanopticValidationError,
    )
    expect(() => decodeOracleRiskParameters(packedPeriods, 724n, -1n)).toThrow(
      PanopticValidationError,
    )
  })

  it('accepts a zero informational clamp delta', () => {
    expect(
      decodeOracleRiskParameters(60n | (120n << 24n) | (240n << 48n) | (960n << 72n), 724n, 0n)
        .maxClampDelta,
    ).toBe(0n)
  })
})
