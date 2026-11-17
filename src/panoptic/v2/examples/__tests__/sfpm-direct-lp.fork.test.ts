/**
 * Direct SFPM LP lifecycle and swap execution against the deployed **v3**
 * SemiFungiblePositionManager on a mainnet fork (5bps USDC/WETH pool).
 *
 * Prerequisites:
 *   1. anvil --fork-url <mainnet RPC> --port 8546
 *   2. SFPM_FORK_RPC=http://127.0.0.1:8546 pnpm --filter @panoptic-eng/sdk test:fork sfpm-direct-lp
 *
 * The suite auto-skips unless SFPM_FORK_RPC points at a reachable mainnet (chainId 1) fork.
 *
 * @module examples/__tests__/sfpm-direct-lp.fork
 */
import {
  type Address,
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
import { beforeAll, describe, expect, it } from 'vitest'

import { requireChainDeployment } from '../../../../hypoVault/chainDeployments'
import {
  type SfpmLpAction,
  type SfpmLpTarget,
  buildSfpmLpTokenId,
  closeSfpmLpPosition,
  collectSfpmLpFees,
  createSfpmLpPosition,
  decodeSfpmLpLegs,
  decreaseSfpmLpPosition,
  getSfpmLpPosition,
  increaseSfpmLpPosition,
  minSfpmLpPositionSize,
  simulateSfpmLp,
} from '../../sfpmLp'
import {
  type SfpmSwapKind,
  buildSfpmSwapPlan,
  ensureSfpmV3PoolInitialized,
  executeSfpmSwap,
  quoteSfpmSwap,
} from '../../sfpmSwap'
import { encodeV3PoolKeyBytes, simulateSFPMMint } from '../../simulations/sfpm'

const RPC = process.env.SFPM_FORK_RPC ?? 'http://127.0.0.1:8546'
const SFPM = requireChainDeployment(1).panoptic.v2.semiFungiblePositionManagerV3 as Address
/** Mainnet USDC/WETH 0.05% Uniswap v3 pool (token0 = USDC, token1 = WETH). */
const POOL: Address = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC_BALANCE_SLOT = 9n
const WETH_BALANCE_SLOT = 3n
const TICK_SPACING = 10n

const erc20Abi = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])
const poolAbi = parseAbi([
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
])

// A fresh EOA: anvil's default accounts carry a 7702 delegation on mainnet
// forks that breaks the SFPM's ERC-1155 acceptance check.
const signer = privateKeyToAccount(generatePrivateKey())
const account = signer.address

let client: PublicClient
let walletClient: WalletClient
let testClient: TestClient
let poolId: bigint

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

/** Tick limits wide enough to never bind, in the non-swapping order. */
async function target(tokenId: bigint): Promise<SfpmLpTarget> {
  const tick = await currentTick()
  return {
    sfpmAddress: SFPM,
    poolAddress: POOL,
    tokenId,
    tickLimitLow: tick - 2_000n,
    tickLimitHigh: tick + 2_000n,
  }
}

/** Simulate `action`, send it with `write`, and check the simulated flows against the real ones. */
async function simulateThenSend(
  tokenId: bigint,
  action: SfpmLpAction,
  write: (position: SfpmLpTarget) => Promise<{ wait: () => Promise<{ status: string }> }>,
) {
  const position = await target(tokenId)
  const simulation = await simulateSfpmLp({ client, account, ...position, action })
  if (!simulation.success) throw simulation.error

  const before = await balances()
  const receipt = await (await write(position)).wait()
  expect(receipt.status).toBe('success')
  const after = await balances()

  expect(before[0] - after[0]).toBe(simulation.data.amount0)
  expect(before[1] - after[1]).toBe(simulation.data.amount1)
  return simulation.data
}

async function swap(kind: SfpmSwapKind, zeroForOne: boolean, amount: bigint) {
  const plan = buildSfpmSwapPlan({
    sfpmAddress: SFPM,
    poolAddress: POOL,
    poolId,
    kind,
    zeroForOne,
    amount,
    currentTick: Number(await currentTick()),
    slippageBps: 100n,
  })
  const quote = await quoteSfpmSwap({ client, plan, account })
  if (!quote.success) throw quote.error

  const before = await balances()
  const receipt = await (await executeSfpmSwap({ client, walletClient, account, plan })).wait()
  expect(receipt.status).toBe('success')
  const after = await balances()

  const [inIndex, outIndex] = zeroForOne ? [0, 1] : [1, 0]
  const paid = (before[inIndex] ?? 0n) - (after[inIndex] ?? 0n)
  const received = (after[outIndex] ?? 0n) - (before[outIndex] ?? 0n)
  expect(paid).toBe(quote.data.amountIn)
  expect(received).toBe(quote.data.amountOut)
  expect(kind === 'exactIn' ? paid : received).toBe(amount)
  expect(await currentTick()).toBe(BigInt(quote.data.finalTick))
}

