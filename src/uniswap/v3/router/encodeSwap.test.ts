/**
 * Unit tests for the v3 Universal Router exact-in swap calldata builder.
 * @module uniswap/v3/router/encodeSwap.test
 */

import type { Address } from 'viem'
import { decodeAbiParameters, decodeFunctionData, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { universalRouterAbi } from '../../v4/abis/universalRouter'
import {
  buildV3SwapExecuteArgs,
  buildV3SwapExecuteCalldata,
  encodeV3Path,
  MSG_SENDER,
  V3_SWAP_EXACT_IN,
} from './encodeSwap'

const TOKEN_A: Address = '0xaaaa000000000000000000000000000000000000'
const TOKEN_B: Address = '0xbbbb000000000000000000000000000000000000'

const inputAbi = [
  { name: 'recipient', type: 'address' },
  { name: 'amountIn', type: 'uint256' },
  { name: 'amountOutMinimum', type: 'uint256' },
  { name: 'path', type: 'bytes' },
  { name: 'payerIsUser', type: 'bool' },
] as const

describe('buildV3SwapExecuteArgs', () => {
  it('emits a single V3_SWAP_EXACT_IN command with the caller as recipient', () => {
    const { args, value } = buildV3SwapExecuteArgs({
      tokenIn: TOKEN_A,
      tokenOut: TOKEN_B,
      fee: 500n,
      amountIn: 1000n,
      amountOutMinimum: 990n,
      deadline: 42n,
    })
    const [commands, inputs, deadline] = args
    expect(commands).toBe(`0x${V3_SWAP_EXACT_IN.toString(16).padStart(2, '0')}`)
    expect(inputs).toHaveLength(1)
    expect(deadline).toBe(42n)
    expect(value).toBe(0n)

    const [recipient, amountIn, minOut, path, payerIsUser] = decodeAbiParameters(
      inputAbi,
      inputs[0],
    )
    expect(recipient.toLowerCase()).toBe(MSG_SENDER) // output goes to the execute caller
    expect(amountIn).toBe(1000n)
    expect(minOut).toBe(990n)
    expect(payerIsUser).toBe(true)
    expect(path.toLowerCase()).toBe(encodeV3Path(TOKEN_A, 500n, TOKEN_B).toLowerCase())
  })

  it('encodes the path direction (tokenIn|fee|tokenOut) — 43 bytes', () => {
    const path = encodeV3Path(TOKEN_A, 3000n, TOKEN_B)
    expect(path.slice(2).length / 2).toBe(43)
    // tokenIn(20) ++ fee(3, big-endian 3000 = 0x000bb8) ++ tokenOut(20)
    expect(path.toLowerCase()).toBe(
      `0x${TOKEN_A.slice(2).toLowerCase()}000bb8${TOKEN_B.slice(2).toLowerCase()}`,
    )
    // reversed direction differs
    expect(encodeV3Path(TOKEN_B, 3000n, TOKEN_A)).not.toBe(path)
  })

  it('round-trips through execute() calldata', () => {
    const { data } = buildV3SwapExecuteCalldata({
      tokenIn: TOKEN_A,
      tokenOut: TOKEN_B,
      fee: 500n,
      amountIn: 5n,
      amountOutMinimum: 1n,
      deadline: 9n,
    })
    const decoded = decodeFunctionData({ abi: universalRouterAbi, data })
    expect(decoded.functionName).toBe('execute')
  })

  it('rejects native ETH and oversized amounts/fee', () => {
    const base = {
      tokenIn: TOKEN_A,
      tokenOut: TOKEN_B,
      fee: 500n,
      amountIn: 1n,
      amountOutMinimum: 1n,
      deadline: 1n,
    }
    expect(() => buildV3SwapExecuteArgs({ ...base, tokenIn: zeroAddress })).toThrow(/native ETH/)
    expect(() => buildV3SwapExecuteArgs({ ...base, tokenOut: zeroAddress })).toThrow(/native ETH/)
    expect(() => buildV3SwapExecuteArgs({ ...base, amountIn: 1n << 129n })).toThrow()
    expect(() => encodeV3Path(TOKEN_A, 1n << 25n, TOKEN_B)).toThrow(/uint24/)
  })
})
