/**
 * Basic Example 05: Position Synchronization
 *
 * Demonstrates:
 * - Setting up storage adapters (memory vs file)
 * - Initial position sync with syncPositions()
 * - Incremental sync on subsequent calls
 * - Checking sync status with getSyncStatus()
 * - Retrieving tracked positions with getTrackedPositionIds()
 * - Progress reporting via onUpdate callback
 * - Cleaning up with clearTrackedPositions()
 *
 * Prerequisites:
 * - RPC_URL environment variable
 * - POOL_ADDRESS environment variable
 * - ACCOUNT_ADDRESS environment variable
 * - CHAIN_ID environment variable (optional, defaults to 1)
 *
 * Why Position Sync?
 * - Panoptic contracts don't enumerate user positions on-chain
 * - SDK must track positions locally via event scanning
 * - Positions discovered via OptionMinted/OptionBurnt events
 * - Checkpoints enable resumable, incremental syncs
 */

import { type Address, createPublicClient, http } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

// SDK imports - for position details
import { getPosition } from '../../reads/position'
// SDK imports - storage adapters
import { type StorageAdapter, createFileStorage, createMemoryStorage } from '../../storage'
// SDK imports - sync module
import {
  type SyncPositionsResult,
  type SyncProgressEvent,
  type SyncStatusResult,
  clearTrackedPositions,
  getSyncStatus,
  getTrackedPositionIds,
  syncPositions,
} from '../../sync'

// Configuration from environment
const RPC_URL = process.env.RPC_URL || 'https://eth.llamarpc.com'
const POOL_ADDRESS = process.env.POOL_ADDRESS as Address
const ACCOUNT_ADDRESS = process.env.ACCOUNT_ADDRESS as Address
const CHAIN_ID = BigInt(process.env.CHAIN_ID || '1')
const USE_FILE_STORAGE = process.env.USE_FILE_STORAGE === 'true'
const STORAGE_PATH = process.env.STORAGE_PATH || './sync-data'

if (!POOL_ADDRESS) {
  console.error('Error: POOL_ADDRESS environment variable is required')
  process.exit(1)
}

if (!ACCOUNT_ADDRESS) {
  console.error('Error: ACCOUNT_ADDRESS environment variable is required')
  process.exit(1)
}

/**
 * Progress callback for sync updates.
 * Shows real-time sync progress to the user.
 */
function handleSyncProgress(event: SyncProgressEvent): void {
  switch (event.type) {
    case 'position-opened':
      console.log(`   [+] Position opened: ${event.tokenId}`)
      break
    case 'position-closed':
      console.log(`   [-] Position closed: ${event.tokenId}`)
      break
    case 'progress':
      if (event.progress) {
        const pct = ((Number(event.progress.current) / Number(event.progress.total)) * 100).toFixed(
          1,
        )
        console.log(
          `   [~] Progress: block ${event.progress.current}/${event.progress.total} (${pct}%)`,
        )
      }
      break
    case 'reorg-detected':
      console.log(`   [!] Reorg detected at block ${event.blockNumber}`)
      break
  }
}

