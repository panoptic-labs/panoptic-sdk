/**
 * Phase 0 feasibility spike — proves the SFPM-as-swap-venue mechanism end-to-end.
 *
 * Uses the deployed **v3** SemiFungiblePositionManager on a mainnet fork to swap
 * in the 5bps USDC/WETH Uniswap v3 pool via `multicall([mint, burn])` of a
 * single-leg loan tokenId with inverted tick limits on exactly one call.
 *
 * This is the gate for the whole SFPM off-venue swap feature: it verifies the
 * mechanics the SDK `sfpmSwap` module and the `SfpmSwapCondition` adapter depend
 * on. See plan `i-need-to-implement-reflective-seahorse.md`.
 *
 * Prerequisites:
 *   1. export FORK_URL=<mainnet archive/full RPC>
 *   2. anvil --fork-url $FORK_URL --port 8546
 *   3. NETWORK=mainnet SFPM_FORK_RPC=http://127.0.0.1:8546 \
 *        pnpm --filter panoptic-v2-sdk exec vitest run \
 *        --config src/panoptic/v2/examples/__tests__/vitest.config.fork.ts \
 *        src/panoptic/v2/examples/__tests__/sfpm-swap.spike.fork.test.ts
 *
 * The suite auto-skips unless SFPM_FORK_RPC points at a reachable mainnet (chainId 1) fork.
 *
 * @module examples/__tests__/sfpm-swap.spike.fork
 */
import {
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
  type WalletClient,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  pad,
  parseAbi,
  toHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { beforeAll, describe, expect, it } from 'vitest'

import { semiFungiblePositionManagerV3Abi as SFPM_ABI } from '../../../../generated'
import { requireChainDeployment } from '../../../../hypoVault/chainDeployments'
import { buildSfpmSwapCalldata, buildSfpmSwapPlan, quoteSfpmSwap } from '../../sfpmSwap'
import { createTokenIdBuilder } from '../../tokenId'

// ---------------------------------------------------------------------------
// Fixtures (mainnet)
// ---------------------------------------------------------------------------
const RPC = process.env.SFPM_FORK_RPC ?? 'http://127.0.0.1:8546'
const MAINNET = requireChainDeployment(1)
const SFPM = MAINNET.panoptic.v2.semiFungiblePositionManagerV3 as Address
/** Canonical mainnet USDC/WETH 0.05% Uniswap v3 pool (token0 = USDC, token1 = WETH). */
const POOL5: Address = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC_BALANCE_SLOT = 9n
const WETH_BALANCE_SLOT = 3n
const VEGOID = 4

const MIN_TICK = -887272
const MAX_TICK = 887272
const WIDE: [number, number] = [MIN_TICK + 1, MAX_TICK - 1] // non-inverted (no swap)

const erc20Abi = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])
const poolAbi = parseAbi([
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
])

// Fresh key per run: an EOA with no code skips the ERC1155 acceptance check. Anvil
// default accounts carry a 7702 delegation on the mainnet fork whose receiver hook
// returns garbage and reverts the SFPM safe-mint (see project memory).
const account = privateKeyToAccount(generatePrivateKey())

let pub: PublicClient
let wallet: WalletClient
let test: TestClient
let poolId: bigint
let poolKey: Hex
let currentTick: number

async function isMainnetFork(): Promise<boolean> {
  try {
    const client = createPublicClient({ transport: http(RPC) })
    return (await client.getChainId()) === 1
  } catch {
    return false
  }
}

async function deal(token: Address, slot: bigint, amount: bigint): Promise<void> {
  const index = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [account.address, slot]),
  )
  await test.setStorageAt({ address: token, index, value: pad(toHex(amount)) })
}

function balanceOf(token: Address): Promise<bigint> {
  return pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })
}

function inner(
  fn: 'mintTokenizedPosition' | 'burnTokenizedPosition',
  tokenId: bigint,
  size: bigint,
  limits: [number, number],
): Hex {
  return encodeFunctionData({
    abi: SFPM_ABI,
    functionName: fn,
    args: [poolKey, tokenId, size, limits[0], limits[1]],
  })
}

function multicall(calls: Hex[]): Hex {
  return encodeFunctionData({ abi: SFPM_ABI, functionName: 'multicall', args: [calls] })
}

async function send(data: Hex): Promise<void> {
  const hash = await wallet.sendTransaction({ account, chain: mainnet, to: SFPM, data })
  await pub.waitForTransactionReceipt({ hash })
}

const shouldRun = await isMainnetFork()
const suite = shouldRun ? describe : describe.skip

