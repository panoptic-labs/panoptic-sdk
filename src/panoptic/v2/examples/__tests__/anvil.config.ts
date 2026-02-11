/**
 * Anvil fork configuration for integration testing
 * @module examples/__tests__/anvil.config
 */

/**
 * Anvil fork configuration
 * - Forks mainnet at a specific block for deterministic testing
 * - Uses a known Panoptic v2 pool with active positions
 */
export const ANVIL_CONFIG = {
  /**
   * Fork URL - mainnet RPC endpoint
   * Falls back to public RPC if FORK_URL env var not set
   */
  forkUrl: process.env.FORK_URL || 'https://eth.llamarpc.com',

  /**
   * Block number to fork at
   * This should be a recent block with known Panoptic v2 pool state
   * Update this periodically to test against fresh market conditions
   * Using recent block to avoid archive node requirements
   * Current mainnet block (2026-01-23): ~24,297,591
   */
  forkBlockNumber: process.env.FORK_BLOCK_NUMBER
    ? BigInt(process.env.FORK_BLOCK_NUMBER)
    : 24_297_000n,

  /**
   * Chain ID for the fork (mainnet)
   */
  chainId: 1n,

  /**
   * Known Panoptic pool address for testing
   * This pool should have:
   * - Active positions
   * - Liquidity in both tokens
   * - Recent oracle updates
   *
   * TODO: Replace with actual deployed Panoptic v2 pool address once available
   */
  poolAddress: (process.env.TEST_POOL_ADDRESS ||
    '0x0000000000000000000000000000000000000000') as `0x${string}`,

  /**
   * Test account private keys
   * These will be funded with ETH and tokens during test setup
   */
  testAccounts: {
    // Default Anvil account #0
    alice: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
    // Default Anvil account #1
    bob: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`,
  },

  /**
   * Anvil server configuration
   */
  anvilPort: 8545,
  anvilHost: '127.0.0.1',

  /**
   * Test fixture amounts
   */
  fixtures: {
    // Amount of ETH to fund each test account
    ethPerAccount: 100n * 10n ** 18n, // 100 ETH
    // Amount of collateral tokens to fund for vault operations
    collateralAmount: 10_000n * 10n ** 18n, // 10,000 tokens (assumes 18 decimals)
  },
} as const

/**
 * Get Anvil RPC URL for the configured fork
 */
export function getAnvilRpcUrl(): string {
  return `http://${ANVIL_CONFIG.anvilHost}:${ANVIL_CONFIG.anvilPort}`
}
