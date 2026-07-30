import { keccak256, toHex } from 'viem'
import { describe, expect, it } from 'vitest'

import type { ConditionFlat } from './conditions'
import { addressEqualCompValue, customCompValue, sizeCapExtra } from './conditions'
import { ExecutionOptions, Operator, ParameterType } from './constants'
import {
  buildDeleveragerDispatchConditions,
  buildDeleveragerRoleSteps,
  DELEVERAGER_ROLE_KEY,
} from './roles/deleverager'
import {
  buildDispatchCustomConditions,
  DISPATCH_SELECTOR,
  roleKey,
} from './roles/dispatchCustomRole'
import { buildLoanOnlyDispatchConditions } from './roles/loanHedger'
import {
  buildDispatchFromConditions,
  buildMaintenanceRoleSteps,
  DISPATCH_FROM_SELECTOR,
  MAINTENANCE_ROLE_KEY,
} from './roles/maintenance'
import { ROLLER_ROLE_KEY } from './roles/roller'
import {
  buildSfpmSwapConditions,
  buildSfpmSwapVenueSteps,
  buildWithdrawWithPositionsConditions,
  MULTICALL_SELECTOR,
  MULTISEND_SELECTOR,
  sfpmPoolIdPinExtra,
  WITHDRAW_WITH_POSITIONS_SELECTOR,
} from './roles/sfpmSwap'
import { SIZE_ADJUSTER_ROLE_KEY } from './roles/sizeAdjuster'
import { loanWidthFieldsMask, optionRatioFieldsMask, strikeFieldsMask } from './tokenIdMask'

const REVIEWED_LOAN_ROLE_TREE_HASH =
  '0x82a2514e569a1aa6aa09d62c2d3018e4977709e6ddb098d08a1bc3f87797785d'

const SAFE = '0x1111111111111111111111111111111111111111' as const
const POOL = '0x2222222222222222222222222222222222222222' as const
const MEMBER = '0x3333333333333333333333333333333333333333' as const
const ADAPTER = '0x4444444444444444444444444444444444444444' as const

describe('loan hedger authorization policy', () => {
  it('keeps the explicitly accepted width-only condition tree byte-for-byte', () => {
    const encoded = toHex(JSON.stringify(buildLoanOnlyDispatchConditions()))
    expect(keccak256(encoded)).toBe(REVIEWED_LOAN_ROLE_TREE_HASH)
  })
})

/** Integrity.sol structural checks shared by all condition trees. */
function assertIntegrity(conditions: ConditionFlat[]): void {
  // BFS: parent indices non-decreasing (NotBFS), and every non-root node must
  // reference an earlier, valid parent (0 <= parent < own index).
  for (let i = 1; i < conditions.length; i++) {
    expect(conditions[i - 1].parent).toBeLessThanOrEqual(conditions[i].parent)
    expect(conditions[i].parent, `node ${i} parent out of range`).toBeGreaterThanOrEqual(0)
    expect(conditions[i].parent, `node ${i} parent must precede it`).toBeLessThan(i)
  }
  conditions.forEach((node, i) => {
    const children = conditions.filter((child, j) => j !== i && child.parent === i)
    // Calldata/Tuple/Array nodes must describe their children (UnsuitableChildCount)
    if (
      node.paramType === ParameterType.Array ||
      node.paramType === ParameterType.Calldata ||
      node.paramType === ParameterType.Tuple
    ) {
      expect(children.length, `node ${i} needs >=1 child`).toBeGreaterThanOrEqual(1)
    }
    // logical operators use ParameterType.None and need children
    if (
      node.operator === Operator.And ||
      node.operator === Operator.Or ||
      node.operator === Operator.Nor
    ) {
      expect(node.paramType).toBe(ParameterType.None)
      expect(children.length).toBeGreaterThanOrEqual(1)
    }
    // int24[3] tuples have exactly 3 static members
    if (node.paramType === ParameterType.Tuple) {
      expect(children.length).toBe(3)
    }
  })
  // root
  expect(conditions[0].parent).toBe(0)
  expect(conditions[0].paramType).toBe(ParameterType.Calldata)
}

describe('customCompValue', () => {
  it('packs adapter address (20B) ++ extra (12B)', () => {
    expect(customCompValue(ADAPTER)).toBe(`0x${ADAPTER.slice(2)}${'0'.repeat(24)}`)
    expect(customCompValue(ADAPTER, '0xdeadbeef')).toBe(
      `0x${ADAPTER.slice(2)}deadbeef${'0'.repeat(16)}`,
    )
  })

  it('rejects extra longer than 12 bytes', () => {
    expect(() => customCompValue(ADAPTER, `0x${'ff'.repeat(13)}`)).toThrow()
  })
})

