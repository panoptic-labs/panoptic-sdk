import { describe, expect, it } from 'vitest'

import type { Pool, SafeModeState } from '../../../types'
import {
  type GuardrailConfig,
  checkFreshness,
  checkOperationAllowed,
  checkSafeMode,
  classifyRpcError,
  evaluateGuardrails,
  parseOperation,
} from '../../intermediate/risk-guardrails'

const NOW = 1_700_000_000n
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const baseConfig: GuardrailConfig = {
  maxDataAgeSeconds: 60n,
  warnUtilizationBps: 8000n,
  haltUtilizationBps: 9500n,
  operation: 'mint',
}

function makePool(overrides: Partial<Pool> = {}): Pool {
  return {
    address: ZERO_ADDRESS,
    chainId: 1n,
    poolId: 1n,
    poolKey: {
      currency0: ZERO_ADDRESS,
      currency1: ZERO_ADDRESS,
      fee: 500n,
      tickSpacing: 10n,
      hooks: ZERO_ADDRESS,
    },
    tickSpacing: 10n,
    collateralTracker0: {
      address: ZERO_ADDRESS,
      token: ZERO_ADDRESS,
      symbol: 'ETH',
      decimals: 18n,
      totalAssets: 1_000_000n,
      insideAMM: 500_000n,
      creditedShares: 0n,
      totalShares: 1_000_000n,
      utilization: 4000n,
      borrowRate: 0n,
      supplyRate: 0n,
    },
    collateralTracker1: {
      address: ZERO_ADDRESS,
      token: ZERO_ADDRESS,
      symbol: 'USDC',
      decimals: 6n,
      totalAssets: 1_000_000n,
      insideAMM: 500_000n,
      creditedShares: 0n,
      totalShares: 1_000_000n,
      utilization: 5000n,
      borrowRate: 0n,
      supplyRate: 0n,
    },
    riskEngine: {
      address: ZERO_ADDRESS,
      collateralRequirement: 10000n,
      maintenanceMargin: 5000n,
      commissionRate: 10n,
      vegoid: 0n,
      maxSpread: 1000n,
    },
    currentTick: 0n,
    sqrtPriceX96: 0n,
    uniswapPoolLiquidity: 1_000_000n,
    healthStatus: 'active',
    metadata: {} as Pool['metadata'],
    _meta: {
      blockNumber: 1n,
      blockTimestamp: NOW - 30n,
      blockHash: '0xabc',
    },
    ...overrides,
  }
}

function makeSafeMode(overrides: Partial<SafeModeState> = {}): SafeModeState {
  return {
    mode: 'normal',
    canMint: true,
    canBurn: true,
    canForceExercise: true,
    canLiquidate: true,
    canSwapAtMint: true,
    _meta: {
      blockNumber: 1n,
      blockTimestamp: NOW - 30n,
      blockHash: '0xabc',
    },
    ...overrides,
  }
}

describe('risk guardrails example', () => {
  it('defaults to mint and rejects invalid operations', () => {
    expect(parseOperation(undefined)).toBe('mint')
    expect(parseOperation('burn')).toBe('burn')
    expect(() => parseOperation('withdraw')).toThrow('Invalid OPERATION')
  })

  it('proceeds when all guardrails pass', () => {
    const decision = evaluateGuardrails(makePool(), makeSafeMode(), baseConfig, NOW)

    expect(decision.canProceed).toBe(true)
    expect(decision.severity).toBe('ok')
    expect(decision.checks).toHaveLength(5)
  })

  it('halts when pool data is stale', () => {
    const pool = makePool({
      _meta: {
        blockNumber: 1n,
        blockTimestamp: NOW - 120n,
        blockHash: '0xabc',
      },
    })

    const check = checkFreshness(pool, baseConfig, NOW)

    expect(check.name).toBe('data_freshness')
    expect(check.severity).toBe('halt')
    expect(check.passed).toBe(false)
  })

  it('warns on restricted safe mode and halts on emergency safe mode', () => {
    const restricted = checkSafeMode(
      makeSafeMode({ mode: 'restricted', reason: 'Oracle deviation elevated' }),
    )
    const emergency = checkSafeMode(makeSafeMode({ mode: 'emergency' }))

    expect(restricted.severity).toBe('warn')
    expect(restricted.passed).toBe(true)
    expect(emergency.severity).toBe('halt')
    expect(emergency.passed).toBe(false)
  })

  it('halts when utilization crosses the halt threshold', () => {
    const pool = makePool({
      collateralTracker1: {
        ...makePool().collateralTracker1,
        utilization: 9754n,
      },
    })

    const decision = evaluateGuardrails(pool, makeSafeMode(), baseConfig, NOW)
    const utilization = decision.checks.find((check) => check.name === 'utilization')

    expect(decision.canProceed).toBe(false)
    expect(decision.severity).toBe('halt')
    expect(utilization?.observed).toBe('97.54%')
  })

  it('halts when the requested operation is blocked by safe mode', () => {
    const check = checkOperationAllowed(makeSafeMode({ canMint: false }), 'mint')

    expect(check.name).toBe('operation_allowed')
    expect(check.severity).toBe('halt')
    expect(check.passed).toBe(false)
  })

  it('classifies retryable RPC errors as warnings', () => {
    const retryable = classifyRpcError(new Error('429 Too Many Requests'))
    const fatal = classifyRpcError(new Error('execution reverted'))

    expect(retryable.severity).toBe('warn')
    expect(retryable.passed).toBe(true)
    expect(fatal.severity).toBe('halt')
    expect(fatal.passed).toBe(false)
  })
})
