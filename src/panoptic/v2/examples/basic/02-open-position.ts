/**
 * Basic Example 02: Open Position
 *
 * Demonstrates:
 * - Building a TokenId with createTokenIdBuilder()
 * - Simulating a position with simulateOpenPosition()
 * - Opening a position with openPosition()
 * - TxResult pattern with wait()
 * - Error handling with typed exceptions
 *
 * Prerequisites:
 * - RPC_URL environment variable
 * - PRIVATE_KEY environment variable (for signing transactions)
 * - POOL_ADDRESS environment variable
 * - UNISWAP_POOL environment variable
 */

import { type Address, createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

import {
  type OpenPositionSimulation,
  type SimulationResult,
  type TxResult,
  createTokenIdBuilder,
  openPosition,
  PanopticError,
  parsePanopticError,
  simulateOpenPosition,
} from '../../index'

// Configuration from environment
const RPC_URL = process.env.RPC_URL || 'https://eth.llamarpc.com'
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`
const POOL_ADDRESS = process.env.POOL_ADDRESS as Address
const UNISWAP_POOL = process.env.UNISWAP_POOL as Address

if (!PRIVATE_KEY) {
  console.error('Error: PRIVATE_KEY environment variable is required')
  process.exit(1)
}

if (!POOL_ADDRESS) {
  console.error('Error: POOL_ADDRESS environment variable is required')
  process.exit(1)
}

if (!UNISWAP_POOL) {
  console.error('Error: UNISWAP_POOL environment variable is required')
  process.exit(1)
}

async function main() {
  console.log('=== Panoptic v2 SDK: Open Position ===\n')

  // Step 1: Create clients
  console.log('1. Setting up clients...')
  const account = privateKeyToAccount(PRIVATE_KEY)
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(RPC_URL),
  })
  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(RPC_URL),
  })
  console.log(`   Account: ${account.address}\n`)

  // Step 2: Build TokenId
  console.log('2. Building TokenId...')
  const builder = createTokenIdBuilder(
    UNISWAP_POOL,
    60n, // Standard 0.3% fee tier (tick spacing)
  )

  // Add a simple short call at current strike
  // (In production, you'd fetch current tick from getPool)
  // addCall automatically sets: asset=1n (token1), tokenType=1n (call)
  const tokenId = builder
    .addCall({
      optionRatio: 1n,
      isLong: false, // Short position
      strike: 0n, // Current strike
      width: 10n, // 10 ticks wide
    })
    .build() // Must call build() to get the final tokenId

  console.log(`   TokenId: ${tokenId}`)
  console.log()

  // Step 3: Simulate position open
  console.log('3. Simulating position open...')
  const positionSize = 1000000n // Size in contracts
  const existingPositionIds: bigint[] = [] // Existing positions (empty for new account)
  const tickLimitLow = -887272n // MIN_TICK - allow any downward price movement
  const tickLimitHigh = 887272n // MAX_TICK - allow any upward price movement

  const simulation: SimulationResult<OpenPositionSimulation> = await simulateOpenPosition({
    client: publicClient,
    poolAddress: POOL_ADDRESS,
    account: account.address,
    existingPositionIds,
    tokenId,
    positionSize,
    tickLimitLow,
    tickLimitHigh,
    swapAtMint: false, // No swap - keep both token exposures
  })

  if (!simulation.success) {
    console.error('   ❌ Simulation failed:', simulation.error.message)
    console.error()
    console.error('   Error details:')
    const parsed = parsePanopticError(simulation.error)
    if (parsed) {
      console.error(`   - Error type: ${parsed.errorName}`)
    }
    process.exit(1)
  }

  console.log('   ✅ Simulation succeeded')
  console.log(`   Gas estimate: ${simulation.gasEstimate}`)
  console.log(`   Commission0: ${simulation.data.commission0}`)
  console.log(`   Commission1: ${simulation.data.commission1}`)
  console.log(`   Amount0 required: ${simulation.data.amount0Required}`)
  console.log(`   Amount1 required: ${simulation.data.amount1Required}`)
  console.log()

  // Step 4: Confirm execution
  console.log('4. Ready to open position')
  console.log(`   TokenId: ${tokenId}`)
  console.log(`   Position Size: ${positionSize} contracts`)
  console.log(`   Tick limits: [${tickLimitLow}, ${tickLimitHigh}]`)
  console.log()
  console.log('   ⚠️  This will submit a real transaction!')
  console.log('   Press Ctrl+C to cancel, or set EXECUTE=true to proceed')
  console.log()

  if (process.env.EXECUTE !== 'true') {
    console.log('   Skipping execution (set EXECUTE=true to execute)')
    return
  }

  // Step 5: Execute transaction
  console.log('5. Opening position...')
  try {
    const txResult: TxResult = await openPosition({
      client: publicClient,
      walletClient,
      account: account.address,
      poolAddress: POOL_ADDRESS,
      existingPositionIds,
      tokenId,
      positionSize,
      tickLimitLow,
      tickLimitHigh,
      swapAtMint: false,
    })

    console.log(`   ✅ Transaction submitted: ${txResult.hash}`)
    console.log('   Waiting for confirmation...')

    // Wait for 1 confirmation
    const receipt = await txResult.wait(1n)

    console.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}`)
    console.log(`   Gas used: ${receipt.gasUsed}`)
    console.log(`   Status: ${receipt.status}`)

    // Log events
    if (receipt.events.length > 0) {
      console.log(`   Events (${receipt.events.length}):`)
      for (const event of receipt.events) {
        console.log(`     - ${event.type}`)
      }
    }
  } catch (error) {
    if (error instanceof PanopticError) {
      console.error('   ❌ Transaction failed:', error.message)
      const parsed = parsePanopticError(error)
      if (parsed) {
        console.error(`   - Error type: ${parsed.errorName}`)
      }
    } else {
      console.error('   ❌ Unexpected error:', error)
    }
    process.exit(1)
  }

  console.log()
  console.log('=== Complete ===')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
