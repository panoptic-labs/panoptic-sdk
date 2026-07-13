import type { Hex } from 'viem'

import type { ScopeStep } from '../applySteps'
import type { ConditionFlat } from '../conditions'
import { ExecutionOptions, Operator, ParameterType } from '../constants'
import { DISPATCH_SELECTOR, roleKey } from './dispatchCustomRole'

/**
 * Deleverager role: burn the Safe's existing positions only — never mint.
 *
 * Enforced with plain static conditions, no adapter and no state oracle:
 * every `positionSizes` entry must be 0. A size-0 entry either burns a held
 * position or reverts the whole dispatch — a size-0 mint is impossible
 * (option legs trip `ChunkHasZeroLiquidity` in the SFPM; pure-loan tokenIds
 * die in the end-of-dispatch solvency pass / positions-hash validation).
 *
 * Trade-off vs an oracle-based check: the key cannot settle premium (settle
 * requires `sizes[i] == storedSize`, unknowable pre-execution). Strictly a
 * risk-reduction key: safe for a watchdog keeper or dead-man's-switch.
 */
export const DELEVERAGER_ROLE_KEY = roleKey('deleverager')

const ZERO_WORD = `0x${'0'.repeat(64)}` as Hex

export function buildDeleveragerDispatchConditions(): ConditionFlat[] {
  return [
    // 0: root over calldata
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: '0x' },
    // 1: arg0 positionIdList — unconstrained (any held tokenId may be burnt)
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 2: arg1 finalPositionIdList
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 3: arg2 positionSizes — EVERY entry must be 0 (burn-or-revert)
    { parent: 0, paramType: ParameterType.Array, operator: Operator.ArrayEvery, compValue: '0x' },
    // 4: arg3 tickAndSpreadLimits (int24[3][])
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 5: arg4 usePremiaAsCollateral
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 6: arg5 builderCode
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 7-9: array element types
    { parent: 1, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    { parent: 2, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    {
      parent: 3,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: ZERO_WORD,
    },
    // 10: tickAndSpreadLimits element (int24[3] — statically encoded, 3 words)
    { parent: 4, paramType: ParameterType.Tuple, operator: Operator.Pass, compValue: '0x' },
    // 11-13: int24[3] members
    { parent: 10, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    { parent: 10, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    { parent: 10, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
  ]
}

export function buildDeleveragerRoleSteps(params: {
  member: `0x${string}`
  pool: `0x${string}`
  roleKey?: Hex
}): ScopeStep[] {
  const key = params.roleKey ?? DELEVERAGER_ROLE_KEY
  return [
    {
      name: 'assignRoles(deleverager member)',
      functionName: 'assignRoles',
      args: [params.member, [key], [true]],
    },
    { name: 'scopeTarget(pool)', functionName: 'scopeTarget', args: [key, params.pool] },
    {
      name: 'scopeFunction(dispatch, burn-only: all sizes == 0)',
      functionName: 'scopeFunction',
      args: [
        key,
        params.pool,
        DISPATCH_SELECTOR,
        buildDeleveragerDispatchConditions(),
        ExecutionOptions.None,
      ],
    },
  ]
}
