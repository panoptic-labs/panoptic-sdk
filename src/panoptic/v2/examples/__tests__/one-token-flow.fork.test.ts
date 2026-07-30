/**
 * Fork tests for "one token out" closes.
 *
 * `simulations/oneTokenFlow.ts` wraps an arbitrary dispatch with a width=0
 * credit leg so the account's net change lands in a single collateral token —
 * sourcing the other token when the close pays it (exact-out, credit legs
 * straddling the user's ops) and selling it when the close receives it
 * (exact-in, credit legs appended after them).
 *
 * The leg ORDERING is the whole mechanism (`swapAtMint` is the order of the
 * tick-limit pair, not a calldata flag) and cannot be verified off-chain, so
 * these tests are the only coverage that the wrap actually nets out.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable (or FORK_URL for mainnet)
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm --filter panoptic-v2-sdk test:fork
 *
 * @module examples/__tests__/one-token-flow.fork.test
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
import { getPool } from '../../reads/pool'
import { getPosition } from '../../reads/position'
import type { DispatchIntent } from '../../simulations/creditWrap'
import { quoteOneTokenFlow } from '../../simulations/oneTokenFlow'
import { simulateDispatch } from '../../simulations/simulateDispatch'
import { MAX_TICK, MIN_TICK } from '../../utils/constants'
import { dispatch } from '../../writes/dispatch'
import { openPosition } from '../../writes/position'
import { depositAndWait } from '../../writes/vault'
import {
  assertValidDeployments,
  createTokenIdBuilder,
  fundTestAccount,
  getAnvilRpcUrl,
  getNetworkConfig,
} from './network.config'

const SLIPPAGE_BPS = 500n // 5% — fork pools can be thin

/**
 * How much residual dust a single-pass sizing may leave, as a fraction of the
 * amount that was swapped away. The wrap shifts fees and commission slightly,
 * so the cancelled side lands near — not exactly at — zero.
 */
const MAX_RESIDUAL_BPS = 500n

const abs = (value: bigint): bigint => (value < 0n ? -value : value)

