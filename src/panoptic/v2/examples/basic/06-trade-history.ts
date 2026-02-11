/**
 * Basic Example 06: Trade History
 *
 * Demonstrates:
 * - Saving closed positions to trade history
 * - Querying trade history with filters (closure reason, block range)
 * - Pagination for large histories
 * - Aggregating realized PnL across positions
 * - Clearing trade history
 *
 * Prerequisites:
 * - RPC_URL environment variable
 * - POOL_ADDRESS environment variable
 * - ACCOUNT_ADDRESS environment variable
 * - CHAIN_ID environment variable (optional, defaults to 1)
 *
 * Why Track Trade History?
 * - Panoptic contracts don't store historical position data on-chain
 * - SDK maintains local history of closed positions
 * - Enables PnL tracking, win/loss analysis, and strategy backtesting
 * - History persists across sessions when using file storage
 *
 * NOTE: Actual PnL calculation requires PanopticQuery contract (not yet finalized).
 * This example uses placeholder values for demonstration purposes.
 */

import { type Address, createPublicClient, http } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

// SDK imports - storage adapters
import { type StorageAdapter, createFileStorage, createMemoryStorage } from '../../storage'
// SDK imports - sync module for trade history
import {
  clearTradeHistory,
  getClosedPositions,
  getRealizedPnL,
  getTradeHistory,
  saveClosedPosition,
} from '../../sync'
// SDK imports - types
import type { ClosedPosition, RealizedPnL } from '../../types'

// Configuration from environment
const RPC_URL = process.env.RPC_URL || 'https://eth.llamarpc.com'
const POOL_ADDRESS = process.env.POOL_ADDRESS as Address
const ACCOUNT_ADDRESS = process.env.ACCOUNT_ADDRESS as Address
const CHAIN_ID = BigInt(process.env.CHAIN_ID || '1')
const USE_FILE_STORAGE = process.env.USE_FILE_STORAGE === 'true'
const STORAGE_PATH = process.env.STORAGE_PATH || './trade-history-data'

if (!POOL_ADDRESS) {
  console.error('Error: POOL_ADDRESS environment variable is required')
  process.exit(1)
}

if (!ACCOUNT_ADDRESS) {
  console.error('Error: ACCOUNT_ADDRESS environment variable is required')
  process.exit(1)
}

/**
 * Format a bigint as a human-readable token amount.
 * Assumes 18 decimals for simplicity.
 */
function formatAmount(amount: bigint, decimals = 18): string {
  const isNegative = amount < 0n
  const absAmount = isNegative ? -amount : amount
  const divisor = 10n ** BigInt(decimals)
  const integerPart = absAmount / divisor
  const fractionalPart = absAmount % divisor
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, 4)
  const sign = isNegative ? '-' : amount > 0n ? '+' : ''
  return `${sign}${integerPart}.${fractionalStr}`
}

/**
 * Format a timestamp as a human-readable date string.
 */
function formatTimestamp(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toISOString().split('T')[0]
}

/**
 * Display a closed position in a readable format.
 */
function displayClosedPosition(position: ClosedPosition, index: number): void {
  console.log(`   [${index + 1}] TokenId: ${position.tokenId}`)
  console.log(
    `       Opened: block ${position.openBlock} (${formatTimestamp(position.openTimestamp)})`,
  )
  console.log(
    `       Closed: block ${position.closeBlock} (${formatTimestamp(position.closeTimestamp)})`,
  )
  console.log(`       Reason: ${position.closureReason}`)
  console.log(`       Size: ${position.positionSize}`)
  console.log(`       Tick: ${position.tickAtOpen} → ${position.tickAtClose}`)
  console.log(
    `       PnL: token0=${formatAmount(position.realizedPnL0)}, token1=${formatAmount(position.realizedPnL1)}`,
  )
  console.log(
    `       Premia: token0=${formatAmount(position.premiaCollected0)}, token1=${formatAmount(position.premiaCollected1)}`,
  )
}

/**
 * Create sample closed positions for demonstration.
 *
 * NOTE: In production, ClosedPosition records are created automatically
 * when syncPositions() detects position closures via OptionBurnt events.
 *
 * TODO: Actual PnL values (realizedPnL0, realizedPnL1, premiaCollected0, premiaCollected1)
 * should be computed using PanopticQuery contract, which is not yet finalized.
 * These placeholder values are for demonstration only.
 */
