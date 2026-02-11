/**
 * Oracle Poker Bot - Main Entry Point
 *
 * Monitors Panoptic pools and pokes their oracles when needed.
 * The oracle can be poked once per epoch (64 seconds) to update
 * the oracle state (EMAs, median tick, etc.).
 */

import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, sepolia } from 'viem/chains'

import { loadConfig } from './config'
import { executeMultiplePokesinParallel } from './executor'
import { Logger } from './logger'
import { checkAllPools } from './monitor'

/**
 * Main bot loop.
 */
async function main() {
  console.log('=== Oracle Poker Bot ===\n')

  // Load configuration
  const config = loadConfig()
  const logger = new Logger(config.verbose)

  logger.info('Bot configuration loaded')
  logger.info(`RPC URL: ${config.rpcUrl}`)
  logger.info(`Chain ID: ${config.chainId}`)
  logger.info(`Monitoring ${config.poolAddresses.length} pool(s)`)
  logger.info(`Polling interval: ${config.pollingInterval}ms`)
  logger.info(`Max gas price: ${config.maxGasPriceGwei} gwei`)
  logger.info('')

  // Determine chain
  const chain = config.chainId === 1 ? mainnet : config.chainId === 11155111 ? sepolia : undefined
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${config.chainId}`)
  }

  // Create clients
  const account = privateKeyToAccount(config.privateKey)
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  })
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  })

  logger.info(`Bot account: ${account.address}`)
  logger.info('Clients initialized')
  logger.info('')

  // Bot loop
  let iteration = 0
  while (true) {
    iteration++
    logger.info(`=== Iteration ${iteration} ===`)

    try {
      // Check all pools
      const statuses = await checkAllPools(publicClient, config.poolAddresses, logger)

      // Filter pools that need poking
      const poolsToPoke = statuses.filter((s) => s.needsPoke).map((s) => s.poolAddress)

      if (poolsToPoke.length > 0) {
        // Check gas price
        const gasPrice = await publicClient.getGasPrice()
        const gasPriceGwei = Number(gasPrice) / 1e9

        logger.info(`Current gas price: ${gasPriceGwei.toFixed(2)} gwei`)

        if (gasPriceGwei > config.maxGasPriceGwei!) {
          logger.warn(
            `Gas price (${gasPriceGwei.toFixed(2)} gwei) exceeds maximum ` +
              `(${config.maxGasPriceGwei} gwei). Skipping pokes.`,
          )
        } else {
          // Execute pokes
          await executeMultiplePokesinParallel(
            publicClient,
            walletClient,
            account.address,
            poolsToPoke,
            config.maxRetries!,
            config.retryDelayMs!,
            logger,
          )
        }
      } else {
        // Log next poke times
        for (const status of statuses) {
          if (status.secondsUntilNextPoke > 0n) {
            logger.debug(`Pool ${status.poolAddress}: next poke in ${status.secondsUntilNextPoke}s`)
          }
        }
      }
    } catch (error) {
      logger.error('Error in bot loop:', error)
    }

    // Wait for next iteration
    logger.info(`Waiting ${config.pollingInterval! / 1000}s until next check...\n`)
    await new Promise((resolve) => setTimeout(resolve, config.pollingInterval))
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Oracle Poker Bot...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\nShutting down Oracle Poker Bot...')
  process.exit(0)
})

// Start the bot
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
