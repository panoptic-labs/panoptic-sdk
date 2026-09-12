import {
  assertCanBurn,
  assertCanForceExercise,
  assertCanLiquidate,
  assertCanMint,
  assertFresh,
  assertHealthy,
  isGasError,
  isNonceError,
  isRetryableRpcError,
} from '../../bot'
import type { Pool, SafeModeState } from '../../types'

export type GuardrailSeverity = 'ok' | 'warn' | 'halt'
export type GuardedOperation = 'mint' | 'burn' | 'liquidate' | 'forceExercise'
export type GuardrailCheckName =
  | 'data_freshness'
  | 'pool_health'
  | 'safe_mode'
  | 'utilization'
  | 'operation_allowed'
  | 'rpc_error_policy'

export interface GuardrailCheck {
  name: GuardrailCheckName
  severity: GuardrailSeverity
  passed: boolean
  reason: string
  observed?: string
  threshold?: string
}

export interface GuardrailDecision {
  canProceed: boolean
  severity: GuardrailSeverity
  checks: GuardrailCheck[]
}

export interface GuardrailConfig {
  maxDataAgeSeconds: bigint
  warnUtilizationBps: bigint
  haltUtilizationBps: bigint
  operation: GuardedOperation
}

export function parseOperation(value: string | undefined): GuardedOperation {
  switch (value) {
    case undefined:
      return 'mint'
    case 'mint':
    case 'burn':
    case 'liquidate':
    case 'forceExercise':
      return value
    default:
      throw new Error(
        `Invalid OPERATION="${value}". Expected one of: mint, burn, liquidate, forceExercise`,
      )
  }
}

function severityRank(severity: GuardrailSeverity): number {
  if (severity === 'halt') return 2
  if (severity === 'warn') return 1
  return 0
}

export function maxSeverity(checks: GuardrailCheck[]): GuardrailSeverity {
  return checks.reduce<GuardrailSeverity>(
    (current, check) =>
      severityRank(check.severity) > severityRank(current) ? check.severity : current,
    'ok',
  )
}

function utilizationLabel(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`
}

export function checkFreshness(
  pool: Pool,
  config: GuardrailConfig,
  now = BigInt(Math.floor(Date.now() / 1000)),
): GuardrailCheck {
  try {
    assertFresh(pool, config.maxDataAgeSeconds, now)
    return {
      name: 'data_freshness',
      severity: 'ok',
      passed: true,
      reason: 'Pool data is fresh enough for automated decisioning.',
      observed: `${now - pool._meta.blockTimestamp}s old`,
      threshold: `<= ${config.maxDataAgeSeconds}s`,
    }
  } catch (error) {
    return {
      name: 'data_freshness',
      severity: 'halt',
      passed: false,
      reason: error instanceof Error ? error.message : 'Pool data is stale.',
      observed: `${now - pool._meta.blockTimestamp}s old`,
      threshold: `<= ${config.maxDataAgeSeconds}s`,
    }
  }
}

export function checkPoolHealth(pool: Pool): GuardrailCheck {
  try {
    assertHealthy(pool)
    return {
      name: 'pool_health',
      severity: 'ok',
      passed: true,
      reason: 'Pool health status is active.',
      observed: pool.healthStatus,
      threshold: 'active',
    }
  } catch (error) {
    return {
      name: 'pool_health',
      severity: 'halt',
      passed: false,
      reason: error instanceof Error ? error.message : 'Pool is not healthy.',
      observed: pool.healthStatus,
      threshold: 'active',
    }
  }
}

export function checkSafeMode(safeMode: SafeModeState): GuardrailCheck {
  if (safeMode.mode === 'normal') {
    return {
      name: 'safe_mode',
      severity: 'ok',
      passed: true,
      reason: 'Safe mode is normal.',
      observed: safeMode.mode,
      threshold: 'normal',
    }
  }

  return {
    name: 'safe_mode',
    severity: safeMode.mode === 'emergency' ? 'halt' : 'warn',
    passed: safeMode.mode !== 'emergency',
    reason: safeMode.reason ?? `Safe mode is ${safeMode.mode}.`,
    observed: safeMode.mode,
    threshold: 'normal',
  }
}

export function checkUtilization(pool: Pool, config: GuardrailConfig): GuardrailCheck {
  const maxUtilization =
    pool.collateralTracker0.utilization > pool.collateralTracker1.utilization
      ? pool.collateralTracker0.utilization
      : pool.collateralTracker1.utilization

  if (maxUtilization >= config.haltUtilizationBps) {
    return {
      name: 'utilization',
      severity: 'halt',
      passed: false,
      reason: 'Utilization is above the halt threshold.',
      observed: utilizationLabel(maxUtilization),
      threshold: `< ${utilizationLabel(config.haltUtilizationBps)}`,
    }
  }

  if (maxUtilization >= config.warnUtilizationBps) {
    return {
      name: 'utilization',
      severity: 'warn',
      passed: true,
      reason: 'Utilization is elevated; strategies should reduce size or require extra confirmation.',
      observed: utilizationLabel(maxUtilization),
      threshold: `< ${utilizationLabel(config.warnUtilizationBps)}`,
    }
  }

  return {
    name: 'utilization',
    severity: 'ok',
    passed: true,
    reason: 'Utilization is below configured warning thresholds.',
    observed: utilizationLabel(maxUtilization),
    threshold: `< ${utilizationLabel(config.warnUtilizationBps)}`,
  }
}

export function checkOperationAllowed(
  safeMode: SafeModeState,
  operation: GuardedOperation,
): GuardrailCheck {
  try {
    switch (operation) {
      case 'mint':
        assertCanMint(safeMode)
        break
      case 'burn':
        assertCanBurn(safeMode)
        break
      case 'liquidate':
        assertCanLiquidate(safeMode)
        break
      case 'forceExercise':
        assertCanForceExercise(safeMode)
        break
    }

    return {
      name: 'operation_allowed',
      severity: 'ok',
      passed: true,
      reason: `${operation} is allowed in the current safe-mode state.`,
      observed: safeMode.mode,
    }
  } catch (error) {
    return {
      name: 'operation_allowed',
      severity: 'halt',
      passed: false,
      reason: error instanceof Error ? error.message : `${operation} is not allowed.`,
      observed: safeMode.mode,
    }
  }
}

export function classifyRpcError(error: unknown): GuardrailCheck {
  const retryable = isRetryableRpcError(error)
  const nonce = isNonceError(error)
  const gas = isGasError(error)

  return {
    name: 'rpc_error_policy',
    severity: retryable || nonce || gas ? 'warn' : 'halt',
    passed: retryable || nonce || gas,
    reason:
      retryable || nonce || gas
        ? 'Error looks recoverable; retry with backoff, refreshed nonce, or adjusted gas.'
        : 'Error does not match retryable RPC, nonce, or gas patterns.',
    observed: error instanceof Error ? error.message : String(error),
  }
}

export function evaluateGuardrails(
  pool: Pool,
  safeMode: SafeModeState,
  config: GuardrailConfig,
  now?: bigint,
): GuardrailDecision {
  const checks = [
    checkFreshness(pool, config, now),
    checkPoolHealth(pool),
    checkSafeMode(safeMode),
    checkUtilization(pool, config),
    checkOperationAllowed(safeMode, config.operation),
  ]
  const severity = maxSeverity(checks)

  return {
    canProceed: severity !== 'halt',
    severity,
    checks,
  }
}
