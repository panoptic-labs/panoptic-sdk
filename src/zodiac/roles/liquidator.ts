import { type Address, type Hex, toFunctionSelector, zeroAddress } from 'viem'

import type { ScopeStep } from '../applySteps'
import { type ConditionFlat, addressEqualCompValue, customCompValue } from '../conditions'
import { ExecutionOptions, Operator, ParameterType } from '../constants'

/**
 * Liquidator role: scopes ONLY `PanopticLiquidator.liquidate(LiquidateParams)`
 * on the helper. `initializePool`, `execute`, `multicall`, `sweep`, and
 * `quoteLiquidation` are never scoped.
 *
 * Split of enforcement (must match the LiquidatorCondition contract and the
 * hand-encoded tree in zodiac-modules/test/LiquidatorRolesFork.t.sol, which is
 * the golden spec for this builder):
 *  - THIS TREE pins the static fields: pool ∈ allowlist, account ∉ {safe,
 *    helper}, swap targets ∈ {router, 0}, premia flags = 0, and — via
 *    ExecutionOptions.None — zero outer msg.value (attached value is excluded
 *    from the helper's minDelta floors, so it must never flow through the
 *    role; native shortfalls are funded via nativeFundingAmount instead).
 *  - THE ADAPTER (Custom node on positionIdListTo; Roles hands it full
 *    calldata) enforces the cross-field invariants: flash/swap tokens ∈ pool
 *    underlyings, swap groups zeroed together or exact nonzero amounts,
 *    nativeFundingAmount only on native pools, floors ≥ 0 with one positive.
 */
export const LIQUIDATE_SELECTOR = toFunctionSelector(
  'liquidate((address,address,uint256[],uint256,address,uint256,uint256,address,bytes,address,uint256,address,bytes,address,uint256,int256,int256))',
)

export interface LiquidatorConditionsParams {
  /** Deployed LiquidatorCondition adapter. */
  adapter: Address
  /** The Safe (avatar) — excluded as a liquidation target. */
  safe: Address
  /** The PanopticLiquidator helper — also excluded as a target. */
  helper: Address
  /** Pinned swap router (Uniswap Universal Router). */
  router: Address
  /** PanopticPool allowlist (at least one). */
  pools: readonly Address[]
  /** Trailing 12 bytes of the Custom compValue (unused by the adapter). */
  extra?: Hex
}

/** BFS ConditionFlat tree over liquidate's single LiquidateParams tuple. */
export function buildLiquidatorConditions(params: LiquidatorConditionsParams): ConditionFlat[] {
  const { adapter, safe, helper, router, pools, extra = '0x' } = params
  if (pools.length === 0) throw new Error('liquidator role needs at least one pool')

  const pass = (parent: number, paramType: ConditionFlat['paramType']): ConditionFlat => ({
    parent,
    paramType,
    operator: Operator.Pass,
    compValue: '0x',
  })

  const conditions: ConditionFlat[] = [
    // 0: root over calldata
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: '0x' },
    // 1: the LiquidateParams tuple
    { parent: 0, paramType: ParameterType.Tuple, operator: Operator.Matches, compValue: '0x' },
    // 2: pool — Or(EqualTo(pool_i)) allowlist
    { parent: 1, paramType: ParameterType.None, operator: Operator.Or, compValue: '0x' },
    // 3: account — Nor(EqualTo(safe), EqualTo(helper))
    { parent: 1, paramType: ParameterType.None, operator: Operator.Nor, compValue: '0x' },
    // 4: positionIdListTo — carries the Custom adapter (full-calldata hook)
    {
      parent: 1,
      paramType: ParameterType.Array,
      operator: Operator.Custom,
      compValue: customCompValue(adapter, extra),
    },
    // 5: usePremiaAsCollateral — pinned to zero
    {
      parent: 1,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: '0x0000000000000000000000000000000000000000000000000000000000000000',
    },
    pass(1, ParameterType.Static), // 6: flashToken
    pass(1, ParameterType.Static), // 7: flashAmount
    pass(1, ParameterType.Static), // 8: nativeFundingAmount
    // 9: preSwapTarget — Or(EqualTo(router), EqualTo(0))
    { parent: 1, paramType: ParameterType.None, operator: Operator.Or, compValue: '0x' },
    pass(1, ParameterType.Dynamic), // 10: preSwapCallData
    pass(1, ParameterType.Static), // 11: preSwapTokenIn
    pass(1, ParameterType.Static), // 12: preSwapAmountIn
    // 13: swapTarget — Or(EqualTo(router), EqualTo(0))
    { parent: 1, paramType: ParameterType.None, operator: Operator.Or, compValue: '0x' },
    pass(1, ParameterType.Dynamic), // 14: swapCallData
    pass(1, ParameterType.Static), // 15: swapTokenIn
    pass(1, ParameterType.Static), // 16: swapAmountIn
    pass(1, ParameterType.Static), // 17: minDelta0
    pass(1, ParameterType.Static), // 18: minDelta1
  ]

  // Children (parents nondecreasing): pool allowlist under 2.
  for (const pool of pools) {
    conditions.push({
      parent: 2,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: addressEqualCompValue(pool),
    })
  }
  // account exclusions under 3.
  for (const excluded of [safe, helper]) {
    conditions.push({
      parent: 3,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: addressEqualCompValue(excluded),
    })
  }
  // positionIdListTo element template under 4.
  conditions.push(pass(4, ParameterType.Static))
  // swap target pins under 9 and 13.
  for (const parent of [9, 13]) {
    conditions.push({
      parent,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: addressEqualCompValue(router),
    })
    conditions.push({
      parent,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: addressEqualCompValue(zeroAddress),
    })
  }

  return conditions
}

/** assignRoles → scopeTarget → scopeFunction for the liquidator role. */
export function buildLiquidatorRoleSteps(
  params: LiquidatorConditionsParams & { roleKey: Hex; member: Address },
): ScopeStep[] {
  return [
    {
      name: 'assignRoles(liquidator member)',
      functionName: 'assignRoles',
      args: [params.member, [params.roleKey], [true]],
    },
    {
      name: 'scopeTarget(helper)',
      functionName: 'scopeTarget',
      args: [params.roleKey, params.helper],
    },
    {
      name: 'scopeFunction(liquidate, liquidator conditions)',
      functionName: 'scopeFunction',
      args: [
        params.roleKey,
        params.helper,
        LIQUIDATE_SELECTOR,
        buildLiquidatorConditions(params),
        // No Send: zero outer msg.value is load-bearing (see module docblock).
        ExecutionOptions.None,
      ],
    },
  ]
}
