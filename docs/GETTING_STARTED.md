# Getting Started with Panoptic v2 SDK

## Installation

```bash
npm install @panoptic-eng/sdk viem
```

`viem` is a required peer dependency — all SDK functions accept viem clients directly.

---

## 1. Setup viem Clients

```typescript
import { createPublicClient, createWalletClient, http } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// Read-only client (for reads, simulations)
const client = createPublicClient({
  chain: sepolia,
  transport: http('https://sepolia.infura.io/v3/YOUR_KEY'),
})

// Write client (for transactions)
const account = privateKeyToAccount('0xYOUR_PRIVATE_KEY')
const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http('https://sepolia.infura.io/v3/YOUR_KEY'),
})
```

---

## 2. Read Pool Data

```typescript
import { getPool } from '@panoptic-eng/sdk/v2'

const poolAddress = '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78' // Sepolia WETH/USDC 500

const pool = await getPool({
  client,
  poolAddress,
  chainId: 11155111n,
})

console.log('Current tick:', pool.currentTick)
console.log('Token0:', pool.collateralTracker0.symbol) // WETH
console.log('Token1:', pool.collateralTracker1.symbol) // USDC
console.log('Block:', pool._meta.blockNumber)
```

Every read function returns a `_meta` field with `{ blockNumber, blockTimestamp, blockHash }` so you always know how fresh your data is.

---

## 3. Approve & Deposit Collateral

Before trading, you need to approve and deposit collateral into the pool's collateral trackers. Every write function has an `*AndWait` variant that waits for confirmation and returns the receipt directly:

```typescript
import { approveAndWait, depositAndWait } from '@panoptic-eng/sdk/v2'
import { parseUnits } from 'viem'

const MaxUint256 = 2n ** 256n - 1n

// Approve WETH for the collateral tracker
await approveAndWait({
  client,
  walletClient,
  account: account.address,
  tokenAddress: pool.poolKey.currency0,            // WETH address
  spenderAddress: pool.collateralTracker0.address,
  amount: MaxUint256,
})

// Deposit 1 WETH
await depositAndWait({
  client,
  walletClient,
  account: account.address,
  collateralTrackerAddress: pool.collateralTracker0.address,
  assets: parseUnits('1', 18),
})
```

> Repeat for token1 (USDC) using `collateralTracker1` if you need collateral in both tokens.
>
> **Tip:** If you need the transaction hash before waiting, use the base variant instead: `const tx = await approve({...}); console.log(tx.hash); await tx.wait();`

---

## 4. Build a Position (TokenId)

Panoptic positions are encoded as a single `bigint` called a **TokenId**. Use the builder to construct one:

```typescript
import { fetchPoolId, createTokenIdBuilder } from '@panoptic-eng/sdk/v2'

// Fetch the pool's encoded ID
const { poolId } = await fetchPoolId({ client, poolAddress })

// Short call on token0 (WETH) at tick 200000, width 10
const tokenId = createTokenIdBuilder(poolId)
  .addCall({
    strike: 200_000n,   // Tick (must align to pool's tickSpacing)
    width: 10n,          // Width in tickSpacing multiples
    optionRatio: 1n,
    asset: 0n,           // 0 = token0, 1 = token1 (default: 0n)
  })
  .build()
```

### Asset index

The `asset` parameter (0 or 1) controls which token the leg is denominated in:

- **Call**: `asset: 0n` → call on token0 (e.g. WETH). `asset: 1n` → call on token1 (e.g. USDC).
- **Put**: `asset: 0n` → put on token0. `asset: 1n` → put on token1.

Which token is token0 vs token1 is determined by the pool's ordering (check `pool.collateralTracker0.symbol` / `pool.collateralTracker1.symbol`). The default is `0n` if omitted.

### Multi-leg positions

The builder supports chaining — call `.addCall()`, `.addPut()`, `.addLoan()`, or `.addCredit()` multiple times to construct spreads and multi-leg positions (up to 4 legs). Call `.build()` to get the encoded `bigint`.

```typescript
// Bull call spread: short call + long call at higher strike
const spreadId = createTokenIdBuilder(poolId)
  .addCall({ strike: 200_000n, width: 10n, optionRatio: 1n, isLong: false })
  .addCall({ strike: 201_000n, width: 10n, optionRatio: 1n, isLong: true })
  .build()
```