/** Trade through the position's ranges in both directions so every chunk accrues fees in both tokens. */
async function accrueFees() {
  await swap('exactIn', true, 300_000n * 10n ** 6n)
  await swap('exactIn', false, 100n * 10n ** 18n)
}

const suite = (await isMainnetFork()) ? describe : describe.skip

suite('SFPM v3 direct LP and swap execution (mainnet fork)', () => {
  let center: bigint

  beforeAll(async () => {
    client = createPublicClient({ chain: mainnet, transport: http(RPC) })
    walletClient = createWalletClient({ account: signer, chain: mainnet, transport: http(RPC) })
    testClient = createTestClient({ mode: 'anvil', chain: mainnet, transport: http(RPC) })

    await testClient.setBalance({ address: account, value: 10n ** 20n })
    await deal(USDC, USDC_BALANCE_SLOT, 10_000_000n * 10n ** 6n)
    await deal(WETH, WETH_BALANCE_SLOT, 5_000n * 10n ** 18n)
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
      fee: 500,
      expectedPool: POOL,
    }))
    const tick = await currentTick()
    center = tick - (((tick % TICK_SPACING) + TICK_SPACING) % TICK_SPACING)
  }, 120_000)

  it.each([
    ['token0', 0n, 50_000n * 10n ** 6n, 12_345_679n],
    ['token1', 1n, 20n * 10n ** 18n, 7_654_321_987_654_321n],
  ] as const)(
    'runs the full lifecycle of a %s-denominated range',
    async (_label, asset, size, increase) => {
      const ranges = [{ tickLower: center - 200n, tickUpper: center + 200n, asset }]
      const tokenId = buildSfpmLpTokenId({ poolId, ranges })

      const created = await simulateThenSend(
        tokenId,
        { kind: 'increase', positionSize: size },
        async (position) => {
          const tx = await createSfpmLpPosition({
            client,
            walletClient,
            account,
            ...position,
            poolId,
            ranges,
            positionSize: size,
          })
          expect(tx.tokenId).toBe(tokenId)
          return tx
        },
      )
      expect(created.amount0).toBeGreaterThan(0n)
      expect(created.amount1).toBeGreaterThan(0n)
      expect(created.fees0 + created.fees1).toBe(0n)

      await accrueFees()
      const accrued = await getSfpmLpPosition({
        client,
        sfpmAddress: SFPM,
        poolAddress: POOL,
        account,
        tokenId,
      })
      const [leg] = accrued.legs
      expect(accrued.positionSize).toBe(size)
      expect(leg?.chunk.netLiquidity).toBe(leg?.liquidity)
      expect(leg?.chunk.pendingFees0).toBeGreaterThan(0n)
      expect(leg?.chunk.pendingFees1).toBeGreaterThan(0n)
      expect(leg?.attributedFees0).toBe(leg?.chunk.pendingFees0)

      const collected = await simulateThenSend(tokenId, { kind: 'collect' }, (position) =>
        collectSfpmLpFees({ client, walletClient, account, ...position }),
      )
      // The read inverts a floored per-liquidity accumulator, so it can trail the payout by dust.
      expect(collected.fees0 - (leg?.chunk.pendingFees0 ?? 0n)).toBeGreaterThanOrEqual(0n)
      expect(collected.fees0 - (leg?.chunk.pendingFees0 ?? 0n)).toBeLessThan(1_000n)
      expect(collected.fees1 - (leg?.chunk.pendingFees1 ?? 0n)).toBeGreaterThanOrEqual(0n)
      expect(collected.fees1 - (leg?.chunk.pendingFees1 ?? 0n)).toBeLessThan(10n ** 9n)
      const afterCollect = await getSfpmLpPosition({
        client,
        sfpmAddress: SFPM,
        poolAddress: POOL,
        account,
        tokenId,
      })
      expect(afterCollect.positionSize).toBe(size)
      expect(afterCollect.legs[0]?.chunk.pendingFees0).toBe(0n)
      expect(afterCollect.legs[0]?.chunk.pendingFees1).toBe(0n)

      await accrueFees()
      const increased = await simulateThenSend(
        tokenId,
        { kind: 'increase', positionSize: increase },
        (position) =>
          increaseSfpmLpPosition({
            client,
            walletClient,
            account,
            ...position,
            positionSize: increase,
          }),
      )
      expect(increased.fees0).toBeGreaterThan(0n)

      const decreased = await simulateThenSend(
        tokenId,
        { kind: 'decrease', positionSize: size / 3n },
        (position) =>
          decreaseSfpmLpPosition({
            client,
            walletClient,
            account,
            ...position,
            positionSize: size / 3n,
          }),
      )
      expect(decreased.amount0).toBeLessThan(0n)
      expect(decreased.call.unburnableSize).toBe(0n)

      const closed = await simulateThenSend(tokenId, { kind: 'close' }, (position) =>
        closeSfpmLpPosition({ client, walletClient, account, ...position }),
      )
      const final = await getSfpmLpPosition({
        client,
        sfpmAddress: SFPM,
        poolAddress: POOL,
        account,
        tokenId,
      })
      expect(final.positionSize).toBe(closed.call.unburnableSize)
      expect(final.positionSize).toBeLessThan(10n)
    },
    120_000,
  )

  it('shares chunk fees between token IDs and closes multi-range positions', async () => {
    const shared = { tickLower: center - 100n, tickUpper: center + 100n, asset: 0n } as const
    const single = buildSfpmLpTokenId({ poolId, ranges: [shared] })
    const multi = buildSfpmLpTokenId({
      poolId,
      ranges: [
        shared,
        { tickLower: center - 50n, tickUpper: center + 300n, asset: 1n },
        {
          tickLower: center - 100n,
          tickUpper: center + 100n,
          asset: 1n,
          tokenType: 1n,
          optionRatio: 2n,
        },
      ],
    })
    // asset-0 sizes are USDC wei; the WETH-denominated legs of `multi` read the same number as WETH wei.
    const size = 30_000n * 10n ** 6n
    const increase = (position: SfpmLpTarget) =>
      increaseSfpmLpPosition({ client, walletClient, account, ...position, positionSize: size })
    for (const tokenId of [single, multi, multi]) {
      await simulateThenSend(tokenId, { kind: 'increase', positionSize: size }, increase)
    }

    await accrueFees()
    const read = (tokenId: bigint) =>
      getSfpmLpPosition({ client, sfpmAddress: SFPM, poolAddress: POOL, account, tokenId })
    const [singlePosition, multiPosition] = [await read(single), await read(multi)]
    const singleLeg = singlePosition.legs[0]
    const multiLeg = multiPosition.legs[0]
    expect(singleLeg?.chunk).toEqual(multiLeg?.chunk)
    expect(singleLeg?.chunk.pendingFees0).toBeGreaterThan(0n)
    // `multi` was minted twice, and per-mint flooring leaves its balance worth 1 more than it deposited.
    const liquiditySum = (multiLeg?.liquidity ?? 0n) + (singleLeg?.liquidity ?? 0n)
    expect(liquiditySum - (singleLeg?.chunk.netLiquidity ?? 0n)).toBeGreaterThanOrEqual(0n)
    expect(liquiditySum - (singleLeg?.chunk.netLiquidity ?? 0n)).toBeLessThanOrEqual(1n)
    const attributed = (singleLeg?.attributedFees0 ?? 0n) + (multiLeg?.attributedFees0 ?? 0n)
    expect(attributed).toBeLessThanOrEqual((singleLeg?.chunk.pendingFees0 ?? 0n) + 1n)
    expect(attributed).toBeGreaterThan(((singleLeg?.chunk.pendingFees0 ?? 0n) * 99n) / 100n)

    // Touching the shared chunk through one token ID pays out the fees of both.
    const collected = await simulateThenSend(single, { kind: 'collect' }, (position) =>
      collectSfpmLpFees({ client, walletClient, account, ...position }),
    )
    expect(collected.fees0).toBeGreaterThanOrEqual(singleLeg?.chunk.pendingFees0 ?? 0n)
    expect((await read(multi)).legs[0]?.chunk.pendingFees0).toBe(0n)

    const close = (position: SfpmLpTarget) =>
      closeSfpmLpPosition({ client, walletClient, account, ...position })
    for (const tokenId of [multi, single]) {
      const closed = await simulateThenSend(tokenId, { kind: 'close' }, close)
      expect((await read(tokenId)).positionSize).toBe(closed.call.unburnableSize)
      // Whatever a close leaves behind is too small to hold liquidity in every range.
      expect(closed.call.unburnableSize).toBeLessThan(
        minSfpmLpPositionSize(decodeSfpmLpLegs(tokenId)),
      )
    }
  }, 120_000)

  it.each([
    ['exactOut', true, 5n * 10n ** 18n],
    ['exactOut', false, 10_000n * 10n ** 6n],
  ] as const)(
    'executes %s swaps (zeroForOne=%s) matching the quote',
    async (kind, zeroForOne, amount) => {
      await swap(kind, zeroForOne, amount)
    },
  )

  it('simulates a raw SFPM mint as an explicit account', async () => {
    const tokenId = buildSfpmLpTokenId({
      poolId,
      ranges: [{ tickLower: center + 500n, tickUpper: center + 700n, asset: 0n }],
    })
    const position = await target(tokenId)
    const [, totalMoved] = await simulateSFPMMint({
      client,
      sfpmAddress: SFPM,
      account,
      poolKey: encodeV3PoolKeyBytes(POOL),
      tokenId,
      positionSize: 1_000n * 10n ** 6n,
      tickLimitLow: Number(position.tickLimitLow),
      tickLimitHigh: Number(position.tickLimitHigh),
    })
    expect(totalMoved).toBeGreaterThan(0n)
  })
})
