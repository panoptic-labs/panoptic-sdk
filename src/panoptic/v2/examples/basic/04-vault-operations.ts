/**
 * Basic Example 04: Vault Operations
 *
 * Demonstrates:
 * - ERC4626 preview functions (previewDeposit, previewWithdraw)
 * - Depositing collateral with deposit()
 * - Withdrawing collateral with withdraw()
 * - Share/asset conversions with convertToShares/convertToAssets
 *
 * Prerequisites:
 * - RPC_URL environment variable
 * - PRIVATE_KEY environment variable
 * - POOL_ADDRESS environment variable
 * - TOKEN_INDEX environment variable (0 or 1)
 */

import { type Address, createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

import {
  type Pool,
  convertToAssets,
  depositAndWait,
  getPool,
  PanopticError,
  parsePanopticError,
  previewDeposit,
  previewWithdraw,
} from '../../index'

// Configuration from environment
const RPC_URL = process.env.RPC_URL || 'https://eth.llamarpc.com'
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`
const POOL_ADDRESS = process.env.POOL_ADDRESS as Address
const TOKEN_INDEX_STR = process.env.TOKEN_INDEX || '0'
const TOKEN_INDEX = parseInt(TOKEN_INDEX_STR, 10) as 0 | 1

if (!PRIVATE_KEY) {
  console.error('Error: PRIVATE_KEY environment variable is required')
  process.exit(1)
}

if (!POOL_ADDRESS) {
  console.error('Error: POOL_ADDRESS environment variable is required')
  process.exit(1)
}

if (TOKEN_INDEX !== 0 && TOKEN_INDEX !== 1) {
  console.error('Error: TOKEN_INDEX must be 0 or 1')
  process.exit(1)
}

async function main() {
  console.log('=== Panoptic v2 SDK: Vault Operations ===\n')

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

  // Step 2: Get pool and collateral tracker address
  console.log('2. Fetching pool info...')
  const pool: Pool = await getPool({
    client: publicClient,
    poolAddress: POOL_ADDRESS,
    chainId: BigInt(mainnet.id),
  })

  const collateralTracker = TOKEN_INDEX === 0 ? pool.collateralTracker0 : pool.collateralTracker1
  const collateralTrackerAddress = collateralTracker.address
  console.log(`   Using collateral tracker: ${collateralTrackerAddress}`)
  console.log(`   Token: ${collateralTracker.symbol}`)
  console.log(`   Token index: ${TOKEN_INDEX}`)
  console.log()

  // Step 3: Preview deposit
  console.log('3. Previewing deposit...')
  const depositAmount = 1000000000000000000n // 1.0 tokens (assuming 18 decimals)

  const previewDepositResult = await previewDeposit({
    client: publicClient,
    poolAddress: POOL_ADDRESS,
    tokenIndex: TOKEN_INDEX,
    amount: depositAmount,
  })

  console.log(`   Deposit amount: ${depositAmount}`)
  console.log(`   Shares to receive: ${previewDepositResult.result}`)
  console.log(`   Block: ${previewDepositResult._meta.blockNumber}`)
  console.log()

  // Step 4: Convert shares to assets (verification)
  console.log('4. Converting shares back to assets...')
  const convertedAssets = await convertToAssets({
    client: publicClient,
    poolAddress: POOL_ADDRESS,
    tokenIndex: TOKEN_INDEX,
    amount: previewDepositResult.result,
  })

  console.log(`   Shares: ${previewDepositResult.result}`)
  console.log(`   Equivalent assets: ${convertedAssets.result}`)
  console.log(
    `   Matches deposit amount: ${convertedAssets.result === depositAmount ? '✅' : '❌'}`,
  )
  console.log()

  // Step 5: Confirm deposit execution
  console.log('5. Ready to deposit')
  console.log(`   Amount: ${depositAmount}`)
  console.log(`   Collateral Tracker: ${collateralTrackerAddress}`)
  console.log()
  console.log('   ⚠️  This will submit a real transaction!')
  console.log('   Press Ctrl+C to cancel, or set EXECUTE=true to proceed')
  console.log()

  if (process.env.EXECUTE !== 'true') {
    console.log('   Skipping execution (set EXECUTE=true to execute)')
    console.log()

    // Show withdraw preview even if not executing
    console.log('6. Previewing withdraw (demonstration only)...')
    const withdrawAmount = depositAmount / 2n // Half the deposit

    const previewWithdrawResult = await previewWithdraw({
      client: publicClient,
      poolAddress: POOL_ADDRESS,
      tokenIndex: TOKEN_INDEX,
      amount: withdrawAmount,
    })

    console.log(`   Withdraw amount: ${withdrawAmount}`)
    console.log(`   Shares to burn: ${previewWithdrawResult.result}`)
    console.log(`   Block: ${previewWithdrawResult._meta.blockNumber}`)
    console.log()
    return
  }

  // Step 6: Execute deposit
  console.log('6. Depositing...')
  try {
    // Note: Using depositAndWait for simplicity
    const receipt = await depositAndWait({
      client: publicClient,
      walletClient,
      account: account.address,
      collateralTrackerAddress,
      assets: depositAmount,
    })

    console.log(`   ✅ Deposit confirmed in block ${receipt.blockNumber}`)
    console.log(`   Transaction: ${receipt.hash}`)
    console.log(`   Gas used: ${receipt.gasUsed}`)
    console.log(`   Status: ${receipt.status}`)
  } catch (error) {
    if (error instanceof PanopticError) {
      console.error('   ❌ Deposit failed:', error.message)
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
  console.log()
  console.log('Tip: To withdraw, use the withdraw() function with the number of shares')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
