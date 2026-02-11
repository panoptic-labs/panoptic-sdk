/**
 * Basic Example 03: Close Position
 *
 * Demonstrates:
 * - Fetching existing position with getPosition()
 * - Simulating position close with simulateClosePosition()
 * - Closing position with closePosition()
 * - Handling slippage limits
 * - Error handling for non-existent positions
 *
 * Prerequisites:
 * - RPC_URL environment variable
 * - PRIVATE_KEY environment variable
 * - POOL_ADDRESS environment variable
 * - TOKEN_ID environment variable (the position to close)
 */

import { type Address, createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

import {
  type ClosePositionSimulation,
  type Position,
  type SimulationResult,
  type TxResult,
  closePosition,
  decodeTokenId,
  getPosition,
  PanopticError,
  parsePanopticError,
  PositionNotOwnedError,
  simulateClosePosition,
} from '../../index'

// Configuration from environment
const RPC_URL = process.env.RPC_URL || 'https://eth.llamarpc.com'
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`
const POOL_ADDRESS = process.env.POOL_ADDRESS as Address
const TOKEN_ID = process.env.TOKEN_ID

if (!PRIVATE_KEY) {
  console.error('Error: PRIVATE_KEY environment variable is required')
  process.exit(1)
}

if (!POOL_ADDRESS) {
  console.error('Error: POOL_ADDRESS environment variable is required')
  process.exit(1)
}

if (!TOKEN_ID) {
  console.error('Error: TOKEN_ID environment variable is required')
  process.exit(1)
}

const tokenId = BigInt(TOKEN_ID)

async function main() {
  console.log('=== Panoptic v2 SDK: Close Position ===\n')

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

  // Step 2: Decode and display TokenId
  console.log('2. Decoding TokenId...')
  const decoded = decodeTokenId(tokenId)
  console.log(`   TokenId: ${tokenId}`)
  console.log(`   Pool ID: ${decoded.poolId}`)
  console.log(`   Number of legs: ${decoded.legs.length}`)
  for (let i = 0; i < decoded.legs.length; i++) {
    const leg = decoded.legs[i]
    console.log(
      `   Leg ${i}: ${leg.isLong ? 'Long' : 'Short'} ${leg.tokenType === 0n ? 'Token0' : 'Token1'}`,
    )
    console.log(`     Strike: ${leg.strike}, Width: ${leg.width}`)
  }
  console.log()

  // Step 3: Fetch current position
  console.log('3. Fetching position...')
  let position: Position
  try {
    position = await getPosition({
      client: publicClient,
      poolAddress: POOL_ADDRESS,
      owner: account.address,
      tokenId,
    })

    console.log(`   Position Size: ${position.positionSize}`)
    console.log(`   Tick at Mint: ${position.tickAtMint}`)
    console.log(`   Premia Owed 0: ${position.premiaOwed0}`)
    console.log(`   Premia Owed 1: ${position.premiaOwed1}`)
    console.log(`   Block: ${position._meta.blockNumber}`)
  } catch (error) {
    if (error instanceof PositionNotOwnedError) {
      console.error('   ❌ Position not found or not owned by account')
      process.exit(1)
    }
    throw error
  }
  console.log()

  // Step 4: Simulate position close
  console.log('4. Simulating position close...')
  const positionIdList: bigint[] = [tokenId] // Current open positions
  const tickLimitLow = -887272n // MIN_TICK - allow any downward price movement
  const tickLimitHigh = 887272n // MAX_TICK - allow any upward price movement

  const simulation: SimulationResult<ClosePositionSimulation> = await simulateClosePosition({
    client: publicClient,
    poolAddress: POOL_ADDRESS,
    account: account.address,
    positionIdList,
    tokenId,
    positionSize: position.positionSize,
    tickLimitLow,
    tickLimitHigh,
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
  console.log(`   Amount0 received: ${simulation.data.amount0Received}`)
  console.log(`   Amount1 received: ${simulation.data.amount1Received}`)
  console.log(`   Premia collected0: ${simulation.data.premiaCollected0}`)
  console.log(`   Premia collected1: ${simulation.data.premiaCollected1}`)
  console.log()

  // Step 5: Confirm execution
  console.log('5. Ready to close position')
  console.log(`   TokenId: ${tokenId}`)
  console.log(`   Position Size: ${position.positionSize} contracts`)
  console.log(`   Tick limits: [${tickLimitLow}, ${tickLimitHigh}]`)
  console.log()
  console.log('   ⚠️  This will submit a real transaction!')
  console.log('   Press Ctrl+C to cancel, or set EXECUTE=true to proceed')
  console.log()

  if (process.env.EXECUTE !== 'true') {
    console.log('   Skipping execution (set EXECUTE=true to execute)')
    return
  }

  // Step 6: Execute transaction
  console.log('6. Closing position...')
  try {
    const txResult: TxResult = await closePosition({
      client: publicClient,
      walletClient,
      account: account.address,
      poolAddress: POOL_ADDRESS,
      positionIdList,
      tokenId,
      positionSize: position.positionSize,
      tickLimitLow,
      tickLimitHigh,
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
