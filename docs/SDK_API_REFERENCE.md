# Panoptic v2 SDK — API Reference

All functions use a flat API (no classes). Numeric values are `bigint` unless noted. Every read function returns `_meta: { blockNumber, blockTimestamp, blockHash }` for data freshness tracking.

---

## Pool & Market Data (`reads/`)

| Function | Description |
|----------|-------------|
| `getPool(params)` | Full pool state: ticks, collateral trackers, oracle, utilization |
| `getPoolMetadata(params)` | Immutable pool info (addresses, symbols, decimals) |
| `fetchPoolId(params)` | Encoded 64-bit pool ID needed for TokenId construction |
| `getUtilization(params)` | Current utilization for both tokens |
| `getOracleState(params)` | Oracle tick observations and cardinality |
| `getRiskParameters(params)` | Protocol risk params (millitick scale: 10M = 100%) |
| `getSafeMode(params)` | Safe mode status (restricts minting/burning) |
| `getPoolLiquidities(params)` | Cumulative liquidity distribution across a tick range |
| `getCurrentRates(params)` | Current interest rates for both tokens |
| `getCollateralData(params)` | Collateral tracker data (total assets, shares, rates) |
| `getCollateralAddresses(pool)` | Extract collateral tracker addresses from a Pool object |

## Account Data (`reads/`)

| Function | Description |
|----------|-------------|
| `getAccountCollateral(params)` | Account deposits, shares, and available balance per token |
| `getAccountSummaryBasic(params)` | Dashboard-ready account overview (positions, collateral) |
| `getAccountSummaryRisk(params)` | Risk-focused summary with margin and liquidation data |
| `getNetLiquidationValue(params)` | Net liquidation value of an account |
| `getLiquidationPrices(params)` | Tick/price levels where account becomes liquidatable |
| `getMarginBuffer(params)` | Margin buffer and distance-to-liquidation |
| `isLiquidatable(params)` | Check if account is liquidatable with margin breakdown |
| `getAccountHistory(params)` | On-chain trade history for an account |
| `getAccountGreeks(params)` | Account-level greeks from stored positions |
| `calculateAccountGreeksPure(params)` | Pure function: portfolio greeks across a range of ticks |

## Position Data (`reads/`)

| Function | Description |
|----------|-------------|
| `getPosition(params)` | Single position by tokenId (size, value, collateral req) |
| `getPositions(params)` | All positions for an account |
| `getPositionGreeks(params)` | Greeks (delta, gamma, value) for a single position |
| `getAccountPremia(params)` | Accumulated premia totals for an account |
| `getPositionsWithPremia(params)` | Positions enriched with per-position premia data |

## Collateral Estimation (`reads/`)

| Function | Description |
|----------|-------------|
| `estimateCollateralRequired(params)` | Estimate collateral needed to open a position |
| `getMaxPositionSize(params)` | Max position size given current collateral |
| `getRequiredCreditForITM(params)` | Required credit amount for an ITM position |

## Portfolio Utilities (`reads/`)

| Function | Description |
|----------|-------------|
| `getPortfolioValue(params)` | Portfolio NAV without premia |
| `checkCollateralAcrossTicks(params)` | Collateral balance vs requirement across tick range |
| `optimizeTokenIdRiskPartners(params)` | Optimize risk partner assignments in a TokenId |
| `getDeltaHedgeParams(params)` | Calculate loan parameters to achieve a target delta |

## ERC-4626 Vault Previews (`reads/`)

| Function | Description |
|----------|-------------|
| `previewDeposit(params)` | Preview shares minted for a given deposit |
| `previewWithdraw(params)` | Preview assets returned for a withdrawal |
| `previewMint(params)` | Preview assets required to mint shares |
| `previewRedeem(params)` | Preview shares burned for a redeem |
| `convertToShares(params)` | Convert asset amount to share amount |
| `convertToAssets(params)` | Convert share amount to asset amount |

---

## Write Functions (`writes/`)

All write functions return `Promise<TxResult>` with a `.wait()` method. Each has an `*AndWait` variant that returns `Promise<TxReceipt>` directly.

### Approvals

| Function | Description |
|----------|-------------|
| `approve(params)` | Approve token spending for a collateral tracker |
| `approvePool(params)` | Approve both tokens for a pool (returns two TxResults) |
| `checkApproval(params)` | Check if approval is needed before transacting |

### Vault (Deposit/Withdraw)

| Function | Description |
|----------|-------------|
| `deposit(params)` | Deposit assets into a collateral tracker |
| `withdraw(params)` | Withdraw assets from a collateral tracker |
| `withdrawWithPositions(params)` | Withdraw with position list validation |
| `mint(params)` | Mint shares by depositing assets |
| `redeem(params)` | Redeem shares for assets |

### Positions

| Function | Description |
|----------|-------------|
| `openPosition(params)` | Open a new options position |
| `closePosition(params)` | Close an existing position |
| `rollPosition(params)` | Roll: close one position + open another atomically |

### Liquidation & Settlement

| Function | Description |
|----------|-------------|
| `liquidate(params)` | Liquidate an undercollateralized account |
| `forceExercise(params)` | Force exercise an ITM long position |
| `settleAccumulatedPremia(params)` | Settle accumulated premia on positions |

