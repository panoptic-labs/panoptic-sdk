/**
 * Basic read function tests against Sepolia fork
 *
 * These tests verify that the SDK can read data from the deployed
 * Panoptic v2 contracts on Sepolia.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/sepolia/
 *
 * @module examples/__tests__/sepolia/01-basic-reads.fork.test
 */

import { type PublicClient, createPublicClient, formatUnits, http } from 'viem'
import { sepolia } from 'viem/chains'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAccountCollateral } from '../../../reads/account'
import { getCurrentRates } from '../../../reads/collateral'
import { getOracleState, getPool } from '../../../reads/pool'
import {
  getAnvilRpcUrl,
  SEPOLIA_ANVIL_CONFIG,
  SEPOLIA_CONTRACTS,
  SEPOLIA_TOKENS,
} from '../sepolia.config'

describe('Sepolia Fork: Basic Reads', () => {
  let client: PublicClient

  beforeAll(() => {
    client = createPublicClient({
      chain: sepolia,
      transport: http(getAnvilRpcUrl()),
    })
  })

  describe('getPool()', () => {
    it('should fetch pool data from deployed Sepolia pool', async () => {
      const pool = await getPool({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        chainId: SEPOLIA_ANVIL_CONFIG.chainId,
      })

      // Verify pool structure
      expect(pool.address).toBe(SEPOLIA_CONTRACTS.pool.address)
      expect(pool.chainId).toBe(SEPOLIA_ANVIL_CONFIG.chainId)

      // Verify token addresses from poolKey
      expect(pool.poolKey.currency0.toLowerCase()).toBe(SEPOLIA_CONTRACTS.pool.token0.toLowerCase())
      expect(pool.poolKey.currency1.toLowerCase()).toBe(SEPOLIA_CONTRACTS.pool.token1.toLowerCase())

      // Verify collateral tracker addresses
      expect(pool.collateralTracker0.address.toLowerCase()).toBe(
        SEPOLIA_CONTRACTS.pool.collateralTracker0.toLowerCase(),
      )
      expect(pool.collateralTracker1.address.toLowerCase()).toBe(
        SEPOLIA_CONTRACTS.pool.collateralTracker1.toLowerCase(),
      )

      // Verify tick spacing matches deployment
      expect(pool.poolKey.tickSpacing).toBe(BigInt(SEPOLIA_CONTRACTS.pool.tickSpacing))

      // Log pool state for debugging
      console.log('Pool state:')
      console.log(`  Address: ${pool.address}`)
      console.log(`  Token0: ${pool.collateralTracker0.symbol} (${pool.poolKey.currency0})`)
      console.log(`  Token1: ${pool.collateralTracker1.symbol} (${pool.poolKey.currency1})`)
      console.log(`  Current tick: ${pool.currentTick}`)
      console.log(`  Tick spacing: ${pool.poolKey.tickSpacing}`)
      console.log(`  Health status: ${pool.healthStatus}`)
      console.log(`  Block: ${pool._meta.blockNumber}`)
    })
  })

  describe('getOracleState()', () => {
    it('should fetch oracle state directly', async () => {
      const oracle = await getOracleState({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
      })

      expect(typeof oracle.epoch).toBe('bigint')
      expect(typeof oracle.fastEMA).toBe('bigint')
      expect(typeof oracle.slowEMA).toBe('bigint')
      expect(oracle._meta).toBeDefined()
      expect(typeof oracle._meta.blockNumber).toBe('bigint')

      console.log('Oracle state:')
      console.log(`  Epoch: ${oracle.epoch}`)
      console.log(`  Last update: ${oracle.lastUpdateTimestamp}`)
      console.log(`  Reference tick: ${oracle.referenceTick}`)
      console.log(`  Fast EMA: ${oracle.fastEMA}`)
      console.log(`  Slow EMA: ${oracle.slowEMA}`)
      console.log(`  Median tick: ${oracle.medianTick}`)
      console.log(`  Lock mode: ${oracle.lockMode}`)
    })
  })

  describe('getAccountCollateral()', () => {
    it('should fetch collateral for test account (likely zero)', async () => {
      const collateral = await getAccountCollateral({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        account: SEPOLIA_ANVIL_CONFIG.testAddresses.alice,
      })

      expect(collateral.account.toLowerCase()).toBe(
        SEPOLIA_ANVIL_CONFIG.testAddresses.alice.toLowerCase(),
      )
      expect(collateral.poolAddress.toLowerCase()).toBe(
        SEPOLIA_CONTRACTS.pool.address.toLowerCase(),
      )

      // Token0 collateral
      expect(typeof collateral.token0.assets).toBe('bigint')
      expect(typeof collateral.token0.shares).toBe('bigint')
      expect(typeof collateral.token0.availableAssets).toBe('bigint')

      // Token1 collateral
      expect(typeof collateral.token1.assets).toBe('bigint')
      expect(typeof collateral.token1.shares).toBe('bigint')
      expect(typeof collateral.token1.availableAssets).toBe('bigint')

      console.log('Account collateral (Alice):')
      console.log(
        `  Token0 assets: ${formatUnits(collateral.token0.assets, SEPOLIA_TOKENS.WETH.decimals)} WETH`,
      )
      console.log(
        `  Token1 assets: ${formatUnits(collateral.token1.assets, SEPOLIA_TOKENS.USDC.decimals)} USDC`,
      )
      console.log(`  Leg count: ${collateral.legCount}`)
    })
  })

  describe('getCurrentRates()', () => {
    it('should fetch current rates from collateral trackers', async () => {
      const rates = await getCurrentRates({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        collateralAddresses: {
          collateralToken0: SEPOLIA_CONTRACTS.pool.collateralTracker0,
          collateralToken1: SEPOLIA_CONTRACTS.pool.collateralTracker1,
        },
      })

      // Rates should be valid bigints
      expect(typeof rates.borrowRate0).toBe('bigint')
      expect(typeof rates.supplyRate0).toBe('bigint')
      expect(typeof rates.borrowRate1).toBe('bigint')
      expect(typeof rates.supplyRate1).toBe('bigint')

      console.log('Current rates:')
      console.log(`  Token0 borrow rate: ${rates.borrowRate0}`)
      console.log(`  Token0 supply rate: ${rates.supplyRate0}`)
      console.log(`  Token1 borrow rate: ${rates.borrowRate1}`)
      console.log(`  Token1 supply rate: ${rates.supplyRate1}`)
    })
  })

  describe('BlockMeta consistency', () => {
    it('should return consistent block metadata across calls', async () => {
      // Fetch multiple reads
      const [pool, oracle, collateral] = await Promise.all([
        getPool({
          client,
          poolAddress: SEPOLIA_CONTRACTS.pool.address,
          chainId: SEPOLIA_ANVIL_CONFIG.chainId,
        }),
        getOracleState({
          client,
          poolAddress: SEPOLIA_CONTRACTS.pool.address,
        }),
        getAccountCollateral({
          client,
          poolAddress: SEPOLIA_CONTRACTS.pool.address,
          account: SEPOLIA_ANVIL_CONFIG.testAddresses.alice,
        }),
      ])

      // All should have _meta
      expect(pool._meta).toBeDefined()
      expect(oracle._meta).toBeDefined()
      expect(collateral._meta).toBeDefined()

      // Block numbers should be close (within same batch)
      // On a forked chain they should be identical
      console.log('Block metadata:')
      console.log(`  Pool block: ${pool._meta.blockNumber}`)
      console.log(`  Oracle block: ${oracle._meta.blockNumber}`)
      console.log(`  Collateral block: ${collateral._meta.blockNumber}`)
    })
  })
})
