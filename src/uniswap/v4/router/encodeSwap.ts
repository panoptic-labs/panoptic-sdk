/**
 * Pure calldata builders for exact-in and exact-out single-hop swaps via the
 * Uniswap v4 Universal Router.
 *
 * Opcodes verified against `@uniswap/universal-router` `Commands.sol` and
 * `@uniswap/v4-periphery` `Actions.sol`:
 * - Universal Router commands `V4_SWAP = 0x10`, `SWEEP = 0x04`.
 * - v4 actions `SWAP_EXACT_IN_SINGLE = 0x06`, `SWAP_EXACT_OUT_SINGLE = 0x08`,
 *   `SETTLE_ALL = 0x0c`, `TAKE = 0x0e`, `TAKE_ALL = 0x0f`.
 *
 * Native ETH is `address(0)` in the PoolKey and needs special handling per side:
 * - Native-ETH OUTPUT: the implicit-recipient `TAKE_ALL` leaves the bought ETH
 *   held by the Universal Router, so output is taken with the explicit-recipient
 *   `TAKE` action instead, delivering ETH straight to the recipient. No trailing
 *   SWEEP is appended for native output.
 * - Native-ETH INPUT on exact-out: the router is funded with the full
 *   `amountInMaximum` overpay, so a trailing Universal-Router-level `SWEEP`
 *   command (NOT the v4 SWEEP action, which this router does not support) refunds
 *   the unused ETH to the recipient.
 * Native-ETH input on exact-in needs neither (msg.value equals the exact input;
 * ERC20 output is delivered by `TAKE_ALL`).
 *
 * @module uniswap/v4/router/encodeSwap
 */

import type { Address, Hex } from 'viem'
import { encodeAbiParameters, encodeFunctionData, encodePacked, zeroAddress } from 'viem'

import type { PoolKey } from '../../../panoptic/v2/types'
import { universalRouterAbi } from '../abis/universalRouter'
import { AmountExceedsUint128Error, MissingSweepRecipientError } from './errors'

/** Universal Router command byte for a v4 swap. */
export const V4_SWAP = 0x10
/** v4 action: exact-in single-hop swap. */
export const SWAP_EXACT_IN_SINGLE = 0x06
/** v4 action: pay all of the input currency owed. */
export const SETTLE_ALL = 0x0c
/** v4 action: take all of the output currency owed. */
export const TAKE_ALL = 0x0f
/** v4 action: take an output currency to an explicit recipient. */
export const TAKE = 0x0e
/** v4 action: exact-out single-hop swap. */
export const SWAP_EXACT_OUT_SINGLE = 0x08
/** Universal Router command: sweep the router's token balance to a recipient. */
export const SWEEP = 0x04

/** v4 sentinel: take the full positive currency delta (used with TAKE). */
const OPEN_DELTA = 0n

const UINT128_MAX = (1n << 128n) - 1n

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const

