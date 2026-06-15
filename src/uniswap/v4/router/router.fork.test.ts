/* eslint-disable @typescript-eslint/no-non-null-assertion -- walletClient.account is set in beforeAll */
/**
 * Fork test for the Uniswap v4 Universal Router exact-in and exact-out swap
 * paths.
 *
 * Validates the verified command/action encoding against the REAL mainnet
 * Universal Router + V4Quoter, on the native-ETH ETH/USDC 0.30% pool, from a
 * wallet with zero Panoptic collateral. Confirms the handoff acceptance
 * criteria: both directions succeed, output within slippage, native ETH needs
 * no WETH wrapping, the exact-out native-ETH SWEEP refunds the overpay (no
 * stranded ETH), and no Panoptic margin error is possible (Panoptic is never
 * touched).
 *
 * Prerequisites:
 * 1. `export FORK_URL=<mainnet RPC>`
 * 2. `anvil --fork-url $FORK_URL` (defaults to 127.0.0.1:8545)
 * 3. `pnpm vitest run --config src/panoptic/v2/examples/__tests__/vitest.config.fork.ts \
 *      src/uniswap/v4/router/router.fork.test.ts`
 *
 * Skips automatically when no fork node is reachable.
 *
 * @module uniswap/v4/router/router.fork.test
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createTestClient,
  createWalletClient,
  erc20Abi,
  http,
  parseEther,
  parseUnits,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { beforeAll, describe, expect, it } from 'vitest'

import type { PoolKey } from '../../../panoptic/v2/types'
import { permit2Abi } from '../abis/permit2'
import { universalRouterAbi } from '../abis/universalRouter'
import { v4QuoterAbi } from '../abis/v4Quoter'
import { getUniswapV4Addresses, PERMIT2_ADDRESS } from '../addresses'
import { buildV4ExactOutSwapExecuteArgs, buildV4SwapExecuteArgs } from './encodeSwap'

const RPC_URL = `http://127.0.0.1:8545`
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const CHAIN_ID = 1n

// Native-ETH ETH/USDC 0.30% v4 pool key (currency0 = ETH = address(0)).
const POOL_KEY: PoolKey = {
  currency0: zeroAddress,
  currency1: USDC,
  fee: 3000n,
  tickSpacing: 60n,
  hooks: zeroAddress,
}

// A fresh, non-standard key: funded with ETH, holds NO Panoptic collateral.
// NOT an anvil default account — those well-known keys carry an EIP-7702
// sweeper delegation on mainnet that auto-forwards any native ETH they receive,
// which would silently drain the swap output and break the native-ETH-out
// assertions. This address has no mainnet code.
const ALICE_PK = '0xa11ce0000000000000000000000000000000000000000000000000000000b0b1' as const

async function forkReachable(): Promise<boolean> {
  try {
    const client = createPublicClient({ chain: mainnet, transport: http(RPC_URL) })
    await client.getBlockNumber()
    return true
  } catch {
    return false
  }
}

const available = await forkReachable()

describe.skipIf(!available)('swapExactInViaRouter (mainnet fork)', () => {
  let publicClient: PublicClient
  let walletClient: WalletClient
  let testClient: ReturnType<typeof createTestClient>
  let account: Address
  const { universalRouter, v4Quoter } = getUniswapV4Addresses(CHAIN_ID)

  beforeAll(async () => {
    publicClient = createPublicClient({ chain: mainnet, transport: http(RPC_URL) })
    const signer = privateKeyToAccount(ALICE_PK)
    account = signer.address
    walletClient = createWalletClient({ account: signer, chain: mainnet, transport: http(RPC_URL) })
    testClient = createTestClient({ chain: mainnet, mode: 'anvil', transport: http(RPC_URL) })
    await testClient.setBalance({ address: account, value: parseEther('100') })
  })

  async function freshDeadline(): Promise<bigint> {
    const block = await publicClient.getBlock()
    return block.timestamp + 1800n
  }

  it('quotes ETH→USDC with a positive output', async () => {
    const { result } = await publicClient.simulateContract({
      address: v4Quoter,
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          poolKey: {
            currency0: POOL_KEY.currency0,
            currency1: POOL_KEY.currency1,
            fee: Number(POOL_KEY.fee),
            tickSpacing: Number(POOL_KEY.tickSpacing),
            hooks: POOL_KEY.hooks,
          },
          zeroForOne: true,
          exactAmount: parseEther('0.1'),
          hookData: '0x',
        },
      ],
    })
    const [amountOut] = result
    expect(amountOut).toBeGreaterThan(0n)
  })

  it('swaps ETH→USDC via the Universal Router (msg.value path)', async () => {
    const amountIn = parseEther('0.1')

    const { result } = await publicClient.simulateContract({
      address: v4Quoter,
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          poolKey: {
            currency0: POOL_KEY.currency0,
            currency1: POOL_KEY.currency1,
            fee: Number(POOL_KEY.fee),
            tickSpacing: Number(POOL_KEY.tickSpacing),
            hooks: POOL_KEY.hooks,
          },
          zeroForOne: true,
          exactAmount: amountIn,
          hookData: '0x',
        },
      ],
    })
    const [quotedOut] = result
    const amountOutMinimum = (quotedOut * 9950n) / 10_000n // 0.5% slippage

    const usdcBefore = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })

    const { args, value } = buildV4SwapExecuteArgs({
      poolKey: POOL_KEY,
      zeroForOne: true,
      amountIn,
      amountOutMinimum,
      tokenIn: zeroAddress,
      tokenOut: USDC,
      deadline: await freshDeadline(),
    })

    const hash = await walletClient.writeContract({
      address: universalRouter,
      abi: universalRouterAbi,
      functionName: 'execute',
      args,
      value,
      account: walletClient.account!,
      chain: mainnet,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')

    const usdcAfter = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    expect(usdcAfter - usdcBefore).toBeGreaterThanOrEqual(amountOutMinimum)
  })

  it('swaps USDC→ETH via the Permit2 path', async () => {
    // We acquired USDC from the prior ETH→USDC swap.
    const usdcBalance = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    const amountIn = usdcBalance > parseUnits('100', 6) ? parseUnits('100', 6) : usdcBalance
    expect(amountIn).toBeGreaterThan(0n)

    // Permit2 two-step approvals.
    const erc20Hash = await walletClient.writeContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [PERMIT2_ADDRESS, amountIn],
      account: walletClient.account!,
      chain: mainnet,
    })
    await publicClient.waitForTransactionReceipt({ hash: erc20Hash })

    const expiration = Number((await freshDeadline()) + 86_400n)
    const permitHash = await walletClient.writeContract({
      address: PERMIT2_ADDRESS,
      abi: permit2Abi,
      functionName: 'approve',
      args: [USDC, universalRouter, amountIn, expiration],
      account: walletClient.account!,
      chain: mainnet,
    })
    await publicClient.waitForTransactionReceipt({ hash: permitHash })

    const { result } = await publicClient.simulateContract({
      address: v4Quoter,
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          poolKey: {
            currency0: POOL_KEY.currency0,
            currency1: POOL_KEY.currency1,
            fee: Number(POOL_KEY.fee),
            tickSpacing: Number(POOL_KEY.tickSpacing),
            hooks: POOL_KEY.hooks,
          },
          zeroForOne: false,
          exactAmount: amountIn,
          hookData: '0x',
        },
      ],
    })
    const [quotedOut] = result
    const amountOutMinimum = (quotedOut * 9950n) / 10_000n

    const ethBefore = await publicClient.getBalance({ address: account })

    const { args, value } = buildV4SwapExecuteArgs({
      poolKey: POOL_KEY,
      zeroForOne: false,
      amountIn,
      amountOutMinimum,
      tokenIn: USDC,
      tokenOut: zeroAddress,
      deadline: await freshDeadline(),
      recipient: account,
    })
    expect(value).toBe(0n)

    const hash = await walletClient.writeContract({
      address: universalRouter,
      abi: universalRouterAbi,
      functionName: 'execute',
      args,
      value,
      account: walletClient.account!,
      chain: mainnet,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')

    // The bought ETH is actually delivered (net of gas, the balance rises by
    // roughly the quoted output). The trailing SWEEP forwards it from the router.
    const ethAfter = await publicClient.getBalance({ address: account })
    expect(ethAfter).toBeGreaterThan(ethBefore + amountOutMinimum - parseEther('0.01'))
    const routerEth = await publicClient.getBalance({ address: universalRouter })
    expect(routerEth).toBe(0n)
  })
})

describe.skipIf(!available)('swapExactOutViaRouter (mainnet fork)', () => {
  let publicClient: PublicClient
  let walletClient: WalletClient
  let testClient: ReturnType<typeof createTestClient>
  let account: Address
  const { universalRouter, v4Quoter } = getUniswapV4Addresses(CHAIN_ID)

  beforeAll(async () => {
    publicClient = createPublicClient({ chain: mainnet, transport: http(RPC_URL) })
    const signer = privateKeyToAccount(ALICE_PK)
    account = signer.address
    walletClient = createWalletClient({ account: signer, chain: mainnet, transport: http(RPC_URL) })
    testClient = createTestClient({ chain: mainnet, mode: 'anvil', transport: http(RPC_URL) })
    await testClient.setBalance({ address: account, value: parseEther('100') })
  })

  async function freshDeadline(): Promise<bigint> {
    const block = await publicClient.getBlock()
    return block.timestamp + 1800n
  }

  function quoteExactOut(zeroForOne: boolean, amountOut: bigint) {
    return publicClient.simulateContract({
      address: v4Quoter,
      abi: v4QuoterAbi,
      functionName: 'quoteExactOutputSingle',
      args: [
        {
          poolKey: {
            currency0: POOL_KEY.currency0,
            currency1: POOL_KEY.currency1,
            fee: Number(POOL_KEY.fee),
            tickSpacing: Number(POOL_KEY.tickSpacing),
            hooks: POOL_KEY.hooks,
          },
          zeroForOne,
          exactAmount: amountOut,
          hookData: '0x',
        },
      ],
    })
  }

  it('swaps ETH→exact-USDC-out and refunds the unused ETH (SWEEP)', async () => {
    const amountOut = parseUnits('250', 6) // exactly 250 USDC out

    const { result } = await quoteExactOut(true, amountOut)
    const [quotedIn] = result
    const amountInMaximum = (quotedIn * 10_050n) / 10_000n // 0.5% slippage cap

    const usdcBefore = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    const ethBefore = await publicClient.getBalance({ address: account })

    const { args, value } = buildV4ExactOutSwapExecuteArgs({
      poolKey: POOL_KEY,
      zeroForOne: true,
      amountOut,
      amountInMaximum,
      tokenIn: zeroAddress,
      tokenOut: USDC,
      deadline: await freshDeadline(),
      recipient: account,
    })
    // Native input funds the router with the overpay cap.
    expect(value).toBe(amountInMaximum)

    const hash = await walletClient.writeContract({
      address: universalRouter,
      abi: universalRouterAbi,
      functionName: 'execute',
      args,
      value,
      account: walletClient.account!,
      chain: mainnet,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')

    // Exact output delivered.
    const usdcAfter = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    expect(usdcAfter - usdcBefore).toBe(amountOut)

    // No stranded ETH: the router holds nothing afterwards, and the account
    // effectively spent only the actual input + gas (the overpay was refunded —
    // ethSpent stays within a gas allowance of the quoted input, well under the
    // funded cap).
    const ethAfter = await publicClient.getBalance({ address: account })
    const ethSpent = ethBefore - ethAfter
    const routerEth = await publicClient.getBalance({ address: universalRouter })
    expect(routerEth).toBe(0n)
    expect(ethSpent).toBeLessThan(quotedIn + parseEther('0.01'))
  })

  it('swaps USDC→exact-ETH-out via the Permit2 path (no SWEEP, zero value)', async () => {
    const amountOut = parseEther('0.05') // exactly 0.05 ETH out

    const { result } = await quoteExactOut(false, amountOut)
    const [quotedIn] = result
    const amountInMaximum = (quotedIn * 10_050n) / 10_000n

    // Approve the cap (not the typed output) through the Permit2 two-step.
    const erc20Hash = await walletClient.writeContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [PERMIT2_ADDRESS, amountInMaximum],
      account: walletClient.account!,
      chain: mainnet,
    })
    await publicClient.waitForTransactionReceipt({ hash: erc20Hash })

    const expiration = Number((await freshDeadline()) + 86_400n)
    const permitHash = await walletClient.writeContract({
      address: PERMIT2_ADDRESS,
      abi: permit2Abi,
      functionName: 'approve',
      args: [USDC, universalRouter, amountInMaximum, expiration],
      account: walletClient.account!,
      chain: mainnet,
    })
    await publicClient.waitForTransactionReceipt({ hash: permitHash })

    const usdcBefore = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    const ethBefore = await publicClient.getBalance({ address: account })

    const { args, value } = buildV4ExactOutSwapExecuteArgs({
      poolKey: POOL_KEY,
      zeroForOne: false,
      amountOut,
      amountInMaximum,
      tokenIn: USDC,
      tokenOut: zeroAddress,
      deadline: await freshDeadline(),
      recipient: account,
    })
    expect(value).toBe(0n)

    const hash = await walletClient.writeContract({
      address: universalRouter,
      abi: universalRouterAbi,
      functionName: 'execute',
      args,
      value,
      account: walletClient.account!,
      chain: mainnet,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')

    // Exact ETH out delivered to the account (net of gas it rises by ~amountOut).
    const ethAfter = await publicClient.getBalance({ address: account })
    expect(ethAfter).toBeGreaterThan(ethBefore + amountOut - parseEther('0.01'))

    // USDC spent never exceeds the cap.
    const usdcAfter = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    expect(usdcBefore - usdcAfter).toBeLessThanOrEqual(amountInMaximum)
  })
})
