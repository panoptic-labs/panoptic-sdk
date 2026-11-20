/**
 * Self-funded covered calls on the deployed **v3** SemiFungiblePositionManager,
 * on a mainnet fork (5bps USDC/WETH pool, token0 = USDC, token1 = WETH).
 *
 * Prerequisites:
 *   1. anvil --fork-url <mainnet RPC> --port 8546
 *   2. SFPM_FORK_RPC=http://127.0.0.1:8546 pnpm --filter @panoptic-eng/sdk test:fork sfpm-covered-call
 *
 * The suite auto-skips unless SFPM_FORK_RPC points at a reachable mainnet (chainId 1) fork.
 *
 * @module examples/__tests__/sfpm-covered-call.fork
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
  http,
  keccak256,
  pad,
  parseAbi,
  toHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { requireChainDeployment } from '../../../../hypoVault/chainDeployments'
import {
  type SfpmCoveredCallCall,
  executeSfpmCoveredCall,
  planSfpmCoveredCallClose,
  planSfpmCoveredCallOpen,
  simulateSfpmCoveredCall,
} from '../../sfpmCoveredCall'
import { getSfpmLpPosition } from '../../sfpmLp'
import {
  buildSfpmSwapPlan,
  ensureSfpmV3PoolInitialized,
  executeSfpmSwap,
  quoteSfpmSwap,
} from '../../sfpmSwap'

const RPC = process.env.SFPM_FORK_RPC ?? 'http://127.0.0.1:8546'
const SFPM = requireChainDeployment(1).panoptic.v2.semiFungiblePositionManagerV3 as Address
const POOL: Address = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC_BALANCE_SLOT = 9n
const WETH_BALANCE_SLOT = 3n
const TICK_SPACING = 10n
const FEE = 500
const SLIPPAGE_BPS = 50n
/** 20 tick spacings: a 200-tick range. */
const WIDTH = 20n

const erc20Abi = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])
const poolAbi = parseAbi([
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function liquidity() view returns (uint128)',
])

// A fresh EOA: anvil's default accounts carry a 7702 delegation on mainnet
// forks that breaks the SFPM's ERC-1155 acceptance check.
const signer = privateKeyToAccount(generatePrivateKey())
const account = signer.address

let client: PublicClient
let walletClient: WalletClient
let testClient: TestClient
let poolId: bigint
let snapshot: Hex

const assets = {
  token0: { assetIdx: 0n, deposit: 100_000n * 10n ** 6n },
  token1: { assetIdx: 1n, deposit: 30n * 10n ** 18n },
} as const

async function isMainnetFork(): Promise<boolean> {
  try {
    return (await createPublicClient({ transport: http(RPC) }).getChainId()) === 1
  } catch {
    return false
  }
}

async function deal(token: Address, slot: bigint, amount: bigint): Promise<void> {
  const index = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [account, slot]),
  )
  await testClient.setStorageAt({ address: token, index, value: pad(toHex(amount)) })
}

async function balances(): Promise<[bigint, bigint]> {
  const read = (token: Address) =>
    client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
  return [await read(USDC), await read(WETH)]
}

async function currentTick(): Promise<bigint> {
  const slot0 = await client.readContract({ address: POOL, abi: poolAbi, functionName: 'slot0' })
  return BigInt(slot0[1])
}

async function alignedTick(): Promise<bigint> {
  const tick = await currentTick()
  return tick - (((tick % TICK_SPACING) + TICK_SPACING) % TICK_SPACING)
}

/** An in-range call strike: the range straddles the price, leaning to the asset's out-of-the-money side. */
async function inRangeStrike(assetIdx: 0n | 1n): Promise<bigint> {
  const center = await alignedTick()
  return assetIdx === 0n ? center + 50n : center - 50n
}