---

## 5. Simulate Before Executing

Always simulate first to check for errors, estimate gas, and preview token flows:

```typescript
import { simulateOpenPosition, tickLimits, formatTokenAmount } from '@panoptic-eng/sdk/v2'

// Calculate slippage-bounded tick limits (500 bps tolerance)
const limits = tickLimits(pool.currentTick, 500n)

const sim = await simulateOpenPosition({
  client,
  poolAddress,
  account: account.address,
  tokenId,
  positionSize: 10n ** 15n,         // 0.001 in 18-decimal units
  existingPositionIds: [],           // Empty if no open positions
  tickLimitLow: limits.low,
  tickLimitHigh: limits.high,
})

if (sim.success) {
  console.log('Gas estimate:', sim.gasEstimate)
  console.log('Token0 required:', formatTokenAmount(
    sim.data.amount0Required, BigInt(pool.collateralTracker0.decimals), 6n
  ))
  console.log('Token1 required:', formatTokenAmount(
    sim.data.amount1Required, BigInt(pool.collateralTracker1.decimals), 6n
  ))
  console.log('Post-mint collateral0:', formatTokenAmount(
    sim.data.postCollateral0, BigInt(pool.collateralTracker0.decimals), 6n
  ))
} else {
  console.error('Would revert:', sim.error)
  // Do not proceed
}
```

Simulations never spend gas. They return either `{ success: true, data, gasEstimate, _meta }` or `{ success: false, error, _meta }`.

---

## 6. Open the Position

```typescript
import { openPositionAndWait } from '@panoptic-eng/sdk/v2'

const receipt = await openPositionAndWait({
  client,
  walletClient,
  account: account.address,
  poolAddress,
  tokenId,
  positionSize: 10n ** 15n,
  existingPositionIds: [],
  tickLimitLow: limits.low,
  tickLimitHigh: limits.high,
})

console.log('Tx hash:', receipt.transactionHash)
```

> **`existingPositionIds`** must contain the tokenIds of all your currently open positions in this pool. Pass `[]` for your first position. For subsequent positions, track them using the sync module (see section 9) or maintain the array yourself.

---

## 7. Monitor & Close

```typescript
import {
  getPosition,
  getAccountCollateral,
  closePositionAndWait,
  formatTokenAmount,
} from '@panoptic-eng/sdk/v2'

// Read position data
const position = await getPosition({
  client,
  poolAddress,
  owner: account.address,
  tokenId,
})
console.log('Position size:', position.positionSize)

// Read collateral and format for display
const collateral = await getAccountCollateral({
  client,
  poolAddress,
  account: account.address,
})

const decimals0 = BigInt(pool.collateralTracker0.decimals)
const decimals1 = BigInt(pool.collateralTracker1.decimals)

console.log('Deposited WETH:', formatTokenAmount(collateral.token0.assets, decimals0, 4n))
console.log('Available WETH:', formatTokenAmount(collateral.token0.availableAssets, decimals0, 4n))
console.log('Deposited USDC:', formatTokenAmount(collateral.token1.assets, decimals1, 2n))
console.log('Available USDC:', formatTokenAmount(collateral.token1.availableAssets, decimals1, 2n))

// Close the position entirely
// Note: any positionSize value closes the full position. Partial closes are not supported;
// to resize, close and reopen at the desired size.
await closePositionAndWait({
  client,
  walletClient,
  account: account.address,
  poolAddress,
  tokenId,
  positionIdList: [tokenId],    // All open positions in this pool
  positionSize: position.positionSize,
  tickLimitLow: limits.low,
  tickLimitHigh: limits.high,
})
```

---

## 8. Format Values for Display

All formatters require an explicit `precision` parameter (no hidden defaults). Here's a realistic example using actual pool and collateral data:

