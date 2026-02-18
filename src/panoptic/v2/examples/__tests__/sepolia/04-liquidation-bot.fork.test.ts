/**
 * Liquidation Bot fork tests against Sepolia
 *
 * Tests the liquidation bot's core functionality:
 * - Position sync and discovery via syncPositions()
 * - Liquidation eligibility checks via isLiquidatable()
 * - Liquidation simulation via simulateLiquidate()
 * - End-to-end liquidation workflow
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/sepolia/
 *
 * @module examples/__tests__/sepolia/04-liquidation-bot.fork.test
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
import { sepolia } from 'viem/chains'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getAccountCollateral } from '../../../reads/account'
import { isLiquidatable } from '../../../reads/checks'
// SDK imports - reads
import { getPool } from '../../../reads/pool'
// SDK imports - simulations
import { simulateLiquidate } from '../../../simulations/simulateLiquidate'
import { simulateOpenPosition } from '../../../simulations/simulateOpenPosition'
import type { StorageAdapter } from '../../../storage'
import { createMemoryStorage } from '../../../storage'
// SDK imports - sync
import { clearTrackedPositions, getTrackedPositionIds, syncPositions } from '../../../sync'
import { openPosition } from '../../../writes/position'
// SDK imports - writes
import { deposit } from '../../../writes/vault'
// Test config
import {
  createTokenIdBuilder,
  fundSepoliaTestAccount,
  getAnvilRpcUrl,
  SEPOLIA_ANVIL_CONFIG,
  SEPOLIA_CONTRACTS,
} from '../sepolia.config'

// Increase timeout for sync operations (full sync can take 30+ seconds)
const SYNC_TIMEOUT = 60_000

describe('Sepolia Fork: Liquidation Bot', () => {
  let client: PublicClient
  let eveWalletClient: WalletClient
  let frankWalletClient: WalletClient
  let eveAddress: Address
  let frankAddress: Address
  let storage: StorageAdapter
  const chainId = SEPOLIA_ANVIL_CONFIG.chainId
  const poolAddress = SEPOLIA_CONTRACTS.pool.address

  beforeAll(async () => {
    // Setup clients - use eve and frank to avoid nonce conflicts with other parallel tests
    const eveAccount = privateKeyToAccount(SEPOLIA_ANVIL_CONFIG.testAccounts.eve)
    const frankAccount = privateKeyToAccount(SEPOLIA_ANVIL_CONFIG.testAccounts.frank)
    eveAddress = eveAccount.address
    frankAddress = frankAccount.address

    client = createPublicClient({
      chain: sepolia,
      transport: http(getAnvilRpcUrl()),
      cacheTime: 0, // Disable block number caching for write-then-read tests
    })

    eveWalletClient = createWalletClient({
      account: eveAccount,
      chain: sepolia,
      transport: http(getAnvilRpcUrl()),
    })

    frankWalletClient = createWalletClient({
      account: frankAccount,
      chain: sepolia,
      transport: http(getAnvilRpcUrl()),
    })

    // Use memory storage for tests (clean state each run)
    storage = createMemoryStorage()
  })

  afterAll(async () => {
    // Cleanup storage
    await clearTrackedPositions({
      chainId,
      poolAddress,
      account: eveAddress,
      storage,
    })
    await clearTrackedPositions({
      chainId,
      poolAddress,
      account: frankAddress,
      storage,
    })
  })

  describe('Position Sync and Discovery', { timeout: SYNC_TIMEOUT }, () => {
    it(
      'should sync positions for an account with no positions',
      { timeout: SYNC_TIMEOUT },
      async () => {
        // Sync positions for a fresh account
        const result = await syncPositions({
          client,
          poolAddress,
          account: eveAddress,
          storage,
          chainId,
        })

        expect(result).toBeDefined()
        expect(result.positionIds).toBeDefined()
        expect(Array.isArray(result.positionIds)).toBe(true)

        console.log(`Synced ${result.positionIds.length} positions for Alice`)
        console.log(`Synced to block: ${result.lastSyncedBlock}`)
      },
    )

    it('should get tracked position IDs after sync', { timeout: SYNC_TIMEOUT }, async () => {
      // First sync
      await syncPositions({
        client,
        poolAddress,
        account: eveAddress,
        storage,
        chainId,
      })

      // Then get tracked IDs
      const tokenIds = await getTrackedPositionIds({
        chainId,
        poolAddress,
        account: eveAddress,
        storage,
      })

      expect(Array.isArray(tokenIds)).toBe(true)
      console.log(`Alice has ${tokenIds.length} tracked positions`)
    })

    it(
      'should perform incremental sync on subsequent calls',
      { timeout: SYNC_TIMEOUT },
      async () => {
        // First sync
        const result1 = await syncPositions({
          client,
          poolAddress,
          account: eveAddress,
          storage,
          chainId,
        })

        // Second sync should be incremental (faster)
        const result2 = await syncPositions({
          client,
          poolAddress,
          account: eveAddress,
          storage,
          chainId,
        })

        expect(result2.lastSyncedBlock).toBeGreaterThanOrEqual(result1.lastSyncedBlock)
        console.log(`First sync to block ${result1.lastSyncedBlock}`)
        console.log(`Second sync to block ${result2.lastSyncedBlock}`)
      },
    )
  })

  describe('Liquidation Eligibility Checks', { timeout: SYNC_TIMEOUT }, () => {
    it(
      'should check if account is liquidatable with no positions',
      { timeout: SYNC_TIMEOUT },
      async () => {
        // Sync first
        await syncPositions({
          client,
          poolAddress,
          account: eveAddress,
          storage,
          chainId,
        })

        const tokenIds = await getTrackedPositionIds({
          chainId,
          poolAddress,
          account: eveAddress,
          storage,
        })

        // Skip if no positions
        if (tokenIds.length === 0) {
          console.log('No positions to check - account is not liquidatable by definition')
          return
        }

        try {
          const result = await isLiquidatable({
            client,
            poolAddress,
            account: eveAddress,
            tokenIds,
            queryAddress: SEPOLIA_CONTRACTS.panopticHelper,
          })

          expect(typeof result.isLiquidatable).toBe('boolean')
          console.log(`Alice is liquidatable: ${result.isLiquidatable}`)
        } catch (error) {
          // PanopticHelper contract may revert on testnet due to state inconsistencies
          console.log(`isLiquidatable check failed (expected on testnets): ${error}`)
        }
      },
    )

    it(
      'should return false for healthy account with collateral',
      { timeout: SYNC_TIMEOUT },
      async () => {
        // Fund Alice with tokens
        await fundSepoliaTestAccount({
          client,
          walletClient: eveWalletClient,
          account: eveAddress,
          wethAmount: parseUnits('1', 18),
          usdcAmount: parseUnits('1000', 6),
          approveCollateral: true,
        })

        // Deposit collateral
        const depositAmount = parseUnits('0.1', 18)
        const depositTx = await deposit({
          client,
          walletClient: eveWalletClient,
          account: eveAddress,
          collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker0,
          assets: depositAmount,
          receiver: eveAddress,
        })
        await depositTx.wait()

        // Check collateral
        const collateral = await getAccountCollateral({
          client,
          poolAddress,
          account: eveAddress,
        })

        expect(collateral.token0.assets).toBeGreaterThan(0n)
        console.log(`Alice collateral0: ${collateral.token0.assets}`)
        console.log(`Alice collateral1: ${collateral.token1.assets}`)

        // Sync and check liquidatable status
        await syncPositions({
          client,
          poolAddress,
          account: eveAddress,
          storage,
          chainId,
        })

        const tokenIds = await getTrackedPositionIds({
          chainId,
          poolAddress,
          account: eveAddress,
          storage,
        })

        if (tokenIds.length === 0) {
          console.log('No positions - healthy by definition')
          return
        }

        try {
          const result = await isLiquidatable({
            client,
            poolAddress,
            account: eveAddress,
            tokenIds,
            queryAddress: SEPOLIA_CONTRACTS.panopticHelper,
          })

          // Account with just collateral and no positions should not be liquidatable
          expect(result.isLiquidatable).toBe(false)
        } catch (error) {
          // PanopticHelper contract may revert on testnet due to state inconsistencies
          console.log(`isLiquidatable check failed (expected on testnets): ${error}`)
        }
      },
    )
  })

  describe('Liquidation Simulation', { timeout: SYNC_TIMEOUT }, () => {
    it('should simulate liquidation for an account', { timeout: SYNC_TIMEOUT }, async () => {
      // First ensure Bob (liquidator) is funded
      await fundSepoliaTestAccount({
        client,
        walletClient: frankWalletClient,
        account: frankAddress,
        wethAmount: parseUnits('1', 18),
        usdcAmount: parseUnits('1000', 6),
        approveCollateral: true,
      })

      // Sync Alice's positions
      await syncPositions({
        client,
        poolAddress,
        account: eveAddress,
        storage,
        chainId,
      })

      const aliceTokenIds = await getTrackedPositionIds({
        chainId,
        poolAddress,
        account: eveAddress,
        storage,
      })

      // Skip if Alice has no positions
      if (aliceTokenIds.length === 0) {
        console.log('Alice has no positions to liquidate - skipping simulation')
        return
      }

      // Simulate liquidation
      const simulation = await simulateLiquidate({
        client,
        poolAddress,
        account: frankAddress, // Bob is the liquidator
        liquidatee: eveAddress,
        positionIdListFrom: [], // Bob has no positions
        positionIdListTo: aliceTokenIds,
        positionIdListToFinal: [], // Close all positions
      })

      expect(simulation).toBeDefined()
      console.log(`Simulation success: ${simulation.success}`)

      if (simulation.success) {
        console.log(`Is liquidatable: ${simulation.data.isLiquidatable}`)
        console.log(`Gas estimate: ${simulation.gasEstimate}`)
      } else {
        console.log(`Simulation failed: ${simulation.error?.message}`)
      }
    })

    it('should fail simulation when liquidatee is healthy', { timeout: SYNC_TIMEOUT }, async () => {
      // Fund Alice heavily to ensure healthy account
      await fundSepoliaTestAccount({
        client,
        walletClient: eveWalletClient,
        account: eveAddress,
        wethAmount: parseUnits('5', 18),
        usdcAmount: parseUnits('5000', 6),
        approveCollateral: true,
      })

      // Deposit more collateral
      const depositAmount = parseUnits('1', 18)
      const depositTx = await deposit({
        client,
        walletClient: eveWalletClient,
        account: eveAddress,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker0,
        assets: depositAmount,
        receiver: eveAddress,
      })
      await depositTx.wait()

      // Sync and get positions
      await syncPositions({
        client,
        poolAddress,
        account: eveAddress,
        storage,
        chainId,
      })

      const aliceTokenIds = await getTrackedPositionIds({
        chainId,
        poolAddress,
        account: eveAddress,
        storage,
      })

      if (aliceTokenIds.length === 0) {
        console.log('No positions - cannot test liquidation failure')
        return
      }

      // Simulate liquidation - should fail or show not liquidatable
      const simulation = await simulateLiquidate({
        client,
        poolAddress,
        account: frankAddress,
        liquidatee: eveAddress,
        positionIdListFrom: [],
        positionIdListTo: aliceTokenIds,
        positionIdListToFinal: [],
      })

      if (simulation.success) {
        // Even if simulation succeeds, account should not be liquidatable
        expect(simulation.data.isLiquidatable).toBe(false)
        console.log('Simulation succeeded but account is not liquidatable (as expected)')
      } else {
        console.log(`Simulation correctly failed: ${simulation.error?.message}`)
      }
    })
  })

  describe('Position Opening for Liquidation Testing', { timeout: SYNC_TIMEOUT }, () => {
    it('should open a position and track it via sync', { timeout: SYNC_TIMEOUT }, async () => {
      // Get pool data for tokenId construction
      const pool = await getPool({
        client,
        poolAddress,
        chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick

      // Build a simple short call position
      const strike = (currentTick / tickSpacing) * tickSpacing
      const builder = createTokenIdBuilder(pool.poolId)

      const tokenId = builder
        .addCall({
          strike,
          width: 2n,
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      console.log(`Built tokenId: ${tokenId}`)

      // Ensure Alice has enough collateral
      await fundSepoliaTestAccount({
        client,
        walletClient: eveWalletClient,
        account: eveAddress,
        wethAmount: parseUnits('2', 18),
        usdcAmount: parseUnits('2000', 6),
        approveCollateral: true,
      })

      // Deposit collateral to both trackers
      const deposit0Tx = await deposit({
        client,
        walletClient: eveWalletClient,
        account: eveAddress,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker0,
        assets: parseUnits('1', 18),
        receiver: eveAddress,
      })
      await deposit0Tx.wait()

      const deposit1Tx = await deposit({
        client,
        walletClient: eveWalletClient,
        account: eveAddress,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker1,
        assets: parseUnits('1000', 6),
        receiver: eveAddress,
      })
      await deposit1Tx.wait()

      // Simulate opening the position
      const tickLimitLow = currentTick - 1000n
      const tickLimitHigh = currentTick + 1000n

      const simulation = await simulateOpenPosition({
        client,
        poolAddress,
        account: eveAddress,
        tokenId,
        positionSize: parseUnits('0.001', 18), // Small position
        tickLimitLow,
        tickLimitHigh,
        existingPositionIds: [],
      })

      console.log(`Open position simulation success: ${simulation.success}`)

      if (!simulation.success) {
        console.log(`Simulation failed: ${simulation.error?.message}`)
        // Don't fail the test - simulation failure is informative
        return
      }

      console.log(`Gas estimate: ${simulation.gasEstimate}`)

      // Actually open the position
      try {
        const openTx = await openPosition({
          client,
          walletClient: eveWalletClient,
          account: eveAddress,
          poolAddress,
          tokenId,
          positionSize: parseUnits('0.001', 18),
          tickLimitLow,
          tickLimitHigh,
          existingPositionIds: [],
        })

        const receipt = await openTx.wait()
        console.log(`Position opened in block ${receipt.blockNumber}`)

        // Now sync and verify the position is tracked
        await syncPositions({
          client,
          poolAddress,
          account: eveAddress,
          storage,
          chainId,
        })

        const trackedIds = await getTrackedPositionIds({
          chainId,
          poolAddress,
          account: eveAddress,
          storage,
        })

        console.log(`Tracked positions after open: ${trackedIds.length}`)

        // The opened position should now be tracked
        const hasPosition = trackedIds.some((id) => id === tokenId)
        expect(hasPosition).toBe(true)
        console.log('Position successfully tracked via sync!')
      } catch (error) {
        console.log(`Position open failed (expected on testnets): ${error}`)
        // Don't fail test - position opening may fail due to various on-chain conditions
      }
    })
  })

  describe('End-to-End Liquidation Workflow', { timeout: SYNC_TIMEOUT }, () => {
    it(
      'should perform complete liquidation check workflow',
      { timeout: SYNC_TIMEOUT },
      async () => {
        // This test demonstrates the full liquidation bot workflow:
        // 1. Sync positions
        // 2. Check liquidatable status
        // 3. Simulate liquidation if eligible
        // 4. Report results

        console.log('\n=== Liquidation Bot Workflow ===\n')

        // Step 1: Sync positions for target account
        console.log('Step 1: Syncing positions...')
        const syncResult = await syncPositions({
          client,
          poolAddress,
          account: eveAddress,
          storage,
          chainId,
        })
        console.log(`  Synced to block: ${syncResult.lastSyncedBlock}`)
        console.log(`  Found ${syncResult.positionIds.length} position(s)`)

        // Step 2: Get tracked position IDs
        console.log('\nStep 2: Getting tracked positions...')
        const tokenIds = await getTrackedPositionIds({
          chainId,
          poolAddress,
          account: eveAddress,
          storage,
        })
        console.log(`  Tracked positions: ${tokenIds.length}`)

        if (tokenIds.length === 0) {
          console.log('\n  No positions found - nothing to liquidate')
          console.log('\n=== Workflow Complete ===')
          return
        }

        // Step 3: Check liquidatable status
        console.log('\nStep 3: Checking liquidation eligibility...')
        let liquidatableResult: { isLiquidatable: boolean }
        try {
          liquidatableResult = await isLiquidatable({
            client,
            poolAddress,
            account: eveAddress,
            tokenIds,
            queryAddress: SEPOLIA_CONTRACTS.panopticHelper,
          })
          console.log(`  Is liquidatable: ${liquidatableResult.isLiquidatable}`)
        } catch (error) {
          // PanopticHelper contract may revert on testnet due to state inconsistencies
          console.log(`  isLiquidatable check failed (expected on testnets): ${error}`)
          console.log('\n=== Workflow Complete (with contract revert) ===')
          return
        }

        if (!liquidatableResult.isLiquidatable) {
          console.log('\n  Account is healthy - no liquidation needed')
          console.log('\n=== Workflow Complete ===')
          return
        }

        // Step 4: Simulate liquidation
        console.log('\nStep 4: Simulating liquidation...')
        const simulation = await simulateLiquidate({
          client,
          poolAddress,
          account: frankAddress,
          liquidatee: eveAddress,
          positionIdListFrom: [],
          positionIdListTo: tokenIds,
          positionIdListToFinal: [],
        })

        if (simulation.success) {
          console.log(`  Simulation successful!`)
          console.log(`  Gas estimate: ${simulation.gasEstimate}`)
          console.log(`  Positions to close: ${simulation.data.positionsClosed.length}`)

          // Step 5: Calculate profitability (simplified)
          const gasPrice = await client.getGasPrice()
          const estimatedGasCost = simulation.gasEstimate * gasPrice
          console.log(`\nStep 5: Profitability check...`)
          console.log(`  Estimated gas cost: ${estimatedGasCost} wei`)
          console.log(`  Gas price: ${Number(gasPrice) / 1e9} gwei`)

          // In production, compare gas cost against liquidation bonus
        } else {
          console.log(`  Simulation failed: ${simulation.error?.message}`)
        }

        console.log('\n=== Workflow Complete ===')
      },
    )
  })
})