function createSampleClosedPositions(poolAddress: Address, owner: Address): ClosedPosition[] {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const dayInSeconds = 86400n

  return [
    {
      tokenId: 12345678901234567890n,
      owner,
      poolAddress,
      positionSize: 1000000000000000000n, // 1e18
      openBlock: 18000000n,
      closeBlock: 18000100n,
      openTimestamp: now - 7n * dayInSeconds,
      closeTimestamp: now - 6n * dayInSeconds,
      tickAtOpen: 200000n,
      tickAtClose: 200050n,
      // TODO: These should be computed via PanopticQuery.getAccountPremium()
      // and position delta calculations. Using placeholder values.
      realizedPnL0: 50000000000000000n, // +0.05 token0
      realizedPnL1: -25000000000000000n, // -0.025 token1
      premiaCollected0: 10000000000000000n,
      premiaCollected1: 5000000000000000n,
      closureReason: 'closed',
    },
    {
      tokenId: 23456789012345678901n,
      owner,
      poolAddress,
      positionSize: 2000000000000000000n, // 2e18
      openBlock: 18000200n,
      closeBlock: 18000400n,
      openTimestamp: now - 5n * dayInSeconds,
      closeTimestamp: now - 4n * dayInSeconds,
      tickAtOpen: 200100n,
      tickAtClose: 199800n,
      // TODO: Compute via PanopticQuery
      realizedPnL0: -100000000000000000n, // -0.1 token0
      realizedPnL1: 200000000000000000n, // +0.2 token1
      premiaCollected0: 20000000000000000n,
      premiaCollected1: 15000000000000000n,
      closureReason: 'closed',
    },
    {
      tokenId: 34567890123456789012n,
      owner,
      poolAddress,
      positionSize: 500000000000000000n, // 0.5e18
      openBlock: 18000500n,
      closeBlock: 18000600n,
      openTimestamp: now - 3n * dayInSeconds,
      closeTimestamp: now - 2n * dayInSeconds,
      tickAtOpen: 199500n,
      tickAtClose: 199000n,
      // TODO: Compute via PanopticQuery
      realizedPnL0: -500000000000000000n, // -0.5 token0
      realizedPnL1: -100000000000000000n, // -0.1 token1
      premiaCollected0: 5000000000000000n,
      premiaCollected1: 2000000000000000n,
      closureReason: 'liquidated',
    },
    {
      tokenId: 45678901234567890123n,
      owner,
      poolAddress,
      positionSize: 3000000000000000000n, // 3e18
      openBlock: 18000700n,
      closeBlock: 18000800n,
      openTimestamp: now - 1n * dayInSeconds,
      closeTimestamp: now,
      tickAtOpen: 198500n,
      tickAtClose: 199200n,
      // TODO: Compute via PanopticQuery
      realizedPnL0: 300000000000000000n, // +0.3 token0
      realizedPnL1: 150000000000000000n, // +0.15 token1
      premiaCollected0: 30000000000000000n,
      premiaCollected1: 25000000000000000n,
      closureReason: 'force_exercised',
    },
  ]
}

