/**
 * Shared test utilities for Anvil fork tests
 * @module examples/__tests__/setup
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
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { deal } from 'viem-deal'

import { ANVIL_CONFIG, getAnvilRpcUrl } from './anvil.config'

/**
 * Fork test clients
 */
export interface ForkTestClients {
  publicClient: PublicClient
  walletClient: WalletClient
  testClient: TestClient
  account: Address
}

/**
 * Create clients for fork testing
 * @param privateKey - Private key for the wallet client
 * @returns Test clients (public, wallet, test)
 */
export function createForkClients(privateKey: Hex): ForkTestClients {
  const account = privateKeyToAccount(privateKey)
  const rpcUrl = getAnvilRpcUrl()

  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(rpcUrl),
  })

  const testClient = createTestClient({
    chain: mainnet,
    mode: 'anvil',
    transport: http(rpcUrl),
  })

  return {
    publicClient,
    walletClient,
    testClient,
    account: account.address,
  }
}

/**
 * Fund an account with ETH using viem-deal
 * @param testClient - Anvil test client
 * @param account - Account address to fund
 * @param amount - Amount of ETH in wei
 */
export async function fundAccountWithEth(
  testClient: TestClient,
  account: Address,
  amount: bigint,
): Promise<void> {
  await deal(testClient, {
    erc20: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as Address, // ETH special address
    account,
    amount,
  })
}

/**
 * Fund an account with ERC20 tokens using viem-deal
 * @param testClient - Anvil test client
 * @param tokenAddress - ERC20 token contract address
 * @param account - Account address to fund
 * @param amount - Amount of tokens (in token's smallest unit)
 */
export async function fundAccountWithToken(
  testClient: TestClient,
  tokenAddress: Address,
  account: Address,
  amount: bigint,
): Promise<void> {
  await deal(testClient, {
    erc20: tokenAddress,
    account,
    amount,
  })
}

/**
 * Reset Anvil fork to initial state
 * Useful for test isolation - call in beforeEach/afterEach
 * @param testClient - Anvil test client
 */
export async function resetFork(testClient: TestClient): Promise<void> {
  await testClient.reset({
    blockNumber: ANVIL_CONFIG.forkBlockNumber,
    jsonRpcUrl: ANVIL_CONFIG.forkUrl,
  })
}

/**
 * Mine blocks to advance time
 * @param testClient - Anvil test client
 * @param blocks - Number of blocks to mine
 */
export async function mineBlocks(testClient: TestClient, blocks: bigint): Promise<void> {
  await testClient.mine({ blocks: Number(blocks) })
}

/**
 * Increase time by specified seconds
 * @param testClient - Anvil test client
 * @param seconds - Seconds to increase
 */
export async function increaseTime(testClient: TestClient, seconds: bigint): Promise<void> {
  await testClient.increaseTime({ seconds: Number(seconds) })
  // Mine a block to apply the time change
  await testClient.mine({ blocks: 1 })
}

/**
 * Set next block timestamp
 * @param testClient - Anvil test client
 * @param timestamp - Unix timestamp in seconds
 */
export async function setNextBlockTimestamp(
  testClient: TestClient,
  timestamp: bigint,
): Promise<void> {
  await testClient.setNextBlockTimestamp({ timestamp })
}

/**
 * Impersonate an account (allows sending txs as that account)
 * @param testClient - Anvil test client
 * @param account - Account to impersonate
 */
export async function impersonateAccount(testClient: TestClient, account: Address): Promise<void> {
  await testClient.impersonateAccount({ address: account })
}

/**
 * Stop impersonating an account
 * @param testClient - Anvil test client
 * @param account - Account to stop impersonating
 */
export async function stopImpersonatingAccount(
  testClient: TestClient,
  account: Address,
): Promise<void> {
  await testClient.stopImpersonatingAccount({ address: account })
}

/**
 * Snapshot current fork state
 * Returns a snapshot ID that can be used to restore state later
 * @param testClient - Anvil test client
 * @returns Snapshot ID
 */
export async function snapshotFork(testClient: TestClient): Promise<Hex> {
  return await testClient.snapshot()
}

/**
 * Restore fork to a previous snapshot
 * @param testClient - Anvil test client
 * @param snapshotId - Snapshot ID from snapshotFork()
 */
export async function restoreForkSnapshot(testClient: TestClient, snapshotId: Hex): Promise<void> {
  await testClient.revert({ id: snapshotId })
}

/**
 * Setup fixture: Fund test accounts with ETH and common tokens
 * @param testClient - Anvil test client
 * @param accounts - Accounts to fund
 * @param tokens - Token addresses to fund (optional)
 */
export async function setupTestAccounts(
  testClient: TestClient,
  accounts: Address[],
  tokens?: Address[],
): Promise<void> {
  // Fund each account with ETH
  for (const account of accounts) {
    await fundAccountWithEth(testClient, account, ANVIL_CONFIG.fixtures.ethPerAccount)
  }

  // Fund each account with tokens if provided
  if (tokens) {
    for (const account of accounts) {
      for (const token of tokens) {
        await fundAccountWithToken(
          testClient,
          token,
          account,
          ANVIL_CONFIG.fixtures.collateralAmount,
        )
      }
    }
  }
}

/**
 * Common test fixtures
 */
export const TEST_FIXTURES = {
  /**
   * Test pool address from config
   */
  poolAddress: ANVIL_CONFIG.poolAddress,

  /**
   * Test accounts
   */
  accounts: ANVIL_CONFIG.testAccounts,

  /**
   * Common amounts for testing
   */
  amounts: {
    eth: ANVIL_CONFIG.fixtures.ethPerAccount,
    collateral: ANVIL_CONFIG.fixtures.collateralAmount,
    smallDeposit: 100n * 10n ** 18n, // 100 tokens
    largeDeposit: 5000n * 10n ** 18n, // 5000 tokens
  },

  /**
   * Oracle epoch duration (64 seconds)
   */
  oracleEpochDuration: 64n,
} as const