### Low-level

| Function | Description |
|----------|-------------|
| `dispatch(params)` | Execute a raw dispatch operation |
| `pokeOracle(params)` | Poke the oracle to update its state |

---

## Simulations (`simulations/`)

All return `Promise<SimulationResult<T>>` — either `{ success: true, data, gasEstimate, _meta }` or `{ success: false, error, _meta }`. No gas is spent.

| Function | Description |
|----------|-------------|
| `simulateOpenPosition(params)` | Simulate opening a position |
| `simulateClosePosition(params)` | Simulate closing a position |
| `simulateDeposit(params)` | Simulate a vault deposit |
| `simulateWithdraw(params)` | Simulate a vault withdrawal |
| `simulateLiquidate(params)` | Simulate a liquidation |
| `simulateForceExercise(params)` | Simulate a force exercise |
| `simulateSettle(params)` | Simulate premium settlement |
| `simulateDispatch(params)` | Simulate a raw dispatch |

---

## TokenId Encoding/Decoding (`tokenId/`)

| Function | Description |
|----------|-------------|
| `createTokenIdBuilder(poolId)` | Returns a builder: `.addCall({strike, width, optionRatio})` / `.addPut(...)` / `.addLoan(...)` / `.addCredit(...)` / `.build()` → `bigint` |
| `decodeTokenId(tokenId)` | Decode a tokenId into `{ poolId, legs[] }` with strike, width, tokenType, isLong, etc. |
| `hasLongLeg(tokenId)` | True if any leg is long |
| `isShortOnly(tokenId)` | True if all legs are short |
| `isSpread(tokenId)` | True if position is a spread |
| `isLoan(tokenId)` | True if tokenId is a pure loan |
| `isCredit(tokenId)` | True if tokenId is a pure credit |
| `hasLoanOrCredit(tokenId)` | True if tokenId contains loan or credit legs |
| `validatePoolId(tokenId, expectedPoolId)` | Validate embedded pool ID matches |

---

## Position Tracking & Sync (`sync/`)

Tracks open/closed positions locally via a `StorageAdapter`.

| Function | Description |
|----------|-------------|
| `syncPositions(params)` | Sync positions from on-chain events into local storage (resumable) |
| `getTrackedPositionIds(params)` | Get locally tracked position IDs |
| `isPositionTracked(params, tokenId)` | Check if a position is tracked |
| `clearTrackedPositions(params)` | Clear all tracked positions from storage |
| `getTradeHistory(params)` | Get closed positions from local storage |
| `getRealizedPnL(params)` | Realized PnL summary from trade history |
| `saveClosedPosition(params)` | Manually save a closed position |
| `clearTradeHistory(params)` | Clear trade history |

---

## Events (`events/`)

| Function | Description |
|----------|-------------|
| `watchEvents(params)` | WebSocket-based real-time event watcher. Returns `unsubscribe()`. |
| `createEventPoller(params)` | HTTP polling-based event fetcher. Returns `{ start, stop, poll }`. |
| `createEventSubscription(params)` | Resilient subscription with auto-reconnect and gap backfill. |

---

## Formatters (`formatters/`)

All formatters require explicit `precision` (bigint) — no defaults.

### Price / Tick

| Function | Description |
|----------|-------------|
| `tickToPrice(tick)` | Raw price string from tick |
| `tickToPriceDecimalScaled(tick, decimals0, decimals1, precision)` | Human-readable price |
| `priceToTick(price, decimals0, decimals1)` | Tick from a price string |
| `tickToSqrtPriceX96(tick)` | sqrtPriceX96 from tick |
| `sqrtPriceX96ToTick(sqrtPriceX96)` | Tick from sqrtPriceX96 |
| `sqrtPriceX96ToPriceDecimalScaled(...)` | Human-readable price from sqrtPriceX96 |
| `getPricesAtTick(tick, decimals0, decimals1, precision)` | Both price directions |
| `formatTick(tick)` | Display string for a tick |
| `formatTickRange(tickLower, tickUpper)` | Display string for a range |
| `formatPriceRange(tickLower, tickUpper, decimals0, decimals1, precision)` | Price range string |
| `getTickSpacing(feeBps)` | Tick spacing for a fee tier |
| `roundToTickSpacing(tick, tickSpacing)` | Round to nearest valid tick |
| `tickLimits(currentTick, toleranceBps)` | Slippage-bounded tick limits for transactions |

### Token Amounts

| Function | Description |
|----------|-------------|
| `formatTokenAmount(amount, decimals, precision)` | e.g. `1000000n` → `"1.00"` (6 decimals) |
| `formatTokenAmountSigned(amount, decimals, precision)` | With +/- prefix |
| `parseTokenAmount(amount, decimals)` | `"1.5"` → `1500000n` (6 decimals) |
| `formatTokenDelta(amount, decimals, precision)` | Alias for signed format |
| `formatTokenFlow(flow, decimals0, decimals1, precision0, precision1)` | Format a two-token flow |

### Percentages & Rates

