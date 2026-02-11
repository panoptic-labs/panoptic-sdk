/**
 * Configuration for the Oracle Poker Bot
 */

import type { Address } from 'viem'

export interface BotConfig {
  /** RPC URL for blockchain connection */
  rpcUrl: string
  /** Private key for signing transactions */
  privateKey: `0x${string}`
  /** List of Panoptic pool addresses to monitor */
  poolAddresses: Address[]
  /** Chain ID (1 for mainnet, 11155111 for sepolia, etc.) */
  chainId: number
  /** Polling interval in milliseconds (default: 30000 = 30s) */
  pollingInterval?: number
  /** Maximum gas price in gwei (default: 100) */
  maxGasPriceGwei?: number
  /** Maximum retry attempts for failed transactions (default: 3) */
  maxRetries?: number
  /** Retry delay in milliseconds (default: 5000) */
  retryDelayMs?: number
  /** Enable verbose logging (default: false) */
  verbose?: boolean
}

/**
 * Load configuration from environment variables.
 */
export function loadConfig(): BotConfig {
  const rpcUrl = process.env.RPC_URL
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined
  const poolAddressesStr = process.env.POOL_ADDRESSES
  const chainIdStr = process.env.CHAIN_ID

  if (!rpcUrl) {
    throw new Error('RPC_URL environment variable is required')
  }

  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required')
  }

  if (!poolAddressesStr) {
    throw new Error('POOL_ADDRESSES environment variable is required')
  }

  if (!chainIdStr) {
    throw new Error('CHAIN_ID environment variable is required')
  }

  // Parse comma-separated pool addresses
  const poolAddresses = poolAddressesStr.split(',').map((addr) => addr.trim() as Address)

  if (poolAddresses.length === 0) {
    throw new Error('At least one pool address must be provided in POOL_ADDRESSES')
  }

  const chainId = parseInt(chainIdStr, 10)
  if (isNaN(chainId)) {
    throw new Error('CHAIN_ID must be a valid number')
  }

  return {
    rpcUrl,
    privateKey,
    poolAddresses,
    chainId,
    pollingInterval: process.env.POLLING_INTERVAL
      ? parseInt(process.env.POLLING_INTERVAL, 10)
      : 30000,
    maxGasPriceGwei: process.env.MAX_GAS_PRICE_GWEI
      ? parseInt(process.env.MAX_GAS_PRICE_GWEI, 10)
      : 100,
    maxRetries: process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES, 10) : 3,
    retryDelayMs: process.env.RETRY_DELAY_MS ? parseInt(process.env.RETRY_DELAY_MS, 10) : 5000,
    verbose: process.env.VERBOSE === 'true',
  }
}
