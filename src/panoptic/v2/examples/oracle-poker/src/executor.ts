/**
 * Transaction execution with retry logic
 */

import type { Address, Hash, PublicClient, WalletClient } from 'viem'

import { OracleRateLimitedError, PanopticError, pokeOracle } from '../../../index'
import type { Logger } from './logger'

export interface ExecutionResult {
  /** Whether execution was successful */
  success: boolean
  /** Transaction hash (if successful) */
  hash?: Hash
  /** Error message (if failed) */
  error?: string
  /** Number of attempts made */
  attempts: number
}

/**
 * Execute oracle poke with retry logic.
 *
 * Retries on transient errors but not on rate limit errors.
 */
export async function executePokeWithRetry(
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,
  poolAddress: Address,
  maxRetries: number,
  retryDelayMs: number,
  logger: Logger,
): Promise<ExecutionResult> {
  let attempts = 0

  while (attempts < maxRetries) {
    attempts++

    try {
      logger.info(`Poking oracle for pool ${poolAddress} (attempt ${attempts}/${maxRetries})...`)

      const result = await pokeOracle({
        client,
        walletClient,
        account,
        poolAddress,
      })

      logger.info(`Transaction submitted: ${result.hash}`)
      logger.debug('Waiting for confirmation...')

      const receipt = await result.wait()

      logger.info(
        `Oracle poked successfully for pool ${poolAddress} ` +
          `(block ${receipt.blockNumber}, gas used: ${receipt.gasUsed})`,
      )

      return {
        success: true,
        hash: result.hash,
        attempts,
      }
    } catch (error) {
      // Don't retry on rate limit errors - oracle was recently poked
      if (error instanceof OracleRateLimitedError) {
        logger.warn(`Oracle rate limited for pool ${poolAddress}:`, error.message)
        return {
          success: false,
          error: error.message,
          attempts,
        }
      }

      // Log error
      if (error instanceof PanopticError) {
        logger.error(`Poke failed for pool ${poolAddress}:`, error.message)
      } else {
        logger.error(`Unexpected error poking pool ${poolAddress}:`, error)
      }

      // Retry if we haven't exceeded max attempts
      if (attempts < maxRetries) {
        logger.info(`Retrying in ${retryDelayMs / 1000}s...`)
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      } else {
        logger.error(`Max retries (${maxRetries}) exceeded for pool ${poolAddress}`)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          attempts,
        }
      }
    }
  }

  // Should never reach here, but TypeScript needs this
  return {
    success: false,
    error: 'Unexpected: exceeded retry loop',
    attempts,
  }
}

/**
 * Execute pokes for multiple pools in parallel.
 */
export async function executeMultiplePokesinParallel(
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,
  poolAddresses: Address[],
  maxRetries: number,
  retryDelayMs: number,
  logger: Logger,
): Promise<ExecutionResult[]> {
  logger.info(`Executing pokes for ${poolAddresses.length} pool(s)...`)

  const results = await Promise.all(
    poolAddresses.map((poolAddress) =>
      executePokeWithRetry(
        client,
        walletClient,
        account,
        poolAddress,
        maxRetries,
        retryDelayMs,
        logger,
      ),
    ),
  )

  const successCount = results.filter((r) => r.success).length
  const failureCount = results.length - successCount

  logger.info(`Poke execution complete: ${successCount} succeeded, ${failureCount} failed`)

  return results
}
