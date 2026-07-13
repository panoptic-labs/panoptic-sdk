import { type Hex, toFunctionSelector } from 'viem'

import type { ScopeStep } from '../applySteps'
import { type ConditionFlat, addressEqualCompValue } from '../conditions'
import { ExecutionOptions, Operator, ParameterType } from '../constants'
import { roleKey } from './dispatchCustomRole'

/**
 * Maintenance role: full `dispatchFrom` access — settle premium on, force-
 * exercise, and liquidate third-party accounts using the Safe's capital.
 * No adapter needed; the pool itself hash-validates the position lists.
 *
 * The only pin is `account != Safe` (Nor(EqualTo(safe))) so the maintenance
 * key can never force-exercise or liquidate the Safe's own book.
 * `positionIdListFrom` (the caller's solvency list) is intentionally
 * unconstrained — the Safe may legitimately hold option positions.
 *
 * dispatchFrom is payable ⇒ ExecutionOptions.Send.
 */
export const MAINTENANCE_ROLE_KEY = roleKey('maintenance')

/** LeftRightUnsigned is a uint256 value type. */
export const DISPATCH_FROM_SELECTOR = toFunctionSelector(
  'dispatchFrom(uint256[],address,uint256[],uint256[],uint256)',
)

export function buildDispatchFromConditions(safe: `0x${string}`): ConditionFlat[] {
  return [
    // 0: root over calldata
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: '0x' },
    // 1: arg0 positionIdListFrom (caller solvency list)
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 2: arg1 account — anything but the Safe itself
    { parent: 0, paramType: ParameterType.None, operator: Operator.Nor, compValue: '0x' },
    // 3: arg2 positionIdListTo
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 4: arg3 positionIdListToFinal
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 5: arg4 usePremiaAsCollateral (LeftRightUnsigned)
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 6: arg0 element
    { parent: 1, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 7: Nor child — account == Safe (negated by the parent)
    {
      parent: 2,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: addressEqualCompValue(safe),
    },
    // 8: arg2 element
    { parent: 3, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 9: arg3 element
    { parent: 4, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
  ]
}

export function buildMaintenanceRoleSteps(params: {
  member: `0x${string}`
  pool: `0x${string}`
  safe: `0x${string}`
  roleKey?: Hex
}): ScopeStep[] {
  const key = params.roleKey ?? MAINTENANCE_ROLE_KEY
  return [
    {
      name: 'assignRoles(maintenance member)',
      functionName: 'assignRoles',
      args: [params.member, [key], [true]],
    },
    { name: 'scopeTarget(pool)', functionName: 'scopeTarget', args: [key, params.pool] },
    {
      name: 'scopeFunction(dispatchFrom, account != safe, Send)',
      functionName: 'scopeFunction',
      args: [
        key,
        params.pool,
        DISPATCH_FROM_SELECTOR,
        buildDispatchFromConditions(params.safe),
        ExecutionOptions.Send,
      ],
    },
  ]
}
