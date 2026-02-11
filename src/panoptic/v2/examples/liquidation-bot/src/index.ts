/**
 * Liquidation Bot Example
 *
 * Monitors accounts for liquidation opportunities and executes liquidations.
 * Uses the SDK's sync module for position discovery via event tracking.
 *
 * IMPORTANT: This is an example demonstrating the SDK patterns.
 * A production liquidation bot would additionally need:
 * - MEV protection (Flashbots, private mempool)
 * - Better account discovery (subgraph for finding ALL accounts with positions)
 * - Multi-pool support
 * - Metrics/monitoring (Prometheus, etc.)
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
import { mainnet, sepolia } from 'viem/chains'

import {
  assertFresh,
  assertHealthy,
  isGasError,
  isNonceError,
  isRetryableRpcError,
} from '../../../bot'
import { StaleDataError, UnhealthyPoolError } from '../../../errors'
import { formatBps, formatGwei, formatTokenAmount, truncateAddress } from '../../../formatters'
// SDK imports
import { isLiquidatable } from '../../../reads/checks'
import { getMarginBuffer } from '../../../reads/margin'
import { getPool } from '../../../reads/pool'
import { getSafeMode } from '../../../reads/safeMode'
import { simulateLiquidate } from '../../../simulations/simulateLiquidate'
import type { StorageAdapter } from '../../../storage'
import { createFileStorage } from '../../../storage'
import { getTrackedPositionIds, syncPositions } from '../../../sync'
import { liquidate } from '../../../writes/liquidate'
import { loadConfig } from './config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LiquidationCandidate {
  address: Address
  tokenIds: bigint[]
  /** Margin buffer percentage in bps (lower = more urgent) */
  marginBufferPct: bigint | null
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: unknown) {
  const timestamp = new Date().toISOString()
  const prefix = `[${timestamp}] [${level}]`
  if (data !== undefined) {
    console.log(prefix, message, data)
  } else {
    console.log(prefix, message)
  }
}

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

/**
 * Validate pool health, safe mode, and data freshness before attempting liquidations.
 * Returns false if liquidations should be skipped this iteration.
 */
