import { type Hex, toFunctionSelector, zeroHash } from 'viem'

import type { ScopeStep } from '../applySteps'
import { type ConditionFlat, addressEqualCompValue, customCompValue } from '../conditions'
import { ExecutionOptions, Operator, ParameterType } from '../constants'
import { buildDepositConditions, DEPOSIT_SELECTOR } from './loanHedger'

/** SFPM `multicall(bytes[])`. */
export const MULTICALL_SELECTOR = toFunctionSelector('multicall(bytes[])')
/** Safe `MultiSend.multiSend(bytes)` — the batch entrypoint the Roles unwrapper is registered for. */
export const MULTISEND_SELECTOR = toFunctionSelector('multiSend(bytes)')
/** WETH9 `deposit()` (wrap native ETH → WETH; payable). */
export const WETH_DEPOSIT_SELECTOR = toFunctionSelector('deposit()')
/** WETH9 `withdraw(uint256)` (unwrap WETH → native ETH). */
export const WETH_WITHDRAW_SELECTOR = toFunctionSelector('withdraw(uint256)')
/** Panoptic CT solvency-aware withdrawal used while the Safe has open positions. */
export const WITHDRAW_WITH_POSITIONS_SELECTOR = toFunctionSelector(
  'withdraw(uint256,address,address,uint256[],bool)',
)

/**
 * Scope the solvency-aware CT withdrawal to the Safe and to the conservative
 * `usePremiaAsCollateral=false` mode. The position list remains dynamic because
 * it must exactly match the Safe's live Panoptic portfolio.
 */
export function buildWithdrawWithPositionsConditions(safe: `0x${string}`): ConditionFlat[] {
  const safeEq = addressEqualCompValue(safe)
  return [
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: '0x' },
    { parent: 0, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
    {
      parent: 0,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: safeEq,
    },
    {
      parent: 0,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: safeEq,
    },
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Pass, compValue: '0x' },
    {
      parent: 0,
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: zeroHash,
    },
    { parent: 4, paramType: ParameterType.Static, operator: Operator.Pass, compValue: '0x' },
  ]
}

/**
 * Encode a `uint64` SFPM poolId as the `bytes12 extra` of the SfpmSwapCondition
 * compValue. The adapter reads it as `uint64(uint96(extra))`, i.e. big-endian
 * right-aligned in the 12 bytes (same convention as `sizeCapExtra`).
 */
export function sfpmPoolIdPinExtra(poolId: bigint): Hex {
  if (poolId <= 0n || poolId >= 1n << 64n) {
    throw new Error(`sfpmPoolIdPinExtra: poolId must be a nonzero uint64, got ${poolId}`)
  }
  return `0x${poolId.toString(16).padStart(24, '0')}` as Hex
}

/**
 * ConditionFlat tree scoping `SFPM.multicall(bytes[])` to the SfpmSwapCondition
 * adapter. The whole check lives in the adapter (Operator.Custom on arg0); the
 * other nodes are the structural template Integrity.sol requires — a Calldata
 * root and the `bytes[]` array with its element type.
 */
export function buildSfpmSwapConditions(
  adapter: `0x${string}`,
  poolIdPin: bigint,
): ConditionFlat[] {
  const compValue = customCompValue(adapter, sfpmPoolIdPinExtra(poolIdPin))
  return [
    // 0: root over calldata
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: '0x' },
    // 1: arg0 bytes[] — carries the Custom adapter check
    { parent: 0, paramType: ParameterType.Array, operator: Operator.Custom, compValue },
    // 2: array element type (bytes → Dynamic)
    { parent: 1, paramType: ParameterType.Dynamic, operator: Operator.Pass, compValue: '0x' },
  ]
}

/**
 * Steps that extend an existing bot role with the off-venue SFPM swap surface.
 *
 * The bot batches `[CT(tokenIn).withdraw(with position list),
 * SFPM.multicall(mint+burn), CT(tokenOut).deposit]`
 * via Safe MultiSend, routed through Roles with a MultiSend unwrapper registered
 * so each inner call is re-checked against the scopes below.
 *
 * Reuses the existing bot `roleKey` (no `assignRoles`) — `execTransactionWithRole`
 * authorizes one role per tx and the batch mixes CT + SFPM calls, so all inner
 * calls must live under one key. The loan-only dispatch scope on that role is
 * orthogonal and unchanged.
 *
 * `setTransactionUnwrapper` is **modifier-global**, not per-role: registering it
 * affects every role on the modifier.
 */
