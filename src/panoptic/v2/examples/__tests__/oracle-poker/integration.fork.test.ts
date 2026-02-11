/**
 * Fork tests for oracle poker bot integration
 *
 * These tests demonstrate oracle state reading, staleness detection,
 * and the pokeOracle functionality against a forked network.
 * By default, tests run against Sepolia. Set NETWORK=mainnet for mainnet testing.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable (or FORK_URL for mainnet)
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/oracle-poker/
 *
 * @module examples/__tests__/oracle-poker/integration.fork.test
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'

import { getOracleState } from '../../../reads/pool'
import { pokeOracle } from '../../../writes/pokeOracle'
import { assertValidDeployments, getAnvilRpcUrl, getNetworkConfig } from '../network.config'

describe('Oracle Poker Bot Integration (Fork Test)', () => {
  let client: PublicClient
  let walletClient: WalletClient
  let daveAddress: Address
  const config = getNetworkConfig()

  beforeAll(() => {
    // Ensure we have valid deployments before running tests
    assertValidDeployments()

    // Use dave account to avoid nonce conflicts with other parallel tests
    const account = privateKeyToAccount(config.testAccounts.dave)
    daveAddress = account.address

    client = createPublicClient({
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })

    walletClient = createWalletClient({
      account,
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })
  })

  describe('Oracle State Reading', () => {
    it('should read current oracle state', async () => {
      const oracle = await getOracleState({
        client,
        poolAddress: config.contracts.pool.address,
      })

      // Verify oracle structure
      expect(typeof oracle.epoch).toBe('bigint')
      expect(typeof oracle.lastUpdateTimestamp).toBe('bigint')
      expect(typeof oracle.referenceTick).toBe('bigint')
      expect(typeof oracle.medianTick).toBe('bigint')
      expect(typeof oracle.fastEMA).toBe('bigint')
      expect(typeof oracle.slowEMA).toBe('bigint')
      expect(typeof oracle.lockMode).toBe('bigint')

      // Verify metadata
      expect(oracle._meta.blockNumber).toBeGreaterThan(0n)
      expect(oracle._meta.blockTimestamp).toBeGreaterThan(0n)

      console.log('Oracle state:')
      console.log(`  Epoch: ${oracle.epoch}`)
      console.log(`  Reference tick: ${oracle.referenceTick}`)
      console.log(`  Median tick: ${oracle.medianTick}`)
      console.log(`  Fast EMA: ${oracle.fastEMA}`)
      console.log(`  Slow EMA: ${oracle.slowEMA}`)
      console.log(`  Lock mode: ${oracle.lockMode}`)
      console.log(`  Block: ${oracle._meta.blockNumber}`)
    })

    it('should have consistent tick values within valid range', async () => {
      const oracle = await getOracleState({
        client,
        poolAddress: config.contracts.pool.address,
      })

      // Uniswap tick range
      const MIN_TICK = -887272n
      const MAX_TICK = 887272n

      // Reference tick should be within valid range
      expect(oracle.referenceTick).toBeGreaterThanOrEqual(MIN_TICK)
      expect(oracle.referenceTick).toBeLessThanOrEqual(MAX_TICK)

      // Median tick should be within valid range
      expect(oracle.medianTick).toBeGreaterThanOrEqual(MIN_TICK)
      expect(oracle.medianTick).toBeLessThanOrEqual(MAX_TICK)

      console.log('Tick validation:')
      console.log(
        `  Reference tick: ${oracle.referenceTick} (valid range: ${MIN_TICK} to ${MAX_TICK})`,
      )
      console.log(`  Median tick: ${oracle.medianTick}`)
    })
  })

  describe('Oracle Poking', () => {
    it('should successfully poke the oracle', async () => {
      const oracleBefore = await getOracleState({
        client,
        poolAddress: config.contracts.pool.address,
      })

      console.log('Before poke:')
      console.log(`  Epoch: ${oracleBefore.epoch}`)
      console.log(`  Block: ${oracleBefore._meta.blockNumber}`)

      // Poke the oracle
      const txResult = await pokeOracle({
        client,
        walletClient,
        account: daveAddress,
        poolAddress: config.contracts.pool.address,
      })

      expect(txResult.hash).toMatch(/^0x[a-fA-F0-9]{64}$/)

      const receipt = await txResult.wait()

      expect(receipt.status).toBe('success')
      expect(receipt.gasUsed).toBeGreaterThan(0n)

      // Oracle poke should be relatively cheap
      console.log('Transaction result:')
      console.log(`  Hash: ${txResult.hash}`)
      console.log(`  Gas used: ${receipt.gasUsed}`)
      console.log(`  Status: ${receipt.status}`)

      // Verify we can read oracle state after poke
      const oracleAfter = await getOracleState({
        client,
        poolAddress: config.contracts.pool.address,
      })

      console.log('After poke:')
      console.log(`  Epoch: ${oracleAfter.epoch}`)
      console.log(`  Block: ${oracleAfter._meta.blockNumber}`)

      // Oracle state should be readable
      expect(typeof oracleAfter.epoch).toBe('bigint')
      expect(typeof oracleAfter.referenceTick).toBe('bigint')
    })

    it('should allow multiple consecutive pokes', async () => {
      // First poke
      const firstPoke = await pokeOracle({
        client,
        walletClient,
        account: daveAddress,
        poolAddress: config.contracts.pool.address,
      })
      const firstReceipt = await firstPoke.wait()
      expect(firstReceipt.status).toBe('success')
      console.log(`First poke: success (gas: ${firstReceipt.gasUsed})`)

      // Second poke immediately - contract handles rate limiting internally
      const secondPoke = await pokeOracle({
        client,
        walletClient,
        account: daveAddress,
        poolAddress: config.contracts.pool.address,
      })
      const secondReceipt = await secondPoke.wait()
      expect(secondReceipt.status).toBe('success')
      console.log(`Second poke: success (gas: ${secondReceipt.gasUsed})`)
    })

    it('should have valid transaction hash format', async () => {
      const txResult = await pokeOracle({
        client,
        walletClient,
        account: daveAddress,
        poolAddress: config.contracts.pool.address,
      })

      // Verify hash format
      expect(txResult.hash).toMatch(/^0x[a-fA-F0-9]{64}$/)
      console.log(`Transaction hash: ${txResult.hash}`)

      // Verify wait() returns a valid receipt
      const receipt = await txResult.wait()
      expect(receipt.status).toBe('success')
      expect(receipt.blockNumber).toBeGreaterThan(0n)
    })
  })

  describe('Bot Workflow Simulation', () => {
    it('should simulate bot check-and-poke workflow', async () => {
      // Step 1: Check current oracle state
      const oracleBefore = await getOracleState({
        client,
        poolAddress: config.contracts.pool.address,
      })

      console.log('Bot: Checking oracle state...')
      console.log(`  Current epoch value: ${oracleBefore.epoch}`)
      console.log(`  Reference tick: ${oracleBefore.referenceTick}`)

      // Step 2: Execute poke
      const txResult = await pokeOracle({
        client,
        walletClient,
        account: daveAddress,
        poolAddress: config.contracts.pool.address,
      })

      console.log(`Bot: Transaction submitted: ${txResult.hash}`)

      const receipt = await txResult.wait()

      expect(receipt.status).toBe('success')
      console.log(`Bot: Oracle poked successfully (gas: ${receipt.gasUsed})`)

      // Step 3: Verify oracle is readable after poke
      const oracleAfter = await getOracleState({
        client,
        poolAddress: config.contracts.pool.address,
      })

      console.log('Bot: Verifying oracle state...')
      console.log(`  Epoch value: ${oracleAfter.epoch}`)
      console.log(`  Reference tick: ${oracleAfter.referenceTick}`)

      // Oracle should still be readable
      expect(typeof oracleAfter.epoch).toBe('bigint')
      expect(typeof oracleAfter.referenceTick).toBe('bigint')
    })

    it('should handle poke-read-poke sequence', async () => {
      // First poke
      const poke1 = await pokeOracle({
        client,
        walletClient,
        account: daveAddress,
        poolAddress: config.contracts.pool.address,
      })
      await poke1.wait()
      console.log('First poke completed')

      // Read state
      const oracle = await getOracleState({
        client,
        poolAddress: config.contracts.pool.address,
      })
      console.log(`Oracle state: Epoch ${oracle.epoch}, Tick ${oracle.referenceTick}`)

      expect(typeof oracle.epoch).toBe('bigint')
      expect(typeof oracle.referenceTick).toBe('bigint')

      // Second poke
      const poke2 = await pokeOracle({
        client,
        walletClient,
        account: daveAddress,
        poolAddress: config.contracts.pool.address,
      })
      const receipt = await poke2.wait()
      expect(receipt.status).toBe('success')
      console.log('Second poke completed')
    })
  })

  describe('Gas Efficiency', () => {
    it('should have reasonable gas consumption for oracle poke', async () => {
      const txResult = await pokeOracle({
        client,
        walletClient,
        account: daveAddress,
        poolAddress: config.contracts.pool.address,
      })

      const receipt = await txResult.wait()

      // Oracle poke should be gas efficient
      // Typical range: 50k - 150k gas
      expect(receipt.gasUsed).toBeGreaterThan(0n)
      expect(receipt.gasUsed).toBeLessThan(200_000n)

      console.log('Gas efficiency test:')
      console.log(`  Gas used: ${receipt.gasUsed}`)
      console.log(`  Within acceptable range: ${receipt.gasUsed < 200_000n}`)
    })
  })
})