```typescript
import {
  formatTokenAmount,
  tickToPriceDecimalScaled,
  formatBps,
  formatUtilization,
} from '@panoptic-eng/sdk/v2'

const decimals0 = BigInt(pool.collateralTracker0.decimals) // e.g. 18n for WETH
const decimals1 = BigInt(pool.collateralTracker1.decimals) // e.g. 6n for USDC

// Format collateral balances
const collateral = await getAccountCollateral({ client, poolAddress, account: account.address })
console.log('WETH deposited:', formatTokenAmount(collateral.token0.assets, decimals0, 4n))
//  → "1.0000"
console.log('USDC deposited:', formatTokenAmount(collateral.token1.assets, decimals1, 2n))
//  → "5000.00"

// Current price from pool tick
const price = tickToPriceDecimalScaled(pool.currentTick, decimals0, decimals1, 2n)
console.log('USDC per WETH:', price)
//  → "3521.47"

// Pool utilization
console.log('Token0 utilization:', formatUtilization(pool.collateralTracker0.utilization, 2n))
//  → "32.15%"

// Fee tier
console.log('Fee tier:', formatBps(BigInt(pool.poolKey.fee), 2n))
//  → "0.05%"
```

---

## 9. Position Tracking (Optional)

For bots or persistent apps, use the sync module to track positions via on-chain events:

```typescript
import {
  createMemoryStorage,   // In-memory (scripts, testing)
  createFileStorage,     // File-based (persistent)
  syncPositions,
  getTrackedPositionIds,
} from '@panoptic-eng/sdk/v2'

const storage = createFileStorage('./panoptic-data')

// Sync from on-chain events (resumable — picks up where it left off)
await syncPositions({
  client,
  chainId: 11155111n,
  poolAddress,
  account: account.address,
  storage,
})

// Get tracked open positions
const openIds = await getTrackedPositionIds({
  chainId: 11155111n,
  poolAddress,
  account: account.address,
  storage,
})

// Use in subsequent openPosition calls
await openPositionAndWait({
  // ...
  existingPositionIds: openIds,
})
```

> **Important:** Write functions (`openPosition`, `closePosition`, etc.) do **not** automatically update the storage. After any write, call `syncPositions()` again to pick up the new on-chain state. The sync is resumable — it only fetches events since its last checkpoint.

---

## 10. Roll Positions

Rolling atomically closes one position and opens another in a single transaction — avoiding the collateral gap of separate close + open calls:

```typescript
import { rollPositionAndWait, tickLimits } from '@panoptic-eng/sdk/v2'

const closeLimits = tickLimits(pool.currentTick, 500n)
const openLimits = tickLimits(pool.currentTick, 500n)

await rollPositionAndWait({
  client,
  walletClient,
  account: account.address,
  poolAddress,
  oldTokenId,
  oldPositionSize: currentPosition.positionSize,
  newTokenId,
  newPositionSize: 10n ** 15n,
  closeTickLimitLow: closeLimits.low,
  closeTickLimitHigh: closeLimits.high,
  openTickLimitLow: openLimits.low,
  openTickLimitHigh: openLimits.high,
})
```

> **Tip:** If you provide `storage` and `chainId`, the `positionIdList` is resolved automatically from tracked positions. Otherwise pass it explicitly.

---

## 11. Loans and Credits

Legs with `width: 0` are **loans** (borrow liquidity) or **credits** (lend liquidity). They don't create an options range — they simply move tokens between collateral trackers.

```typescript
import { createTokenIdBuilder, isLoan, isCredit, hasLoanOrCredit } from '@panoptic-eng/sdk/v2'

// Borrow token0 at a specific strike
const loanId = createTokenIdBuilder(poolId)
  .addLoan({ asset: 0n, tokenType: 0n, strike: 200_000n })
  .build()

// Lend token1 at a specific strike
const creditId = createTokenIdBuilder(poolId)
  .addCredit({ asset: 1n, tokenType: 1n, strike: 200_000n })
  .build()

console.log(isLoan(loanId))          // true
console.log(isCredit(creditId))      // true
console.log(hasLoanOrCredit(loanId)) // true
```

> **`swapAtMint`**: Pass `swapAtMint: true` in `openPositionAndWait()` to auto-swap borrowed tokens into the required collateral — useful for delta-hedging strategies.
>
> See the [reverse-gamma-scalping example](../src/panoptic/v2/examples/reverse-gamma-scalping/) for a full workflow combining loans, credits, and swap-aware greeks.

---

## 12. Client-side Greeks

Greeks are **pure functions** — no RPC calls needed. Outputs are in **natural token units** (not WAD-scaled):

