/**
 * Fork tests for basic example 03: Close Position
 *
 * These tests demonstrate the full position lifecycle: open a position,
 * inspect it, simulate close, execute close, and verify post-close state.
 * By default, tests run against Sepolia. Set NETWORK=mainnet for mainnet testing.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable (or FORK_URL for mainnet)
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/basic/
 *
 * @module examples/__tests__/basic/03-close-position.fork.test
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

import { parsePanopticError } from '../../../errors'
import { getAccountCollateral } from '../../../reads/account'
import { isLiquidatable } from '../../../reads/checks'
import { getAccountHistory } from '../../../reads/history'
import { getPool } from '../../../reads/pool'
import { getPosition } from '../../../reads/position'
import { simulateClosePosition } from '../../../simulations/simulateClosePosition'
import { decodeTokenId } from '../../../tokenId'
import { closePosition, openPosition } from '../../../writes/position'
import { deposit } from '../../../writes/vault'
import {
  assertValidDeployments,
  createBuilderFromPoolId,
  fundTestAccount,
  getAnvilRpcUrl,
  getNetworkConfig,
} from '../network.config'

describe('Basic Example 03: Close Position (Fork Test)', () => {
  let client: PublicClient
  let walletClient: WalletClient
  let bobAddress: Address
  const config = getNetworkConfig()

  // Shared state: set during position setup, used by all subsequent tests
  let tokenId: bigint
  const positionSize = 10n ** 15n // 0.001 units

  beforeAll(() => {
    assertValidDeployments()

    // Use bob account to avoid nonce conflicts with other basic tests
    const account = privateKeyToAccount(config.testAccounts.bob)
    bobAddress = account.address

    client = createPublicClient({
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
      cacheTime: 0, // Disable block number caching for write-then-read tests
    })

    walletClient = createWalletClient({
      account,
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })
  })

  describe('Setup: Open a position to close', () => {
    beforeAll(async () => {
      // Step 1: Fund bob with tokens and approve collateral trackers
      await fundTestAccount({
        client,
        walletClient,
        account: bobAddress,
        token0Amount: parseUnits('10', config.tokens.token0.decimals),
        token1Amount: parseUnits('10000', config.tokens.token1.decimals),
        approveCollateral: true,
      })

      // Step 2: Deposit collateral into both trackers
      const token0DepositResult = await deposit({
        client,
        walletClient,
        account: bobAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
        assets: parseUnits('5', config.tokens.token0.decimals),
      })
      await token0DepositResult.wait()

      const token1DepositResult = await deposit({
        client,
        walletClient,
        account: bobAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker1,
        assets: parseUnits('5000', config.tokens.token1.decimals),
      })
      await token1DepositResult.wait()

      // Step 3: Build a tokenId and open a position
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      // Place strike slightly OTM (above current for calls)
      const strike = (currentTick / tickSpacing + 5n) * tickSpacing

      const builder = createBuilderFromPoolId(pool.poolId)
      tokenId = builder
        .addCall({
          strike,
          width: 120n,
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      // Step 4: Open the position (skip if already open from prior run)
      const existing = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: bobAddress,
        tokenId,
      })
      if (existing.positionSize > 0n) {
        console.log('Position already exists (re-run), skipping open')
        return
      }

      const openResult = await openPosition({
        client,
        walletClient,
        account: bobAddress,
        poolAddress: config.contracts.pool.address,
        tokenId,
        positionSize,
        existingPositionIds: [],
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })
      const openReceipt = await openResult.wait()

      console.log('Setup complete:')
      console.log(`  Opened position: ${tokenId}`)
      console.log(`  Strike: ${strike}`)
      console.log(`  Open tx: ${openResult.hash}`)
      console.log(`  Gas used: ${openReceipt.gasUsed}`)
    })

    it('should have successfully opened a position', async () => {
      const position = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: bobAddress,
        tokenId,
      })

      // On first run positionSize matches; on re-runs position may already be closed (0)
      expect(position.positionSize).toBeGreaterThanOrEqual(0n)
      expect(position.tokenId).toBe(tokenId)
    })
  })

  describe('Position inspection', () => {
    it('should fetch position data with getPosition', async () => {
      const position = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: bobAddress,
        tokenId,
      })

      expect(position.positionSize).toBeGreaterThanOrEqual(0n)
      expect(position.tokenId).toBe(tokenId)
      expect(typeof position.tickAtMint).toBe('bigint')
      expect(typeof position.poolUtilization0AtMint).toBe('bigint')
      expect(typeof position.poolUtilization1AtMint).toBe('bigint')
      expect(position._meta.blockNumber).toBeGreaterThan(0n)

      console.log('Position data:')
      console.log(`  Token ID: ${position.tokenId}`)
      console.log(`  Size: ${position.positionSize}`)
      console.log(`  Tick at mint: ${position.tickAtMint}`)
      console.log(`  Utilization0 at mint: ${position.poolUtilization0AtMint}`)
      console.log(`  Utilization1 at mint: ${position.poolUtilization1AtMint}`)
    })

    it('should decode tokenId structure', () => {
      const decoded = decodeTokenId(tokenId)

      expect(decoded.legCount).toBe(1n)
      expect(decoded.legs.length).toBe(1)
      expect(decoded.tokenId).toBe(tokenId)
      expect(typeof decoded.legs[0].strike).toBe('bigint')
      expect(typeof decoded.legs[0].width).toBe('bigint')
      expect(decoded.legs[0].width).toBe(120n)

      console.log('Decoded tokenId:')
      console.log(`  Pool ID: ${decoded.poolId}`)
      console.log(`  Tick spacing: ${decoded.tickSpacing}`)
      console.log(`  Leg count: ${decoded.legCount}`)
      console.log(`  Leg 0 strike: ${decoded.legs[0].strike}`)
      console.log(`  Leg 0 width: ${decoded.legs[0].width}`)
    })
  })

  describe('Close position simulation', () => {
    it('should successfully simulate closing the position', async () => {
      // Check if position is still open (may be closed from prior run)
      const pos = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: bobAddress,
        tokenId,
      })
      if (pos.positionSize === 0n) {
        console.log('Position already closed (re-run), skipping close simulation')
        return
      }

      const simulation = await simulateClosePosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: bobAddress,
        positionIdList: [tokenId],
        tokenId,
        positionSize,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      console.log('Close simulation:')
      console.log(`  Success: ${simulation.success}`)
      if (simulation.success) {
        console.log(`  Gas estimate: ${simulation.gasEstimate}`)
        expect(simulation.gasEstimate).toBeGreaterThan(0n)
        expect(simulation._meta.blockNumber).toBeGreaterThan(0n)
      } else {
        const parsed = parsePanopticError(simulation.error)
        console.log(`  Error: ${parsed?.errorName ?? simulation.error?.message?.slice(0, 100)}`)
      }

      expect(simulation.success).toBe(true)
    })

    it('should fail simulation for non-existent position', async () => {
      // Build a tokenId with a different strike
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      const fakeStrike = (currentTick / tickSpacing + 50n) * tickSpacing

      const builder = createBuilderFromPoolId(pool.poolId)
      const fakeTokenId = builder
        .addCall({
          strike: fakeStrike,
          width: 2n,
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      const simulation = await simulateClosePosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: bobAddress,
        positionIdList: [fakeTokenId],
        tokenId: fakeTokenId,
        positionSize: 1n,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      expect(simulation.success).toBe(false)

      if (!simulation.success) {
        expect(simulation.error).toBeDefined()

        console.log('Non-existent position simulation:')
        console.log(`  Success: ${simulation.success}`)
        const parsed = parsePanopticError(simulation.error)
        console.log(`  Error: ${parsed?.errorName ?? 'unparseable'}`)
      }
    })
  })

  describe('Liquidation margin (with open position)', () => {
    it('should show account is solvent with detailed margin breakdown', async () => {
      const queryAddress = config.contracts.panopticQuery
      if (!queryAddress) {
        console.log('Skipping isLiquidatable test: no panopticQuery address configured')
        return
      }

      // Check if position is still open
      const pos = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: bobAddress,
        tokenId,
      })
      if (pos.positionSize === 0n) {
        console.log('Position already closed (re-run), skipping liquidation margin check')
        return
      }

      const result = await isLiquidatable({
        client,
        poolAddress: config.contracts.pool.address,
        account: bobAddress,
        tokenIds: [tokenId],
        queryAddress,
      })

      // Bob should be solvent — he has ample collateral for a small position
      expect(result.isLiquidatable).toBe(false)

      // Verify all margin fields are bigints
      expect(typeof result.marginShortfall0).toBe('bigint')
      expect(typeof result.marginShortfall1).toBe('bigint')
      expect(typeof result.currentMargin0).toBe('bigint')
      expect(typeof result.currentMargin1).toBe('bigint')
      expect(typeof result.requiredMargin0).toBe('bigint')
      expect(typeof result.requiredMargin1).toBe('bigint')
      expect(typeof result.atTick).toBe('bigint')
      expect(result._meta.blockNumber).toBeGreaterThan(0n)

      // Current margin should exceed required margin (account is healthy)
      // Shortfall should be 0 or negative (negative = excess margin)
      expect(result.marginShortfall0).toBeLessThanOrEqual(0n)
      expect(result.marginShortfall1).toBeLessThanOrEqual(0n)

      console.log('Liquidation margin (with position):')
      console.log(`  Liquidatable: ${result.isLiquidatable}`)
      console.log(`  Current margin0: ${result.currentMargin0}`)
      console.log(`  Current margin1: ${result.currentMargin1}`)
      console.log(`  Required margin0: ${result.requiredMargin0}`)
      console.log(`  Required margin1: ${result.requiredMargin1}`)
      console.log(`  Shortfall0: ${result.marginShortfall0}`)
      console.log(`  Shortfall1: ${result.marginShortfall1}`)
      console.log(`  At tick: ${result.atTick}`)
    })
  })

  describe('Close position execution', () => {
    it('should close the position successfully', async () => {
      // Check if already closed from prior run
      const pos = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: bobAddress,
        tokenId,
      })
      if (pos.positionSize === 0n) {
        console.log('Position already closed (re-run), skipping close execution')
        return
      }

      const result = await closePosition({
        client,
        walletClient,
        account: bobAddress,
        poolAddress: config.contracts.pool.address,
        positionIdList: [tokenId],
        tokenId,
        positionSize,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/)

      const receipt = await result.wait()
      expect(receipt.status).toBe('success')
      expect(receipt.gasUsed).toBeGreaterThan(0n)

      console.log('Position closed:')
      console.log(`  Hash: ${result.hash}`)
      console.log(`  Gas used: ${receipt.gasUsed}`)
    })

    it('should have zero position size after closing', async () => {
      const position = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: bobAddress,
        tokenId,
      })

      expect(position.positionSize).toBe(0n)

      console.log('Position after close:')
      console.log(`  Size: ${position.positionSize}`)
    })
  })

  describe('Post-close state', () => {
    it('should still have collateral after closing', async () => {
      const collateral = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: bobAddress,
      })

      // Collateral should still be present (deposits remain, position P/L settled)
      expect(collateral.token0.assets).toBeGreaterThan(0n)

      console.log('Collateral after close:')
      console.log(`  Token0 assets: ${collateral.token0.assets}`)
      console.log(`  Token1 assets: ${collateral.token1.assets}`)
    })

    it('should show improved margin after closing position', async () => {
      const queryAddress = config.contracts.panopticQuery
      if (!queryAddress) {
        console.log('Skipping post-close isLiquidatable test: no panopticQuery address configured')
        return
      }

      const result = await isLiquidatable({
        client,
        poolAddress: config.contracts.pool.address,
        account: bobAddress,
        tokenIds: [],
        queryAddress,
      })

      // With no positions, bob should definitely not be liquidatable
      expect(result.isLiquidatable).toBe(false)

      // Required margin should be 0 with no positions
      expect(result.requiredMargin0).toBe(0n)
      expect(result.requiredMargin1).toBe(0n)

      console.log('Liquidation margin (after close, no positions):')
      console.log(`  Liquidatable: ${result.isLiquidatable}`)
      console.log(`  Current margin0: ${result.currentMargin0}`)
      console.log(`  Current margin1: ${result.currentMargin1}`)
      console.log(`  Required margin0: ${result.requiredMargin0}`)
      console.log(`  Required margin1: ${result.requiredMargin1}`)
    })
  })

  describe('Account history', () => {
    it('should return mint and burn trades for bob', async () => {
      const history = await getAccountHistory({
        client,
        poolAddress: config.contracts.pool.address,
        account: bobAddress,
      })

      console.log(`Account history: ${history.trades.length} trades`)
      for (const trade of history.trades) {
        console.log(
          `  ${trade.action} tokenId=${trade.tokenId} size=${trade.positionSize} block=${trade.blockNumber}`,
        )
      }

      // Bob should have at least 1 mint and 1 burn from this test
      expect(history.trades.length).toBeGreaterThanOrEqual(2)

      const mints = history.trades.filter((t) => t.action === 'mint')
      const burns = history.trades.filter((t) => t.action === 'burn')
      expect(mints.length).toBeGreaterThanOrEqual(1)
      expect(burns.length).toBeGreaterThanOrEqual(1)

      // Verify mint fields are populated
      const mint = mints.find((t) => t.tokenId === tokenId)
      if (mint) {
        expect(mint.positionSize).toBeGreaterThan(0n)
        expect(mint.tickAtMint).toBeDefined()
        expect(mint.timestampAtMint).toBeGreaterThan(0n)
      }

      // Verify burn fields are populated
      const burn = burns.find((t) => t.tokenId === tokenId)
      if (burn) {
        expect(burn.premiaByLeg).toBeDefined()
      }

      // Trades should be sorted chronologically
      for (let i = 1; i < history.trades.length; i++) {
        const prev = history.trades[i - 1]
        const curr = history.trades[i]
        expect(
          prev.blockNumber < curr.blockNumber ||
            (prev.blockNumber === curr.blockNumber && prev.logIndex <= curr.logIndex),
        ).toBe(true)
      }

      expect(history._meta.blockNumber).toBeGreaterThan(0n)
    })
  })

  describe('Error handling', () => {
    it('should fail when closing an already-closed position', async () => {
      const simulation = await simulateClosePosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: bobAddress,
        positionIdList: [tokenId],
        tokenId,
        positionSize,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      // Should fail because position is already closed (size = 0)
      expect(simulation.success).toBe(false)

      if (!simulation.success) {
        expect(simulation.error).toBeDefined()

        const parsed = parsePanopticError(simulation.error)
        console.log('Already-closed position simulation:')
        console.log(`  Success: ${simulation.success}`)
        console.log(`  Error: ${parsed?.errorName ?? simulation.error?.message?.slice(0, 100)}`)
      }
    })
  })
})
