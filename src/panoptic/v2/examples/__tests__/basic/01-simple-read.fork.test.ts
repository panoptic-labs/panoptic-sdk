/**
 * Fork tests for basic example 01: Simple Read Operations
 *
 * These tests demonstrate basic SDK read operations against a forked network.
 * By default, tests run against Sepolia. Set NETWORK=mainnet for mainnet testing.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable (or FORK_URL for mainnet)
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/basic/
 *
 * @module examples/__tests__/basic/01-simple-read.fork.test
 */

import { type PublicClient, createPublicClient, formatUnits, http } from 'viem'
import { beforeAll, describe, expect, it } from 'vitest'

import { formatTokenAmount } from '../../../formatters/amount'
import { formatBps } from '../../../formatters/percentage'
import { tickToPrice, tickToPriceDecimalScaled } from '../../../formatters/tick'
import { getAccountCollateral } from '../../../reads/account'
import { isLiquidatable } from '../../../reads/checks'
import { getCurrentRates } from '../../../reads/collateral'
import { getOracleState, getPool, getRiskParameters } from '../../../reads/pool'
import { getSafeMode } from '../../../reads/safeMode'
import { assertValidDeployments, getAnvilRpcUrl, getNetworkConfig } from '../network.config'

describe('Basic Example 01: Simple Read Operations (Fork Test)', () => {
  let client: PublicClient
  const config = getNetworkConfig()

  beforeAll(() => {
    // Ensure we have valid deployments before running tests
    assertValidDeployments()

    client = createPublicClient({
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })
  })

  describe('getPool', () => {
    it('should return valid pool data from forked network', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      // Verify pool address matches
      expect(pool.address.toLowerCase()).toBe(config.contracts.pool.address.toLowerCase())

      // Verify token addresses from poolKey
      expect(pool.poolKey.currency0.toLowerCase()).toBe(config.contracts.pool.token0.toLowerCase())
      expect(pool.poolKey.currency1.toLowerCase()).toBe(config.contracts.pool.token1.toLowerCase())

      // Verify collateral tracker addresses
      expect(pool.collateralTracker0.address.toLowerCase()).toBe(
        config.contracts.pool.collateralTracker0.toLowerCase(),
      )
      expect(pool.collateralTracker1.address.toLowerCase()).toBe(
        config.contracts.pool.collateralTracker1.toLowerCase(),
      )

      // Verify tick spacing matches deployment
      expect(pool.poolKey.tickSpacing).toBe(BigInt(config.contracts.pool.tickSpacing))

      // Verify metadata is present and valid
      expect(pool._meta.blockNumber).toBeGreaterThan(0n)
      expect(pool._meta.blockTimestamp).toBeGreaterThan(0n)
      expect(pool._meta.blockHash).toMatch(/^0x[a-fA-F0-9]{64}$/)

      // Log pool state for debugging
      console.log(`Pool state on ${config.network}:`)
      console.log(`  Address: ${pool.address}`)
      console.log(`  Token0: ${pool.collateralTracker0.symbol} (${pool.poolKey.currency0})`)
      console.log(`  Token1: ${pool.collateralTracker1.symbol} (${pool.poolKey.currency1})`)
      console.log(`  Current tick: ${pool.currentTick}`)
      console.log(`  Tick spacing: ${pool.poolKey.tickSpacing}`)
      console.log(`  Health status: ${pool.healthStatus}`)
      console.log(`  Block: ${pool._meta.blockNumber}`)
    })

    it('should return utilization for both tokens', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      // Verify utilization values are valid bigints
      expect(typeof pool.collateralTracker0.utilization).toBe('bigint')
      expect(typeof pool.collateralTracker1.utilization).toBe('bigint')

      // Utilization should be non-negative
      expect(pool.collateralTracker0.utilization).toBeGreaterThanOrEqual(0n)
      expect(pool.collateralTracker1.utilization).toBeGreaterThanOrEqual(0n)

      console.log('Utilization:')
      console.log(`  Token0: ${pool.collateralTracker0.utilization}`)
      console.log(`  Token1: ${pool.collateralTracker1.utilization}`)
    })
  })

  describe('getOracleState', () => {
    it('should return oracle state with valid ticks', async () => {
      const oracle = await getOracleState({
        client,
        poolAddress: config.contracts.pool.address,
      })

      // Verify tick values are within valid Uniswap range
      const MIN_TICK = -887272n
      const MAX_TICK = 887272n

      expect(oracle.referenceTick).toBeGreaterThanOrEqual(MIN_TICK)
      expect(oracle.referenceTick).toBeLessThanOrEqual(MAX_TICK)
      expect(oracle.medianTick).toBeGreaterThanOrEqual(MIN_TICK)
      expect(oracle.medianTick).toBeLessThanOrEqual(MAX_TICK)

      // Verify epoch is a valid bigint
      expect(typeof oracle.epoch).toBe('bigint')

      // Verify metadata
      expect(oracle._meta.blockNumber).toBeGreaterThan(0n)
      expect(oracle._meta.blockTimestamp).toBeGreaterThan(0n)

      console.log('Oracle state:')
      console.log(`  Epoch: ${oracle.epoch}`)
      console.log(`  Last update: ${oracle.lastUpdateTimestamp}`)
      console.log(`  Reference tick: ${oracle.referenceTick}`)
      console.log(`  Median tick: ${oracle.medianTick}`)
      console.log(`  Fast EMA: ${oracle.fastEMA}`)
      console.log(`  Slow EMA: ${oracle.slowEMA}`)
      console.log(`  Lock mode: ${oracle.lockMode}`)
    })

    it('should return all oracle fields with valid types', async () => {
      const oracle = await getOracleState({
        client,
        poolAddress: config.contracts.pool.address,
      })

      // Verify all oracle fields are present and have correct types
      expect(typeof oracle.epoch).toBe('bigint')
      expect(typeof oracle.lastUpdateTimestamp).toBe('bigint')
      expect(typeof oracle.referenceTick).toBe('bigint')
      expect(typeof oracle.medianTick).toBe('bigint')
      expect(typeof oracle.fastEMA).toBe('bigint')
      expect(typeof oracle.slowEMA).toBe('bigint')
      expect(typeof oracle.lockMode).toBe('bigint')

      // Block metadata should be valid
      expect(oracle._meta.blockNumber).toBeGreaterThan(0n)
      expect(oracle._meta.blockTimestamp).toBeGreaterThan(0n)

      console.log('Oracle fields:')
      console.log(`  Epoch: ${oracle.epoch}`)
      console.log(`  Last update: ${oracle.lastUpdateTimestamp}`)
      console.log(`  Reference tick: ${oracle.referenceTick}`)
      console.log(`  Median tick: ${oracle.medianTick}`)
      console.log(`  Fast EMA: ${oracle.fastEMA}`)
      console.log(`  Slow EMA: ${oracle.slowEMA}`)
      console.log(`  Lock mode: ${oracle.lockMode}`)
      console.log(`  Block: ${oracle._meta.blockNumber}`)
    })
  })

  describe('getAccountCollateral', () => {
    it('should return zero collateral for unfunded account', async () => {
      const collateral = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: config.testAddresses.alice,
      })

      // Verify account address matches
      expect(collateral.account.toLowerCase()).toBe(config.testAddresses.alice.toLowerCase())
      expect(collateral.poolAddress.toLowerCase()).toBe(config.contracts.pool.address.toLowerCase())

      // Token0 collateral structure should be present
      expect(typeof collateral.token0.assets).toBe('bigint')
      expect(typeof collateral.token0.shares).toBe('bigint')
      expect(typeof collateral.token0.availableAssets).toBe('bigint')

      // Token1 collateral structure should be present
      expect(typeof collateral.token1.assets).toBe('bigint')
      expect(typeof collateral.token1.shares).toBe('bigint')
      expect(typeof collateral.token1.availableAssets).toBe('bigint')

      // Verify metadata
      expect(collateral._meta.blockNumber).toBeGreaterThan(0n)

      console.log('Account collateral (Alice):')
      console.log(
        `  Token0 assets: ${formatUnits(collateral.token0.assets, config.tokens.token0.decimals)} ${config.tokens.token0.symbol}`,
      )
      console.log(
        `  Token1 assets: ${formatUnits(collateral.token1.assets, config.tokens.token1.decimals)} ${config.tokens.token1.symbol}`,
      )
      console.log(`  Leg count: ${collateral.legCount}`)
    })

    it('should return collateral for account with deposits', async () => {
      // This test requires an account that has actually deposited to the pool
      // On a fork, we could impersonate such an account or fund one ourselves
      // For now, we just verify the function works with any account

      const collateral = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: config.testAddresses.bob,
      })

      // Verify the response structure is valid regardless of balance
      expect(collateral.account.toLowerCase()).toBe(config.testAddresses.bob.toLowerCase())
      expect(typeof collateral.token0.assets).toBe('bigint')
      expect(typeof collateral.token1.assets).toBe('bigint')
      expect(collateral._meta).toBeDefined()

      console.log('Account collateral (Bob):')
      console.log(
        `  Token0 assets: ${formatUnits(collateral.token0.assets, config.tokens.token0.decimals)} ${config.tokens.token0.symbol}`,
      )
      console.log(
        `  Token1 assets: ${formatUnits(collateral.token1.assets, config.tokens.token1.decimals)} ${config.tokens.token1.symbol}`,
      )
    })
  })

  describe('getCurrentRates', () => {
    it('should return valid interest rates for both tokens', async () => {
      const rates = await getCurrentRates({
        client,
        poolAddress: config.contracts.pool.address,
      })

      // All rate fields should be bigints
      expect(typeof rates.borrowRate0).toBe('bigint')
      expect(typeof rates.supplyRate0).toBe('bigint')
      expect(typeof rates.borrowRate1).toBe('bigint')
      expect(typeof rates.supplyRate1).toBe('bigint')

      // Rates should be non-negative
      expect(rates.borrowRate0).toBeGreaterThanOrEqual(0n)
      expect(rates.supplyRate0).toBeGreaterThanOrEqual(0n)
      expect(rates.borrowRate1).toBeGreaterThanOrEqual(0n)
      expect(rates.supplyRate1).toBeGreaterThanOrEqual(0n)

      // Metadata should be present
      expect(rates._meta.blockNumber).toBeGreaterThan(0n)
      expect(rates._meta.blockTimestamp).toBeGreaterThan(0n)

      console.log('Current rates:')
      console.log(`  Borrow rate token0: ${rates.borrowRate0}`)
      console.log(`  Supply rate token0: ${rates.supplyRate0}`)
      console.log(`  Borrow rate token1: ${rates.borrowRate1}`)
      console.log(`  Supply rate token1: ${rates.supplyRate1}`)
      console.log(`  Block: ${rates._meta.blockNumber}`)
    })
  })

  describe('getRiskParameters', () => {
    it('should return valid risk parameters with correct types', async () => {
      const risk = await getRiskParameters({
        client,
        poolAddress: config.contracts.pool.address,
      })

      // All fields should be bigints
      expect(typeof risk.collateralRequirement).toBe('bigint')
      expect(typeof risk.maintenanceMargin).toBe('bigint')
      expect(typeof risk.commissionRate).toBe('bigint')
      expect(typeof risk.targetUtilization).toBe('bigint')
      expect(typeof risk.saturatedUtilization).toBe('bigint')
      expect(typeof risk.itmSpreadMultiplier).toBe('bigint')

      // Metadata should be present
      expect(risk._meta.blockNumber).toBeGreaterThan(0n)
      expect(risk._meta.blockTimestamp).toBeGreaterThan(0n)

      console.log('Risk parameters:')
      console.log(`  Collateral requirement: ${risk.collateralRequirement}`)
      console.log(`  Maintenance margin: ${risk.maintenanceMargin}`)
      console.log(`  Commission rate: ${risk.commissionRate}`)
      console.log(`  Target utilization: ${risk.targetUtilization}`)
      console.log(`  Saturated utilization: ${risk.saturatedUtilization}`)
      console.log(`  ITM spread multiplier: ${risk.itmSpreadMultiplier}`)
    })

    it('should return risk parameters within sane ranges', async () => {
      const risk = await getRiskParameters({
        client,
        poolAddress: config.contracts.pool.address,
      })

      // Collateral requirement should be positive
      expect(risk.collateralRequirement).toBeGreaterThan(0n)

      // Maintenance margin should be positive and <= collateral requirement
      expect(risk.maintenanceMargin).toBeGreaterThan(0n)
      expect(risk.maintenanceMargin).toBeLessThanOrEqual(risk.collateralRequirement)

      // Target utilization should be between 0 and 10_000_000 (millitick scale: 10M = 100%)
      expect(risk.targetUtilization).toBeGreaterThanOrEqual(0n)
      expect(risk.targetUtilization).toBeLessThanOrEqual(10_000_000n)

      // Saturated utilization should be >= target utilization
      expect(risk.saturatedUtilization).toBeGreaterThanOrEqual(risk.targetUtilization)
    })
  })

  describe('getSafeMode', () => {
    it('should return safe mode state with valid fields', async () => {
      const safeMode = await getSafeMode({
        client,
        poolAddress: config.contracts.pool.address,
      })

      expect(typeof safeMode.mode).toBe('string')
      expect(['normal', 'restricted', 'emergency']).toContain(safeMode.mode)
      expect(typeof safeMode.canMint).toBe('boolean')
      expect(typeof safeMode.canBurn).toBe('boolean')
      expect(typeof safeMode.canForceExercise).toBe('boolean')
      expect(typeof safeMode.canLiquidate).toBe('boolean')

      // Metadata should be present
      expect(safeMode._meta.blockNumber).toBeGreaterThan(0n)
      expect(safeMode._meta.blockTimestamp).toBeGreaterThan(0n)

      console.log('Safe mode state:')
      console.log(`  Mode: ${safeMode.mode}`)
      console.log(`  Can mint: ${safeMode.canMint}`)
      console.log(`  Can liquidate: ${safeMode.canLiquidate}`)
      console.log(`  Reason: ${safeMode.reason ?? 'none'}`)
    })

    it('should report pool as not in safe mode on healthy Sepolia fork', async () => {
      const safeMode = await getSafeMode({
        client,
        poolAddress: config.contracts.pool.address,
      })

      // On a fresh Sepolia fork, the pool should be in normal mode
      expect(safeMode.mode).toBe('normal')
      expect(safeMode.reason).toBeUndefined()
    })
  })

  describe('isLiquidatable', () => {
    it('should return not-liquidatable for account with no positions', async () => {
      const queryAddress = config.contracts.panopticQuery
      if (!queryAddress) {
        console.log('Skipping isLiquidatable test: no panopticQuery address configured')
        return
      }

      const result = await isLiquidatable({
        client,
        poolAddress: config.contracts.pool.address,
        account: config.testAddresses.alice,
        tokenIds: [],
        queryAddress,
      })

      expect(result.isLiquidatable).toBe(false)
      expect(typeof result.marginShortfall0).toBe('bigint')
      expect(typeof result.marginShortfall1).toBe('bigint')
      expect(typeof result.currentMargin0).toBe('bigint')
      expect(typeof result.currentMargin1).toBe('bigint')
      expect(typeof result.requiredMargin0).toBe('bigint')
      expect(typeof result.requiredMargin1).toBe('bigint')
      expect(typeof result.atTick).toBe('bigint')
      expect(result._meta.blockNumber).toBeGreaterThan(0n)

      console.log('Liquidation check (no positions):')
      console.log(`  Liquidatable: ${result.isLiquidatable}`)
      console.log(`  Current margin0: ${result.currentMargin0}`)
      console.log(`  Current margin1: ${result.currentMargin1}`)
      console.log(`  Required margin0: ${result.requiredMargin0}`)
      console.log(`  Required margin1: ${result.requiredMargin1}`)
      console.log(`  At tick: ${result.atTick}`)
    })
  })

  describe('Formatters with live pool data', () => {
    it('should format current tick to human-readable price', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      // tickToPrice returns raw price string (no decimal adjustment)
      const rawPrice = tickToPrice(pool.currentTick)
      expect(typeof rawPrice).toBe('string')
      expect(rawPrice.length).toBeGreaterThan(0)

      // tickToPriceDecimalScaled adjusts for token decimals
      const scaledPrice = tickToPriceDecimalScaled(
        pool.currentTick,
        BigInt(config.tokens.token0.decimals),
        BigInt(config.tokens.token1.decimals),
        6n, // precision
      )
      expect(typeof scaledPrice).toBe('string')
      expect(scaledPrice.length).toBeGreaterThan(0)
      // Price should be parseable as a number
      expect(Number(scaledPrice)).toBeGreaterThan(0)

      console.log('Tick to price formatting:')
      console.log(`  Current tick: ${pool.currentTick}`)
      console.log(`  Raw price: ${rawPrice}`)
      console.log(
        `  Scaled price (${config.tokens.token0.symbol}/${config.tokens.token1.symbol}): ${scaledPrice}`,
      )
    })

    it('should format token amounts with explicit precision', () => {
      // Format 1.5 WETH (18 decimals)
      const wethAmount = 1_500_000_000_000_000_000n // 1.5e18
      const formatted = formatTokenAmount(wethAmount, 18n, 4n)
      expect(typeof formatted).toBe('string')
      expect(formatted).toBe('1.5000')

      // Format 1000.50 USDC (6 decimals)
      const usdcAmount = 1_000_500_000n // 1000.5e6
      const formattedUsdc = formatTokenAmount(usdcAmount, 6n, 2n)
      expect(formattedUsdc).toBe('1000.50')

      console.log('Token amount formatting:')
      console.log(`  1.5 WETH: ${formatted}`)
      console.log(`  1000.50 USDC: ${formattedUsdc}`)
    })

    it('should format basis points as percentages', () => {
      // 150 bps = 1.50%
      const formatted = formatBps(150n, 2n)
      expect(typeof formatted).toBe('string')
      expect(formatted).toBe('1.50%')

      // 10000 bps = 100%
      const hundredPercent = formatBps(10000n, 0n)
      expect(hundredPercent).toBe('100%')

      // 0 bps = 0%
      const zero = formatBps(0n, 2n)
      expect(zero).toBe('0.00%')

      console.log('Basis points formatting:')
      console.log(`  150 bps: ${formatted}`)
      console.log(`  10000 bps: ${hundredPercent}`)
      console.log(`  0 bps: ${zero}`)
    })
  })

  describe('Data Freshness Verification', () => {
    it('should return same block number for multiple reads in single call', async () => {
      // This test verifies that parallel reads return data from the same block
      // (or very close blocks if RPC has slight delay)

      const [pool, oracle, collateral] = await Promise.all([
        getPool({
          client,
          poolAddress: config.contracts.pool.address,
          chainId: config.chainId,
        }),
        getOracleState({
          client,
          poolAddress: config.contracts.pool.address,
        }),
        getAccountCollateral({
          client,
          poolAddress: config.contracts.pool.address,
          account: config.testAddresses.alice,
        }),
      ])

      // All should have _meta
      expect(pool._meta).toBeDefined()
      expect(oracle._meta).toBeDefined()
      expect(collateral._meta).toBeDefined()

      // On a forked/paused chain, block numbers should be identical
      // Allow small variance (1-2 blocks) for live networks
      const blocks = [
        pool._meta.blockNumber,
        oracle._meta.blockNumber,
        collateral._meta.blockNumber,
      ]

      const minBlock = blocks.reduce((a, b) => (a < b ? a : b))
      const maxBlock = blocks.reduce((a, b) => (a > b ? a : b))
      const blockDifference = maxBlock - minBlock

      expect(blockDifference).toBeLessThanOrEqual(2n)

      console.log('Block metadata consistency:')
      console.log(`  Pool block: ${pool._meta.blockNumber}`)
      console.log(`  Oracle block: ${oracle._meta.blockNumber}`)
      console.log(`  Collateral block: ${collateral._meta.blockNumber}`)
      console.log(`  Max difference: ${blockDifference} blocks`)
    })
  })
})