- **Value / Gamma**: numeraire token smallest units (e.g. USDC wei)
- **Delta**: asset token smallest units (e.g. WETH wei)

```typescript
import {
  decodeTokenId,
  calculatePositionGreeks,
  isCall,
  isDefinedRisk,
  calculatePositionDeltaWithSwap,
  getLoanEffectiveDelta,
} from '@panoptic-eng/sdk/v2'

// Decode the tokenId into legs
const { legs } = decodeTokenId(tokenId)

// Calculate all greeks at once
const greeks = calculatePositionGreeks({
  legs,
  currentTick: pool.currentTick,
  mintTick: pool.currentTick,   // Tick at time of mint
  positionSize: 10n ** 15n,
  poolTickSpacing: BigInt(pool.poolKey.tickSpacing),
})

console.log('Value:', greeks.value)   // numeraire smallest units
console.log('Delta:', greeks.delta)   // asset smallest units
console.log('Gamma:', greeks.gamma)   // numeraire smallest units

// Helpers
console.log('Is call?', isCall(legs[0].tokenType, legs[0].asset === 0n))
console.log('Defined risk?', isDefinedRisk(legs))

// Swap-aware delta (accounts for loan auto-swap effects)
const swapDelta = calculatePositionDeltaWithSwap({
  legs,
  currentTick: pool.currentTick,
  positionSize: 10n ** 15n,
  poolTickSpacing: BigInt(pool.poolKey.tickSpacing),
  mintTick: pool.currentTick,
  definedRisk: isDefinedRisk(legs),
})

// Effective delta of a single loan leg
const loanDelta = getLoanEffectiveDelta({
  leg: legs[0],
  positionSize: 10n ** 15n,
})
```

---

## 13. Risk & Margin Monitoring

Check whether an account is healthy and how far it is from liquidation:

```typescript
import {
  isLiquidatable,
  getMarginBuffer,
  getLiquidationPrices,
  getNetLiquidationValue,
  estimateCollateralRequired,
  getMaxPositionSize,
} from '@panoptic-eng/sdk/v2'

// Is the account liquidatable right now?
const liqCheck = await isLiquidatable({
  client,
  poolAddress,
  account: account.address,
  queryAddress,    // PanopticQuery contract address
})
console.log('Liquidatable:', liqCheck.isLiquidatable)

// How much margin buffer remains?
const margin = await getMarginBuffer({
  client,
  poolAddress,
  account: account.address,
  queryAddress,
})
console.log('Margin buffer:', margin.marginBuffer)

// At what prices does the account become liquidatable?
const liqPrices = await getLiquidationPrices({
  client,
  poolAddress,
  account: account.address,
  queryAddress,
})

// Net liquidation value
const nlv = await getNetLiquidationValue({
  client,
  poolAddress,
  account: account.address,
  queryAddress,
})

// Pre-trade: how much collateral would a new position require?
const estimate = await estimateCollateralRequired({
  client,
  poolAddress,
  account: account.address,
  tokenId: newTokenId,
  positionSize: 10n ** 15n,
  queryAddress,
})

// Pre-trade: what's the max size given current collateral?
const maxSize = await getMaxPositionSize({
  client,
  poolAddress,
  account: account.address,
  tokenId: newTokenId,
  queryAddress,
})
```

> Most risk functions require a `queryAddress` — the deployed `PanopticQuery` helper contract. Obtain it from your deployment config.

---

## 14. Liquidation & Force Exercise

Full liquidation workflow: detect → simulate → execute.

```typescript
import {
  isLiquidatable,
  simulateLiquidate,
  liquidateAndWait,
  forceExerciseAndWait,
} from '@panoptic-eng/sdk/v2'

// 1. Check if target is liquidatable
const check = await isLiquidatable({
  client,
  poolAddress,
  account: targetAddress,
  queryAddress,
})

if (check.isLiquidatable) {
  // 2. Simulate first
  const sim = await simulateLiquidate({
    client,
    poolAddress,
    account: account.address,       // Your address (liquidator)
    liquidatee: targetAddress,
    positionIdListFrom: myPositionIds,      // Your open positions
    positionIdListTo: targetPositionIds,    // Target's positions
  })

  if (sim.success) {
    // 3. Execute
    await liquidateAndWait({
      client,
      walletClient,
      account: account.address,
      poolAddress,
      liquidatee: targetAddress,
      positionIdListFrom: myPositionIds,
      positionIdListTo: targetPositionIds,
    })
  }
}

// Force exercise an ITM long position (separate flow)
await forceExerciseAndWait({
  client,
  walletClient,
  account: account.address,
  poolAddress,
  touchedId: targetTokenId,
  positionIdListExercisee: targetPositionIds,
  positionIdListExercisor: myPositionIds,
})
```