/** Simulate a call, send it, and check the simulated flows against the real balance changes. */
async function simulateThenSend(call: SfpmCoveredCallCall) {
  const simulation = await simulateSfpmCoveredCall({ client, account, call })
  if (!simulation.success) throw simulation.error
  const before = await balances()
  const receipt = await (
    await executeSfpmCoveredCall({ client, walletClient, account, call })
  ).wait()
  expect(receipt.status).toBe('success')
  const after = await balances()
  const paid = [before[0] - after[0], before[1] - after[1]] as const
  expect(paid[0]).toBe(simulation.data.amount0)
  expect(paid[1]).toBe(simulation.data.amount1)
  expect(await currentTick()).toBe(simulation.data.finalTick)
  return paid
}

async function open(assetIdx: 0n | 1n, deposit: bigint, strike: bigint) {
  const plan = planSfpmCoveredCallOpen({
    sfpmAddress: SFPM,
    poolAddress: POOL,
    poolId,
    assetIdx,
    strike,
    width: WIDTH,
    deposit,
    currentTick: await currentTick(),
    liquidity: await client.readContract({
      address: POOL,
      abi: poolAbi,
      functionName: 'liquidity',
    }),
    fee: FEE,
    slippageBps: SLIPPAGE_BPS,
  })
  const paid = await simulateThenSend(plan)
  return { plan, paid }
}

/** Swap in `zeroForOne` direction until the pool tick is past `target`, halving chunks that overshoot the band. */
async function pushTickPast(target: bigint, zeroForOne: boolean) {
  let amount = zeroForOne ? 20_000_000n * 10n ** 6n : 5_000n * 10n ** 18n
  for (let i = 0; i < 80; i++) {
    const tick = await currentTick()
    if (zeroForOne ? tick < target : tick > target) return
    const plan = buildSfpmSwapPlan({
      sfpmAddress: SFPM,
      poolAddress: POOL,
      poolId,
      kind: 'exactIn',
      zeroForOne,
      amount,
      currentTick: Number(tick),
      slippageBps: 1000n,
    })
    const quote = await quoteSfpmSwap({ client, plan, account })
    if (!quote.success) {
      amount /= 2n
      continue
    }
    const receipt = await (await executeSfpmSwap({ client, walletClient, account, plan })).wait()
    expect(receipt.status).toBe('success')
  }
  throw new Error(`could not move the pool tick past ${target}`)
}

async function heldSize(tokenId: bigint) {
  const position = await getSfpmLpPosition({
    client,
    sfpmAddress: SFPM,
    poolAddress: POOL,
    account,
    tokenId,
  })
  return position.positionSize
}

const suite = (await isMainnetFork()) ? describe : describe.skip