| Function | Description |
|----------|-------------|
| `formatBps(bps, precision)` | `250n` → `"2.50%"` |
| `parseBps(percent)` | `"2.5%"` → `250n` |
| `formatUtilization(util, precision)` | Format utilization as percentage |
| `formatRatioPercent(numerator, denominator, precision)` | Ratio as percentage |

### WAD-scaled Values (1e18 = 1.0)

| Function | Description |
|----------|-------------|
| `formatWad(wad, precision)` | WAD to decimal string |
| `formatWadSigned(wad, precision)` | With +/- prefix |
| `formatWadPercent(wad, precision)` | WAD as percentage |
| `formatRateWad(rateWad, precision)` | Annualized rate |
| `parseWad(value)` | Decimal string to WAD bigint |

---

## Client-side Greeks (`greeks/`)

All outputs are WAD-scaled bigints (1e18 = 1.0).

| Function | Description |
|----------|-------------|
| `getLegValue(leg, currentTick, mintTick, positionSize, poolTickSpacing, definedRisk, assetIndex?)` | Value of a single leg |
| `getLegDelta(leg, currentTick, positionSize, poolTickSpacing, mintTick, definedRisk, assetIndex?)` | Delta of a single leg |
| `getLegGamma(leg, currentTick, positionSize, poolTickSpacing, assetIndex?)` | Gamma of a single leg |
| `calculatePositionValue(input)` | Total value across all legs |
| `calculatePositionDelta(input)` | Total delta across all legs |
| `calculatePositionGamma(input)` | Total gamma across all legs |
| `calculatePositionGreeks(input)` | All greeks at once: `{ value, delta, gamma }` |
| `isCall(tokenType, isAssetToken0)` | True if leg is a call |
| `isDefinedRisk(legs)` | True if position has defined risk (has a long leg) |

---

## Bot Utilities (`bot/`)

Assertion functions throw typed errors. Classification functions return booleans.

| Function | Description |
|----------|-------------|
| `assertFresh(data, maxAgeSeconds, currentTimestamp?)` | Throws `StaleDataError` if `_meta.blockTimestamp` is too old |
| `assertHealthy(pool)` | Throws `UnhealthyPoolError` if pool is not active |
| `assertTradeable(pool, safeMode?)` | Checks pool health + safe mode restrictions |
| `assertCanMint(safeMode)` | Throws if minting is restricted |
| `assertCanBurn(safeMode)` | Throws if burning is restricted |
| `assertCanLiquidate(safeMode)` | Throws if liquidations are restricted |
| `assertCanForceExercise(safeMode)` | Throws if force exercise is restricted |
| `isRetryableRpcError(error)` | True for transient RPC errors (timeout, rate limit) |
| `isNonceError(error)` | True for nonce-related errors |
| `isGasError(error)` | True for gas-related errors |

---

## Storage (`storage/`)

| Function | Description |
|----------|-------------|
| `createMemoryStorage()` | In-memory `StorageAdapter` (for testing or ephemeral use) |

**Storage key helpers** — all in `storage/keys.ts`:
`getPositionsKey`, `getSyncCheckpointKey`, `getClosedPositionsKey`, `getPositionMetaKey`, `getTrackedChunksKey`, `getPendingPositionsKey`, `getPoolMetaKey`, `getPoolPrefix`, `getSchemaVersionKey`

Key format: `panoptic-v2-sdk:v{VERSION}:chain{chainId}:pool{address}:{entity}:{id}`

---

## Low-level Clients (`clients/`)

| Function | Description |
|----------|-------------|
| `getBlockMeta(params)` | Get `{ blockNumber, blockTimestamp, blockHash }` for a block |
| `multicallRead(params)` | Batched multicall read via Multicall3 — guarantees same-block consistency |

---

## Key Types

```typescript
// Every read returns this for freshness tracking
interface BlockMeta { blockNumber: bigint; blockTimestamp: bigint; blockHash: `0x${string}` }

// Write results
interface TxResult { hash: `0x${string}`; wait(confirmations?: bigint): Promise<TxReceipt> }

// Simulation results (no gas spent)
type SimulationResult<T> =
  | { success: true; data: T; gasEstimate: bigint; _meta: BlockMeta }
  | { success: false; error: ParsedError; _meta: BlockMeta }

// TokenId builder (chainable)
createTokenIdBuilder(poolId)
  .addCall({ strike, width, optionRatio })
  .addPut({ strike, width, optionRatio })
  .build() // → bigint

// Storage adapter interface
interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}
```

---

## Constants (`utils/constants`)

| Constant | Value | Description |
|----------|-------|-------------|
| `WAD` | `10n ** 18n` | 1.0 in WAD scale |
| `MIN_TICK` | `-887272n` | Uniswap V3 min tick |
| `MAX_TICK` | `887272n` | Uniswap V3 max tick |
| `BPS_DENOMINATOR` | `10000n` | Basis points denominator |
| `UTILIZATION_DENOMINATOR` | `10000000000n` | Utilization denominator |
| `MAX_TRACKED_CHUNKS` | `1000n` | Max chunks per pool before `ChunkLimitError` |
| `REORG_DEPTH` | `64n` | Block reorg safety depth |
