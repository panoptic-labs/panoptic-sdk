/* eslint-disable @typescript-eslint/no-non-null-assertion -- decoded array indices are known-present in these fixtures */
/**
 * Unit tests for the v4 Universal Router swap calldata builder.
 * @module uniswap/v4/router/encodeSwap.test
 */

import { decodeAbiParameters, decodeFunctionData, slice, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import type { PoolKey } from '../../../panoptic/v2/types'
import { universalRouterAbi } from '../abis/universalRouter'
import {
  buildV4ExactOutSwapExecuteArgs,
  buildV4ExactOutSwapExecuteCalldata,
  buildV4SwapExecuteArgs,
  buildV4SwapExecuteCalldata,
  SETTLE_ALL,
  SWAP_EXACT_IN_SINGLE,
  SWAP_EXACT_OUT_SINGLE,
  SWEEP,
  TAKE,
  TAKE_ALL,
  V4_SWAP,
} from './encodeSwap'
import { AmountExceedsUint128Error, MissingSweepRecipientError } from './errors'

const USDC: `0x${string}` = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const RECIPIENT: `0x${string}` = '0x1111111111111111111111111111111111111111'

// Native-ETH ETH/USDC 0.30% style pool key (currency0 = ETH = address(0)).
const POOL_KEY: PoolKey = {
  currency0: zeroAddress,
  currency1: USDC,
  fee: 3000n,
  tickSpacing: 60n,
  hooks: zeroAddress,
}

const swapParamsTuple = [
  {
    type: 'tuple',
    components: [
      {
        name: 'poolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ],
  },
] as const

const currencyAmountTuple = [
  { name: 'currency', type: 'address' },
  { name: 'amount', type: 'uint256' },
] as const

const v4InputTuple = [
  { name: 'actions', type: 'bytes' },
  { name: 'params', type: 'bytes[]' },
] as const

const exactOutSwapParamsTuple = [
  {
    type: 'tuple',
    components: [
      {
        name: 'poolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountOut', type: 'uint128' },
      { name: 'amountInMaximum', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ],
  },
] as const

const sweepParamsTuple = [
  { name: 'token', type: 'address' },
  { name: 'recipient', type: 'address' },
  { name: 'amountMin', type: 'uint256' },
] as const

const takeParamsTuple = [
  { name: 'currency', type: 'address' },
  { name: 'recipient', type: 'address' },
  { name: 'amount', type: 'uint256' },
] as const

const toByte = (n: number) => n.toString(16).padStart(2, '0')

// ERC20/ERC20 pool (no native ETH on either side) for the no-SWEEP case.
const DAI: `0x${string}` = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const ERC20_POOL_KEY: PoolKey = {
  currency0: DAI,
  currency1: USDC,
  fee: 100n,
  tickSpacing: 1n,
  hooks: zeroAddress,
}

describe('buildV4SwapExecuteArgs', () => {
  it('encodes ETH→USDC (zeroForOne, native value) correctly', () => {
    const amountIn = 10n ** 17n // 0.1 ETH
    const amountOutMinimum = 250_000_000n // 250 USDC

    const { args, value } = buildV4SwapExecuteArgs({
      poolKey: POOL_KEY,
      zeroForOne: true,
      amountIn,
      amountOutMinimum,
      tokenIn: zeroAddress,
      tokenOut: USDC,
      deadline: 1_700_000_000n,
    })

    // Native ETH input → msg.value carries the amount.
    expect(value).toBe(amountIn)

    const [commands, inputs, deadline] = args
    expect(commands).toBe(`0x${V4_SWAP.toString(16).padStart(2, '0')}`)
    expect(inputs).toHaveLength(1)
    expect(deadline).toBe(1_700_000_000n)

    const [actions, params] = decodeAbiParameters(v4InputTuple, inputs[0]!)
    // actions = packed [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]
    expect(actions).toBe(
      `0x${toByte(SWAP_EXACT_IN_SINGLE)}${toByte(SETTLE_ALL)}${toByte(TAKE_ALL)}`,
    )
    expect(params).toHaveLength(3)

    const [swap] = decodeAbiParameters(swapParamsTuple, params[0]!)
    expect(swap.poolKey.currency0).toBe(zeroAddress)
    expect(swap.poolKey.currency1.toLowerCase()).toBe(USDC.toLowerCase())
    expect(swap.poolKey.fee).toBe(3000)
    expect(swap.poolKey.tickSpacing).toBe(60)
    expect(swap.zeroForOne).toBe(true)
    expect(swap.amountIn).toBe(amountIn)
    expect(swap.amountOutMinimum).toBe(amountOutMinimum)
    expect(swap.hookData).toBe('0x')

    const [settleCurrency, settleAmount] = decodeAbiParameters(currencyAmountTuple, params[1]!)
    expect(settleCurrency).toBe(zeroAddress)
    expect(settleAmount).toBe(amountIn)

    const [takeCurrency, takeAmount] = decodeAbiParameters(currencyAmountTuple, params[2]!)
    expect(takeCurrency.toLowerCase()).toBe(USDC.toLowerCase())
    expect(takeAmount).toBe(amountOutMinimum)
  })

  it('encodes USDC→ETH (oneForZero) taking the ETH straight to the recipient', () => {
    const { args, value } = buildV4SwapExecuteArgs({
      poolKey: POOL_KEY,
      zeroForOne: false,
      amountIn: 250_000_000n,
      amountOutMinimum: 9n * 10n ** 16n,
      tokenIn: USDC,
      tokenOut: zeroAddress,
      deadline: 1_700_000_000n,
      recipient: RECIPIENT,
    })

    // ERC20 input → no msg.value; native output uses the explicit-recipient TAKE,
    // so no trailing command is needed.
    expect(value).toBe(0n)

    const [commands, inputs] = args
    expect(commands).toBe(`0x${toByte(V4_SWAP)}`)
    expect(inputs).toHaveLength(1)

    const [actions, params] = decodeAbiParameters(v4InputTuple, inputs[0]!)
    // v4 actions = packed [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE]
    expect(actions).toBe(`0x${toByte(SWAP_EXACT_IN_SINGLE)}${toByte(SETTLE_ALL)}${toByte(TAKE)}`)
    expect(params).toHaveLength(3)

    const [swap] = decodeAbiParameters(swapParamsTuple, params[0]!)
    expect(swap.zeroForOne).toBe(false)

    const [settleCurrency] = decodeAbiParameters(currencyAmountTuple, params[1]!)
    expect(settleCurrency.toLowerCase()).toBe(USDC.toLowerCase())

    // TAKE delivers the full ETH credit (OPEN_DELTA = 0) to the recipient.
    const [takeCurrency, takeRecipient, takeAmount] = decodeAbiParameters(
      takeParamsTuple,
      params[2]!,
    )
    expect(takeCurrency).toBe(zeroAddress)
    expect(takeRecipient.toLowerCase()).toBe(RECIPIENT.toLowerCase())
    expect(takeAmount).toBe(0n)
  })

  it('throws when native-ETH output has no recipient', () => {
    expect(() =>
      buildV4SwapExecuteArgs({
        poolKey: POOL_KEY,
        zeroForOne: false,
        amountIn: 250_000_000n,
        amountOutMinimum: 1n,
        tokenIn: USDC,
        tokenOut: zeroAddress,
        deadline: 1n,
      }),
    ).toThrow(MissingSweepRecipientError)
  })

  it('rejects amounts exceeding uint128', () => {
    const over = 1n << 128n
    expect(() =>
      buildV4SwapExecuteArgs({
        poolKey: POOL_KEY,
        zeroForOne: true,
        amountIn: over,
        amountOutMinimum: 0n,
        tokenIn: zeroAddress,
        tokenOut: USDC,
        deadline: 1n,
      }),
    ).toThrow(AmountExceedsUint128Error)
  })
})

describe('buildV4SwapExecuteCalldata', () => {
  it('produces decodable execute() calldata with the V4_SWAP command', () => {
    const { data, value } = buildV4SwapExecuteCalldata({
      poolKey: POOL_KEY,
      zeroForOne: true,
      amountIn: 10n ** 17n,
      amountOutMinimum: 1n,
      tokenIn: zeroAddress,
      tokenOut: USDC,
      deadline: 42n,
    })

    expect(value).toBe(10n ** 17n)

    const decoded = decodeFunctionData({ abi: universalRouterAbi, data })
    expect(decoded.functionName).toBe('execute')
    const [commands, inputs, deadline] = decoded.args
    // First (only) command byte is V4_SWAP.
    expect(slice(commands, 0, 1)).toBe(`0x${V4_SWAP.toString(16).padStart(2, '0')}`)
    expect(inputs).toHaveLength(1)
    expect(deadline).toBe(42n)
  })
})

describe('buildV4ExactOutSwapExecuteArgs', () => {
  it('encodes ETH→exact-USDC-out with a trailing SWEEP and native value', () => {
    const amountOut = 250_000_000n // exactly 250 USDC out
    const amountInMaximum = 105n * 10n ** 15n // 0.105 ETH cap

    const { args, value } = buildV4ExactOutSwapExecuteArgs({
      poolKey: POOL_KEY,
      zeroForOne: true,
      amountOut,
      amountInMaximum,
      tokenIn: zeroAddress,
      tokenOut: USDC,
      deadline: 1_700_000_000n,
      recipient: RECIPIENT,
    })

    // Native ETH input → msg.value carries the overpay cap.
    expect(value).toBe(amountInMaximum)

    const [commands, inputs, deadline] = args
    // V4_SWAP then a Universal Router SWEEP to refund the unused ETH overpay.
    expect(commands).toBe(`0x${toByte(V4_SWAP)}${toByte(SWEEP)}`)
    expect(inputs).toHaveLength(2)
    expect(deadline).toBe(1_700_000_000n)

    const [actions, params] = decodeAbiParameters(v4InputTuple, inputs[0]!)
    // v4 actions = packed [SWAP_EXACT_OUT_SINGLE, SETTLE_ALL, TAKE_ALL]
    expect(actions).toBe(
      `0x${toByte(SWAP_EXACT_OUT_SINGLE)}${toByte(SETTLE_ALL)}${toByte(TAKE_ALL)}`,
    )
    expect(params).toHaveLength(3)

    const [swap] = decodeAbiParameters(exactOutSwapParamsTuple, params[0]!)
    expect(swap.poolKey.currency0).toBe(zeroAddress)
    expect(swap.poolKey.currency1.toLowerCase()).toBe(USDC.toLowerCase())
    expect(swap.zeroForOne).toBe(true)
    expect(swap.amountOut).toBe(amountOut)
    expect(swap.amountInMaximum).toBe(amountInMaximum)
    expect(swap.hookData).toBe('0x')

    // SETTLE_ALL caps the input; TAKE_ALL delivers the exact output.
    const [settleCurrency, settleAmount] = decodeAbiParameters(currencyAmountTuple, params[1]!)
    expect(settleCurrency).toBe(zeroAddress)
    expect(settleAmount).toBe(amountInMaximum)

    const [takeCurrency, takeAmount] = decodeAbiParameters(currencyAmountTuple, params[2]!)
    expect(takeCurrency.toLowerCase()).toBe(USDC.toLowerCase())
    expect(takeAmount).toBe(amountOut)

    // The Universal Router SWEEP command refunds unused native ETH to the recipient.
    const [sweepToken, sweepRecipient, sweepMin] = decodeAbiParameters(sweepParamsTuple, inputs[1]!)
    expect(sweepToken).toBe(zeroAddress)
    expect(sweepRecipient.toLowerCase()).toBe(RECIPIENT.toLowerCase())
    expect(sweepMin).toBe(0n)
  })

  it('encodes USDC→exact-ETH-out taking the exact ETH to the recipient', () => {
    const amountOut = 9n * 10n ** 16n
    const { args, value } = buildV4ExactOutSwapExecuteArgs({
      poolKey: POOL_KEY,
      zeroForOne: false,
      amountOut,
      amountInMaximum: 260_000_000n,
      tokenIn: USDC,
      tokenOut: zeroAddress,
      deadline: 1_700_000_000n,
      recipient: RECIPIENT,
    })

    // ERC20 input → no msg.value; native output uses the explicit-recipient TAKE,
    // so no trailing SWEEP command is needed.
    expect(value).toBe(0n)

    const [commands, inputs] = args
    expect(commands).toBe(`0x${toByte(V4_SWAP)}`)
    expect(inputs).toHaveLength(1)

    const [actions, params] = decodeAbiParameters(v4InputTuple, inputs[0]!)
    expect(actions).toBe(`0x${toByte(SWAP_EXACT_OUT_SINGLE)}${toByte(SETTLE_ALL)}${toByte(TAKE)}`)
    expect(params).toHaveLength(3)

    const [swap] = decodeAbiParameters(exactOutSwapParamsTuple, params[0]!)
    expect(swap.zeroForOne).toBe(false)

    const [settleCurrency] = decodeAbiParameters(currencyAmountTuple, params[1]!)
    expect(settleCurrency.toLowerCase()).toBe(USDC.toLowerCase())

    // TAKE delivers exactly amountOut of ETH to the recipient.
    const [takeCurrency, takeRecipient, takeAmount] = decodeAbiParameters(
      takeParamsTuple,
      params[2]!,
    )
    expect(takeCurrency).toBe(zeroAddress)
    expect(takeRecipient.toLowerCase()).toBe(RECIPIENT.toLowerCase())
    expect(takeAmount).toBe(amountOut)
  })

  it('encodes an ERC20→ERC20 exact-out swap without any SWEEP', () => {
    const { args, value } = buildV4ExactOutSwapExecuteArgs({
      poolKey: ERC20_POOL_KEY,
      zeroForOne: true,
      amountOut: 250_000_000n,
      amountInMaximum: 260n * 10n ** 18n,
      tokenIn: DAI,
      tokenOut: USDC,
      deadline: 1_700_000_000n,
      recipient: RECIPIENT,
    })

    // No native ETH on either side → no SWEEP, no msg.value.
    expect(value).toBe(0n)

    const [commands, inputs] = args
    expect(commands).toBe(`0x${toByte(V4_SWAP)}`)
    expect(inputs).toHaveLength(1)

    const [actions, params] = decodeAbiParameters(v4InputTuple, inputs[0]!)
    expect(actions).toBe(
      `0x${toByte(SWAP_EXACT_OUT_SINGLE)}${toByte(SETTLE_ALL)}${toByte(TAKE_ALL)}`,
    )
    expect(params).toHaveLength(3)
  })

  it('rejects amounts exceeding uint128', () => {
    const over = 1n << 128n
    expect(() =>
      buildV4ExactOutSwapExecuteArgs({
        poolKey: POOL_KEY,
        zeroForOne: true,
        amountOut: over,
        amountInMaximum: 0n,
        tokenIn: zeroAddress,
        tokenOut: USDC,
        deadline: 1n,
        recipient: RECIPIENT,
      }),
    ).toThrow(AmountExceedsUint128Error)
    expect(() =>
      buildV4ExactOutSwapExecuteArgs({
        poolKey: POOL_KEY,
        zeroForOne: true,
        amountOut: 1n,
        amountInMaximum: over,
        tokenIn: zeroAddress,
        tokenOut: USDC,
        deadline: 1n,
        recipient: RECIPIENT,
      }),
    ).toThrow(AmountExceedsUint128Error)
  })
})

describe('buildV4ExactOutSwapExecuteCalldata', () => {
  it('produces decodable execute() calldata with the V4_SWAP command', () => {
    const { data, value } = buildV4ExactOutSwapExecuteCalldata({
      poolKey: POOL_KEY,
      zeroForOne: true,
      amountOut: 250_000_000n,
      amountInMaximum: 10n ** 17n,
      tokenIn: zeroAddress,
      tokenOut: USDC,
      deadline: 42n,
      recipient: RECIPIENT,
    })

    expect(value).toBe(10n ** 17n)

    const decoded = decodeFunctionData({ abi: universalRouterAbi, data })
    expect(decoded.functionName).toBe('execute')
    const [commands, inputs, deadline] = decoded.args
    // Native-ETH input → V4_SWAP + SWEEP (refund the overpay).
    expect(slice(commands, 0, 1)).toBe(`0x${toByte(V4_SWAP)}`)
    expect(inputs).toHaveLength(2)
    expect(deadline).toBe(42n)
  })
})