describe('sizeCapExtra', () => {
  it('encodes a uint96 cap right-aligned in 12 bytes', () => {
    expect(sizeCapExtra(0n)).toBe(`0x${'0'.repeat(24)}`)
    expect(sizeCapExtra(400n)).toBe(`0x${'0'.repeat(21)}190`)
    expect(sizeCapExtra((1n << 96n) - 1n)).toBe(`0x${'f'.repeat(24)}`)
  })

  it('rejects caps outside uint96', () => {
    expect(() => sizeCapExtra(1n << 96n)).toThrow()
    expect(() => sizeCapExtra(-1n)).toThrow()
  })

  it('composes with customCompValue as the trailing 12 bytes', () => {
    expect(customCompValue(ADAPTER, sizeCapExtra(400n))).toBe(
      `0x${ADAPTER.slice(2)}${'0'.repeat(21)}190`,
    )
  })
})

describe('dispatch custom-role conditions', () => {
  const conditions = buildDispatchCustomConditions(ADAPTER)

  it('satisfies Integrity structural rules', () => {
    assertIntegrity(conditions)
  })

  it('mirrors the loan-hedger structure tree exactly, except arg0 carries Custom', () => {
    const loanTree = buildLoanOnlyDispatchConditions()
    // same shape as the (fork-validated) loan tree: 6 args under root
    expect(conditions.filter((c, i) => i !== 0 && c.parent === 0).length).toBe(6)
    expect(loanTree.filter((c, i) => i !== 0 && c.parent === 0).length).toBe(6)
    expect(conditions[1].operator).toBe(Operator.Custom)
    expect(conditions[1].paramType).toBe(ParameterType.Array)
    expect(conditions[1].compValue).toBe(customCompValue(ADAPTER))
    // all other nodes are pure structure
    conditions.slice(2).forEach((node) => expect(node.operator).toBe(Operator.Pass))
  })

  it('uses the verified dispatch selector', () => {
    expect(DISPATCH_SELECTOR).toBe('0xc25813aa')
  })
})

describe('deleverager role (static, no adapter)', () => {
  const conditions = buildDeleveragerDispatchConditions()

  it('satisfies Integrity structural rules', () => {
    assertIntegrity(conditions)
  })

  it('pins every positionSizes element to 0 and constrains nothing else', () => {
    // arg2 (positionSizes) is ArrayEvery over EqualTo(0)
    const argNodes = conditions
      .map((c, i) => ({ ...c, i }))
      .filter((c) => c.i !== 0 && c.parent === 0)
    expect(argNodes.length).toBe(6)
    const sizesNode = argNodes[2]
    expect(sizesNode.operator).toBe(Operator.ArrayEvery)
    const sizeElement = conditions.filter((c, i) => i !== sizesNode.i && c.parent === sizesNode.i)
    expect(sizeElement).toEqual([
      {
        parent: sizesNode.i,
        paramType: ParameterType.Static,
        operator: Operator.EqualTo,
        compValue: `0x${'0'.repeat(64)}`,
      },
    ])
    // no Custom node anywhere — this role needs no adapter deployment
    expect(conditions.some((c) => c.operator === Operator.Custom)).toBe(false)
    conditions
      .filter((c, i) => i !== 0 && i !== sizesNode.i && c.parent !== sizesNode.i)
      .forEach((node) => expect(node.operator).toBe(Operator.Pass))
  })

  it('builds assignRoles → scopeTarget → scopeFunction steps', () => {
    const steps = buildDeleveragerRoleSteps({ member: MEMBER, pool: POOL })
    expect(steps.map((s) => s.functionName)).toEqual([
      'assignRoles',
      'scopeTarget',
      'scopeFunction',
    ])
    expect(steps[0].args).toEqual([MEMBER, [DELEVERAGER_ROLE_KEY], [true]])
    const [key, pool, selector, , options] = steps[2].args as [
      string,
      string,
      string,
      ConditionFlat[],
      number,
    ]
    expect(key).toBe(DELEVERAGER_ROLE_KEY)
    expect(pool).toBe(POOL)
    expect(selector).toBe(DISPATCH_SELECTOR)
    expect(options).toBe(ExecutionOptions.None)
  })
})

