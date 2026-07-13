import type { Hex } from 'viem'

import type { ScopeStep } from '../applySteps'
import { sizeCapExtra } from '../conditions'
import { buildDispatchCustomRoleSteps, roleKey } from './dispatchCustomRole'

/**
 * Roller role: close one position and reopen it identical-except-strike (roll
 * out-of-range positions back into range). Enforced on-chain by the stateless
 * `RollerCondition` adapter (strike-mask equality + one-burn-one-mint shape).
 *
 * The reopened size is bounded by `sizeCap` (0n = uncapped, leaving only
 * dispatch's solvency check as the ceiling) — there is no pre-state oracle,
 * so "same size as before" cannot be enforced.
 */
export const ROLLER_ROLE_KEY = roleKey('roller')

export function buildRollerRoleSteps(params: {
  member: `0x${string}`
  pool: `0x${string}`
  adapter: `0x${string}` // deployed RollerCondition (stateless, shared per chain)
  sizeCap?: bigint
  roleKey?: Hex
}): ScopeStep[] {
  return buildDispatchCustomRoleSteps({
    roleName: 'roller',
    roleKey: params.roleKey ?? ROLLER_ROLE_KEY,
    member: params.member,
    pool: params.pool,
    adapter: params.adapter,
    extra: sizeCapExtra(params.sizeCap ?? 0n),
  })
}
