/**
 * Tests for fork test setup utilities
 * Unit tests that don't require Anvil running
 * @module examples/__tests__/setup.test
 */

import { describe, expect, it } from 'vitest'

import { ANVIL_CONFIG, getAnvilRpcUrl } from './anvil.config'
import { createForkClients, TEST_FIXTURES } from './setup'

describe('Fork Test Setup Utilities (Unit Tests)', () => {
  describe('createForkClients', () => {
    it('should create all required clients', () => {
      const clients = createForkClients(ANVIL_CONFIG.testAccounts.alice)

      expect(clients.publicClient).toBeDefined()
      expect(clients.walletClient).toBeDefined()
      expect(clients.testClient).toBeDefined()
      expect(clients.account).toBeDefined()
      expect(clients.account).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should derive correct account from private key', () => {
      const clients = createForkClients(ANVIL_CONFIG.testAccounts.alice)

      // Anvil account #0 address
      expect(clients.account.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')
    })

    it('should create clients with correct chain config', () => {
      const clients = createForkClients(ANVIL_CONFIG.testAccounts.alice)

      expect(clients.publicClient.chain?.id).toBe(1) // Mainnet
      expect(clients.walletClient.chain?.id).toBe(1)
    })
  })

  describe('TEST_FIXTURES', () => {
    it('should export test fixtures', () => {
      expect(TEST_FIXTURES.poolAddress).toBeDefined()
      expect(TEST_FIXTURES.accounts).toBeDefined()
      expect(TEST_FIXTURES.amounts).toBeDefined()
      expect(TEST_FIXTURES.oracleEpochDuration).toBe(64n)
    })

    it('should have valid pool address format', () => {
      expect(TEST_FIXTURES.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should have test account private keys', () => {
      expect(TEST_FIXTURES.accounts.alice).toMatch(/^0x[a-fA-F0-9]{64}$/)
      expect(TEST_FIXTURES.accounts.bob).toMatch(/^0x[a-fA-F0-9]{64}$/)
    })

    it('should have reasonable test amounts', () => {
      expect(TEST_FIXTURES.amounts.eth).toBeGreaterThan(0n)
      expect(TEST_FIXTURES.amounts.collateral).toBeGreaterThan(0n)
      expect(TEST_FIXTURES.amounts.smallDeposit).toBeLessThan(TEST_FIXTURES.amounts.collateral)
    })
  })

  describe('ANVIL_CONFIG', () => {
    it('should have valid fork configuration', () => {
      expect(ANVIL_CONFIG.forkUrl).toBeDefined()
      expect(ANVIL_CONFIG.forkBlockNumber).toBeGreaterThan(0n)
      expect(ANVIL_CONFIG.chainId).toBe(1n)
      expect(ANVIL_CONFIG.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should have test accounts configured', () => {
      expect(ANVIL_CONFIG.testAccounts.alice).toMatch(/^0x[a-fA-F0-9]{64}$/)
      expect(ANVIL_CONFIG.testAccounts.bob).toMatch(/^0x[a-fA-F0-9]{64}$/)
    })

    it('should have Anvil server config', () => {
      expect(ANVIL_CONFIG.anvilPort).toBe(8545)
      expect(ANVIL_CONFIG.anvilHost).toBe('127.0.0.1')
    })
  })

  describe('getAnvilRpcUrl', () => {
    it('should return correct RPC URL', () => {
      const url = getAnvilRpcUrl()
      expect(url).toBe('http://127.0.0.1:8545')
    })
  })
})

/**
 * NOTE: Fork tests that require Anvil running are in *.fork.test.ts files
 * Run them with: pnpm test:fork
 *
 * Requirements for fork tests:
 * 1. Start Anvil: anvil --fork-url <RPC_URL> --fork-block-number 24400000 --port 8545
 * 2. Use a reliable RPC endpoint (Alchemy, Infura, or local archive node)
 * 3. Public RPCs may rate-limit and cause fork tests to fail
 */