async function main() {
  console.log('=== Panoptic v2 SDK: Position Synchronization ===\n')

  // Step 1: Create viem PublicClient
  console.log('1. Setting up PublicClient...')
  const chain = CHAIN_ID === 1n ? mainnet : CHAIN_ID === 11155111n ? sepolia : mainnet
  const client = createPublicClient({
    chain,
    transport: http(RPC_URL),
  })
  console.log(`   Connected to chain ${CHAIN_ID}`)
  console.log(`   RPC: ${RPC_URL}\n`)

  // Step 2: Create storage adapter
  console.log('2. Setting up storage adapter...')
  let storage: StorageAdapter

  if (USE_FILE_STORAGE) {
    // File storage - persists between runs, good for production
    storage = createFileStorage(STORAGE_PATH)
    console.log(`   Using file storage: ${STORAGE_PATH}`)
  } else {
    // Memory storage - ephemeral, good for testing
    storage = createMemoryStorage()
    console.log('   Using memory storage (ephemeral)')
  }
  console.log()

  // Step 3: Check current sync status
  console.log('3. Checking sync status...')
  const statusBefore: SyncStatusResult = await getSyncStatus({
    client,
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
  })

  console.log(`   Has checkpoint: ${statusBefore.hasCheckpoint}`)
  console.log(`   Last synced block: ${statusBefore.lastSyncedBlock}`)
  console.log(`   Is synced: ${statusBefore.isSynced}`)
  console.log(`   Blocks behind: ${statusBefore.blocksBehind}`)
  console.log(`   Position count: ${statusBefore.positionCount}`)
  console.log()

  // Step 4: Perform position sync
  console.log('4. Syncing positions...')
  console.log(`   Account: ${ACCOUNT_ADDRESS}`)
  console.log(`   Pool: ${POOL_ADDRESS}`)
  console.log()

  const startTime = Date.now()

  const syncResult: SyncPositionsResult = await syncPositions({
    client,
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
    // Max 5000 blocks per getLogs call (conservative for public RPCs)
    maxLogsPerQuery: 5000n,
    // 5 minute timeout for initial sync
    syncTimeout: BigInt(5 * 60 * 1000),
    // Progress callback
    onUpdate: handleSyncProgress,
  })

  const syncTime = Date.now() - startTime
  console.log()
  console.log(`   Sync complete!`)
  console.log(`   Duration: ${syncTime}ms`)
  console.log(`   Sync type: ${syncResult.incremental ? 'incremental' : 'full'}`)
  console.log(`   Last synced block: ${syncResult.lastSyncedBlock}`)
  console.log(`   Position count: ${syncResult.positionCount}`)
  console.log()

  // Step 5: Get tracked position IDs
  console.log('5. Retrieving tracked positions...')
  const positionIds = await getTrackedPositionIds({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
  })

  if (positionIds.length === 0) {
    console.log('   No positions found for this account')
  } else {
    console.log(`   Found ${positionIds.length} position(s):`)
    for (const tokenId of positionIds) {
      console.log(`   - ${tokenId}`)
    }
  }
  console.log()

  // Step 6: Fetch position details (if any exist)
  if (positionIds.length > 0) {
    console.log('6. Fetching position details...')
    for (const tokenId of positionIds.slice(0, 3)) {
      // Limit to first 3
      try {
        const position = await getPosition({
          client,
          poolAddress: POOL_ADDRESS,
          owner: ACCOUNT_ADDRESS,
          tokenId,
        })
        console.log(`   Position ${tokenId}:`)
        console.log(`     Size: ${position.positionSize}`)
        console.log(`     Tick at mint: ${position.tickAtMint}`)
        console.log(`     Timestamp at mint: ${position.timestampAtMint}`)
        console.log(`     Block at mint: ${position.blockNumberAtMint}`)
      } catch (error) {
        console.log(`   Position ${tokenId}: Error fetching details`)
      }
    }
    if (positionIds.length > 3) {
      console.log(`   ... and ${positionIds.length - 3} more`)
    }
    console.log()
  }

  // Step 7: Perform incremental sync (if already synced)
  if (statusBefore.hasCheckpoint) {
    console.log('7. Performing incremental sync...')
    const incrementalStart = Date.now()

    const incrementalResult = await syncPositions({
      client,
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      storage,
      onUpdate: handleSyncProgress,
    })

    const incrementalTime = Date.now() - incrementalStart
    console.log()
    console.log(`   Incremental sync complete!`)
    console.log(`   Duration: ${incrementalTime}ms (vs ${syncTime}ms for initial)`)
    console.log(`   Sync type: ${incrementalResult.incremental ? 'incremental' : 'full'}`)
    console.log()
  }

  // Step 8: Check final sync status
  console.log('8. Final sync status...')
  const statusAfter = await getSyncStatus({
    client,
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    account: ACCOUNT_ADDRESS,
    storage,
  })

  console.log(`   Has checkpoint: ${statusAfter.hasCheckpoint}`)
  console.log(`   Last synced block: ${statusAfter.lastSyncedBlock}`)
  console.log(`   Is synced: ${statusAfter.isSynced}`)
  console.log(`   Blocks behind: ${statusAfter.blocksBehind}`)
  console.log(`   Position count: ${statusAfter.positionCount}`)
  console.log()

  // Step 9: Cleanup demonstration (optional)
  if (process.env.CLEANUP === 'true') {
    console.log('9. Cleaning up tracked positions...')
    await clearTrackedPositions({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      storage,
    })
    console.log('   Positions cleared')

    const statusCleared = await getSyncStatus({
      client,
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      storage,
    })
    console.log(`   Position count after clear: ${statusCleared.positionCount}`)
    console.log()
  }

  console.log('=== Complete ===')
  console.log()
  console.log('Tips:')
  console.log('- Use USE_FILE_STORAGE=true to persist sync data between runs')
  console.log('- Incremental syncs are much faster than full syncs')
  console.log('- Set CLEANUP=true to clear positions at the end')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