> See the [liquidation-bot example](../src/panoptic/v2/examples/liquidation-bot/) for a production-ready bot with account discovery, margin sorting, and retry logic.

---

## 15. Real-time Events

Three approaches for different use cases:

```typescript
import {
  watchEvents,
  createEventSubscription,
  createEventPoller,
} from '@panoptic-eng/sdk/v2'

// --- Option A: Simple WebSocket watcher ---
// Best for: scripts, quick monitoring. Stops on disconnect.
const unsubscribe = watchEvents({
  client,    // Must use WebSocket transport
  poolAddress,
  onEvent: (event) => {
    console.log(event.eventName, event.args)
  },
})
// Later: unsubscribe()

// --- Option B: Resilient subscription ---
// Best for: production bots. Auto-reconnects, backfills gaps.
const subscription = createEventSubscription({
  client,
  poolAddress,
  onEvent: (event) => {
    console.log(event.eventName, event.args)
  },
  onError: (error) => console.error(error),
})
subscription.start()
// Later: subscription.stop()

// --- Option C: HTTP polling ---
// Best for: environments without WebSocket support.
const poller = createEventPoller({
  client,
  poolAddress,
  onEvent: (event) => {
    console.log(event.eventName, event.args)
  },
  intervalMs: 12_000,    // Poll every 12 seconds
})
poller.start()
// Later: poller.stop()
```

> **Event types** include: `OptionMinted`, `OptionBurnt`, `AccountLiquidated`, `ForcedExercised`, `PremiumSettled`, `Deposit`, `Withdraw`, and more.

---

## 16. Bot Utilities

Preflight checks and error classifiers for robust bot loops:

```typescript
import {
  assertFresh,
  assertHealthy,
  assertTradeable,
  assertCanMint,
  isRetryableRpcError,
  isNonceError,
  isGasError,
  getSafeMode,
} from '@panoptic-eng/sdk/v2'

// --- Preflight checks (throw on failure) ---
const pool = await getPool({ client, poolAddress, chainId })
assertFresh(pool, 60)          // Throws StaleDataError if data > 60s old
assertHealthy(pool)            // Throws UnhealthyPoolError if pool is inactive

const safeMode = await getSafeMode({ client, poolAddress })
assertTradeable(pool, safeMode)  // Checks health + safe mode restrictions
assertCanMint(safeMode)          // Throws if minting is restricted

// --- Retry loop with error classifiers ---
async function executeWithRetry(fn: () => Promise<void>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fn()
      return
    } catch (error) {
      if (isRetryableRpcError(error)) {
        console.log('Transient RPC error, retrying...')
        continue
      }
      if (isNonceError(error)) {
        console.log('Nonce error, will retry with fresh nonce...')
        continue
      }
      if (isGasError(error)) {
        console.log('Gas error, will retry with higher gas...')
        continue
      }
      throw error  // Non-retryable
    }
  }
}
```

---

## 17. Oracle Maintenance

Panoptic pools have an internal oracle that must be poked periodically to record new price observations. There is a **64-second epoch** constraint — poking more frequently reverts.

```typescript
import {
  getOracleState,
  pokeOracleAndWait,
} from '@panoptic-eng/sdk/v2'

// Check oracle state
const oracle = await getOracleState({ client, poolAddress })
console.log('Cardinality:', oracle.cardinality)
console.log('Last observation:', oracle.lastObservation)

// Poke the oracle (with rate-limit check to avoid reverts)
try {
  await pokeOracleAndWait({
    client,
    walletClient,
    account: account.address,
    poolAddress,
    checkRateLimit: true,   // Pre-checks epoch elapsed; throws OracleRateLimitedError if not
  })
  console.log('Oracle poked successfully')
} catch (error) {
  if (error.name === 'OracleRateLimitedError') {
    console.log('Epoch not elapsed yet, try again later')
  } else {
    throw error
  }
}
```

