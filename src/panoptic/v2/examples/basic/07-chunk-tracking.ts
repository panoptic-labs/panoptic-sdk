/**
 * Basic Example 07: Liquidity Chunk Tracking
 *
 * Demonstrates:
 * - Scanning chunks with scanChunks() (recommended, PanopticQuery-based)
 * - Getting position chunk data with getPositionChunkData()
 * - Manual chunk tracking with addTrackedChunks/getTrackedChunks (legacy)
 * - Calculating spread from liquidity values with calculateSpreadWad()
 * - Handling ChunkLimitError when exceeding 1000 chunks
 *
 * Prerequisites:
 * - RPC_URL environment variable
 * - POOL_ADDRESS environment variable
 * - QUERY_ADDRESS environment variable (PanopticQuery contract)
 * - CHAIN_ID environment variable (optional, defaults to 1)
 *
 * Why Track Liquidity Chunks?
 * - Chunks represent liquidity ranges where options can be written
 * - A chunk is identified by (tokenType, strike, width)
 * - Tracking chunks enables volatility surface monitoring
 * - Spread = 1 + (1/VEGOID) * removedLiquidity / netLiquidity
 * - Higher spread indicates higher borrowing cost for option buyers
 *
 * Two Approaches:
 * 1. scanChunks() - Automatic discovery of non-empty chunks in a range (recommended)
 * 2. Manual tracking - Add/remove chunks explicitly, then query (legacy)
 */

import { type Address, createPublicClient, http } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

// SDK imports - errors
import { ChunkLimitError } from '../../errors'
// SDK imports - storage adapters
import { type StorageAdapter, createFileStorage, createMemoryStorage } from '../../storage'
// SDK imports - chunk tracking (new PanopticQuery-based)
import {
  type LiquidityChunkKey,
  type ScannedChunk,
  addTrackedChunks,
  calculateSpreadWad,
  clearTrackedChunks,
  getTrackedChunks,
  removeTrackedChunks,
  scanChunks,
} from '../../sync'
// SDK imports - constants
import { MAX_TRACKED_CHUNKS, WAD } from '../../utils/constants'

// Configuration from environment
const RPC_URL = process.env.RPC_URL || 'https://eth.llamarpc.com'
const POOL_ADDRESS = process.env.POOL_ADDRESS as Address
const QUERY_ADDRESS = process.env.QUERY_ADDRESS as Address | undefined
const CHAIN_ID = BigInt(process.env.CHAIN_ID || '1')
const USE_FILE_STORAGE = process.env.USE_FILE_STORAGE === 'true'
const STORAGE_PATH = process.env.STORAGE_PATH || './chunk-tracking-data'

if (!POOL_ADDRESS) {
  console.error('Error: POOL_ADDRESS environment variable is required')
  process.exit(1)
}

/**
 * Format a WAD-scaled value as a human-readable multiplier.
 * 1e18 = 1.0x, 1.5e18 = 1.5x
 */
function formatSpread(spreadWad: bigint): string {
  // Convert to a decimal with 4 decimal places
  const scaled = (spreadWad * 10000n) / WAD
  const intPart = scaled / 10000n
  const fracPart = scaled % 10000n
  return `${intPart}.${fracPart.toString().padStart(4, '0')}x`
}

/**
 * Format a tick as a human-readable string.
 */
function formatTick(tick: bigint): string {
  return tick >= 0n ? `+${tick}` : `${tick}`
}

/**
 * Display a scanned chunk.
 */
function displayScannedChunk(chunk: ScannedChunk, index: number): void {
  console.log(`   [${index + 1}] Strike ${formatTick(chunk.strike)}:`)
  console.log(
    `       Token0: net=${chunk.netLiquidity0}, removed=${chunk.removedLiquidity0}, spread=${formatSpread(chunk.spreadWad0)}`,
  )
  console.log(
    `       Token1: net=${chunk.netLiquidity1}, removed=${chunk.removedLiquidity1}, spread=${formatSpread(chunk.spreadWad1)}`,
  )
}

/**
 * Display a chunk key in a readable format.
 */
function displayChunkKey(chunk: LiquidityChunkKey, index: number): void {
  const tokenTypeStr = chunk.tokenType === 0n ? 'token0 (put)' : 'token1 (call)'
  console.log(
    `   [${index + 1}] ${tokenTypeStr}: ticks [${formatTick(chunk.tickLower)}, ${formatTick(chunk.tickUpper)}]`,
  )
}

/**
 * Create sample liquidity chunks for demonstration.
 * These represent common tick ranges around the current price.
 */