suite('SFPM v3 self-funded covered calls (mainnet fork)', () => {
  beforeAll(async () => {
    client = createPublicClient({ chain: mainnet, transport: http(RPC) })
    walletClient = createWalletClient({ account: signer, chain: mainnet, transport: http(RPC) })
    testClient = createTestClient({ mode: 'anvil', chain: mainnet, transport: http(RPC) })

    await testClient.setBalance({ address: account, value: 10n ** 20n })
    for (const token of [USDC, WETH]) {
      const hash = await walletClient.writeContract({
        account: signer,
        chain: mainnet,
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [SFPM, 2n ** 255n],
      })
      await client.waitForTransactionReceipt({ hash })
    }
    ;({ poolId } = await ensureSfpmV3PoolInitialized({
      client,
      wallet: walletClient,
      sfpmAddress: SFPM,
      token0: USDC,
      token1: WETH,
      fee: FEE,
      expectedPool: POOL,
    }))
  }, 120_000)

  beforeEach(async () => {
    snapshot = await testClient.snapshot()
    await deal(USDC, USDC_BALANCE_SLOT, assets.token0.deposit)
    await deal(WETH, WETH_BALANCE_SLOT, assets.token1.deposit)
  })

  afterEach(async () => {
    await testClient.revert({ id: snapshot })
  })

  it.each(Object.entries(assets))(
    'opens an in-range %s call within the deposit, buying the quote share with an SFPM swap',
    async (_label, { assetIdx, deposit }) => {
      const quoteIdx = assetIdx === 0n ? 1 : 0
      const { plan, paid } = await open(assetIdx, deposit, await inRangeStrike(assetIdx))

      expect(plan.calls).toHaveLength(3)
      expect(plan.quoteBought).toBeGreaterThan(0n)
      const assetPaid = paid[Number(assetIdx)] ?? 0n
      expect(assetPaid).toBeLessThanOrEqual(plan.maxAssetIn)
      expect(assetPaid).toBeLessThanOrEqual(deposit)
      expect(assetPaid * 1000n).toBeGreaterThan(deposit * 990n)
      // The swap supplies all the quote the range takes; none comes from the wallet.
      expect(paid[quoteIdx]).toBeLessThanOrEqual(0n)
      expect(await heldSize(plan.tokenId)).toBe(plan.positionSize)
    },
    120_000,
  )

  it.each(Object.entries(assets))(
    'opens an out-of-range %s call without swapping',
    async (_label, { assetIdx, deposit }) => {
      const center = await alignedTick()
      const strike = assetIdx === 0n ? center + 500n : center - 500n
      const { plan, paid } = await open(assetIdx, deposit, strike)

      expect(plan.calls).toHaveLength(1)
      expect(plan.quoteBought).toBe(0n)
      expect(paid[assetIdx === 0n ? 1 : 0]).toBe(0n)
      expect(paid[Number(assetIdx)]).toBeLessThanOrEqual(deposit)
      expect(await heldSize(plan.tokenId)).toBe(plan.positionSize)
    },
    120_000,
  )

  describe.each(Object.entries(assets))('closing a %s call', (_label, { assetIdx, deposit }) => {
    const quoteIdx = assetIdx === 0n ? 1 : 0
    // The asset is sold as its price rises: a higher tick for token0, a lower one for token1.
    const assignedDirection = assetIdx === 1n

    async function openAndMove(assigned: boolean) {
      const strike = await inRangeStrike(assetIdx)
      const { plan } = await open(assetIdx, deposit, strike)
      const half = (WIDTH * TICK_SPACING) / 2n
      const zeroForOne = assigned ? assignedDirection : !assignedDirection
      const target = zeroForOne ? strike - half - 20n : strike + half + 20n
      // Liquidity to push the price through the range.
      await deal(USDC, USDC_BALANCE_SLOT, 10n ** 9n * 10n ** 6n)
      await deal(WETH, WETH_BALANCE_SLOT, 500_000n * 10n ** 18n)
      await pushTickPast(target, zeroForOne)
      return plan
    }

    it('pays out the quote token once the price is above the range', async () => {
      const plan = await openAndMove(true)
      const call = await planSfpmCoveredCallClose({
        client,
        sfpmAddress: SFPM,
        poolAddress: POOL,
        account,
        tokenId: plan.tokenId,
        slippageBps: SLIPPAGE_BPS,
      })
      const paid = await simulateThenSend(call)

      // The pushes traded the quote token in, so the range earned no asset fees.
      expect(paid[Number(assetIdx)]).toBe(0n)
      expect(paid[quoteIdx]).toBeLessThan(0n)
      expect(await heldSize(plan.tokenId)).toBe(0n)
    }, 240_000)

    it('returns the asset once the price is below the range', async () => {
      const plan = await openAndMove(false)
      const call = await planSfpmCoveredCallClose({
        client,
        sfpmAddress: SFPM,
        poolAddress: POOL,
        account,
        tokenId: plan.tokenId,
        slippageBps: SLIPPAGE_BPS,
      })
      const paid = await simulateThenSend(call)

      // A range below the price holds exactly the position size in the asset, less Uniswap's rounding.
      expect(-(paid[Number(assetIdx)] ?? 0n)).toBeGreaterThanOrEqual(plan.positionSize - 2n)
      expect(paid[quoteIdx]).toBe(0n)
      expect(await heldSize(plan.tokenId)).toBe(0n)
    }, 240_000)
  })
})