export function buildSfpmSwapVenueSteps(params: {
  roleKey: Hex
  safe: `0x${string}`
  sfpm: `0x${string}`
  /** CollateralTracker for token0. */
  collateralTracker0: `0x${string}`
  /** CollateralTracker for token1. */
  collateralTracker1: `0x${string}`
  /** Deployed SfpmSwapCondition (stateless, canonical per chain). */
  adapter: `0x${string}`
  /** The registered `uint64` SFPM poolId of the allowed swap pool. */
  poolIdPin: bigint
  /** Safe MultiSendCallOnly address (the batch entrypoint). */
  multiSendCallOnly: `0x${string}`
  /** Canonical MultiSend unwrapper adapter for this chain. */
  multiSendUnwrapper: `0x${string}`
  /**
   * Which collateral asset is native ETH (its CT `deposit` is payable and needs
   * value; the batch wraps/unwraps around the swap). `'none'` for two-ERC20 pools.
   */
  nativeCollateral?: 'token0' | 'token1' | 'none'
  /** WETH9 address — required when `nativeCollateral` is not `'none'`. */
  weth9?: `0x${string}`
}): ScopeStep[] {
  const {
    roleKey,
    safe,
    sfpm,
    collateralTracker0,
    collateralTracker1,
    adapter,
    poolIdPin,
    multiSendCallOnly,
    multiSendUnwrapper,
  } = params
  const nativeCollateral = params.nativeCollateral ?? 'none'

  // The native-ETH CT's deposit is payable (deposit by sending value), so it
  // needs ExecutionOptions.Send; ERC20 CT deposits take no value.
  const depositOptions = (side: 'token0' | 'token1') =>
    nativeCollateral === side ? ExecutionOptions.Send : ExecutionOptions.None

  const scopeCollateralTracker = (
    ct: `0x${string}`,
    side: 'token0' | 'token1',
    label: string,
  ): ScopeStep[] => [
    { name: `scopeTarget(${label})`, functionName: 'scopeTarget', args: [roleKey, ct] },
    {
      name: `scopeFunction(${label}.withdraw(with positions) → Safe)`,
      functionName: 'scopeFunction',
      args: [
        roleKey,
        ct,
        WITHDRAW_WITH_POSITIONS_SELECTOR,
        buildWithdrawWithPositionsConditions(safe),
        ExecutionOptions.None,
      ],
    },
    {
      name: `scopeFunction(${label}.deposit → Safe)`,
      functionName: 'scopeFunction',
      args: [roleKey, ct, DEPOSIT_SELECTOR, buildDepositConditions(safe), depositOptions(side)],
    },
  ]

  const steps: ScopeStep[] = [
    {
      name: 'setTransactionUnwrapper(MultiSend)',
      functionName: 'setTransactionUnwrapper',
      args: [multiSendCallOnly, MULTISEND_SELECTOR, multiSendUnwrapper],
    },
    { name: 'scopeTarget(SFPM)', functionName: 'scopeTarget', args: [roleKey, sfpm] },
    {
      name: 'scopeFunction(SFPM.multicall, SfpmSwapCondition)',
      functionName: 'scopeFunction',
      args: [
        roleKey,
        sfpm,
        MULTICALL_SELECTOR,
        buildSfpmSwapConditions(adapter, poolIdPin),
        ExecutionOptions.None,
      ],
    },
    ...scopeCollateralTracker(collateralTracker0, 'token0', 'CT0'),
    ...scopeCollateralTracker(collateralTracker1, 'token1', 'CT1'),
  ]

  // Bridge native ETH ↔ WETH around the v3 swap when a collateral asset is native.
  if (nativeCollateral !== 'none') {
    if (params.weth9 === undefined) {
      throw new Error('buildSfpmSwapVenueSteps: weth9 is required when nativeCollateral is set')
    }
    steps.push(
      { name: 'scopeTarget(WETH9)', functionName: 'scopeTarget', args: [roleKey, params.weth9] },
      {
        name: 'allowFunction(WETH9.deposit, Send)',
        functionName: 'allowFunction',
        args: [roleKey, params.weth9, WETH_DEPOSIT_SELECTOR, ExecutionOptions.Send],
      },
      {
        name: 'allowFunction(WETH9.withdraw)',
        functionName: 'allowFunction',
        args: [roleKey, params.weth9, WETH_WITHDRAW_SELECTOR, ExecutionOptions.None],
      },
    )
  }

  return steps
}
