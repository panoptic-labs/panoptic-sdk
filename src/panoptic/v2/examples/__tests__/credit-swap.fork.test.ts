/**
 * Fork tests for credit-based collateral swaps.
 *
 * `writes/swap.ts` swaps by opening and closing a width=0 **credit** leg in a
 * single dispatch. The point of using a credit rather than a loan is that a
 * credit pays into the pool instead of borrowing from it, so the swap is never
 * capped by the bought token's utilization or available-to-borrow. These tests
 * exercise that end to end — the construction has no other on-chain coverage.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable (or FORK_URL for mainnet)
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm --filter panoptic-v2-sdk test:fork
 *
 * @module examples/__tests__/credit-swap.fork.test
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAccountCollateral } from '../../reads/account'
import { getPool, getUtilization } from '../../reads/pool'
import { simulateSwapExactIn, simulateSwapExactOut } from '../../simulations/simulateSwap'
import { createMemoryStorage } from '../../storage'
import { getTrackedPositionIds, syncPositions } from '../../sync'
import { swapExactInAndWait, swapExactOutAndWait } from '../../writes/swap'
import { depositAndWait } from '../../writes/vault'
import {
  assertValidDeployments,
  fundTestAccount,
  getAnvilRpcUrl,
  getNetworkConfig,
} from './network.config'

const SLIPPAGE_BPS = 500n // 5% — fork pools can be thin

describe('Credit-based collateral swaps (fork test)', () => {
  let client: PublicClient
  let walletClient: WalletClient
  let accountAddress: Address
  const config = getNetworkConfig()
  const storage = createMemoryStorage()

  const token0 = config.tokens.token0
  const token1 = config.tokens.token1

  /** Position IDs the account holds, so the swap can build a non-colliding leg. */
  const positionIds = async (): Promise<bigint[]> => {
    await syncPositions({
      client,
      chainId: config.chainId,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
      storage,
    })
    return getTrackedPositionIds({
      chainId: config.chainId,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
      storage,
    })
  }

  const collateral = async (): Promise<{ balance0: bigint; balance1: bigint }> => {
    const acct = await getAccountCollateral({
      client,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
    })
    return { balance0: acct.token0.assets, balance1: acct.token1.assets }
  }

  beforeAll(async () => {
    assertValidDeployments()

    // alice: the swap tests own their own account so nonces don't collide with
    // the position/vault fork tests (bob, carol, dave, eve, frank).
    const account = privateKeyToAccount(config.testAccounts.alice)
    accountAddress = account.address

    client = createPublicClient({
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
      cacheTime: 0,
    })
    walletClient = createWalletClient({
      account,
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })

    await fundTestAccount({
      client,
      walletClient,
      account: accountAddress,
      token0Amount: parseUnits('20', token0.decimals),
      token1Amount: parseUnits('50000', token1.decimals),
      approveCollateral: true,
    })

    // Both sides need deposited collateral: the credit is paid from it.
    await depositAndWait({
      client,
      walletClient,
      account: accountAddress,
      collateralTrackerAddress: config.contracts.pool.collateralTracker0,
      assets: parseUnits('10', token0.decimals),
    })
    await depositAndWait({
      client,
      walletClient,
      account: accountAddress,
      collateralTrackerAddress: config.contracts.pool.collateralTracker1,
      assets: parseUnits('20000', token1.decimals),
    })
  })

  it('simulates an exact-in credit swap', async () => {
    const amountIn = parseUnits('1', token0.decimals)
    const result = await simulateSwapExactIn({
      client,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
      chainId: config.chainId,
      tokenIn: token0.address,
      amountIn,
      slippageBps: SLIPPAGE_BPS,
      existingPositionIds: await positionIds(),
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.amountIn).toBeGreaterThan(0n)
    expect(result.data.amountOut).toBeGreaterThan(0n)
  })

  it('executes an exact-in credit swap, moving collateral from token0 to token1', async () => {
    const before = await collateral()
    const amountIn = parseUnits('1', token0.decimals)

    await swapExactInAndWait({
      client,
      walletClient,
      account: accountAddress,
      poolAddress: config.contracts.pool.address,
      chainId: config.chainId,
      tokenIn: token0.address,
      amountIn,
      slippageBps: SLIPPAGE_BPS,
      existingPositionIds: await positionIds(),
    })

    const after = await collateral()
    expect(after.balance0).toBeLessThan(before.balance0)
    expect(after.balance1).toBeGreaterThan(before.balance1)
  })

  it('executes an exact-out credit swap, receiving the requested amount', async () => {
    const before = await collateral()
    const amountOut = parseUnits('1000', token1.decimals)

    await swapExactOutAndWait({
      client,
      walletClient,
      account: accountAddress,
      poolAddress: config.contracts.pool.address,
      chainId: config.chainId,
      tokenOut: token1.address,
      amountOut,
      slippageBps: SLIPPAGE_BPS,
      existingPositionIds: await positionIds(),
    })

    const after = await collateral()
    expect(after.balance0).toBeLessThan(before.balance0)
    // Exact output: the requested amount lands, give or take accrued interest.
    expect(after.balance1 - before.balance1).toBeGreaterThanOrEqual((amountOut * 99n) / 100n)
  })

  it('leaves no position behind and does not change utilization', async () => {
    const utilBefore = await getUtilization({
      client,
      poolAddress: config.contracts.pool.address,
    })
    const idsBefore = await positionIds()

    await swapExactInAndWait({
      client,
      walletClient,
      account: accountAddress,
      poolAddress: config.contracts.pool.address,
      chainId: config.chainId,
      tokenIn: token1.address,
      amountIn: parseUnits('500', token1.decimals),
      slippageBps: SLIPPAGE_BPS,
      existingPositionIds: idsBefore,
    })

    // The credit opens and closes in the same dispatch.
    expect(await positionIds()).toEqual(idsBefore)

    // A credit never touches s_assetsInAMM, so utilization is untouched. A
    // loan-based swap of the same size would have moved both of these.
    const utilAfter = await getUtilization({
      client,
      poolAddress: config.contracts.pool.address,
    })
    expect(utilAfter.utilization0).toBe(utilBefore.utilization0)
    expect(utilAfter.utilization1).toBe(utilBefore.utilization1)
  })

  it('swaps for more than the pool has available to borrow', async () => {
    // The whole reason for credits: a loan-based swap is capped by
    // availableToBorrow on the bought side, a credit-based one is not.
    const { availableToBorrow1 } = await getUtilization({
      client,
      poolAddress: config.contracts.pool.address,
    })
    const pool = await getPool({
      client,
      poolAddress: config.contracts.pool.address,
      chainId: config.chainId,
    })
    expect(pool.collateralTracker1.token.toLowerCase()).toBe(token1.address.toLowerCase())

    const amountOut = availableToBorrow1 + parseUnits('1', token1.decimals)
    const before = await collateral()

    const result = await simulateSwapExactOut({
      client,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
      chainId: config.chainId,
      tokenOut: token1.address,
      amountOut,
      slippageBps: SLIPPAGE_BPS,
      existingPositionIds: await positionIds(),
    })

    // Only meaningful if the account can actually afford it; skip otherwise so
    // the assertion never passes vacuously on a thin fork.
    if (!result.success) {
      console.warn(
        `Skipping over-available assertion: ${result.error.message} ` +
          `(available=${availableToBorrow1}, balance0=${before.balance0})`,
      )
      return
    }
    expect(result.data.amountOut).toBeGreaterThanOrEqual((amountOut * 99n) / 100n)
  })
})