describe('One-token-out close (fork test)', () => {
  let client: PublicClient
  let walletClient: WalletClient
  let accountAddress: Address
  const config = getNetworkConfig()

  // A straddle: a call and a put at the same strike. Whichever side the price
  // sits on, one leg settles in each token — exactly the two-token close this
  // feature exists to collapse.
  let tokenId: bigint
  const positionSize = 10n ** 15n

  const collateral = async (): Promise<{ balance0: bigint; balance1: bigint }> => {
    const acct = await getAccountCollateral({
      client,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
    })
    return { balance0: acct.token0.assets, balance1: acct.token1.assets }
  }

  /** The plain close of the straddle, unwrapped. */
  const closeIntent = (): DispatchIntent => ({
    positionIdList: [tokenId],
    finalPositionIdList: [],
    positionSizes: [0n],
    tickAndSpreadLimits: [[MIN_TICK, MAX_TICK, 0n]],
    usePremiaAsCollateral: false,
    builderCode: 0n,
  })

  beforeAll(async () => {
    assertValidDeployments()

    // carol: this file owns its own account so nonces don't collide with the
    // other fork suites (alice, bob, dave, eve, frank).
    const account = privateKeyToAccount(config.testAccounts.carol)
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
      token0Amount: parseUnits('20', config.tokens.token0.decimals),
      token1Amount: parseUnits('50000', config.tokens.token1.decimals),
      approveCollateral: true,
    })

    // Both sides need deposited collateral: the credit is paid out of it, and
    // the exact-out direction is refused outright if the target side can't fund
    // the swap.
    await depositAndWait({
      client,
      walletClient,
      account: accountAddress,
      collateralTrackerAddress: config.contracts.pool.collateralTracker0,
      assets: parseUnits('10', config.tokens.token0.decimals),
    })
    await depositAndWait({
      client,
      walletClient,
      account: accountAddress,
      collateralTrackerAddress: config.contracts.pool.collateralTracker1,
      assets: parseUnits('20000', config.tokens.token1.decimals),
    })

    const pool = await getPool({
      client,
      poolAddress: config.contracts.pool.address,
      chainId: config.chainId,
    })
    const strike = (pool.currentTick / pool.tickSpacing) * pool.tickSpacing
    tokenId = createTokenIdBuilder(pool.poolId)
      .addCall({ strike, width: 120n, optionRatio: 1n, isLong: false })
      .addPut({ strike, width: 120n, optionRatio: 1n, isLong: false })
      .build()

    const existing = await getPosition({
      client,
      poolAddress: config.contracts.pool.address,
      owner: accountAddress,
      tokenId,
    })
    if (existing.positionSize > 0n) return

    const open = await openPosition({
      client,
      walletClient,
      account: accountAddress,
      poolAddress: config.contracts.pool.address,
      tokenId,
      positionSize,
      existingPositionIds: [],
      tickLimitLow: MIN_TICK,
      tickLimitHigh: MAX_TICK,
    })
    await open.wait()
  })

  it('the plain close moves BOTH tokens — the case this feature collapses', async () => {
    const simulation = await simulateDispatch({
      client,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
      existingPositionIdList: [tokenId],
      ...closeIntent(),
    })

    expect(simulation.success).toBe(true)
    if (!simulation.success || simulation.tokenFlow === undefined) return
    expect(simulation.tokenFlow.delta0).not.toBe(0n)
    expect(simulation.tokenFlow.delta1).not.toBe(0n)
  })

  it.each([
    { target: 0n, label: 'token0' },
    { target: 1n, label: 'token1' },
  ])('routes the whole close into $label', async ({ target }) => {
    const result = await quoteOneTokenFlow({
      client,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
      chainId: config.chainId,
      existingPositionIds: [tokenId],
      dispatch: closeIntent(),
      targetTokenIndex: target,
      slippageBps: SLIPPAGE_BPS,
    })

    expect(result.available).toBe(true)
    if (!result.available) return
    const { quote } = result

    // The direction must follow the sign of the flow being cancelled, and the
    // leg placement must follow the direction.
    const legCount = quote.dispatch.positionIdList.length
    expect(legCount).toBe(closeIntent().positionIdList.length + 2)
    if (quote.direction === 'exact-out') {
      expect(quote.dispatch.positionIdList[0]).toBe(quote.creditTokenId)
    } else {
      expect(quote.dispatch.positionIdList[legCount - 2]).toBe(quote.creditTokenId)
    }
    expect(quote.dispatch.positionIdList[legCount - 1]).toBe(quote.creditTokenId)

    // The point of the whole exercise: the cancelled side is dust relative to
    // what was swapped away, while the target side carries the P&L.
    expect(abs(quote.residualOtherChange) * 10_000n).toBeLessThanOrEqual(
      quote.swapAmount * MAX_RESIDUAL_BPS,
    )
    expect(quote.netTargetChange).not.toBe(0n)
  })

  it('executes the wrapped close, leaving one token changed and no credit behind', async () => {
    const position = await getPosition({
      client,
      poolAddress: config.contracts.pool.address,
      owner: accountAddress,
      tokenId,
    })
    if (position.positionSize === 0n) {
      console.log('Position already closed (re-run), skipping execution')
      return
    }

    const result = await quoteOneTokenFlow({
      client,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
      chainId: config.chainId,
      existingPositionIds: [tokenId],
      dispatch: closeIntent(),
      targetTokenIndex: 1n,
      slippageBps: SLIPPAGE_BPS,
    })
    expect(result.available).toBe(true)
    if (!result.available) return

    const before = await collateral()
    const sent = await dispatch({
      client,
      walletClient,
      account: accountAddress,
      poolAddress: config.contracts.pool.address,
      ...result.quote.dispatch,
    })
    const receipt = await sent.wait()
    expect(receipt.status).toBe('success')

    const after = await collateral()
    // token0 (the cancelled side) barely moves; token1 absorbs everything.
    expect(abs(after.balance0 - before.balance0) * 10_000n).toBeLessThanOrEqual(
      result.quote.swapAmount * MAX_RESIDUAL_BPS,
    )
    expect(after.balance1).not.toBe(before.balance1)

    // The straddle is gone and the temporary credit opened and closed in the
    // same dispatch, so nothing is left behind.
    const closed = await getPosition({
      client,
      poolAddress: config.contracts.pool.address,
      owner: accountAddress,
      tokenId,
    })
    expect(closed.positionSize).toBe(0n)
    const credit = await getPosition({
      client,
      poolAddress: config.contracts.pool.address,
      owner: accountAddress,
      tokenId: result.quote.creditTokenId,
    })
    expect(credit.positionSize).toBe(0n)
  })

  it('reports already-single-token for a dispatch that moves one side only', async () => {
    const result = await quoteOneTokenFlow({
      client,
      poolAddress: config.contracts.pool.address,
      account: accountAddress,
      chainId: config.chainId,
      existingPositionIds: [],
      // An empty dispatch moves nothing at all, so neither side needs cancelling.
      dispatch: {
        positionIdList: [],
        finalPositionIdList: [],
        positionSizes: [],
        tickAndSpreadLimits: [],
        usePremiaAsCollateral: false,
        builderCode: 0n,
      },
      targetTokenIndex: 1n,
      slippageBps: SLIPPAGE_BPS,
    })

    expect(result).toMatchObject({ available: false, reason: 'already-single-token' })
  })
})