const exactInputSingleParamsAbi = [
  {
    type: 'tuple',
    components: [
      { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ],
  },
] as const

const exactOutputSingleParamsAbi = [
  {
    type: 'tuple',
    components: [
      { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountOut', type: 'uint128' },
      { name: 'amountInMaximum', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ],
  },
] as const

const currencyAmountAbi = [
  { name: 'currency', type: 'address' },
  { name: 'amount', type: 'uint256' },
] as const

// v4 TAKE action params: take `amount` of `currency` to an explicit recipient.
const takeToRecipientAbi = [
  { name: 'currency', type: 'address' },
  { name: 'recipient', type: 'address' },
  { name: 'amount', type: 'uint256' },
] as const

// Universal Router SWEEP command params: forward `token` above `amountMin` to
// `recipient`.
const sweepParamsAbi = [
  { name: 'token', type: 'address' },
  { name: 'recipient', type: 'address' },
  { name: 'amountMin', type: 'uint256' },
] as const

function assertUint128(amount: bigint): void {
  if (amount < 0n || amount > UINT128_MAX) {
    throw new AmountExceedsUint128Error(amount)
  }
}

/**
 * Encode the input for a Universal Router `SWEEP` command that forwards the
 * router's full native-ETH balance (above `amountMin = 0`) to `recipient`.
 */
function encodeEthSweepInput(recipient: Address): Hex {
  return encodeAbiParameters(sweepParamsAbi, [zeroAddress, recipient, 0n])
}

/**
 * Build the output-take v4 action byte + param.
 *
 * Native-ETH output is taken with the explicit-recipient `TAKE` action so the
 * router forwards the ETH straight to `recipient` (the implicit-`msgSender`
 * `TAKE_ALL` leaves native ETH held by the router). ERC20 output uses
 * `TAKE_ALL`, which already credits the caller.
 *
 * @param nativeAmount - TAKE amount for native-ETH output: `OPEN_DELTA` (0) to
 *   take the full credit (exact-in, protected by the swap's min) or the exact
 *   output (exact-out).
 * @param erc20Amount - TAKE_ALL min/amount for ERC20 output: `amountOutMinimum`
 *   (exact-in) or the exact output (exact-out).
 */
function buildOutputTake(
  tokenOut: Address,
  recipient: Address | undefined,
  nativeAmount: bigint,
  erc20Amount: bigint,
): { action: number; param: Hex } {
  if (tokenOut === zeroAddress) {
    if (recipient === undefined) {
      throw new MissingSweepRecipientError()
    }
    return {
      action: TAKE,
      param: encodeAbiParameters(takeToRecipientAbi, [zeroAddress, recipient, nativeAmount]),
    }
  }
  return {
    action: TAKE_ALL,
    param: encodeAbiParameters(currencyAmountAbi, [tokenOut, erc20Amount]),
  }
}

/**
 * Arguments for {@link buildV4SwapExecuteCalldata}.
 */
export interface BuildV4SwapCalldataArgs {
  /** The v4 PoolKey (currency0, currency1, fee, tickSpacing, hooks). */
  poolKey: PoolKey
  /** Whether the swap goes currency0 → currency1. */
  zeroForOne: boolean
  /** Exact input amount (uint128). */
  amountIn: bigint
  /** Minimum acceptable output (uint128). */
  amountOutMinimum: bigint
  /** Input token address (`address(0)` for native ETH). */
  tokenIn: Address
  /** Output token address (`address(0)` for native ETH). */
  tokenOut: Address
  /** Absolute deadline (unix seconds). */
  deadline: bigint
  /**
   * Recipient of native-ETH output. Required when `tokenOut` is `address(0)`,
   * since the explicit-recipient `TAKE` action forwards the bought ETH there
   * (the implicit-recipient `TAKE_ALL` would leave it held by the router).
   */
  recipient?: Address
  /** Hook data; defaults to `0x` (hook-less pools). */
  hookData?: Hex
}

/**
 * Build the typed `execute(...)` args + msg.value for an exact-in single-hop v4
 * swap. Use this when submitting via viem (`writeContract` / `submitWrite`).
 *
 * When `tokenOut` is native ETH the explicit-recipient `TAKE` action forwards
 * the bought ETH to `recipient` (no trailing SWEEP is needed for exact-in).
 *
 * @returns `args` ready to spread into `execute` and the ETH `value` to send
 *   (= `amountIn` for native-ETH input, otherwise `0n`).
 */
export function buildV4SwapExecuteArgs(args: BuildV4SwapCalldataArgs): {
  args: readonly [Hex, readonly Hex[], bigint]
  value: bigint
} {
  const {
    poolKey,
    zeroForOne,
    amountIn,
    amountOutMinimum,
    tokenIn,
    tokenOut,
    deadline,
    recipient,
    hookData = '0x',
  } = args

  assertUint128(amountIn)
  assertUint128(amountOutMinimum)

  const swapParam = encodeAbiParameters(exactInputSingleParamsAbi, [
    {
      poolKey: {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: poolKey.hooks,
      },
      zeroForOne,
      amountIn,
      amountOutMinimum,
      hookData,
    },
  ])

  // SETTLE_ALL pays the input; the output take credits the recipient. Native-ETH
  // output uses the explicit-recipient TAKE so the router forwards the ETH (with
  // OPEN_DELTA to take the full, slippage-protected swap output).
  const settleParam = encodeAbiParameters(currencyAmountAbi, [tokenIn, amountIn])
  const take = buildOutputTake(tokenOut, recipient, OPEN_DELTA, amountOutMinimum)

  const actions = encodePacked(
    ['uint8', 'uint8', 'uint8'],
    [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, take.action],
  )

  const v4Input = encodeAbiParameters(
    [
      { name: 'actions', type: 'bytes' },
      { name: 'params', type: 'bytes[]' },
    ],
    [actions, [swapParam, settleParam, take.param]],
  )

  // Native-ETH input on exact-in needs no SWEEP (msg.value equals the exact input).
  const commands = encodePacked(['uint8'], [V4_SWAP])
  const value = tokenIn === zeroAddress ? amountIn : 0n

  return { args: [commands, [v4Input], deadline] as const, value }
}

/**
 * Build the `execute(commands, inputs, deadline)` calldata + msg.value for an
 * exact-in single-hop v4 swap.
 *
 * @returns The encoded calldata and the ETH `value` to send.
 */
export function buildV4SwapExecuteCalldata(args: BuildV4SwapCalldataArgs): {
  data: Hex
  value: bigint
} {
  const { args: executeArgs, value } = buildV4SwapExecuteArgs(args)
  const data = encodeFunctionData({
    abi: universalRouterAbi,
    functionName: 'execute',
    args: executeArgs,
  })
  return { data, value }
}

/**
 * Arguments for {@link buildV4ExactOutSwapExecuteCalldata}.
 */
export interface BuildV4ExactOutSwapCalldataArgs {
  /** The v4 PoolKey (currency0, currency1, fee, tickSpacing, hooks). */
  poolKey: PoolKey
  /** Whether the swap goes currency0 → currency1. */
  zeroForOne: boolean
  /** Exact output amount to receive (uint128). */
  amountOut: bigint
  /** Maximum acceptable input to spend (uint128). */
  amountInMaximum: bigint
  /** Input token address (`address(0)` for native ETH). */
  tokenIn: Address
  /** Output token address (`address(0)` for native ETH). */
  tokenOut: Address
  /** Absolute deadline (unix seconds). */
  deadline: bigint
  /**
   * Recipient of any swept native-ETH refund (only used for native-ETH input).
   * Must be the payer; the leftover `amountInMaximum - actualInput` is returned
   * here.
   */
  recipient: Address
  /** Hook data; defaults to `0x` (hook-less pools). */
  hookData?: Hex
}

/**
 * Build the typed `execute(...)` args + msg.value for an exact-out single-hop v4
 * swap. Use this when submitting via viem (`writeContract` / `submitWrite`).
 *
 * For native-ETH input, `value` is `amountInMaximum` (an overpay) and a trailing
 * `SWEEP` action refunds the unused ETH to `recipient`. For ERC20 input, Permit2
 * pulls only the settled amount, so no SWEEP is appended and `value` is `0n`.
 *
 * @returns `args` ready to spread into `execute` and the ETH `value` to send.
 */
export function buildV4ExactOutSwapExecuteArgs(args: BuildV4ExactOutSwapCalldataArgs): {
  args: readonly [Hex, readonly Hex[], bigint]
  value: bigint
} {
  const {
    poolKey,
    zeroForOne,
    amountOut,
    amountInMaximum,
    tokenIn,
    tokenOut,
    deadline,
    recipient,
    hookData = '0x',
  } = args

  assertUint128(amountOut)
  assertUint128(amountInMaximum)

  const swapParam = encodeAbiParameters(exactOutputSingleParamsAbi, [
    {
      poolKey: {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: poolKey.hooks,
      },
      zeroForOne,
      amountOut,
      amountInMaximum,
      hookData,
    },
  ])

  // SETTLE_ALL caps the input at amountInMaximum; the output take delivers the
  // exact output. Native-ETH output uses the explicit-recipient TAKE so the
  // router forwards the ETH straight to `recipient`.
  const settleParam = encodeAbiParameters(currencyAmountAbi, [tokenIn, amountInMaximum])
  const take = buildOutputTake(tokenOut, recipient, amountOut, amountOut)

  const actions = encodePacked(
    ['uint8', 'uint8', 'uint8'],
    [SWAP_EXACT_OUT_SINGLE, SETTLE_ALL, take.action],
  )

  const v4Input = encodeAbiParameters(
    [
      { name: 'actions', type: 'bytes' },
      { name: 'params', type: 'bytes[]' },
    ],
    [actions, [swapParam, settleParam, take.param]],
  )

  const isNativeIn = tokenIn === zeroAddress

  // Native-ETH input funds the router with the full overpay cap; a trailing
  // Universal Router SWEEP command (the v4 SWEEP *action* is unsupported here)
  // refunds the unused ETH to the recipient.
  const commandList: number[] = [V4_SWAP]
  const inputs: Hex[] = [v4Input]
  if (isNativeIn) {
    commandList.push(SWEEP)
    inputs.push(encodeEthSweepInput(recipient))
  }

  const commands = encodePacked(
    commandList.map(() => 'uint8'),
    commandList,
  )
  const value = isNativeIn ? amountInMaximum : 0n

  return { args: [commands, inputs, deadline] as const, value }
}

/**
 * Build the `execute(commands, inputs, deadline)` calldata + msg.value for an
 * exact-out single-hop v4 swap.
 *
 * @returns The encoded calldata and the ETH `value` to send.
 */
export function buildV4ExactOutSwapExecuteCalldata(args: BuildV4ExactOutSwapCalldataArgs): {
  data: Hex
  value: bigint
} {
  const { args: executeArgs, value } = buildV4ExactOutSwapExecuteArgs(args)
  const data = encodeFunctionData({
    abi: universalRouterAbi,
    functionName: 'execute',
    args: executeArgs,
  })
  return { data, value }
}