async function preflightChecks(
  client: PublicClient,
  poolAddress: Address,
  chainId: bigint,
  maxStalenessSeconds: number,
): Promise<boolean> {
  try {
    const [pool, safeMode] = await Promise.all([
      getPool({ client, poolAddress, chainId }),
      getSafeMode({ client, poolAddress }),
    ])

    // Data freshness
    assertFresh(pool, maxStalenessSeconds)

    // Pool health
    assertHealthy(pool)

    if (!safeMode.canLiquidate) {
      log(
        'WARN',
        `Pool safe mode blocks liquidations (${safeMode.reason ?? safeMode.mode}), skipping iteration`,
      )
      return false
    }

    if (safeMode.mode !== 'normal') {
      log('INFO', `Pool in ${safeMode.mode} safe mode — liquidations still allowed`)
    }

    return true
  } catch (error) {
    if (error instanceof StaleDataError) {
      log('WARN', `RPC data stale (${error.stalenessSeconds}s old), skipping iteration`)
    } else if (error instanceof UnhealthyPoolError) {
      log('WARN', `Pool unhealthy (${error.healthStatus}), skipping iteration`)
    } else if (isRetryableRpcError(error)) {
      log('WARN', 'Transient RPC error during preflight, skipping iteration')
    } else {
      log('ERROR', 'Preflight check failed:', error)
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Account checking
// ---------------------------------------------------------------------------

/**
 * Sync positions for an account, check if liquidatable, and get margin buffer.
 */
async function checkAccount(
  client: PublicClient,
  poolAddress: Address,
  queryAddress: Address,
  account: Address,
  storage: StorageAdapter,
  chainId: bigint,
): Promise<LiquidationCandidate | null> {
  try {
    // Sync positions (incremental if already synced)
    await syncPositions({
      client,
      poolAddress,
      account,
      storage,
      chainId,
    })

    // Get tracked position IDs
    const tokenIds = await getTrackedPositionIds({
      chainId,
      poolAddress,
      account,
      storage,
    })

    if (tokenIds.length === 0) {
      return null
    }

    const result = await isLiquidatable({
      client,
      poolAddress,
      account,
      tokenIds,
      queryAddress,
    })

    if (!result.isLiquidatable) {
      return null
    }

    // Get margin buffer for prioritization
    let marginBufferPct: bigint | null = null
    try {
      const buffer = await getMarginBuffer({
        client,
        poolAddress,
        account,
        tokenIds,
        queryAddress,
      })
      // Use the minimum of both token buffers
      const bp0 = buffer.bufferPercent0
      const bp1 = buffer.bufferPercent1
      if (bp0 !== null && bp1 !== null) {
        marginBufferPct = bp0 < bp1 ? bp0 : bp1
      } else {
        marginBufferPct = bp0 ?? bp1
      }
    } catch {
      // Non-critical — proceed without prioritization data
    }

    log(
      'WARN',
      `${truncateAddress(account)} is LIQUIDATABLE (${tokenIds.length} positions` +
        (marginBufferPct !== null ? `, buffer: ${formatBps(marginBufferPct, 1n)}` : '') +
        ')',
    )

    return { address: account, tokenIds, marginBufferPct }
  } catch (error) {
    if (isRetryableRpcError(error)) {
      log(
        'WARN',
        `Transient RPC error checking ${truncateAddress(account)}, will retry next iteration`,
      )
    } else {
      log('ERROR', `Failed to check ${truncateAddress(account)}:`, error)
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Liquidation execution
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2

async function attemptLiquidation(
  publicClient: PublicClient,
  walletClient: WalletClient,
  liquidatorAddress: Address,
  poolAddress: Address,
  target: LiquidationCandidate,
  maxGasPriceGwei: number,
  retriesLeft: number = MAX_RETRIES,
): Promise<boolean> {
  const addr = truncateAddress(target.address)
  log('INFO', `Attempting to liquidate ${addr} (${target.tokenIds.length} positions)...`)

  try {
    // Step 1: Simulate
    const simulation = await simulateLiquidate({
      client: publicClient,
      poolAddress,
      account: liquidatorAddress,
      liquidatee: target.address,
      positionIdListFrom: [],
      positionIdListTo: target.tokenIds,
      positionIdListToFinal: [],
    })

    if (!simulation.success) {
      log('WARN', `Simulation failed for ${addr}: ${simulation.error?.message}`)
      return false
    }

    if (!simulation.data.isLiquidatable) {
      log('INFO', `${addr} no longer liquidatable (race condition)`)
      return false
    }

    const gasEstimate = simulation.gasEstimate
    log('INFO', `Simulation OK — gas estimate: ${gasEstimate}`)

    // Step 2: Gas price check
    const gasPrice = await publicClient.getGasPrice()
    const gasPriceGwei = Number(gasPrice) / 1e9

    if (gasPriceGwei > maxGasPriceGwei) {
      log(
        'WARN',
        `Gas price ${formatGwei(gasPrice, 2n)} exceeds max ${maxGasPriceGwei} gwei, skipping`,
      )
      return false
    }

    // Step 3: Basic profitability check
    // Gas cost in wei
    const estimatedGasCost = gasEstimate * gasPrice
    log(
      'INFO',
      `Estimated gas cost: ${formatTokenAmount(estimatedGasCost, 18n, 6n)} ETH ` +
        `(${gasEstimate} gas @ ${formatGwei(gasPrice, 2n)} gwei)`,
    )

    // Step 4: Execute
    log('INFO', 'Executing liquidation...')

    const txResult = await liquidate({
      client: publicClient,
      walletClient,
      account: liquidatorAddress,
      poolAddress,
      liquidatee: target.address,
      positionIdListFrom: [],
      positionIdListTo: target.tokenIds,
      positionIdListToFinal: [],
    })

    log('INFO', `Tx submitted: ${txResult.hash}`)

    const receipt = await txResult.wait()

    if (receipt.status === 'success') {
      log(
        'INFO',
        `Liquidation successful! Block ${receipt.blockNumber}, gas used: ${receipt.gasUsed}`,
      )
      return true
    } else {
      log('ERROR', `Liquidation reverted in block ${receipt.blockNumber}`)
      return false
    }
  } catch (error) {
    if (isNonceError(error) && retriesLeft > 0) {
      log('WARN', `Nonce error, retrying (${retriesLeft} left)...`)
      await sleep(1000)
      return attemptLiquidation(
        publicClient,
        walletClient,
        liquidatorAddress,
        poolAddress,
        target,
        maxGasPriceGwei,
        retriesLeft - 1,
      )
    }

    if (isGasError(error) && retriesLeft > 0) {
      log('WARN', `Gas error, retrying (${retriesLeft} left)...`)
      await sleep(2000)
      return attemptLiquidation(
        publicClient,
        walletClient,
        liquidatorAddress,
        poolAddress,
        target,
        maxGasPriceGwei,
        retriesLeft - 1,
      )
    }

    if (isRetryableRpcError(error) && retriesLeft > 0) {
      log('WARN', `Transient RPC error, retrying (${retriesLeft} left)...`)
      await sleep(3000)
      return attemptLiquidation(
        publicClient,
        walletClient,
        liquidatorAddress,
        poolAddress,
        target,
        maxGasPriceGwei,
        retriesLeft - 1,
      )
    }

    log('ERROR', `Liquidation of ${addr} failed:`, error)
    return false
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('=== Panoptic Liquidation Bot ===\n')

  const config = loadConfig()

  log('INFO', `Pool:     ${config.poolAddress}`)
  log('INFO', `Query:    ${config.queryAddress}`)
  log('INFO', `Accounts: ${config.accountsToMonitor.length}`)
  log('INFO', `Interval: ${config.pollingInterval}ms`)
  log('INFO', `Max gas:  ${config.maxGasPriceGwei} gwei`)
  console.log('')

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

  log('INFO', `Bot account: ${truncateAddress(account.address)}`)

  // Storage for position sync
  const storage = createFileStorage(config.storagePath ?? './data')
  const chainId = BigInt(config.chainId)

  log('INFO', `Storage: ${config.storagePath ?? './data'}`)
  console.log('')

  const accounts = config.accountsToMonitor

  // Bot loop
  let iteration = 0
  let totalLiquidations = 0
  const maxStalenessSeconds = 60 // 1 minute

  while (true) {
    iteration++
    log('INFO', `=== Iteration ${iteration} ===`)

    try {
      // Pre-flight: pool health, safe mode, data freshness
      const ok = await preflightChecks(
        publicClient,
        config.poolAddress,
        chainId,
        maxStalenessSeconds,
      )
      if (!ok) {
        log('INFO', `Waiting ${(config.pollingInterval ?? 15000) / 1000}s...\n`)
        await sleep(config.pollingInterval ?? 15000)
        continue
      }

      // Check all monitored accounts in parallel
      const candidates = await Promise.all(
        accounts.map((addr) =>
          checkAccount(
            publicClient,
            config.poolAddress,
            config.queryAddress,
            addr,
            storage,
            chainId,
          ),
        ),
      )

      // Filter to liquidatable, sort by urgency (lowest margin buffer first)
      const liquidatable = candidates
        .filter((c): c is LiquidationCandidate => c !== null)
        .sort((a, b) => {
          if (a.marginBufferPct === null) return 1
          if (b.marginBufferPct === null) return -1
          return Number(a.marginBufferPct - b.marginBufferPct)
        })

      if (liquidatable.length > 0) {
        log('INFO', `Found ${liquidatable.length} liquidatable account(s)`)

        for (const target of liquidatable) {
          const success = await attemptLiquidation(
            publicClient,
            walletClient,
            account.address,
            config.poolAddress,
            target,
            config.maxGasPriceGwei ?? 100,
          )
          if (success) {
            totalLiquidations++
            log('INFO', `Total successful liquidations: ${totalLiquidations}`)
          }
        }
      } else {
        log('INFO', 'No liquidatable accounts found')
      }
    } catch (error) {
      if (isRetryableRpcError(error)) {
        log('WARN', 'Transient error in bot loop, will retry next iteration')
      } else {
        log('ERROR', 'Error in bot loop:', error)
      }
    }

    log('INFO', `Waiting ${(config.pollingInterval ?? 15000) / 1000}s...\n`)
    await sleep(config.pollingInterval ?? 15000)
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\nShutting down...')
  process.exit(0)
})

// Start
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