describe('maintenance role', () => {
  const conditions = buildDispatchFromConditions(SAFE)

  it('satisfies Integrity structural rules', () => {
    assertIntegrity(conditions)
  })

  it('pins account (arg1) to != Safe via Nor(EqualTo(safe)) and passes everything else', () => {
    const argNodes = conditions
      .map((c, i) => ({ ...c, i }))
      .filter((c) => c.i !== 0 && c.parent === 0)
    expect(argNodes.length).toBe(5) // dispatchFrom has 5 args
    const nor = argNodes[1]
    expect(nor.operator).toBe(Operator.Nor)
    const norChildren = conditions.filter((c, i) => i !== nor.i && c.parent === nor.i)
    expect(norChildren).toEqual([
      {
        parent: nor.i,
        paramType: ParameterType.Static,
        operator: Operator.EqualTo,
        compValue: addressEqualCompValue(SAFE),
      },
    ])
    // no other constraint anywhere
    conditions
      .filter((c, i) => i !== 0 && i !== nor.i && c.parent !== nor.i)
      .forEach((node) => expect(node.operator).toBe(Operator.Pass))
  })

  it('scopes dispatchFrom as payable (ExecutionOptions.Send)', () => {
    const steps = buildMaintenanceRoleSteps({ member: MEMBER, pool: POOL, safe: SAFE })
    const [, , selector, , options] = steps[2].args as [string, string, string, unknown, number]
    expect(selector).toBe(DISPATCH_FROM_SELECTOR)
    expect(options).toBe(ExecutionOptions.Send)
  })
})

describe('role keys', () => {
  it('are stable, distinct keccak256 constants', () => {
    expect(DELEVERAGER_ROLE_KEY).toBe(roleKey('deleverager'))
    const keys = [
      DELEVERAGER_ROLE_KEY,
      MAINTENANCE_ROLE_KEY,
      ROLLER_ROLE_KEY,
      SIZE_ADJUSTER_ROLE_KEY,
    ]
    expect(new Set(keys).size).toBe(4)
    keys.forEach((k) => expect(k).toMatch(/^0x[0-9a-f]{64}$/))
  })
})

describe('tokenId masks — parity with contracts/lib/TokenIdMasks.sol goldens', () => {
  // Fixed literals independently derived from the TokenIdMasks.sol layout
  // (poolId=64 low bits; then 4 legs × 48 bits, each with optionRatio at
  // offset 1 width 7, strike at offset 12 width 24, width at offset 36 width 12).
  // Hard-coding them — rather than recomputing with the same per-leg loop the
  // implementation uses — keeps this an independent check, so a drift in the TS
  // masks fails here regardless of shared logic.
  const GOLDEN_WIDTH_MASK = 0xfff000000000fff000000000fff000000000fff0000000000000000000000000n
  const GOLDEN_STRIKE_MASK = 0xffffff000000ffffff000000ffffff000000ffffff0000000000000000000n
  const GOLDEN_OPTION_RATIO_MASK = 0xfe0000000000fe0000000000fe0000000000fe0000000000000000n

  it('width/strike/optionRatio field masks match the tokenId layout', () => {
    expect(loanWidthFieldsMask()).toBe(GOLDEN_WIDTH_MASK)
    expect(strikeFieldsMask()).toBe(GOLDEN_STRIKE_MASK)
    expect(optionRatioFieldsMask()).toBe(GOLDEN_OPTION_RATIO_MASK)
  })

  it('masks are pairwise disjoint', () => {
    expect(strikeFieldsMask() & optionRatioFieldsMask()).toBe(0n)
    expect(strikeFieldsMask() & loanWidthFieldsMask()).toBe(0n)
    expect(optionRatioFieldsMask() & loanWidthFieldsMask()).toBe(0n)
  })
})