async function main() {
  console.log('=== Panoptic v2 SDK: Trade History ===\n')

  // Step 1: Create viem PublicClient
  console.log('1. Setting up PublicClient...')
  const chain = CHAIN_ID === 1n ? mainnet : CHAIN_ID === 11155111n ? sepolia : mainnet
  const client = createPublicClient({
    chain,
    transport: http(RPC_URL),
  })
  const latestBlock = await client.getBlockNumber()
  console.log(`   Connected to chain ${CHAIN_ID}`)
  console.log(`   Latest block: ${latestBlock}`)
  console.log(`   RPC: ${RPC_URL}\n`)

  // Step 2: Create storage adapter
  console.log('2. Setting up storage adapter...')
  let storage: StorageAdapter

  if (USE_FILE_STORAGE) {
    storage = createFileStorage(STORAGE_PATH)
    console.log(`   Using file storage: ${STORAGE_PATH}`)
  } else {
    storage = createMemoryStorage()
    console.log('   Using memory storage (ephemeral)')
  }
  console.log()

  // Step 3: Save sample closed positions
  console.log('3. Saving closed positions to history...')
  console.log('   NOTE: In production, positions are saved automatically by syncPositions()')
  console.log('   TODO: Actual PnL values require PanopticQuery contract (not yet finalized)\n')

  const samplePositions = createSampleClosedPositions(POOL_ADDRESS, ACCOUNT_ADDRESS)

  for (const position of samplePositions) {
    await saveClosedPosition({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      storage,
      closedPosition: position,
    })
    console.log(`   Saved position ${position.tokenId} (${position.closureReason})`)
  }
  console.log()

  // Step 4: Query all trade history
  console.log('4. Retrieving all trade history...')
  const allHistory = await getTradeHistory({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
  })

  console.log(`   Found ${allHistory.length} closed position(s):\n`)
  for (let i = 0; i < allHistory.length; i++) {
    displayClosedPosition(allHistory[i], i)
    console.log()
  }

  // Step 5: Filter by closure reason
  console.log('5. Filtering by closure reason...')

  const closedOnly = await getClosedPositions({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
    closureReason: 'closed',
  })
  console.log(`   Voluntarily closed: ${closedOnly.length} position(s)`)

  const liquidatedOnly = await getTradeHistory({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
    closureReason: 'liquidated',
  })
  console.log(`   Liquidated: ${liquidatedOnly.length} position(s)`)

  const forceExercisedOnly = await getTradeHistory({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
    closureReason: 'force_exercised',
  })
  console.log(`   Force exercised: ${forceExercisedOnly.length} position(s)`)
  console.log()

  // Step 6: Filter by block range
  console.log('6. Filtering by block range...')

  const recentHistory = await getTradeHistory({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
    fromBlock: 18000500n,
    toBlock: 18000800n,
  })
  console.log(`   Positions closed in blocks 18000500-18000800: ${recentHistory.length}`)

  for (const position of recentHistory) {
    console.log(`   - TokenId ${position.tokenId} at block ${position.closeBlock}`)
  }
  console.log()

  // Step 7: Pagination
  console.log('7. Demonstrating pagination...')

  const page1 = await getTradeHistory({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
    limit: 2n,
    offset: 0n,
  })
  console.log(`   Page 1 (limit=2, offset=0): ${page1.length} positions`)
  for (const p of page1) {
    console.log(`   - TokenId ${p.tokenId}`)
  }

  const page2 = await getTradeHistory({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
    limit: 2n,
    offset: 2n,
  })
  console.log(`   Page 2 (limit=2, offset=2): ${page2.length} positions`)
  for (const p of page2) {
    console.log(`   - TokenId ${p.tokenId}`)
  }
  console.log()

  // Step 8: Get realized PnL summary
  console.log('8. Calculating realized PnL summary...')
  console.log('   TODO: Actual PnL calculation requires PanopticQuery contract')
  console.log('   NOTE: Current values are placeholders for demonstration\n')

  const pnl: RealizedPnL = await getRealizedPnL({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
  })

  console.log('   === PnL Summary ===')
  console.log(`   Total positions: ${pnl.positionCount}`)
  console.log(`   Wins: ${pnl.winCount}`)
  console.log(`   Losses: ${pnl.lossCount}`)
  console.log(
    `   Win rate: ${pnl.positionCount > 0n ? Number((pnl.winCount * 100n) / pnl.positionCount) : 0}%`,
  )
  console.log(`   Token0 PnL: ${formatAmount(pnl.total0)}`)
  console.log(`   Token1 PnL: ${formatAmount(pnl.total1)}`)
  console.log()

  // Step 9: Get PnL for specific period
  console.log('9. PnL for specific block range...')

  const recentPnl = await getRealizedPnL({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
    fromBlock: 18000500n,
  })

  console.log(`   PnL from block 18000500 onwards:`)
  console.log(`   Positions: ${recentPnl.positionCount}`)
  console.log(`   Token0: ${formatAmount(recentPnl.total0)}`)
  console.log(`   Token1: ${formatAmount(recentPnl.total1)}`)
  console.log()

  // Step 10: Cleanup demonstration (optional)
  if (process.env.CLEANUP === 'true') {
    console.log('10. Clearing trade history...')
    await clearTradeHistory({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      storage,
    })

    const emptyHistory = await getTradeHistory({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      storage,
    })
    console.log(`   History cleared. Remaining positions: ${emptyHistory.length}`)
    console.log()
  }

  console.log('=== Complete ===')
  console.log()
  console.log('Key Takeaways:')
  console.log('- Trade history is stored locally, not on-chain')
  console.log('- syncPositions() automatically saves closed positions')
  console.log('- Filter by closure reason: closed, liquidated, force_exercised')
  console.log('- Filter by block range for period-specific analysis')
  console.log('- Use pagination (limit/offset) for large histories')
  console.log('- TODO: PnL calculation requires PanopticQuery (not yet finalized)')
  console.log()
  console.log('Tips:')
  console.log('- Use USE_FILE_STORAGE=true to persist history between runs')
  console.log('- Set CLEANUP=true to clear history at the end')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
