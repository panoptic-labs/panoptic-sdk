import type { Hex } from 'viem'

import type { ScopeStep } from '../applySteps'
import { sizeCapExtra } from '../conditions'
import { buildDispatchCustomRoleSteps, roleKey } from './dispatchCustomRole'

/**
 * Size-adjuster role: replace one position with an identical-except-optionRatio
 * one — reduce a short whose long side was purchased, or grow a long as more
 * options are sold. Enforced on-chain by the stateless `SizeAdjusterCondition`
 * adapter (ratio-mask equality + one-burn-one-mint shape).
 *
 * Without a pre-state oracle the relative notional cap is not enforceable;
 * set `sizeCap` (uint96, 0n = uncapped) to bound the mint size absolutely.
 */
export const SIZE_ADJUSTER_ROLE_KEY = roleKey('size-adjuster')

export function buildSizeAdjusterRoleSteps(params: {
  member: `0x${string}`
  pool: `0x${string}`
  adapter: `0x${string}` // deployed SizeAdjusterCondition (stateless, shared per chain)
  sizeCap?: bigint
  roleKey?: Hex
}): ScopeStep[] {
  return buildDispatchCustomRoleSteps({
    roleName: 'size-adjuster',
    roleKey: params.roleKey ?? SIZE_ADJUSTER_ROLE_KEY,
    member: params.member,
    pool: params.pool,
    adapter: params.adapter,
    extra: sizeCapExtra(params.sizeCap ?? 0n),
  })
}
