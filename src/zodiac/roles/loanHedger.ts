import type { Hex } from 'viem'

import { type ConditionFlat, addressEqualCompValue } from '../conditions'
import { Operator, ParameterType } from '../constants'
import { loanBitmaskCondition } from '../tokenIdMask'

/**
 * Loan-only hedger role scope (migrated from apps/hedger-bot scripts/lib).
 *
 * ⚠️  VALIDATE ON A FORK BEFORE MAINNET. The ConditionFlat encoding below is
 * security-critical. Dry-run `scopeFunction` on an anvil/Tenderly fork and
 * assert that the role CAN mint/burn a pure width=0 loan via dispatch and
 * CANNOT dispatch a tokenId with any width>0 leg.
 *
 * The scope constrains PanopticPool.dispatch(positionIdList, finalPositionIdList,
 * positionSizes, tickAndSpreadLimits, usePremiaAsCollateral, builderCode) so that
 * EVERY element of `positionIdList` (arg 0 — the tokenIds actually minted/burned)
 * is a pure loan: `tokenId & widthFieldsMask == 0`. All other args pass freely;
 * `finalPositionIdList` is intentionally NOT constrained (it legitimately contains
 * the user's option positions that remain open).
 */

/**
 * Bitmask compValue layout (Roles v2 `PermissionChecker._bitmask`): a 32-byte
 * word packing `uint16 shift | bytes15 mask | bytes15 expected`, where `shift`
 * is a BYTE offset from the start (left / most-significant end) of the value
 * and the 15-byte mask is applied LEFT-aligned to `bytes32(value[shift:])`.
 *
 * The four 12-bit width fields span tokenId bits 100–255 (leg 3's width sits in
 * the top two bytes), which is wider than one 15-byte window. So the loan
 * constraint is expressed as TWO windows AND-ed together:
 *   - shift 0:  tokenId bytes 0..14  (bits 136–255) — covers legs 1, 2, 3
 *   - shift 17: tokenId bytes 17..31 (bits 0–119)   — covers leg 0
 * Bytes 15–16 (bits 120–135) contain no width bits.
 */
export const LOAN_BITMASK_WINDOW_SHIFTS = [0, 17] as const

export function loanBitmaskCompValueAt(shiftBytes: number): Hex {
  const { mask } = loanBitmaskCondition()
  const maskBytes = mask.slice(2) // 64 hex chars, byte 0 first
  const window = maskBytes.slice(shiftBytes * 2, shiftBytes * 2 + 30).padEnd(30, '0')
  const shift = shiftBytes.toString(16).padStart(4, '0')
  return `0x${shift}${window}${'0'.repeat(30)}` as Hex // expected = all zeros
}

/**
 * Build the ConditionFlat[] tree scoping dispatch to loan-only positionIdList.
 *
 * Roles v2 `Integrity.sol` requirements honored here:
 *   - BFS order: parent indices must be non-decreasing (NotBFS).
 *   - Every Array-typed node needs >=1 child describing the element type
 *     (UnsuitableChildCount); ArrayEvery needs exactly 1.
 *   - And nodes use ParameterType.None and an empty compValue.
 */
export function buildLoanOnlyDispatchConditions(): ConditionFlat[] {
  return [
    // 0: root over calldata
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: '0x' },
    // 1: arg0 positionIdList — every element must satisfy subtree [7]
    { parent: 0, paramType: ParameterType.Array, operator: Operator.ArrayEvery, compValue: '0x' },
    // 2: arg1 finalPositionIdList — unconstrained (holds user option positions)
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 3: arg2 positionSizes
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 4: arg3 tickAndSpreadLimits (int24[3][])
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    // 5: arg4 usePremiaAsCollateral
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 6: arg5 builderCode
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 7: positionIdList element (uint256 tokenId) — both width windows must be zero
    { parent: 1, paramType: ParameterType.None, operator: Operator.And, compValue: '0x' },
    // 8: finalPositionIdList element
    { parent: 2, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 9: positionSizes element
    { parent: 3, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    // 10: tickAndSpreadLimits element (int24[3] — statically encoded, 3 words)
    { parent: 4, paramType: ParameterType.Tuple, operator: Operator.Pass, compValue: '0x' },
    // 11-12: the two AND-ed bitmask windows over the tokenId
    {
      parent: 7,
      paramType: ParameterType.Static,
      operator: Operator.Bitmask,
      compValue: loanBitmaskCompValueAt(LOAN_BITMASK_WINDOW_SHIFTS[0]),
    },
    {
      parent: 7,
      paramType: ParameterType.Static,
      operator: Operator.Bitmask,
      compValue: loanBitmaskCompValueAt(LOAN_BITMASK_WINDOW_SHIFTS[1]),
    },
    // 13-15: int24[3] members
    { parent: 10, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    { parent: 10, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    { parent: 10, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
  ]
}

// ---------------------------------------------------------------------------
// Cross-pool scope: MultiSend unwrap + per-inner-call scopes.
//
// The bot batches [CT.withdraw, router.execute, CT.deposit] via Safe MultiSend,
// routed through Roles with a MultiSend unwrapper registered so each inner call
// is re-checked against these scopes. Selectors below are the inner targets.
// ---------------------------------------------------------------------------

/** ERC4626 CollateralTracker withdraw(uint256 assets, address receiver, address owner). */
export const WITHDRAW_SELECTOR = '0xb460af94' as const
/** ERC4626 CollateralTracker deposit(uint256 assets, address receiver). */
export const DEPOSIT_SELECTOR = '0x6e553f65' as const
/** Uniswap UniversalRouter execute(bytes,bytes[],uint256). */
export const EXECUTE_SELECTOR = '0x3593564c' as const

/**
 * Scope CT.withdraw so tokens can only be pulled to the Safe: receiver == owner
 * == Safe. Without this, a compromised bot key could withdraw the Safe's
 * collateral to an arbitrary address — this is the critical cross-pool scope.
 */
export function buildWithdrawConditions(safe: `0x${string}`): ConditionFlat[] {
  const safeEq = addressEqualCompValue(safe)
  return [
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: '0x' },
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' }, // assets
    { parent: 0, paramType: ParameterType.Static, operator: Operator.EqualTo, compValue: safeEq }, // receiver
    { parent: 0, paramType: ParameterType.Static, operator: Operator.EqualTo, compValue: safeEq }, // owner
  ]
}

/** Scope CT.deposit so the shares are credited to the Safe: receiver == Safe. */
export function buildDepositConditions(safe: `0x${string}`): ConditionFlat[] {
  return [
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: '0x' },
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' }, // assets
    {
      parent: 0,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: addressEqualCompValue(safe),
    }, // receiver
  ]
}