function createSampleChunks(): LiquidityChunkKey[] {
  // Sample chunks around tick 0 with tickSpacing of 10
  return [
    // Token0 (put) chunks - typically below current price
    { tokenType: 0n, tickLower: -200n, tickUpper: -100n },
    { tokenType: 0n, tickLower: -300n, tickUpper: -200n },
    { tokenType: 0n, tickLower: -400n, tickUpper: -300n },

    // Token1 (call) chunks - typically above current price
    { tokenType: 1n, tickLower: 100n, tickUpper: 200n },
    { tokenType: 1n, tickLower: 200n, tickUpper: 300n },
    { tokenType: 1n, tickLower: 300n, tickUpper: 400n },

    // Near-the-money chunks
    { tokenType: 0n, tickLower: -100n, tickUpper: 0n },
    { tokenType: 1n, tickLower: 0n, tickUpper: 100n },
  ]
}

async function main() {
  console.log('=== Panoptic v2 SDK: Liquidity Chunk Tracking ===\n')

  // Step 1: Create viem PublicClient
  console.log('1. Setting up PublicClient...')
  const chain = CHAIN_ID === 1n ? mainnet : CHAIN_ID === 11155111n ? sepolia : mainnet
  const client = createPublicClient({
    chain,
    transport: http(RPC_URL),
  })
  console.log(`   Connected to chain ${CHAIN_ID}`)
  console.log(`   RPC: ${RPC_URL}\n`)

  // Step 2: Create storage adapter (for legacy manual tracking)
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

  // ============================================================================
  // PART A: PanopticQuery-based chunk scanning (RECOMMENDED)
  // ============================================================================

  if (QUERY_ADDRESS) {
    console.log('=== Part A: PanopticQuery-based Chunk Scanning (Recommended) ===\n')

    // Step 3: Scan for chunks in a tick range
    console.log('3. Scanning for non-empty chunks in tick range...')
    console.log(`   Pool: ${POOL_ADDRESS}`)
    console.log(`   Query: ${QUERY_ADDRESS}`)
    console.log(`   Range: [-1000, +1000], width: 100`)

    try {
      const scanResult = await scanChunks({
        client,
        poolAddress: POOL_ADDRESS,
        queryAddress: QUERY_ADDRESS,
        tickLower: -1000n,
        tickUpper: 1000n,
        width: 100n,
      })

      console.log(`   Found ${scanResult.chunks.length} non-empty chunk(s)`)
      console.log(`   Block: ${scanResult._meta.blockNumber}`)
      console.log()

      if (scanResult.chunks.length > 0) {
        console.log('4. Displaying scanned chunks:')
        for (let i = 0; i < Math.min(scanResult.chunks.length, 10); i++) {
          displayScannedChunk(scanResult.chunks[i], i)
        }
        if (scanResult.chunks.length > 10) {
          console.log(`   ... and ${scanResult.chunks.length - 10} more`)
        }
        console.log()
      }

      // Step 5: Get chunk data for specific positions
      console.log('5. Getting chunk data for specific positions...')
      console.log('   (Requires tokenIds - skipping as we have none)')
      console.log()

      // If you have tokenIds, you can use:
      // const positionChunkData = await getPositionChunkData({
      //   client,
      //   poolAddress: POOL_ADDRESS,
      //   queryAddress: QUERY_ADDRESS,
      //   tokenIds: [tokenId1, tokenId2],
      // })
    } catch (error) {
      console.log(`   Error scanning chunks: ${error}`)
      console.log('   (This may be expected if the pool has no liquidity)')
      console.log()
    }
  } else {
    console.log('=== Part A: Skipped (QUERY_ADDRESS not provided) ===\n')
    console.log('   Set QUERY_ADDRESS to use PanopticQuery-based scanning\n')
  }

  // ============================================================================
  // PART B: Legacy Manual Tracking
  // ============================================================================

  console.log('=== Part B: Manual Chunk Tracking (Legacy) ===\n')

  // Step 6: Check initial state
  console.log('6. Checking initial chunk tracking state...')
  const initialChunks = await getTrackedChunks({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    storage,
  })
  console.log(`   Currently tracking ${initialChunks.length} chunk(s)`)
  console.log()

  // Step 7: Add sample chunks to tracking
  console.log('7. Adding sample chunks to tracking...')
  const sampleChunks = createSampleChunks()
  console.log(`   Adding ${sampleChunks.length} chunks:`)

  await addTrackedChunks({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    storage,
    chunks: sampleChunks,
  })

  for (let i = 0; i < sampleChunks.length; i++) {
    displayChunkKey(sampleChunks[i], i)
  }
  console.log()

  // Step 8: Retrieve tracked chunks
  console.log('8. Retrieving tracked chunks...')
  const trackedChunks = await getTrackedChunks({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    storage,
  })

  console.log(`   Found ${trackedChunks.length} tracked chunk(s):`)
  for (let i = 0; i < trackedChunks.length; i++) {
    displayChunkKey(trackedChunks[i], i)
  }
  console.log()

  // ============================================================================
  // PART C: Spread Calculation Examples
  // ============================================================================

  console.log('=== Part C: Spread Calculation Examples ===\n')

  console.log('9. Calculating spread from liquidity values...')
  console.log('   Formula: spread = 1 + (1/VEGOID) * removedLiquidity / netLiquidity')
  console.log('   VEGOID = 4 (default)')
  console.log()

  // Example 1: No borrowed liquidity
  const spread1 = calculateSpreadWad(1000000n, 0n)
  console.log('   Example 1: No borrowed liquidity')
  console.log(`     Net: 1,000,000  Removed: 0`)
  console.log(`     Spread: ${formatSpread(spread1)} (base rate)`)
  console.log()

  // Example 2: 25% borrowed
  const spread2 = calculateSpreadWad(1000000n, 250000n)
  console.log('   Example 2: 25% borrowed liquidity')
  console.log(`     Net: 1,000,000  Removed: 250,000`)
  console.log(`     Spread: ${formatSpread(spread2)}`)
  console.log()

  // Example 3: 50% borrowed
  const spread3 = calculateSpreadWad(1000000n, 500000n)
  console.log('   Example 3: 50% borrowed liquidity')
  console.log(`     Net: 1,000,000  Removed: 500,000`)
  console.log(`     Spread: ${formatSpread(spread3)}`)
  console.log()

  // Example 4: 100% borrowed (all liquidity removed)
  const spread4 = calculateSpreadWad(1000000n, 1000000n)
  console.log('   Example 4: 100% borrowed liquidity')
  console.log(`     Net: 1,000,000  Removed: 1,000,000`)
  console.log(`     Spread: ${formatSpread(spread4)}`)
  console.log()

  // Example 5: Zero liquidity (returns base rate)
  const spread5 = calculateSpreadWad(0n, 0n)
  console.log('   Example 5: Zero liquidity')
  console.log(`     Net: 0  Removed: 0`)
  console.log(`     Spread: ${formatSpread(spread5)} (default 1.0x)`)
  console.log()

  // ============================================================================
  // PART D: Chunk Management
  // ============================================================================

  console.log('=== Part D: Chunk Management ===\n')

  // Step 10: Remove some chunks
  console.log('10. Removing some chunks from tracking...')
  const chunksToRemove = sampleChunks.slice(0, 2) // Remove first 2 chunks

  await removeTrackedChunks({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    storage,
    chunks: chunksToRemove,
  })

  console.log(`   Removed ${chunksToRemove.length} chunk(s):`)
  for (let i = 0; i < chunksToRemove.length; i++) {
    displayChunkKey(chunksToRemove[i], i)
  }

  const remainingChunks = await getTrackedChunks({
    chainId: CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    storage,
  })
  console.log(`   Remaining: ${remainingChunks.length} chunk(s)`)
  console.log()

  // Step 11: Demonstrate chunk limit
  console.log('11. Demonstrating chunk limit...')
  console.log(`   MAX_TRACKED_CHUNKS = ${MAX_TRACKED_CHUNKS}`)

  // Create a fresh storage to test the limit
  const limitTestStorage = createMemoryStorage()

  // Try to add more than 1000 chunks
  const tooManyChunks: LiquidityChunkKey[] = []
  for (let i = 0; i < MAX_TRACKED_CHUNKS + 10; i++) {
    tooManyChunks.push({
      tokenType: (BigInt(i) % 2n) as 0n | 1n,
      tickLower: BigInt(i * 10),
      tickUpper: BigInt(i * 10 + 10),
    })
  }

  try {
    await addTrackedChunks({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      storage: limitTestStorage,
      chunks: tooManyChunks,
    })
    console.log('   ERROR: Should have thrown ChunkLimitError')
  } catch (error) {
    if (error instanceof ChunkLimitError) {
      console.log('   ChunkLimitError thrown as expected:')
      console.log(`     Current count: ${error.currentCount}`)
      console.log(`     Attempted add: ${error.attemptedAdd}`)
      console.log(`     Message: ${error.message}`)
    } else {
      throw error
    }
  }
  console.log()

  // Step 12: Cleanup demonstration (optional)
  if (process.env.CLEANUP === 'true') {
    console.log('12. Clearing all tracked chunks...')
    await clearTrackedChunks({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      storage,
    })

    const clearedChunks = await getTrackedChunks({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      storage,
    })
    console.log(`   Chunks after clear: ${clearedChunks.length}`)
    console.log()
  }

  console.log('=== Complete ===')
  console.log()
  console.log('Key Concepts:')
  console.log('- Use scanChunks() to discover non-empty chunks automatically (recommended)')
  console.log('- Use getPositionChunkData() to get chunk data for specific positions')
  console.log('- Manual tracking is still available for fine-grained control')
  console.log('- Spread increases as more liquidity is borrowed')
  console.log('- Spread = 1 + (1/VEGOID) * removed/net (in WAD)')
  console.log('- Maximum 1000 chunks can be tracked manually per pool')
  console.log()
  console.log('Tips:')
  console.log('- scanChunks() is efficient - it only returns non-empty chunks')
  console.log('- Higher spread = higher borrowing cost for buyers')
  console.log('- Use a wide scan range to build a volatility surface')
  console.log('- Set QUERY_ADDRESS to enable PanopticQuery features')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
