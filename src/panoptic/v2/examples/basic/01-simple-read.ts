/**
 * Basic Example 01: Simple Read Operations
 *
 * Demonstrates:
 * - Setting up a viem PublicClient
 * - Fetching pool data with getPool()
 * - Fetching oracle state with getOracleState()
 * - Fetching account collateral with getAccountCollateral()
 * - Using BlockMeta (_meta) for data freshness verification
 *
 * Prerequisites:
 * - RPC_URL environment variable
 * - POOL_ADDRESS environment variable
 * - ACCOUNT_ADDRESS environment variable (optional)
 */

import { type Address, createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

import {
  type AccountCollateral,
  type OracleState,
  type Pool,
  getAccountCollateral,
  getOracleState,
  getPool,
} from '../../index'

// Configuration from environment
const RPC_URL = process.env.RPC_URL || 'https://eth.llamarpc.com'
const POOL_ADDRESS = process.env.POOL_ADDRESS as Address
const ACCOUNT_ADDRESS = process.env.ACCOUNT_ADDRESS as Address | undefined

if (!POOL_ADDRESS) {
  console.error('Error: POOL_ADDRESS environment variable is required')
  process.exit(1)
}

async function main() {
  console.log('=== Panoptic v2 SDK: Simple Read Operations ===\n')

  // Step 1: Create viem PublicClient
  console.log('1. Setting up PublicClient...')
  const client = createPublicClient({
    chain: mainnet,
    transport: http(RPC_URL),
  })
  console.log(`   Connected to: ${RPC_URL}\n`)

  // Step 2: Fetch pool data
  console.log('2. Fetching pool data...')
  const pool: Pool = await getPool({
    client,
    poolAddress: POOL_ADDRESS,
    chainId: BigInt(mainnet.id),
  })

  console.log(`   Pool Address: ${pool.address}`)
  console.log(`   Pool Key:`)
  console.log(`     Currency0: ${pool.poolKey.currency0}`)
  console.log(`     Currency1: ${pool.poolKey.currency1}`)
  console.log(`     Fee: ${pool.poolKey.fee}`)
  console.log(`     Tick Spacing: ${pool.poolKey.tickSpacing}`)
  console.log(`   Collateral Tracker 0: ${pool.collateralTracker0.address}`)
  console.log(`   Collateral Tracker 1: ${pool.collateralTracker1.address}`)
  console.log(`   Current Tick: ${pool.currentTick}`)
  console.log(`   Block: ${pool._meta.blockNumber}`)
  console.log(`   Block Hash: ${pool._meta.blockHash}`)
  console.log(`   Block Timestamp: ${pool._meta.blockTimestamp}`)
  console.log()

  // Step 3: Fetch oracle state
  console.log('3. Fetching oracle state...')
  const oracleState: OracleState = await getOracleState({
    client,
    poolAddress: POOL_ADDRESS,
  })

  console.log(`   Epoch: ${oracleState.epoch}`)
  console.log(`   Last Update: ${oracleState.lastUpdateTimestamp}`)
  console.log(`   Reference Tick: ${oracleState.referenceTick}`)
  console.log(`   Spot EMA: ${oracleState.spotEMA}`)
  console.log(`   Fast EMA: ${oracleState.fastEMA}`)
  console.log(`   Slow EMA: ${oracleState.slowEMA}`)
  console.log(`   Eons EMA: ${oracleState.eonsEMA}`)
  console.log(`   Median Tick: ${oracleState.medianTick}`)
  console.log(`   Block: ${oracleState._meta.blockNumber}`)
  console.log()

  // Step 4: Verify same-block consistency
  console.log('4. Verifying same-block consistency...')
  if (pool._meta.blockNumber === oracleState._meta.blockNumber) {
    console.log('   ✅ Pool and Oracle data from same block')
  } else {
    console.log('   ⚠️  Pool and Oracle data from different blocks')
    console.log(`      Pool block: ${pool._meta.blockNumber}`)
    console.log(`      Oracle block: ${oracleState._meta.blockNumber}`)
  }
  console.log()

  // Step 5: Fetch account collateral (if account provided)
  if (ACCOUNT_ADDRESS) {
    console.log('5. Fetching account collateral...')
    const accountCollateral: AccountCollateral = await getAccountCollateral({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
    })

    console.log(`   Account: ${ACCOUNT_ADDRESS}`)
    console.log(`   Token0:`)
    console.log(`     Assets: ${accountCollateral.token0.assets}`)
    console.log(`     Shares: ${accountCollateral.token0.shares}`)
    console.log(`     Available Assets: ${accountCollateral.token0.availableAssets}`)
    console.log(`     Locked Assets: ${accountCollateral.token0.lockedAssets}`)
    console.log(`   Token1:`)
    console.log(`     Assets: ${accountCollateral.token1.assets}`)
    console.log(`     Shares: ${accountCollateral.token1.shares}`)
    console.log(`     Available Assets: ${accountCollateral.token1.availableAssets}`)
    console.log(`     Locked Assets: ${accountCollateral.token1.lockedAssets}`)
    console.log(`   Leg Count: ${accountCollateral.legCount}`)
    console.log(`   Block: ${accountCollateral._meta.blockNumber}`)
    console.log()
  }

  // Step 6: Data freshness check
  console.log('6. Data freshness check...')
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))
  const dataAge = currentTimestamp - pool._meta.blockTimestamp
  console.log(`   Data age: ${dataAge} seconds`)

  if (dataAge < 60n) {
    console.log('   ✅ Data is fresh (< 60 seconds old)')
  } else if (dataAge < 300n) {
    console.log('   ⚠️  Data is slightly stale (< 5 minutes old)')
  } else {
    console.log('   ❌ Data is stale (> 5 minutes old)')
  }
  console.log()

  console.log('=== Complete ===')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