suite('SFPM v3 off-venue swap feasibility (mainnet fork)', () => {
  beforeAll(async () => {
    pub = createPublicClient({ chain: mainnet, transport: http(RPC) })
    wallet = createWalletClient({ chain: mainnet, transport: http(RPC) })
    test = createTestClient({ mode: 'anvil', chain: mainnet, transport: http(RPC) })

    await test.setBalance({ address: account.address, value: 10n ** 20n })
    await deal(USDC, USDC_BALANCE_SLOT, 1_000_000n * 10n ** 6n)
    await deal(WETH, WETH_BALANCE_SLOT, 1000n * 10n ** 18n)
    for (const token of [USDC, WETH]) {
      const hash = await wallet.writeContract({
        account,
        chain: mainnet,
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [SFPM, 2n ** 255n],
      })
      await pub.waitForTransactionReceipt({ hash })
    }

    const { result } = await pub.simulateContract({
      account,
      address: SFPM,
      abi: SFPM_ABI,
      functionName: 'initializeAMMPool',
      args: [USDC, WETH, 500, VEGOID],
    })
    poolId = BigInt(result)
    const hash = await wallet.writeContract({
      account,
      chain: mainnet,
      address: SFPM,
      abi: SFPM_ABI,
      functionName: 'initializeAMMPool',
      args: [USDC, WETH, 500, VEGOID],
    })
    await pub.waitForTransactionReceipt({ hash })

    poolKey = encodeAbiParameters([{ type: 'address' }], [POOL5])
    const slot0 = await pub.readContract({ address: POOL5, abi: poolAbi, functionName: 'slot0' })
    currentTick = slot0[1]
  }, 60_000)

  it('registers the 5bps pool and resolves its poolId', async () => {
    const resolved = await pub.readContract({
      address: SFPM,
      abi: SFPM_ABI,
      functionName: 'getUniswapV3PoolFromId',
      args: [poolId],
    })
    expect((resolved as string).toLowerCase()).toBe(POOL5.toLowerCase())
  })

  it('exactIn USDC->WETH: pulls exactly positionSize USDC, delivers WETH (swap on mint)', async () => {
    const tokenId = createTokenIdBuilder(poolId)
      .addLoan({ asset: 0n, tokenType: 0n, strike: 0n })
      .build()
    const size = 1000n * 10n ** 6n
    const [u0, w0] = [await balanceOf(USDC), await balanceOf(WETH)]
    await send(
      multicall([
        inner('mintTokenizedPosition', tokenId, size, [currentTick + 500, currentTick - 500]), // inverted → swap
        inner('burnTokenizedPosition', tokenId, size, WIDE),
      ]),
    )
    expect((await balanceOf(USDC)) - u0).toBe(-size)
    expect((await balanceOf(WETH)) - w0).toBeGreaterThan(0n)
  })

  it('exactIn WETH->USDC: pulls exactly positionSize WETH, delivers USDC (swap on mint)', async () => {
    const tokenId = createTokenIdBuilder(poolId)
      .addLoan({ asset: 1n, tokenType: 1n, strike: 0n })
      .build()
    const size = 10n ** 17n
    const [u0, w0] = [await balanceOf(USDC), await balanceOf(WETH)]
    await send(
      multicall([
        inner('mintTokenizedPosition', tokenId, size, [currentTick + 500, currentTick - 500]),
        inner('burnTokenizedPosition', tokenId, size, WIDE),
      ]),
    )
    expect((await balanceOf(WETH)) - w0).toBe(-size)
    expect((await balanceOf(USDC)) - u0).toBeGreaterThan(0n)
  })

  it('exactOut WETH: delivers exactly positionSize WETH, pays USDC (swap on burn)', async () => {
    const tokenId = createTokenIdBuilder(poolId)
      .addLoan({ asset: 1n, tokenType: 1n, strike: 0n })
      .build()
    const size = 10n ** 17n
    const [u0, w0] = [await balanceOf(USDC), await balanceOf(WETH)]
    await send(
      multicall([
        inner('mintTokenizedPosition', tokenId, size, WIDE),
        inner('burnTokenizedPosition', tokenId, size, [currentTick + 500, currentTick - 500]), // inverted → swap
      ]),
    )
    expect((await balanceOf(WETH)) - w0).toBe(size)
    expect((await balanceOf(USDC)) - u0).toBeLessThan(0n)
  })

  it('both calls non-inverted: no token movement', async () => {
    const tokenId = createTokenIdBuilder(poolId)
      .addLoan({ asset: 0n, tokenType: 0n, strike: 0n })
      .build()
    const size = 1000n * 10n ** 6n
    const [u0, w0] = [await balanceOf(USDC), await balanceOf(WETH)]
    await send(
      multicall([
        inner('mintTokenizedPosition', tokenId, size, WIDE),
        inner('burnTokenizedPosition', tokenId, size, WIDE),
      ]),
    )
    expect((await balanceOf(USDC)) - u0).toBe(0n)
    expect((await balanceOf(WETH)) - w0).toBe(0n)
  })

  it('SDK module end-to-end: buildSfpmSwapPlan + quote + calldata execute a real exactIn swap', async () => {
    const amount = 500n * 10n ** 6n // 500 USDC in
    const plan = buildSfpmSwapPlan({
      sfpmAddress: SFPM,
      poolAddress: POOL5,
      poolId,
      kind: 'exactIn',
      zeroForOne: true, // sell token0 (USDC) for token1 (WETH)
      amount,
      currentTick,
      slippageBps: 50n,
    })

    const quote = await quoteSfpmSwap({ client: pub, plan, account: account.address })
    expect(quote.success).toBe(true)
    if (!quote.success) return
    expect(quote.data.amountIn).toBe(amount) // exactIn: input == positionSize
    expect(quote.data.amountOut).toBeGreaterThan(0n)

    const { multicallData } = buildSfpmSwapCalldata(plan)
    const [u0, w0] = [await balanceOf(USDC), await balanceOf(WETH)]
    await send(multicallData)
    expect((await balanceOf(USDC)) - u0).toBe(-amount)
    const wethGained = (await balanceOf(WETH)) - w0
    // realized output within a wei of the quote (loan-leg round-up)
    expect(wethGained).toBeGreaterThanOrEqual(quote.data.amountOut - 2n)
  })

  it('reverts with a tight inverted band far from market (slippage guard)', async () => {
    const tokenId = createTokenIdBuilder(poolId)
      .addLoan({ asset: 0n, tokenType: 0n, strike: 0n })
      .build()
    const size = 500_000n * 10n ** 6n // large swap moves tick past the tight band
    await expect(
      send(
        multicall([
          inner('mintTokenizedPosition', tokenId, size, [currentTick + 2, currentTick + 1]),
          inner('burnTokenizedPosition', tokenId, size, WIDE),
        ]),
      ),
    ).rejects.toThrow()
  })
})