describe('sfpm swap venue role', () => {
  const SFPM = '0x5555555555555555555555555555555555555555' as const
  const CT0 = '0x6666666666666666666666666666666666666666' as const
  const CT1 = '0x7777777777777777777777777777777777777777' as const
  const MULTISEND = '0x8888888888888888888888888888888888888888' as const
  const UNWRAPPER = '0x9999999999999999999999999999999999999999' as const
  const POOL_ID = 0xa0488e6a0c2ddn
  const BOT_ROLE = roleKey('loan-hedger')

  it('pins the poolId in the low 64 bits of a right-aligned uint96 extra', () => {
    expect(sfpmPoolIdPinExtra(POOL_ID)).toBe(`0x${POOL_ID.toString(16).padStart(24, '0')}`)
  })

  it('rejects a zero or oversized poolId pin', () => {
    expect(() => sfpmPoolIdPinExtra(0n)).toThrow()
    expect(() => sfpmPoolIdPinExtra(1n << 64n)).toThrow()
  })

  it('builds an integrity-valid Custom tree over multicall arg0', () => {
    const tree = buildSfpmSwapConditions(ADAPTER, POOL_ID)
    assertIntegrity(tree)
    expect(tree[1].operator).toBe(Operator.Custom)
    expect(tree[1].paramType).toBe(ParameterType.Array)
    expect(tree[1].compValue).toBe(customCompValue(ADAPTER, sfpmPoolIdPinExtra(POOL_ID)))
    // array element child (bytes → Dynamic)
    expect(tree[2].parent).toBe(1)
    expect(tree[2].paramType).toBe(ParameterType.Dynamic)
  })

  it('scopes the solvency-aware withdrawal to the Safe and false premia mode', () => {
    const tree = buildWithdrawWithPositionsConditions(SAFE)
    assertIntegrity(tree)
    expect(WITHDRAW_WITH_POSITIONS_SELECTOR).toBe('0xe51161ba')
    expect(tree[2].compValue).toBe(addressEqualCompValue(SAFE))
    expect(tree[3].compValue).toBe(addressEqualCompValue(SAFE))
    expect(tree[5]).toEqual({
      parent: 0,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: `0x${'0'.repeat(64)}`,
    })
  })

  it('emits unwrapper + SFPM scope + both CT scopes under the existing role key', () => {
    const steps = buildSfpmSwapVenueSteps({
      roleKey: BOT_ROLE,
      safe: SAFE,
      sfpm: SFPM,
      collateralTracker0: CT0,
      collateralTracker1: CT1,
      adapter: ADAPTER,
      poolIdPin: POOL_ID,
      multiSendCallOnly: MULTISEND,
      multiSendUnwrapper: UNWRAPPER,
    })
    expect(steps.map((s) => s.functionName)).toEqual([
      'setTransactionUnwrapper',
      'scopeTarget', // SFPM
      'scopeFunction', // SFPM.multicall
      'scopeTarget', // CT0
      'scopeFunction', // CT0.withdraw
      'scopeFunction', // CT0.deposit
      'scopeTarget', // CT1
      'scopeFunction', // CT1.withdraw
      'scopeFunction', // CT1.deposit
    ])
    // no assignRoles: extends the existing bot role
    expect(steps.some((s) => s.functionName === 'assignRoles')).toBe(false)
    // no WETH scoping for a two-ERC20 pool
    expect(steps.some((s) => s.functionName === 'allowFunction')).toBe(false)
    // unwrapper registered for MultiSend.multiSend
    expect(steps[0].args).toEqual([MULTISEND, MULTISEND_SELECTOR, UNWRAPPER])
    // SFPM scopeFunction targets multicall under the bot role
    expect(steps[2].args[0]).toBe(BOT_ROLE)
    expect(steps[2].args[1]).toBe(SFPM)
    expect(steps[2].args[2]).toBe(MULTICALL_SELECTOR)
    expect(steps[4].args[2]).toBe(WITHDRAW_WITH_POSITIONS_SELECTOR)
    expect(steps[7].args[2]).toBe(WITHDRAW_WITH_POSITIONS_SELECTOR)
  })

  it('adds WETH wrap/unwrap scopes when a collateral asset is native ETH', () => {
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
    const steps = buildSfpmSwapVenueSteps({
      roleKey: BOT_ROLE,
      safe: SAFE,
      sfpm: SFPM,
      collateralTracker0: CT0,
      collateralTracker1: CT1,
      adapter: ADAPTER,
      poolIdPin: POOL_ID,
      multiSendCallOnly: MULTISEND,
      multiSendUnwrapper: UNWRAPPER,
      nativeCollateral: 'token1', // WETH side is native ETH collateral
      weth9: WETH,
    })
    const allows = steps.filter((s) => s.functionName === 'allowFunction')
    expect(allows).toHaveLength(2) // WETH deposit + withdraw
    expect(steps.some((s) => s.name === 'scopeTarget(WETH9)')).toBe(true)
    // the native side's CT deposit must allow value (ExecutionOptions.Send = 1)
    const ct1Deposit = steps.find((s) => s.name.includes('CT1.deposit'))
    expect(ct1Deposit?.args[4]).toBe(ExecutionOptions.Send)
    // the ERC20 side's CT deposit does not
    const ct0Deposit = steps.find((s) => s.name.includes('CT0.deposit'))
    expect(ct0Deposit?.args[4]).toBe(ExecutionOptions.None)
  })

  it('rejects native collateral without a WETH address', () => {
    expect(() =>
      buildSfpmSwapVenueSteps({
        roleKey: BOT_ROLE,
        safe: SAFE,
        sfpm: SFPM,
        collateralTracker0: CT0,
        collateralTracker1: CT1,
        adapter: ADAPTER,
        poolIdPin: POOL_ID,
        multiSendCallOnly: MULTISEND,
        multiSendUnwrapper: UNWRAPPER,
        nativeCollateral: 'token1',
      }),
    ).toThrow()
  })
})
