/**
 * Configuration for the Liquidation Bot
 */

import type { Address } from 'viem'

export interface BotConfig {
  /** RPC URL for blockchain connection */
  rpcUrl: string
  /** Private key for signing transactions */
  privateKey: `0x${string}`
  /** Panoptic pool address to monitor */
  poolAddress: Address
  /** PanopticQuery contract address (required for isLiquidatable) */
  queryAddress: Address
  /** Chain ID (1 for mainnet, 11155111 for sepolia, etc.) */
  chainId: number
  /** Accounts to monitor for liquidation */
  accountsToMonitor: Address[]
  /** Polling interval in milliseconds (default: 15000 = 15s) */
  pollingInterval?: number
  /** Maximum gas price in gwei (default: 100) */
  maxGasPriceGwei?: number
  /** Enable verbose logging (default: false) */
  verbose?: boolean
  /** Storage directory for position sync data (default: ./data) */
  storagePath?: string
}

/**
 * Load configuration from environment variables.
 */
export function loadConfig(): BotConfig {
  const rpcUrl = process.env.RPC_URL
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined
  const poolAddress = process.env.POOL_ADDRESS as Address | undefined
  const queryAddress = process.env.QUERY_ADDRESS as Address | undefined
  const chainIdStr = process.env.CHAIN_ID
  const accountsStr = process.env.ACCOUNTS_TO_MONITOR

  if (!rpcUrl) {
    throw new Error('RPC_URL environment variable is required')
  }

  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required')
  }

  if (!poolAddress) {
    throw new Error('POOL_ADDRESS environment variable is required')
  }

  if (!queryAddress) {
    throw new Error('QUERY_ADDRESS environment variable is required')
  }

  if (!chainIdStr) {
    throw new Error('CHAIN_ID environment variable is required')
  }

  if (!accountsStr) {
    throw new Error('ACCOUNTS_TO_MONITOR environment variable is required')
  }

  const chainId = parseInt(chainIdStr, 10)
  if (isNaN(chainId)) {
    throw new Error('CHAIN_ID must be a valid number')
  }

  // Parse comma-separated accounts
  const accountsToMonitor = accountsStr.split(',').map((addr) => addr.trim() as Address)

  if (accountsToMonitor.length === 0) {
    throw new Error('At least one account must be provided in ACCOUNTS_TO_MONITOR')
  }

  return {
    rpcUrl,
    privateKey,
    poolAddress,
    queryAddress,
    chainId,
    accountsToMonitor,
    pollingInterval: process.env.POLLING_INTERVAL
      ? parseInt(process.env.POLLING_INTERVAL, 10)
      : 15000,
    maxGasPriceGwei: process.env.MAX_GAS_PRICE_GWEI
      ? parseInt(process.env.MAX_GAS_PRICE_GWEI, 10)
      : 100,
    verbose: process.env.VERBOSE === 'true',
    storagePath: process.env.STORAGE_PATH || './data',
  }
}
