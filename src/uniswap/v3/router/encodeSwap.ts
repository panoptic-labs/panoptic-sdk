/**
 * Pure calldata builder for an exact-in single-hop swap through a Uniswap **v3**
 * pool via the Universal Router.
 *
 * Opcodes verified against `@uniswap/universal-router` `Commands.sol`:
 * - Universal Router command `V3_SWAP_EXACT_IN = 0x00`.
 *
 * The v3 command input is (unlike the v4 action list) a single flat tuple:
 *   `(address recipient, uint256 amountIn, uint256 amountOutMinimum,
 *     bytes path, bool payerIsUser)`
 * where:
 * - `recipient` is an EXPLICIT field. We encode the Universal Router sentinel
 *   `MSG_SENDER = address(1)`, which the router maps to the `execute` caller —
 *   so the output is delivered to the caller (e.g. a Safe) with no literal
 *   address in the calldata to redirect.
 * - `path` is `abi.encodePacked(tokenIn, fee (uint24), tokenOut)` for a single
 *   hop (43 bytes). The direction lives in the path ordering, not a bool.
 * - `payerIsUser = true`: the router pulls `tokenIn` from the caller via Permit2.
 *
 * ERC20-only: native ETH is intentionally unsupported here (the native paths
 * need WRAP/UNWRAP/SWEEP commands with explicit recipients).
 *
 * @module uniswap/v3/router/encodeSwap
 */

import type { Address, Hex } from 'viem'
import { encodeAbiParameters, encodeFunctionData, encodePacked, zeroAddress } from 'viem'

import { PanopticError } from '../../../panoptic/v2/errors'
import { universalRouterAbi } from '../../v4/abis/universalRouter'
import { AmountExceedsUint128Error } from '../../v4/router/errors'

/** Universal Router command byte for a v3 exact-in swap. */
export const V3_SWAP_EXACT_IN = 0x00

/**
 * Universal Router recipient sentinel: the router maps `address(1)` to
 * `msg.sender` (the `execute` caller). Uniswap `Constants.MSG_SENDER`.
 */
export const MSG_SENDER: Address = '0x0000000000000000000000000000000000000001'

const UINT128_MAX = (1n << 128n) - 1n

const v3ExactInInputAbi = [
  { name: 'recipient', type: 'address' },
  { name: 'amountIn', type: 'uint256' },
  { name: 'amountOutMinimum', type: 'uint256' },
  { name: 'path', type: 'bytes' },
  { name: 'payerIsUser', type: 'bool' },
] as const

function assertUint128(amount: bigint): void {
  if (amount < 0n || amount > UINT128_MAX) {
    throw new AmountExceedsUint128Error(amount)
  }
}

/** Arguments for {@link buildV3SwapExecuteCalldata}. */
export interface BuildV3SwapCalldataArgs {
  /** Input token (funds pulled from the caller via Permit2). */
  tokenIn: Address
  /** Output token. */
  tokenOut: Address
  /** v3 pool fee tier (e.g. 500, 3000). */
  fee: bigint
  /** Exact input amount (uint128). */
  amountIn: bigint
  /** Minimum acceptable output (uint128). */
  amountOutMinimum: bigint
  /**
   * Absolute deadline (unix seconds) — the `execute(commands, inputs, deadline)`
   * argument, enforced by the Universal Router.
   */
  deadline: bigint
}

/**
 * Encode the packed v3 single-hop path `tokenIn ++ fee(uint24) ++ tokenOut`.
 */
export function encodeV3Path(tokenIn: Address, fee: bigint, tokenOut: Address): Hex {
  if (fee < 0n || fee > 0xffffffn) {
    throw new PanopticError(`v3 fee ${fee} exceeds uint24`)
  }
  return encodePacked(['address', 'uint24', 'address'], [tokenIn, Number(fee), tokenOut])
}

/**
 * Build the typed `execute(...)` args for an exact-in single-hop v3 swap whose
 * output is delivered to the `execute` caller (recipient = MSG_SENDER).
 */
export function buildV3SwapExecuteArgs(args: BuildV3SwapCalldataArgs): {
  args: readonly [Hex, readonly Hex[], bigint]
  value: bigint
} {
  const { tokenIn, tokenOut, fee, amountIn, amountOutMinimum, deadline } = args

  if (tokenIn === zeroAddress || tokenOut === zeroAddress) {
    throw new PanopticError('native ETH is not supported by the v3 exact-in router builder')
  }
  assertUint128(amountIn)
  assertUint128(amountOutMinimum)

  const path = encodeV3Path(tokenIn, fee, tokenOut)
  const input = encodeAbiParameters(v3ExactInInputAbi, [
    MSG_SENDER,
    amountIn,
    amountOutMinimum,
    path,
    true, // payerIsUser: pull tokenIn from the caller via Permit2
  ])

  const commands = encodePacked(['uint8'], [V3_SWAP_EXACT_IN])
  return { args: [commands, [input], deadline] as const, value: 0n }
}

/**
 * Build the `execute(commands, inputs, deadline)` calldata for an exact-in
 * single-hop v3 swap.
 */
export function buildV3SwapExecuteCalldata(args: BuildV3SwapCalldataArgs): {
  data: Hex
  value: bigint
} {
  const { args: executeArgs, value } = buildV3SwapExecuteArgs(args)
  const data = encodeFunctionData({
    abi: universalRouterAbi,
    functionName: 'execute',
    args: executeArgs,
  })
  return { data, value }
}