> See the [oracle-poker example](../src/panoptic/v2/examples/oracle-poker/) for a multi-pool monitoring bot that keeps oracles fresh.

---

## 18. Price & Trade History

Historical data for charting and analytics:

```typescript
import {
  getPriceHistory,
  getStreamiaHistory,
  getTradeHistory,
  getRealizedPnL,
} from '@panoptic-eng/sdk/v2'

// Historical prices at specific blocks (for charting)
const priceHistory = await getPriceHistory({
  client,
  blockNumbers: [19000000n, 19100000n, 19200000n],
  poolConfig: {
    uniswapPoolAddress: pool.uniswapPoolAddress,
  },
})
for (const snap of priceHistory.snapshots) {
  console.log(`Block ${snap.blockNumber}: tick=${snap.tick}`)
}

// Streamia (premia) history for a position over time
const streamia = await getStreamiaHistory({
  client,
  poolAddress,
  account: account.address,
  tokenId,
  blockNumbers: [19000000n, 19100000n, 19200000n],
})

// Local trade history (from sync storage)
const trades = await getTradeHistory({
  chainId: 11155111n,
  poolAddress,
  account: account.address,
  storage,
})
console.log(`${trades.length} closed positions`)

// Aggregate realized PnL
const pnl = await getRealizedPnL({
  chainId: 11155111n,
  poolAddress,
  account: account.address,
  storage,
})
console.log('Realized PnL:', pnl)
```

> See [`examples/basic/06-trade-history.ts`](../src/panoptic/v2/examples/basic/06-trade-history.ts) for a complete trade history workflow.

---

## 19. Pool Deployment

Deploy new Panoptic pools on top of existing Uniswap v4 pools:

```typescript
import {
  minePoolAddress,
  simulateDeployNewPool,
  deployNewPoolAndWait,
  getPanopticPoolAddress,
} from '@panoptic-eng/sdk/v2'

const poolKey = {
  currency0: '0x...',     // Token0 address
  currency1: '0x...',     // Token1 address
  fee: 500n,              // Fee tier in BPS
  tickSpacing: 10n,
  hooks: '0x0000000000000000000000000000000000000000',
}

// Optional: mine a vanity address with a specific prefix
const mined = await minePoolAddress({
  client,
  factoryAddress,
  deployerAddress: account.address,
  poolKey,
  riskEngine: riskEngineAddress,
  salt: 0n,
  loops: 1000n,
  minTargetRarity: 2n,
})
console.log('Best salt:', mined.bestSalt, 'Address:', mined.bestAddress)

// Simulate the deployment
const deployedAddress = await simulateDeployNewPool({
  client,
  factoryAddress,
  poolKey,
  riskEngine: riskEngineAddress,
  salt: mined.bestSalt,
})
console.log('Would deploy at:', deployedAddress)

// Deploy
await deployNewPoolAndWait({
  client,
  walletClient,
  account: account.address,
  factoryAddress,
  poolKey,
  riskEngine: riskEngineAddress,
  salt: mined.bestSalt,
})

// Look up an existing Panoptic pool address
const existingPool = await getPanopticPoolAddress({
  client,
  factoryAddress,
  poolKey,
  riskEngine: riskEngineAddress,
})
```

> Pool deployment is a rare, advanced operation. Most users will interact with existing pools discovered via the Panoptic UI or subgraph.

---

## Complete Example

Putting it all together — read pool, deposit, simulate, open a short call, monitor, then close:

```typescript
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  getPool, fetchPoolId,
  approveAndWait, depositAndWait,
  createTokenIdBuilder, simulateOpenPosition,
  openPositionAndWait, closePositionAndWait,
  getAccountCollateral, getPosition,
  tickLimits, formatTokenAmount,
} from '@panoptic-eng/sdk/v2'

const account = privateKeyToAccount('0xYOUR_PRIVATE_KEY')
const client = createPublicClient({ chain: sepolia, transport: http() })
const walletClient = createWalletClient({ account, chain: sepolia, transport: http() })

const poolAddress = '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78'

// 1. Read pool
const pool = await getPool({ client, poolAddress, chainId: 11155111n })
const decimals0 = BigInt(pool.collateralTracker0.decimals)

// 2. Approve + deposit WETH
await approveAndWait({
  client, walletClient, account: account.address,
  tokenAddress: pool.poolKey.currency0,
  spenderAddress: pool.collateralTracker0.address,
  amount: 2n ** 256n - 1n,
})

await depositAndWait({
  client, walletClient, account: account.address,
  collateralTrackerAddress: pool.collateralTracker0.address,
  assets: parseUnits('1', 18),
})

// 3. Build position — short call on token0 (WETH)
const { poolId } = await fetchPoolId({ client, poolAddress })
const tokenId = createTokenIdBuilder(poolId)
  .addCall({ strike: 200_000n, width: 10n, optionRatio: 1n })
  .build()

// 4. Simulate and check token flows
const limits = tickLimits(pool.currentTick, 500n)
const sim = await simulateOpenPosition({
  client, poolAddress, account: account.address,
  tokenId, positionSize: 10n ** 15n, existingPositionIds: [],
  tickLimitLow: limits.low, tickLimitHigh: limits.high,
})

if (!sim.success) throw new Error(`Simulation failed: ${sim.error}`)

console.log('Token0 required:', formatTokenAmount(sim.data.amount0Required, decimals0, 6n))
console.log('Gas estimate:', sim.gasEstimate)

// 5. Open
const openReceipt = await openPositionAndWait({
  client, walletClient, account: account.address, poolAddress,
  tokenId, positionSize: 10n ** 15n, existingPositionIds: [],
  tickLimitLow: limits.low, tickLimitHigh: limits.high,
})
console.log('Opened:', openReceipt.transactionHash)

// 6. Monitor
const position = await getPosition({ client, poolAddress, owner: account.address, tokenId })
const collateral = await getAccountCollateral({ client, poolAddress, account: account.address })
console.log('Position size:', position.positionSize)
console.log('Available WETH:', formatTokenAmount(collateral.token0.availableAssets, decimals0, 4n))

// 7. Close
await closePositionAndWait({
  client, walletClient, account: account.address, poolAddress,
  tokenId, positionIdList: [tokenId], positionSize: position.positionSize,
  tickLimitLow: limits.low, tickLimitHigh: limits.high,
})
console.log('Position closed!')
```

---

## Key Concepts

| Concept | Details |
|---------|---------|
| **All values are `bigint`** | Amounts, ticks, timestamps, block numbers. Use `parseUnits()` from viem for human → raw conversion. |
| **`_meta` on every read** | `{ blockNumber, blockTimestamp, blockHash }` — always know data freshness. |
| **`*AndWait` variants** | Every write function has an `*AndWait` variant that waits for confirmation and returns the receipt. Use the base variant if you need the tx hash before waiting. |
| **Simulations don't throw** | They return `{ success: false, error }` instead. All other errors throw typed `PanopticError` subclasses. |
| **Position ID lists** | `openPosition()` takes `existingPositionIds` (positions held before this mint); `closePosition()` takes `positionIdList` (all current positions). Use sync module or track manually. |
| **Explicit precision** | Formatters never assume decimal places — you always pass `precision`. |
| **No caching** | The SDK never caches RPC data across calls. Every call fetches fresh state. |
| **Same-block reads** | Aggregate reads (e.g., `getPool`) use a single Multicall3 call to guarantee consistency. |
| **Storage is not auto-synced** | After writes, call `syncPositions()` to update local position tracking. |
| **Loans & credits** | Width-0 legs. Loans borrow liquidity, credits lend it. Use `swapAtMint: true` for auto-swap of borrowed tokens. |
| **Greeks are natural units** | Value/gamma in numeraire smallest units, delta in asset smallest units — no WAD scaling. |
| **Bot assertions throw** | `assertFresh`, `assertHealthy`, `assertTradeable` throw typed errors; error classifiers (`isRetryableRpcError`, etc.) return booleans. |
| **Three event modes** | `watchEvents` (WebSocket, simple), `createEventSubscription` (resilient, auto-reconnect), `createEventPoller` (HTTP polling). |
| **Oracle epochs** | Oracle pokes are rate-limited to 64-second epochs. Use `checkRateLimit: true` to avoid `OracleRateLimitedError`. |
