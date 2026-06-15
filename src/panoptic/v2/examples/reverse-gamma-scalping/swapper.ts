/**
 * Price Mover (Swapper) for Reverse Gamma Scalping Bot
 *
 * Periodically moves the pool price by ~1% to simulate natural price movement,
 * triggering the bot's delta hedging.
 *
 * Uses the SDK's swapExactOutAndWait() to open+close a loan atomically
 * and wait for on-chain confirmation, moving the pool price without
 * leaving any open position.
 *
 * Usage:
 *   pnpm --filter @panoptic-eng/sdk exec tsx src/panoptic/v2/examples/reverse-gamma-scalping/swapper.ts
 *
 * @module examples/reverse-gamma-scalping/swapper
 */

import {
  formatTokenAmount,
  getOpenPositionIds,
  getPool,
  parsePanopticError,
  swapExactOutAndWait,
  tickToPriceDecimalScaled,
} from '@panoptic-eng/sdk/v2'
import { type Address, type PublicClient, type WalletClient } from 'viem'

import { CHAIN_ID, createClients, loadEnv, USDC_DECIMALS, WETH_DECIMALS } from './config'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** How many blocks between each swap */
const SWAP_INTERVAL_BLOCKS = 1n

/** Position size for the loan — tune for ~1% price impact on target pool.
 * Amounts are in each token's native units (WETH: 18 decimals, USDC: 6 decimals). */
const SWAP_SIZE_WETH = 5n * 10n ** 16n // 0.05 WETH
const SWAP_SIZE_USDC = 100n * 10n ** 6n // 100 USDC (~equivalent at ~$2000/ETH)

/** Direction strategy: 'random' | 'alternate' | 'up' | 'down' */
const DIRECTION: 'random' | 'alternate' | 'up' | 'down' = 'random'

/** Slippage tolerance in bps (~5%) */
const SLIPPAGE_TOLERANCE_BPS = 500n

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCancellableSleep() {
  let cancelFn: (() => void) | null = null

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      cancelFn = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  function cancel() {
    cancelFn?.()
    cancelFn = null
  }

  return { sleep, cancel }
}

function timestamp(): string {
  return new Date().toISOString()
}

function pickDirection(strategy: typeof DIRECTION, lastDirection: 'up' | 'down'): 'up' | 'down' {
  switch (strategy) {
    case 'up':
      return 'up'
    case 'down':
      return 'down'
    case 'alternate':
      return lastDirection === 'up' ? 'down' : 'up'
    case 'random':
      return Math.random() < 0.5 ? 'up' : 'down'
  }
}

// ---------------------------------------------------------------------------
// Core swap function
// ---------------------------------------------------------------------------

async function executeSwap(
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,
  poolAddress: Address,
  chainId: bigint,
  direction: 'up' | 'down',
): Promise<void> {
  // Fetch pool to resolve token addresses
  const pool = await getPool({ client, poolAddress, chainId })

  // Price UP (ETH more expensive): buy ETH → tokenOut = token0 (WETH)
  // Price DOWN (ETH cheaper): buy USDC → tokenOut = token1 (USDC)
  const tokenOut =
    direction === 'up' ? pool.collateralTracker0.token : pool.collateralTracker1.token
  const amountOut = direction === 'up' ? SWAP_SIZE_WETH : SWAP_SIZE_USDC

  const existingIds = (await getOpenPositionIds({ client, chainId, poolAddress, account })) ?? []

  await swapExactOutAndWait({
    client,
    walletClient,
    account,
    poolAddress,
    chainId,
    tokenOut,
    amountOut,
    slippageBps: SLIPPAGE_TOLERANCE_BPS,
    existingPositionIds: existingIds,
  })
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const env = loadEnv()
  const { client, walletClient, account } = createClients(env)
  const poolAddress = env.poolAddress

  let isShuttingDown = false
  const { sleep, cancel: cancelSleep } = createCancellableSleep()

  const triggerShutdown = () => {
    if (isShuttingDown) return
    console.log(`[${timestamp()}] Shutting down swapper...`)
    isShuttingDown = true
    cancelSleep()
  }

  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  process.stdin.on('data', (data: string) => {
    if (data.trim().toLowerCase() === 'q') {
      triggerShutdown()
    }
  })

  process.removeAllListeners('SIGINT')
  process.on('SIGINT', triggerShutdown)

  console.log('Press q + Enter to quit gracefully.\n')
  console.log(`[${timestamp()}] Starting swapper`)
  console.log(`  Pool: ${poolAddress}`)
  console.log(`  Account: ${account.address}`)
  console.log(
    `  Swap size: ${formatTokenAmount(SWAP_SIZE_WETH, WETH_DECIMALS, 6n)} WETH / ${formatTokenAmount(SWAP_SIZE_USDC, USDC_DECIMALS, 2n)} USDC`,
  )
  console.log(`  Direction: ${DIRECTION}`)
  console.log(`  Interval: every ${SWAP_INTERVAL_BLOCKS} blocks`)

  let lastBlock = await client.getBlockNumber()
  let swapCount = 0
  let lastDirection: 'up' | 'down' = 'down'

  while (!isShuttingDown) {
    const currentBlock = await client.getBlockNumber()

    if (currentBlock - lastBlock < SWAP_INTERVAL_BLOCKS) {
      await sleep(2000)
      continue
    }

    const direction = pickDirection(DIRECTION, lastDirection)
    lastDirection = direction

    const poolBefore = await getPool({ client, poolAddress, chainId: CHAIN_ID })
    const oldPrice = tickToPriceDecimalScaled(
      poolBefore.currentTick,
      WETH_DECIMALS,
      USDC_DECIMALS,
      2n,
    )

    let swapped = false
    for (const dir of [direction, direction === 'up' ? 'down' : 'up'] as const) {
      try {
        await executeSwap(client, walletClient, account.address, poolAddress, CHAIN_ID, dir)
        swapped = true

        const poolAfter = await getPool({ client, poolAddress, chainId: CHAIN_ID })
        const newPrice = tickToPriceDecimalScaled(
          poolAfter.currentTick,
          WETH_DECIMALS,
          USDC_DECIMALS,
          2n,
        )

        swapCount++
        const retried = dir !== direction ? ` (retried ${dir})` : ''
        console.log(
          `[${timestamp()}] Swap #${swapCount}: ${dir}${retried} | ${oldPrice} → ${newPrice}`,
        )
        break
      } catch (error) {
        const parsed = parsePanopticError(error as Error)
        const msg = parsed
          ? `${parsed.errorName}${parsed.args ? ` (${parsed.args.join(', ')})` : ''}`
          : String(error)

        if (dir === direction) {
          console.warn(`[${timestamp()}] Swap ${dir} failed: ${msg} — retrying opposite direction`)
        } else {
          console.error(`[${timestamp()}] Swap ${dir} also failed: ${msg}`)
        }
      }
    }

    if (!swapped) {
      console.error(`[${timestamp()}] Both directions failed, skipping this interval`)
    }

    lastBlock = currentBlock
    await sleep(2000)
  }

  console.log(`[${timestamp()}] Swapper stopped after ${swapCount} swaps`)
  process.stdin.pause()
  process.removeAllListeners('SIGINT')
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('swapper') || process.argv[1].includes('reverse-gamma-scalping'))
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Swapper failed:', err)
      process.exit(1)
    })
}
