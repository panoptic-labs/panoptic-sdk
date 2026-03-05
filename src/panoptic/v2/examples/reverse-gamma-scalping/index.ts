/**
 * Reverse Gamma Scalping Bot
 *
 * Sells an ATM short straddle (short gamma) and delta-hedges with loans+swapAtMint.
 * Profits if realized volatility < implied volatility priced into the options.
 *
 * Strategy:
 * 1. Assumes a short straddle is already open (opened via a separate script)
 * 2. Delta-hedge using loans+swapAtMint to keep net delta near zero
 * 3. Re-hedge periodically as the underlying moves
 * 4. Profit/loss = premium collected minus total hedging costs
 *
 * Usage:
 *   pnpm --filter @panoptic-eng/sdk exec tsx src/panoptic/v2/examples/reverse-gamma-scalping/index.ts
 *
 * @module examples/reverse-gamma-scalping
 */

import * as readline from 'node:readline'

import {
  type AccountCollateral,
  // Types
  type Pool,
  type PositionGreeksResult,
  type StorageAdapter,
  // Bot utilities
  assertFresh,
  assertHealthy,
  // Greeks
  calculatePositionDeltaWithSwap,
  calculatePositionGreeks,
  closePositionAndWait,
  createFileStorage,
  // TokenId
  createTokenIdBuilder,
  // Writes
  depositAndWait,
  dispatchAndWait,
  // Formatters
  formatTokenAmount,
  getAccountCollateral,
  // Delta Hedging
  getDeltaHedgeParams,
  getOpenPositionIds,
  // Reads
  getPool,
  getPosition,
  isGasError,
  isNonceError,
  isRetryableRpcError,
  // Errors
  parsePanopticError,
  simulateClosePosition,
  simulateDispatch,
  tickLimits,
  tickToPriceDecimalScaled,
} from '@panoptic-eng/sdk/v2'
import {
  type Address,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

import { CHAIN_ID, loadEnv, USDC_DECIMALS, WETH_DECIMALS } from './config'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Retry delays in milliseconds */
const RPC_RETRY_DELAY_MS = 5000
const NONCE_RETRY_DELAY_MS = 2000
const GAS_RETRY_DELAY_MS = 3000

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ReverseGammaScalperConfig {
  rpcUrl: string
  privateKey: `0x${string}`
  poolAddress: Address
  chainId: bigint
  collateralTracker0: Address
  collateralTracker1: Address
  /** WETH to deposit into collateral tracker */
  depositAmount0: bigint
  /** USDC to deposit into collateral tracker */
  depositAmount1: bigint
  /** Position size for the straddle (in token0 smallest units) */
  positionSize: bigint
  /** Re-hedge when |delta| / positionSize exceeds this (bps) */
  deltaThresholdBps: bigint
  /** How often to check delta (ms) */
  hedgeCheckIntervalMs: number
  /** Stop after N iterations */
  maxIterations: number
  /** Max staleness for pool data (seconds) */
  maxStalenessSeconds: number
  /** Slippage tolerance for tick limits (bps) */
  slippageToleranceBps: bigint
}

/**
 * Load configuration from environment variables.
 * Fetches collateral tracker addresses from the pool contract.
 */
export async function loadConfigFromEnv(): Promise<ReverseGammaScalperConfig> {
  const env = loadEnv()

  // Fetch pool to resolve collateral tracker addresses
  const tempClient = createPublicClient({ chain: sepolia, transport: http(env.rpcUrl) })
  const pool = await getPool({
    client: tempClient,
    poolAddress: env.poolAddress,
    chainId: CHAIN_ID,
  })

  return {
    rpcUrl: env.rpcUrl,
    privateKey: env.privateKey,
    poolAddress: env.poolAddress,
    chainId: CHAIN_ID,
    collateralTracker0: pool.collateralTracker0.address,
    collateralTracker1: pool.collateralTracker1.address,
    depositAmount0: 0n, // Native ETH deposits handled by setup.ts (SDK deposit doesn't support msg.value)
    depositAmount1: 0n, // USDC deposits handled by setup.ts
    positionSize: 2n * 10n ** 17n, // 0.001 WETH-scale
    deltaThresholdBps: 200n, // 2%
    hedgeCheckIntervalMs: 30_000,
    maxIterations: 100,
    maxStalenessSeconds: 120,
    slippageToleranceBps: 500n, // 5%
  }
}

// ---------------------------------------------------------------------------
// Client Setup
// ---------------------------------------------------------------------------

export interface BotClients {
  client: PublicClient
  walletClient: WalletClient
  account: Address
}

export function createBotClients(config: ReverseGammaScalperConfig): BotClients {
  const account = privateKeyToAccount(config.privateKey)

  const client = createPublicClient({
    chain: sepolia,
    transport: http(config.rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(config.rpcUrl),
  })

  return {
    client: client as PublicClient,
    walletClient,
    account: account.address,
  }
}

// ---------------------------------------------------------------------------
// Mutable bot state
// ---------------------------------------------------------------------------

export interface BotState {
  currentHedgeTokenId: bigint | null
  startingCollateral: AccountCollateral | null
  totalHedges: number
  iteration: number
  isShuttingDown: boolean
}

export function createInitialState(): BotState {
  return {
    currentHedgeTokenId: null,
    startingCollateral: null,
    totalHedges: 0,
    iteration: 0,
    isShuttingDown: false,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cancellable sleep — resolves immediately when cancel() is called. */
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

function abs(n: bigint): bigint {
  return n < 0n ? -n : n
}

/**
 * Build a unique loan tokenId that doesn't collide with existing open positions.
 * If the default optionRatio=1 tokenId is already in existingIds, bump the ratio
 * and adjust the position size to maintain equivalent exposure.
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

/** Prompt the user for input via stdin and return their answer. */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// ---------------------------------------------------------------------------
// Phase 2 — Read-only: pool state and logging
// ---------------------------------------------------------------------------

export async function readPoolState(
  client: PublicClient,
  config: ReverseGammaScalperConfig,
): Promise<Pool> {
  const pool = await getPool({
    client,
    poolAddress: config.poolAddress,
    chainId: config.chainId,
  })
  assertFresh(pool, config.maxStalenessSeconds)
  assertHealthy(pool)
  return pool
}

export function logStatus(
  iteration: number,
  pool: Pool,
  greeks: PositionGreeksResult | null,
  collateral: AccountCollateral,
  totalHedges: number,
  hedgedThisIteration: boolean,
  netDelta?: bigint,
): void {
  const price = tickToPriceDecimalScaled(pool.currentTick, WETH_DECIMALS, USDC_DECIMALS, 2n)
  const col0 = formatTokenAmount(collateral.token0.assets, WETH_DECIMALS, 6n)
  const col1 = formatTokenAmount(collateral.token1.assets, USDC_DECIMALS, 2n)
  const deltaSuffix =
    netDelta !== undefined ? ` delta=${formatTokenAmount(netDelta, WETH_DECIMALS, 8n)}` : ''

  console.log(
    `[${timestamp()}] iteration=${iteration} price=${price} ` +
      `collateral=[${col0} WETH, ${col1} USDC] ` +
      `hedges=${totalHedges} hedgedNow=${hedgedThisIteration}${deltaSuffix}`,
  )

  if (greeks) {
    const deltaStr = formatTokenAmount(greeks.delta, WETH_DECIMALS, 8n)
    const gammaStr = formatTokenAmount(greeks.gamma, USDC_DECIMALS, 4n)
    const valueStr = formatTokenAmount(greeks.value, USDC_DECIMALS, 4n)
    console.log(`  greeks: delta=${deltaStr} gamma=${gammaStr} value=${valueStr}`)
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — Hedge logic
// ---------------------------------------------------------------------------

const INPUT_LIST_FAIL_RETRIES = 3

export async function executeHedge(
  clients: BotClients,
  config: ReverseGammaScalperConfig,
  storage: StorageAdapter,
  pool: Pool,
  state: BotState,
): Promise<{ hedged: boolean; netDelta: bigint }> {
  for (let attempt = 0; attempt < INPUT_LIST_FAIL_RETRIES; attempt++) {
    try {
      return await executeHedgeAttempt(clients, config, storage, pool, state)
    } catch (error) {
      const parsed = parsePanopticError(error as Error)
      if (parsed?.errorName === 'InputListFail' && attempt < INPUT_LIST_FAIL_RETRIES - 1) {
        console.warn(
          `[${timestamp()}] InputListFail — position list changed, retrying hedge (${attempt + 1}/${INPUT_LIST_FAIL_RETRIES})`,
        )
        // Re-fetch pool state for the retry
        pool = await readPoolState(clients.client, config)
        continue
      }
      throw error
    }
  }
  // Unreachable, but satisfies TypeScript
  return { hedged: false, netDelta: 0n }
}

async function executeHedgeAttempt(
  clients: BotClients,
  config: ReverseGammaScalperConfig,
  storage: StorageAdapter,
  pool: Pool,
  state: BotState,
): Promise<{ hedged: boolean; netDelta: bigint }> {
  const { client, walletClient, account } = clients
  const { poolAddress, chainId } = config

  // Fetch all open positions and compute aggregate delta
  const openIds = await getOpenPositionIds({ client, chainId, poolAddress, account, storage })
  if (openIds.length === 0) return { hedged: false, netDelta: 0n }

  // Collect position data for delta computation (reusable at different ticks)
  interface PositionSnapshot {
    tokenId: bigint
    legs: Awaited<ReturnType<typeof getPosition>>['legs']
    positionSize: bigint
    tickAtMint: bigint
    swapAtMint: boolean
    isLoan: boolean
  }

  const positions: PositionSnapshot[] = []
  let totalPositionSize = 0n

  for (const tokenId of openIds) {
    const pos = await getPosition({ client, poolAddress, owner: account, tokenId })
    if (pos.positionSize === 0n) continue
    const isLoan = pos.legs.every((leg) => leg.width === 0n)
    positions.push({
      tokenId,
      legs: pos.legs,
      positionSize: pos.positionSize,
      tickAtMint: pos.tickAtMint,
      swapAtMint: pos.swapAtMint,
      isLoan,
    })
    totalPositionSize += pos.positionSize
  }

  if (totalPositionSize === 0n) return { hedged: false, netDelta: 0n }

  /** Compute aggregate delta at a given tick, optionally excluding a position by tokenId. */
  function computeDelta(tick: bigint, excludeTokenId?: bigint | null): bigint {
    let delta = 0n
    for (const p of positions) {
      if (excludeTokenId !== undefined && p.tokenId === excludeTokenId) continue
      if (p.isLoan) {
        delta += calculatePositionDeltaWithSwap({
          legs: p.legs,
          currentTick: tick,
          mintTick: p.tickAtMint,
          positionSize: p.positionSize,
          poolTickSpacing: pool.poolKey.tickSpacing,
          swapAtMint: p.swapAtMint,
        })
      } else {
        delta += calculatePositionGreeks({
          legs: p.legs,
          currentTick: tick,
          mintTick: p.tickAtMint,
          positionSize: p.positionSize,
          poolTickSpacing: pool.poolKey.tickSpacing,
        }).delta
      }
    }
    return delta
  }

  // Full portfolio delta (for threshold check)
  const netDelta = computeDelta(pool.currentTick)
  const absDelta = abs(netDelta)
  const deltaRatio = (absDelta * 10000n) / totalPositionSize

  if (deltaRatio <= config.deltaThresholdBps) return { hedged: false, netDelta }

  // Delta excluding current hedge (for initial hedge sizing)
  const deltaExHedge = computeDelta(pool.currentTick, state.currentHedgeTokenId)

  console.log(
    `[${timestamp()}] Delta threshold exceeded: ratio=${deltaRatio}bps ` +
      `(threshold=${config.deltaThresholdBps}bps), hedging...\n` +
      `  netDelta=${formatTokenAmount(netDelta, WETH_DECIMALS, 8n)} ` +
      `deltaExHedge=${formatTokenAmount(deltaExHedge, WETH_DECIMALS, 8n)}\n` +
      `  currentTick=${pool.currentTick}`,
  )

  // Pre-compute a dry-run hedgeLeg to determine the newHedgeTokenId before the convergence loop.
  // We need the tokenId to build dispatch params inside simulateSwap.
  const dryHedge = await getDeltaHedgeParams({
    client,
    poolAddress,
    chainId,
    targetDelta: 0n,
    currentDelta: deltaExHedge,
    asset: 0n,
    currentTick: pool.currentTick,
    tickSpacing: pool.poolKey.tickSpacing,
  })

  const { tokenId: newHedgeTokenId } = buildUniqueLoan(
    pool.poolId,
    dryHedge.hedgeLeg,
    openIds,
    dryHedge.hedgeAmount,
  )

  // Compute tick limits and build dispatch params
  const limits = tickLimits(pool.currentTick, config.slippageToleranceBps)
  const swapLimits: [bigint, bigint, bigint] = [limits.high, limits.low, 0n]
  const finalIds = openIds
    .filter((id) => id !== state.currentHedgeTokenId)
    .concat([newHedgeTokenId])

  // Helper to build dispatch params for a given hedge size
  const buildDispatchParams = (size: bigint) =>
    state.currentHedgeTokenId
      ? {
          positionIdList: [state.currentHedgeTokenId, newHedgeTokenId],
          finalPositionIdList: finalIds,
          positionSizes: [0n, size],
          tickAndSpreadLimits: [swapLimits, swapLimits],
        }
      : {
          positionIdList: [newHedgeTokenId],
          finalPositionIdList: finalIds,
          positionSizes: [size],
          tickAndSpreadLimits: [swapLimits],
        }

  // --- Hedge with simulation-based convergence ---
  const hedge = await getDeltaHedgeParams({
    client,
    poolAddress,
    chainId,
    targetDelta: 0n,
    currentDelta: deltaExHedge,
    asset: 0n,
    currentTick: pool.currentTick,
    tickSpacing: pool.poolKey.tickSpacing,
    totalPositionSize,
    convergenceThresholdBps: config.deltaThresholdBps,
    simulateSwap: async (hedgeAmount, hedgeLeg) => {
      const { adjustedSize } = buildUniqueLoan(pool.poolId, hedgeLeg, openIds, hedgeAmount)
      const sim = await simulateDispatch({
        client,
        poolAddress,
        account,
        ...buildDispatchParams(adjustedSize),
      })
      if (!sim.success || sim.tokenFlow?.tickAfter == null) return null
      return { tickAfter: sim.tokenFlow.tickAfter }
    },
    computeDeltaAtTick: (tick) => computeDelta(tick, state.currentHedgeTokenId),
  })

  const { adjustedSize: finalHedgeSize } = buildUniqueLoan(
    pool.poolId,
    hedge.hedgeLeg,
    openIds,
    hedge.hedgeAmount,
  )

  console.log(
    `  hedge: amount=${hedge.hedgeAmount} size=${finalHedgeSize} ` +
      `iterations=${hedge.simulationIterations} converged=${hedge.converged}` +
      (hedge.simulatedTickAfter !== undefined ? ` tickAfter=${hedge.simulatedTickAfter}` : ''),
  )

  // If the simulation never succeeded, skip execution — the hedge would likely revert
  if (hedge.simulatedTickAfter === undefined) {
    console.log(`  simulation failed, skipping hedge this iteration`)
    return { hedged: false, netDelta }
  }

  // --- Execute the actual dispatch with the converged size ---
  const execParams = buildDispatchParams(finalHedgeSize)
  await dispatchAndWait({
    client,
    walletClient,
    account,
    poolAddress,
    ...execParams,
  })

  state.currentHedgeTokenId = newHedgeTokenId
  state.totalHedges++

  // Read post-hedge pool state to see actual tick impact
  const postPool = await getPool({ client, poolAddress, chainId })
  const postPrice = tickToPriceDecimalScaled(postPool.currentTick, WETH_DECIMALS, USDC_DECIMALS, 2n)

  console.log(
    `[${timestamp()}] Hedge #${state.totalHedges} opened: ` +
      `amount=${finalHedgeSize} tokenType=${hedge.hedgeLeg.tokenType}\n` +
      `  preTick=${pool.currentTick} postTick=${postPool.currentTick} ` +
      `tickDelta=${postPool.currentTick - pool.currentTick} postPrice=${postPrice}`,
  )

  return { hedged: true, netDelta }
}

// ---------------------------------------------------------------------------
// Phase 5 — Shutdown & PnL
// ---------------------------------------------------------------------------

export async function closeAllPositions(
  clients: BotClients,
  config: ReverseGammaScalperConfig,
  storage: StorageAdapter,
  state: BotState,
): Promise<void> {
  const { client, walletClient, account } = clients
  const { poolAddress, chainId } = config

  console.log(`[${timestamp()}] Closing all hedge positions...`)

  // Close hedge first (if open) — with swapAtMint: true
  if (state.currentHedgeTokenId) {
    const hedgePos = await getPosition({
      client,
      poolAddress,
      owner: account,
      tokenId: state.currentHedgeTokenId,
    })

    if (hedgePos.positionSize > 0n) {
      const pool = await getPool({ client, poolAddress, chainId })
      const limits = tickLimits(pool.currentTick, config.slippageToleranceBps)
      const closeIds = await getOpenPositionIds({ client, chainId, poolAddress, account, storage })

      const closeSim = await simulateClosePosition({
        client,
        poolAddress,
        account,
        positionIdList: closeIds,
        tokenId: state.currentHedgeTokenId,
        positionSize: 0n,
        tickLimitLow: limits.low,
        tickLimitHigh: limits.high,
        swapAtMint: true,
      })

      if (closeSim.success) {
        await closePositionAndWait({
          client,
          walletClient,
          account,
          poolAddress,
          positionIdList: closeIds,
          tokenId: state.currentHedgeTokenId,
          positionSize: 0n,
          tickLimitLow: limits.low,
          tickLimitHigh: limits.high,
          swapAtMint: true,
          storage,
          chainId,
        })
        console.log(`[${timestamp()}] Hedge position closed`)
      } else {
        console.error(
          `[${timestamp()}] Failed to close hedge: ` +
            `${parsePanopticError(closeSim.error)?.errorName ?? 'unknown'}`,
        )
      }
    }
    state.currentHedgeTokenId = null
  }

  // Final PnL report
  const endingCollateral = await getAccountCollateral({
    client,
    poolAddress,
    account,
  })

  if (state.startingCollateral) {
    const pnl0 = endingCollateral.token0.assets - state.startingCollateral.token0.assets
    const pnl1 = endingCollateral.token1.assets - state.startingCollateral.token1.assets

    console.log(`[${timestamp()}] === PnL Report ===`)
    console.log(`  WETH PnL: ${formatTokenAmount(pnl0, WETH_DECIMALS, 6n)}`)
    console.log(`  USDC PnL: ${formatTokenAmount(pnl1, USDC_DECIMALS, 2n)}`)
    console.log(`  Total hedges: ${state.totalHedges}`)
    console.log(
      `  Strategy: ${pnl1 > 0n ? 'PROFITABLE — realized vol < implied vol' : 'LOSS — realized vol > implied vol'}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Phase 6 — Main loop with error handling
// ---------------------------------------------------------------------------

export async function runBot(
  config: ReverseGammaScalperConfig,
  storageOverride?: StorageAdapter,
): Promise<BotState> {
  const clients = createBotClients(config)
  const { client, walletClient, account } = clients
  const { poolAddress } = config
  const storage = storageOverride ?? createFileStorage('./data/reverse-gamma-scalper')
  const state = createInitialState()
  const { sleep, cancel: cancelSleep } = createCancellableSleep()

  // Graceful shutdown: press 'q' + Enter, or Ctrl+C
  const triggerShutdown = () => {
    if (state.isShuttingDown) return
    console.log(`[${timestamp()}] Shutting down gracefully...`)
    state.isShuttingDown = true
    cancelSleep()
  }

  // Listen for 'q' on stdin
  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  process.stdin.on('data', (data: string) => {
    if (data.trim().toLowerCase() === 'q') {
      triggerShutdown()
    }
  })

  // Also handle SIGINT as best-effort
  process.removeAllListeners('SIGINT')
  process.on('SIGINT', triggerShutdown)

  console.log('Press q + Enter to quit gracefully.\n')

  try {
    // --- Initialization ---
    console.log(`[${timestamp()}] Starting reverse gamma scalper`)
    console.log(`  Pool: ${poolAddress}`)
    console.log(`  Account: ${account}`)
    console.log(`  Position size: ${config.positionSize}`)
    console.log(`  Delta threshold: ${config.deltaThresholdBps}bps`)

    // Read initial pool state
    const initialPool = await readPoolState(client, config)
    const initialPrice = tickToPriceDecimalScaled(
      initialPool.currentTick,
      WETH_DECIMALS,
      USDC_DECIMALS,
      2n,
    )
    console.log(`[${timestamp()}] Pool price: ${initialPrice}`)

    // Deposit collateral
    if (config.depositAmount0 > 0n) {
      await depositAndWait({
        client,
        walletClient,
        account,
        collateralTrackerAddress: config.collateralTracker0,
        assets: config.depositAmount0,
      })
      console.log(
        `[${timestamp()}] Deposited ${formatTokenAmount(config.depositAmount0, WETH_DECIMALS, 4n)} WETH`,
      )
    }

    if (config.depositAmount1 > 0n) {
      await depositAndWait({
        client,
        walletClient,
        account,
        collateralTrackerAddress: config.collateralTracker1,
        assets: config.depositAmount1,
      })
      console.log(
        `[${timestamp()}] Deposited ${formatTokenAmount(config.depositAmount1, USDC_DECIMALS, 2n)} USDC`,
      )
    }

    // Record starting collateral
    state.startingCollateral = await getAccountCollateral({
      client,
      poolAddress,
      account,
    })
    console.log(
      `[${timestamp()}] Starting collateral: ` +
        `${formatTokenAmount(state.startingCollateral.token0.assets, WETH_DECIMALS, 6n)} WETH, ` +
        `${formatTokenAmount(state.startingCollateral.token1.assets, USDC_DECIMALS, 2n)} USDC`,
    )

    // --- Verify open positions exist ---
    const openIds = await getOpenPositionIds({
      client,
      chainId: config.chainId,
      poolAddress,
      account,
      storage,
    })
    if (openIds.length === 0) {
      throw new Error('No open positions found. Open a position first using a separate script.')
    }
    console.log(
      `[${timestamp()}] Detected ${openIds.length} open position(s): [${openIds.map(String).join(', ')}]`,
    )

    // --- Main hedging loop ---
    while (state.iteration < config.maxIterations && !state.isShuttingDown) {
      try {
        // Pre-flight checks
        const currentPool = await readPoolState(client, config)

        // Attempt hedge (computes net delta across all positions internally)
        const { hedged, netDelta } = await executeHedge(
          clients,
          config,
          storage,
          currentPool,
          state,
        )

        // Log status
        const collateral = await getAccountCollateral({
          client,
          poolAddress,
          account,
        })
        logStatus(
          state.iteration,
          currentPool,
          null,
          collateral,
          state.totalHedges,
          hedged,
          netDelta,
        )
      } catch (error) {
        if (isRetryableRpcError(error)) {
          console.log(
            `[${timestamp()}] Transient RPC error, retrying in ${RPC_RETRY_DELAY_MS}ms...`,
          )
          await sleep(RPC_RETRY_DELAY_MS)
          state.iteration++
          continue
        }
        if (isNonceError(error)) {
          console.log(`[${timestamp()}] Nonce error, retrying in ${NONCE_RETRY_DELAY_MS}ms...`)
          await sleep(NONCE_RETRY_DELAY_MS)
          state.iteration++
          continue
        }
        if (isGasError(error)) {
          console.log(`[${timestamp()}] Gas error, retrying in ${GAS_RETRY_DELAY_MS}ms...`)
          await sleep(GAS_RETRY_DELAY_MS)
          state.iteration++
          continue
        }
        // Non-retryable error
        console.error(`[${timestamp()}] Fatal error:`, error)
        break
      }

      await sleep(config.hedgeCheckIntervalMs)
      state.iteration++
    }

    // --- Shutdown ---
    try {
      await closeAllPositions(clients, config, storage, state)
    } catch (shutdownError) {
      console.error(`[${timestamp()}] Error during shutdown:`, shutdownError)
    }
  } finally {
    process.stdin.pause()
    process.removeAllListeners('SIGINT')
  }

  return state
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/* istanbul ignore next -- CLI entry point */
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('reverse-gamma-scalping') || process.argv[1].endsWith('index.ts'))
) {
  ;(async () => {
    const config = await loadConfigFromEnv()

    // Interactive prompts
    const iterationsInput = await prompt(`Max iterations [${config.maxIterations}]: `)
    if (iterationsInput !== '') {
      const parsed = Number(iterationsInput)
      if (Number.isNaN(parsed) || parsed <= 0) {
        console.error('Invalid number of iterations')
        process.exit(1)
      }
      config.maxIterations = parsed
    }

    const deltaInput = await prompt(`Delta threshold in bps [${config.deltaThresholdBps}]: `)
    if (deltaInput !== '') {
      const parsed = Number(deltaInput)
      if (Number.isNaN(parsed) || parsed <= 0) {
        console.error('Invalid delta threshold')
        process.exit(1)
      }
      config.deltaThresholdBps = BigInt(parsed)
    }

    const state = await runBot(config)
    console.log(
      `[${new Date().toISOString()}] Bot finished after ${state.iteration} iterations, ${state.totalHedges} hedges`,
    )
    process.exit(0)
  })().catch((err) => {
    console.error('Bot failed:', err)
    process.exit(1)
  })
}
