/**
 * Open a credit (width==0, isLong==1) position for the reverse gamma scalping bot.
 *
 * A credit lends liquidity to the pool at the current tick. The lender deposits
 * the token and earns streaming premium (interest) from borrowers.
 *
 * Usage:
 *   TOKEN_TYPE=0 \
 *   POSITION_SIZE=200000000000000000 \
 *   EXECUTE=true \
 *   pnpm --filter @panoptic-eng/sdk exec tsx src/panoptic/v2/examples/reverse-gamma-scalping/open-credit.ts
 *
 * Environment variables:
 *   RPC_URL          - RPC endpoint
 *   PRIVATE_KEY      - Wallet private key
 *   POOL_ADDRESS     - PanopticPool contract address
 *   TOKEN_TYPE       - 0 for WETH credit, 1 for USDC credit (default: 0)
 *   POSITION_SIZE    - Position size in token0 smallest units (default: 0.2 WETH = 2e17)
 *   SWAP_AT_MINT     - Set to "true" to swap at mint (default: false)
 *   EXECUTE          - Set to "true" to submit the transaction (default: simulate only)
 *
 * @module examples/reverse-gamma-scalping/open-credit
 */

import {
  createFileStorage,
  createTokenIdBuilder,
  fetchPoolId,
  formatTokenAmount,
  getPool,
  getTrackedPositionIds,
  openPosition,
  parsePanopticError,
  simulateOpenPosition,
  syncPositions,
  tickLimits,
} from '@panoptic-eng/sdk/v2'

import { CHAIN_ID, createClients, loadEnv, USDC_DECIMALS, WETH_DECIMALS } from './config'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SLIPPAGE_BPS = 500n // 5%

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const env = loadEnv()
  const { client, walletClient, account } = createClients(env)

  const tokenType = BigInt(process.env.TOKEN_TYPE ?? '0') // 0=WETH, 1=USDC
  if (tokenType !== 0n && tokenType !== 1n) throw new Error('TOKEN_TYPE must be 0 or 1')

  const positionSize = BigInt(process.env.POSITION_SIZE ?? String(2n * 10n ** 17n))
  const swapAtMint = process.env.SWAP_AT_MINT === 'true'

  console.log(`Account:       ${account.address}`)
  console.log(`Pool:          ${env.poolAddress}`)
  const tokenDecimals = tokenType === 0n ? WETH_DECIMALS : USDC_DECIMALS
  const tokenSymbol = tokenType === 0n ? 'WETH' : 'USDC'
  console.log(`Token type:    ${tokenType === 0n ? 'WETH (0)' : 'USDC (1)'}`)
  console.log(
    `Position size: ${formatTokenAmount(positionSize, tokenDecimals, 6n)} ${tokenSymbol}-units`,
  )
  console.log(`Swap at mint:  ${swapAtMint}`)
  console.log()

  // --- Fetch pool state ---
  const pool = await getPool({ client, poolAddress: env.poolAddress, chainId: CHAIN_ID })
  console.log(`Current tick: ${pool.currentTick}  (pool: ${pool.poolId})`)

  // --- Fetch existing positions for the positionIdList ---
  const storage = createFileStorage('./data/reverse-gamma-scalper')
  await syncPositions({
    client,
    chainId: CHAIN_ID,
    poolAddress: env.poolAddress,
    account: account.address,
    storage,
  })
  const existingIds = await getTrackedPositionIds({
    chainId: CHAIN_ID,
    poolAddress: env.poolAddress,
    account: account.address,
    storage,
  })
  console.log(`Existing tracked positions: ${existingIds.length}`)

  // --- Build credit tokenId (width=0, isLong=true) ---
  const { poolId } = await fetchPoolId({ client, poolAddress: env.poolAddress })
  const tokenId = createTokenIdBuilder(poolId)
    .addCredit({
      asset: tokenType, // lend the same token as tokenType
      tokenType, // which token is lent
      strike: pool.currentTick, // lend at current market tick
      optionRatio: 1n,
    })
    .build()

  console.log(`TokenId: ${tokenId}`)
  console.log()

  // --- Simulate ---
  const limits = tickLimits(pool.currentTick, SLIPPAGE_BPS)
  const simulation = await simulateOpenPosition({
    client,
    poolAddress: env.poolAddress,
    account: account.address,
    existingPositionIds: existingIds,
    tokenId,
    positionSize,
    tickLimitLow: limits.low,
    tickLimitHigh: limits.high,
    swapAtMint,
  })

  if (!simulation.success) {
    const parsed = parsePanopticError(simulation.error)
    console.error('Simulation failed:', parsed?.errorName ?? simulation.error.message)
    process.exit(1)
  }

  console.log('Simulation succeeded')
  console.log(`  Gas estimate:    ${simulation.gasEstimate}`)
  console.log(
    `  Amount0 required: ${formatTokenAmount(simulation.data.amount0Required, WETH_DECIMALS, 6n)} WETH`,
  )
  console.log(
    `  Amount1 required: ${formatTokenAmount(simulation.data.amount1Required, USDC_DECIMALS, 2n)} USDC`,
  )
  console.log()

  if (process.env.EXECUTE !== 'true') {
    console.log('Dry run complete. Set EXECUTE=true to submit the transaction.')
    return
  }

  // --- Execute ---
  console.log('Opening credit position...')
  const tx = await openPosition({
    client,
    walletClient,
    account: account.address,
    poolAddress: env.poolAddress,
    existingPositionIds: existingIds,
    tokenId,
    positionSize,
    tickLimitLow: limits.low,
    tickLimitHigh: limits.high,
    swapAtMint,
  })

  console.log(`Transaction submitted: ${tx.hash}`)
  const receipt = await tx.wait(1n)
  console.log(`Confirmed in block ${receipt.blockNumber} (gas used: ${receipt.gasUsed})`)
  console.log(`TokenId: ${tokenId}`)
  console.log()
  console.log('Credit position opened. Run check.ts to verify.')
}

main().catch((err) => {
  console.error('open-credit failed:', err)
  process.exit(1)
})
