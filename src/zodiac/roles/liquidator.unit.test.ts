import { describe, expect, it } from 'vitest'

import { addressEqualCompValue, customCompValue } from '../conditions'
import { ExecutionOptions, Operator, ParameterType } from '../constants'
import {
  buildLiquidatorConditions,
  buildLiquidatorRoleSteps,
  LIQUIDATE_SELECTOR,
} from './liquidator'

const adapter = '0x1111111111111111111111111111111111111111' as const
const safe = '0x2222222222222222222222222222222222222222' as const
const helper = '0x3333333333333333333333333333333333333333' as const
const router = '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af' as const
const poolA = '0x4444444444444444444444444444444444444444' as const
const poolB = '0x5555555555555555555555555555555555555555' as const

describe('liquidator role conditions', () => {
  const conditions = buildLiquidatorConditions({
    adapter,
    safe,
    helper,
    router,
    pools: [poolA, poolB],
  })

  it('matches the Phase 0 fork-test golden shape (28 nodes for 2 pools)', () => {
    expect(conditions).toHaveLength(28)
    // Root + tuple
    expect(conditions[0]).toMatchObject({
      paramType: ParameterType.Calldata,
      operator: Operator.Matches,
    })
    expect(conditions[1]).toMatchObject({ parent: 0, paramType: ParameterType.Tuple })
    // Tuple has exactly 17 member children (LiquidateParams fields), parents = 1
    expect(conditions.filter((c, i) => i >= 2 && c.parent === 1)).toHaveLength(17)
  })

  it('pins pool to the Or-allowlist and account to Nor(safe, helper)', () => {
    expect(conditions[2]).toMatchObject({ paramType: ParameterType.None, operator: Operator.Or })
    expect(conditions[3]).toMatchObject({ paramType: ParameterType.None, operator: Operator.Nor })
    const poolChildren = conditions.filter((c) => c.parent === 2)
    expect(poolChildren.map((c) => c.compValue)).toEqual([
      addressEqualCompValue(poolA),
      addressEqualCompValue(poolB),
    ])
    const accountChildren = conditions.filter((c) => c.parent === 3)
    expect(accountChildren.map((c) => c.compValue)).toEqual([
      addressEqualCompValue(safe),
      addressEqualCompValue(helper),
    ])
  })

  it('attaches the Custom adapter to positionIdListTo and zeroes premia flags', () => {
    expect(conditions[4]).toMatchObject({
      paramType: ParameterType.Array,
      operator: Operator.Custom,
      compValue: customCompValue(adapter, '0x'),
    })
    expect(conditions[5]).toMatchObject({ operator: Operator.EqualTo })
    expect(conditions[5]?.compValue).toBe(`0x${'00'.repeat(32)}`)
  })

  it('pins both swap targets to {router, 0}', () => {
    for (const parent of [9, 13]) {
      const children = conditions.filter((c) => c.parent === parent)
      expect(children.map((c) => c.compValue)).toEqual([
        addressEqualCompValue(router),
        addressEqualCompValue('0x0000000000000000000000000000000000000000'),
      ])
    }
  })

  it('keeps parents nondecreasing (Roles BFS integrity requirement)', () => {
    for (let i = 1; i < conditions.length; i++) {
      expect(conditions[i]?.parent ?? -1).toBeGreaterThanOrEqual(conditions[i - 1]?.parent ?? -1)
    }
  })

  it('rejects an empty pool allowlist', () => {
    expect(() => buildLiquidatorConditions({ adapter, safe, helper, router, pools: [] })).toThrow()
  })
})

describe('liquidator role steps', () => {
  it('scopes ONLY liquidate on the helper with ExecutionOptions.None', () => {
    const steps = buildLiquidatorRoleSteps({
      adapter,
      safe,
      helper,
      router,
      pools: [poolA],
      roleKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
      member: '0x9999999999999999999999999999999999999999',
    })
    expect(steps.map((s) => s.functionName)).toEqual([
      'assignRoles',
      'scopeTarget',
      'scopeFunction',
    ])
    const scopeFn = steps[2]?.args ?? []
    expect(scopeFn[1]).toBe(helper)
    expect(scopeFn[2]).toBe(LIQUIDATE_SELECTOR)
    expect(scopeFn[4]).toBe(ExecutionOptions.None) // zero msg.value is load-bearing
  })

  it('liquidate selector matches the deployed helper (0x97faa0d4)', () => {
    expect(LIQUIDATE_SELECTOR).toBe('0x97faa0d4')
  })
})
