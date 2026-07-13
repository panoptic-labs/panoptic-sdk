import { type Hex, keccak256, toBytes, toFunctionSelector } from 'viem'

import type { ScopeStep } from '../applySteps'
import { type ConditionFlat, customCompValue } from '../conditions'
import { ExecutionOptions, Operator, ParameterType } from '../constants'

/** PanopticPool.dispatch — TokenId is a uint256 value type. */
export const DISPATCH_SELECTOR = toFunctionSelector(
  'dispatch(uint256[],uint256[],uint128[],int24[3][],bool,uint256)',
)

/** Deterministic per-role keys; override via env/config if a Safe needs several instances. */
export function roleKey(name: string): Hex {
  return keccak256(toBytes(`panoptic.role.${name}.v1`))
}

/**
 * ConditionFlat tree for a dispatch-scoped role whose whole authorization
 * logic lives in an on-chain `ICustomCondition` adapter (Operator.Custom).
 *
 * The Custom node is attached to arg0 (`positionIdList`): Roles hands the
 * adapter the FULL calldata regardless of attachment point, and the adapter
 * decodes `positionIdList`/`positionSizes` itself. The remaining nodes are the
 * structural template `Integrity.sol` requires (Calldata and Array nodes must
 * describe their children; see buildLoanOnlyDispatchConditions for the shape).
 */
export function buildDispatchCustomConditions(
  adapter: `0x${string}`,
  extra: Hex = '0x',
): ConditionFlat[] {
  const compValue = customCompValue(adapter, extra)
  return [
    // 0: root over calldata
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: '0x' },
    // 1: arg0 positionIdList — carries the Custom adapter check
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Custom, compValue },
    // 2: arg1 finalPositionIdList
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 3: arg2 positionSizes
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 4: arg3 tickAndSpreadLimits (int24[3][])
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 5: arg4 usePremiaAsCollateral
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 6: arg5 builderCode
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 7-9: array element types
    { parent: 1, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    { parent: 2, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    { parent: 3, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 10: tickAndSpreadLimits element (int24[3] — statically encoded, 3 words)
    { parent: 4, paramType: ParameterType.Tuple, operator: Operator.Pass, compValue: '0x' },
    // 11-13: int24[3] members
    { parent: 10, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    { parent: 10, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    { parent: 10, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
  ]
}

/** assignRoles → scopeTarget → scopeFunction steps for an adapter-gated dispatch role. */
export function buildDispatchCustomRoleSteps(params: {
  roleName: string
  roleKey: Hex
  member: `0x${string}`
  pool: `0x${string}`
  adapter: `0x${string}`
  extra?: Hex
}): ScopeStep[] {
  const { roleName, member, pool, adapter, extra } = params
  return [
    {
      name: `assignRoles(${roleName} member)`,
      functionName: 'assignRoles',
      args: [member, [params.roleKey], [true]],
    },
    { name: 'scopeTarget(pool)', functionName: 'scopeTarget', args: [params.roleKey, pool] },
    {
      name: `scopeFunction(dispatch, ${roleName} custom adapter)`,
      functionName: 'scopeFunction',
      args: [
        params.roleKey,
        pool,
        DISPATCH_SELECTOR,
        buildDispatchCustomConditions(adapter, extra),
        ExecutionOptions.None,
      ],
    },
  ]
}
