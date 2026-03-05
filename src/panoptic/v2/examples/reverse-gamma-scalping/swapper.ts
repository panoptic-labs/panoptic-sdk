/**
 * Price Mover (Swapper) for Reverse Gamma Scalping Bot
 *
 * Periodically moves the pool price by ~1% to simulate natural price movement,
 * triggering the bot's delta hedging.
 *
 * Mechanism: Opens a loan with swapAtMint=true then closes it with swapAtMint=false
 * in a single dispatch() call. Net effect: pool price moves, no open position remains.
 *
 * Usage:
 *   pnpm --filter @panoptic-eng/sdk exec tsx src/panoptic/v2/examples/reverse-gamma-scalping/swapper.ts
 *
 * @module examples/reverse-gamma-scalping/swapper
 */

import {
  createTokenIdBuilder,
  dispatchAndWait,
  formatTokenAmount,
  getOpenPositionIds,
  getPool,
  parsePanopticError,
  roundToTickSpacing,
  tickLimits,
  tickToPriceDecimalScaled,
} from '@panoptic-eng/sdk/v2'
import { type Address, type PublicClient, type WalletClient } from 'viem'

import { CHAIN_ID, createClients, loadEnv, USDC_DECIMALS, WETH_DECIMALS } from './config'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** How many blocks between each swap */
const SWAP_INTERVAL_BLOCKS = 50n

/** Position size for the loan — tune for ~1% price impact on target pool */
const SWAP_SIZE = 5n * 10n ** 16n

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
// Unique loan helper
// ---------------------------------------------------------------------------

/**
 * Build a unique loan tokenId that doesn't collide with existing open positions.
 * Bumps optionRatio (1-127) and adjusts position size to maintain equivalent exposure.
 */
function buildUniqueLoan(
  poolId: bigint,
  leg: { asset: bigint; tokenType: bigint; strike: bigint },
  existingIds: bigint[],
  positionSize: bigint,
): { tokenId: bigint; adjustedSize: bigint } {
  for (let ratio = 1n; ratio <= 127n; ratio++) {
    const tokenId = createTokenIdBuilder(poolId)
      .addLoan({
        asset: leg.asset,
        tokenType: leg.tokenType,
        strike: leg.strike,
        optionRatio: ratio,
      })
      .build()
    if (!existingIds.includes(tokenId)) {
      return { tokenId, adjustedSize: positionSize / ratio }
    }
  }
  throw new Error('Could not build a unique loan tokenId — all optionRatios 1-127 are in use')
}

// ---------------------------------------------------------------------------
// Core swap function
// ---------------------------------------------------------------------------

/** Max retries when InputListFail occurs (position list changed between fetch and tx) */
const INPUT_LIST_FAIL_RETRIES = 3

async function executeSwap(
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,
  poolAddress: Address,
  chainId: bigint,
  direction: 'up' | 'down',
): Promise<void> {
  for (let attempt = 0; attempt < INPUT_LIST_FAIL_RETRIES; attempt++) {
    // Fetch fresh position list + pool state together to minimize staleness window
    const [existingIds, pool] = await Promise.all([
      getOpenPositionIds({ client, chainId, poolAddress, account }),
      getPool({ client, poolAddress, chainId }),
    ])

    const tickSpacing = pool.poolKey.tickSpacing
    const strike = roundToTickSpacing(pool.currentTick, tickSpacing)

    // Price UP (ETH more expensive): tokenType=1 (borrow USDC → swap to ETH)
    // Price DOWN (ETH cheaper): tokenType=0 (borrow ETH → swap to USDC)
    const tokenType = direction === 'up' ? 1n : 0n

    const { tokenId: loanTokenId, adjustedSize } = buildUniqueLoan(
      pool.poolId,
      { asset: 0n, tokenType, strike },
      existingIds,
      SWAP_SIZE,
    )

    const limits = tickLimits(pool.currentTick, SLIPPAGE_TOLERANCE_BPS)

    try {
      // Single dispatch: open loan (swap) + close loan (no swap)
      // Operation 1 (mint): descending tick limits = swapAtMint=true
      // Operation 2 (burn): ascending tick limits = swapAtMint=false
      await dispatchAndWait({
        client,
        walletClient,
        account,
        poolAddress,
        positionIdList: [loanTokenId, loanTokenId],
        finalPositionIdList: existingIds,
        positionSizes: [adjustedSize, 0n],
        tickAndSpreadLimits: [
          [limits.high, limits.low, 0n],
          [limits.low, limits.high, 0n],
        ],
      })
      return
    } catch (error) {
      const parsed = parsePanopticError(error as Error)
      if (parsed?.errorName === 'InputListFail' && attempt < INPUT_LIST_FAIL_RETRIES - 1) {
        console.warn(
          `[${timestamp()}] InputListFail — position list changed, retrying (${attempt + 1}/${INPUT_LIST_FAIL_RETRIES})`,
        )
        continue
      }
      throw error
    }
  }
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
  console.log(`  Swap size: ${formatTokenAmount(SWAP_SIZE, WETH_DECIMALS, 6n)}`)
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
