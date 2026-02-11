# Panoptic v2 SDK Implementation Plan

## Overview

This document contains the implementation plan for the `@panoptic/sdk` (Panoptic v2 SDK) MVP, following the spec.md specification.

**Decision Log:**
- PanopticHelper-dependent functions: Stub with `PanopticHelperNotDeployedError` (no client-side fallbacks)
- TokenId encoding: Fresh implementation in `src/tokenId/` (not refactoring existing code)
- Build output: ESM only

---

## Phase 0: Plan

### 1) Repository Layout

```
packages/sdk/
├── src/
│   ├── index.ts                     # Main entry point (public exports)
│   ├── generated.ts                 # wagmi-generated ABIs (from codegen:wagmi)
│   │
│   ├── config/
│   │   ├── index.ts
│   │   ├── createConfig.ts          # Config factory with deep freeze
│   │   ├── updateConfig.ts          # Dynamic config updates
│   │   ├── addresses.ts             # Bundled chain addresses
│   │   └── types.ts                 # PanopticConfig, WriteConfig interfaces
│   │
│   ├── core/
│   │   ├── index.ts
│   │   ├── publicClient.ts          # viem publicClient construction
│   │   ├── multicall.ts             # Multicall3 wrapper with _meta
│   │   ├── retry.ts                 # RPC retry wrapper
│   │   └── contracts.ts             # Contract instance helpers
│   │
│   ├── reads/
│   │   ├── index.ts
│   │   ├── pool.ts                  # getPool(), getCurrentUtilization()
│   │   ├── oracle.ts                # getOracleState()
│   │   ├── safeMode.ts              # getSafeMode()
│   │   ├── riskParams.ts            # getRiskParameters()
│   │   ├── rates.ts                 # getCurrentRates()
│   │   ├── position.ts              # getPosition(), getPositions()
│   │   ├── accountCollateral.ts     # getAccountCollateral()
│   │   ├── accountSummary.ts        # getAccountSummaryBasic(), getAccountSummaryRisk()
│   │   ├── liquidation.ts           # getLiquidationPrices(), isLiquidatable()
│   │   ├── greeks.ts                # getPositionGreeks(), getAccountGreeks()
│   │   ├── collateralEstimate.ts    # estimateCollateralRequired(), getMaxPositionSize()
│   │   ├── checks.ts                # checkApproval(), isLiquidatable()
│   │   └── erc4626.ts               # preview*, convertTo* functions
│   │
│   ├── writes/
│   │   ├── index.ts
│   │   ├── approve.ts
│   │   ├── openPosition.ts
│   │   ├── closePosition.ts
│   │   ├── settle.ts                # settleAccumulatedPremia()
│   │   ├── forceExercise.ts
│   │   ├── liquidate.ts
│   │   ├── vault.ts                 # deposit, withdraw, mint, redeem
│   │   ├── pokeOracle.ts
│   │   ├── dispatch.ts              # Raw dispatch for power users
│   │   ├── broadcaster.ts           # TxBroadcaster interface + publicBroadcaster
│   │   └── nonceManager.ts          # createNonceManager()
│   │
│   ├── simulations/
│   │   ├── index.ts
│   │   ├── simulateOpenPosition.ts
│   │   ├── simulateClosePosition.ts
│   │   ├── simulateForceExercise.ts
│   │   ├── simulateLiquidate.ts
│   │   ├── simulateSettle.ts
│   │   ├── simulateVault.ts         # deposit/withdraw/mint/redeem
│   │   └── simulateDispatch.ts
│   │
│   ├── sync/
│   │   ├── index.ts
│   │   ├── syncPositions.ts         # Main sync entry point
│   │   ├── snapshotRecovery.ts      # Snapshot from dispatch() calldata
│   │   ├── eventReconstruction.ts   # Full event scanning fallback
│   │   ├── reorgHandling.ts         # Block hash verification
│   │   ├── chunks.ts                # Chunk tracking: add/remove/get/scan
│   │   └── tradeHistory.ts          # Closed positions & realized PnL
│   │
│   ├── events/
│   │   ├── index.ts
│   │   ├── watchEvents.ts           # Simple WebSocket watching
│   │   ├── subscription.ts          # createEventSubscription() resilient
│   │   └── poller.ts                # createEventPoller() HTTP alternative
│   │
│   ├── tokenId/
│   │   ├── index.ts
│   │   ├── builder.ts               # createTokenIdBuilder()
│   │   ├── decode.ts                # decodeTokenId()
│   │   ├── encoding.ts              # Low-level bit manipulation
│   │   └── constants.ts             # STANDARD_TICK_WIDTHS, etc.
│   │
│   ├── greeks/
│   │   ├── index.ts
│   │   ├── value.ts                 # getLegValue() - client-side
│   │   ├── delta.ts                 # getLegDelta() - client-side
│   │   ├── gamma.ts                 # getLegGamma() - client-side
│   │   └── definedRisk.ts           # isDefinedRisk()
│   │
│   ├── formatters/
│   │   ├── index.ts
│   │   ├── tick.ts                  # tickToPrice, priceToTick, tickToPriceDecimalScaled
│   │   ├── amount.ts                # formatTokenAmount, parseTokenAmount
│   │   ├── percentage.ts            # formatBps, formatUtilization
│   │   ├── wad.ts                   # formatWad
│   │   ├── tokenList.ts             # getTokenListId()
│   │   └── poolFormatters.ts        # createPoolFormatters()
│   │
│   ├── storage/
│   │   ├── index.ts
│   │   ├── adapter.ts               # StorageAdapter interface
│   │   ├── fileStorage.ts           # createFileStorage()
│   │   ├── memoryStorage.ts         # createMemoryStorage()
│   │   ├── keys.ts                  # Storage key generation
│   │   └── serializer.ts            # jsonSerializer (BigInt-safe)
│   │
│   ├── errors/
│   │   ├── index.ts
│   │   ├── base.ts                  # PanopticError base class
│   │   ├── contract.ts              # Contract errors (from Errors.sol)
│   │   ├── sdk.ts                   # SDK-specific errors
│   │   └── parser.ts                # parsePanopticError()
│   │
│   ├── react/
│   │   ├── index.ts
│   │   ├── queryKeys.ts             # queryKeys object
│   │   └── mutationEffects.ts       # mutationEffects map
│   │
│   ├── bot/
│   │   ├── index.ts
│   │   ├── assertions.ts            # assertFresh, assertHealthy, assertTradeable
│   │   └── retryable.ts             # isRetryableRpcError()
│   │
│   ├── types/
│   │   ├── index.ts
│   │   ├── pool.ts                  # Pool, PoolHealthStatus
│   │   ├── position.ts              # Position, TokenIdLeg, PositionGreeks
│   │   ├── account.ts               # AccountCollateral, AccountSummaryBasic, AccountSummaryRisk
│   │   ├── oracle.ts                # OracleState, SafeModeState
│   │   ├── tx.ts                    # TxResult, TxReceipt, TxBroadcaster
│   │   ├── simulation.ts            # SimulationResult variants
│   │   ├── events.ts                # PanopticEvent, LegUpdate
│   │   ├── chunks.ts                # ChunkSpread, ChunkKey
│   │   ├── sync.ts                  # SyncState, SyncStatus
│   │   ├── branded.ts               # UnderlyingToken, CollateralShare, PositionToken
│   │   └── meta.ts                  # BlockMeta interface
│   │
│   └── utils/
│       ├── index.ts
│       ├── deepFreeze.ts            # Deep freeze utility
│       └── constants.ts             # WAD, ZERO_COLLATERAL, ZERO_VALUATION
│
├── test/
│   ├── setup.ts                     # Vitest setup
│   ├── utils/
│   │   ├── anvil.ts                 # Anvil fork helpers
│   │   └── fixtures.ts              # Test fixtures
│   ├── unit/
│   │   ├── config.test.ts
│   │   ├── tokenId.test.ts
│   │   ├── encoding.test.ts
│   │   ├── formatters.test.ts
│   │   ├── storage.test.ts
│   │   ├── errors.test.ts
│   │   └── greeks.test.ts
│   └── fork/
│       ├── pool.test.ts
│       ├── positions.test.ts
│       └── greeks.test.ts
│
├── examples/
│   ├── market-maker/                # Continuous position management
│   ├── delta-hedge/                 # Delta-neutral portfolio
│   └── analytics-dashboard/         # React TanStack Query demo
│
├── contracts/                       # Synced from panoptic-next-core-private-post-vuln
│   ├── sync-metadata.json
│   └── ... (Solidity files for reference)
│
├── package.json
├── tsconfig.json
├── tsdown.config.ts                 # Build config (ESM + types)
├── vitest.config.ts
├── wagmi.config.ts                  # ABI generation config
└── setup-tests.ts
```

---

### 2) Module Map (Matching Spec)

| Spec Section | Implementation Module(s) |
|--------------|-------------------------|
| Configuration | `src/config/` |
| Storage Adapter | `src/storage/` |
| Pool reads | `src/reads/pool.ts` |
| Position tracking | `src/sync/` |
| Position reads | `src/reads/position.ts` |
| Account reads | `src/reads/accountCollateral.ts`, `src/reads/accountSummary.ts` |
| Oracle & Safe Mode | `src/reads/oracle.ts`, `src/reads/safeMode.ts` |
| Risk & Rates | `src/reads/riskParams.ts`, `src/reads/rates.ts` |
| Collateral estimation | `src/reads/collateralEstimate.ts` |
| Greeks | `src/greeks/` (client-side), `src/reads/greeks.ts` (PanopticHelper) |
| TokenId utilities | `src/tokenId/` |
| Write operations | `src/writes/` |
| Simulations | `src/simulations/` |
| Events | `src/events/` |
| Error handling | `src/errors/` |
| Formatters | `src/formatters/` |
| React integration | `src/react/` |
| Bot utilities | `src/bot/` |

---

### 3) Public API Surface (Index Exports)

```typescript
// src/index.ts exports

// ─── Config ───
export { createConfig, updateConfig } from './config'
export type { PanopticConfig, WriteConfig, HealthThresholds } from './config'

// ─── Storage ───
export { createFileStorage, createMemoryStorage } from './storage'
export type { StorageAdapter } from './storage'
export { clearCache } from './sync'

// ─── Read Functions ───
export { getPool, getCurrentUtilization } from './reads/pool'
export { getOracleState } from './reads/oracle'
export { getSafeMode } from './reads/safeMode'
export { getRiskParameters } from './reads/riskParams'
export { getCurrentRates } from './reads/rates'
export { getPosition, getPositions } from './reads/position'
export { getAccountCollateral } from './reads/accountCollateral'
export { getAccountSummaryBasic, getAccountSummaryRisk } from './reads/accountSummary'
export { getLiquidationPrices, isLiquidatable } from './reads/liquidation'
export { getPositionGreeks, getAccountGreeks } from './reads/greeks'
export { estimateCollateralRequired, getMaxPositionSize } from './reads/collateralEstimate'
export { checkApproval, isLiquidatable } from './reads/checks'
export {
  previewDeposit, previewWithdraw, previewMint, previewRedeem,
  convertToShares, convertToAssets
} from './reads/erc4626'

// ─── Position Tracking ───
export { syncPositions, getSyncStatus, getTrackedPositionIds } from './sync'
export { getClosedPositions, getPositionHistory, getTradeHistory, getRealizedPnL } from './sync/tradeHistory'
export { addTrackedChunks, removeTrackedChunks, getChunkSpreads, scanChunks } from './sync/chunks'

// ─── Write Functions ───
export { approve } from './writes/approve'
export { openPosition, openPositionAndWait } from './writes/openPosition'
export { closePosition, closePositionAndWait } from './writes/closePosition'
export { settleAccumulatedPremia } from './writes/settle'
export { forceExercise, forceExerciseAndWait } from './writes/forceExercise'
export { liquidate, liquidateAndWait } from './writes/liquidate'
export {
  deposit, depositAndWait, withdraw, withdrawAndWait,
  mint, mintAndWait, redeem, redeemAndWait
} from './writes/vault'
export { pokeOracle } from './writes/pokeOracle'
export { dispatch, dispatchAndWait } from './writes/dispatch'
export { publicBroadcaster, createNonceManager } from './writes/broadcaster'
export type { TxBroadcaster, NonceManager } from './writes/broadcaster'

// ─── Simulations ───
export { simulateOpenPosition } from './simulations/simulateOpenPosition'
export { simulateClosePosition } from './simulations/simulateClosePosition'
export { simulateForceExercise } from './simulations/simulateForceExercise'
export { simulateLiquidate } from './simulations/simulateLiquidate'
export { simulateSettle } from './simulations/simulateSettle'
export { simulateDeposit, simulateWithdraw } from './simulations/simulateVault'
export { simulateDispatch } from './simulations/simulateDispatch'

// ─── Events ───
export { watchEvents } from './events/watchEvents'
export { createEventSubscription } from './events/subscription'
export { createEventPoller } from './events/poller'

// ─── TokenId ───
export { createTokenIdBuilder, decodeTokenId } from './tokenId'
export { STANDARD_TICK_WIDTHS } from './tokenId/constants'

// ─── Client-side Greeks ───
export { getLegValue, getLegDelta, getLegGamma, isDefinedRisk } from './greeks'

// ─── Formatters ───
export {
  tickToPrice, tickToPriceDecimalScaled, priceToTick,
  formatTokenAmount, parseTokenAmount,
  formatBps, formatUtilization, formatWad,
  getTokenListId, createPoolFormatters
} from './formatters'
export type { PoolFormatters } from './formatters'

// ─── Serialization ───
export { jsonSerializer } from './storage/serializer'

// ─── Error Handling ───
export { parsePanopticError } from './errors/parser'
export type { UIError } from './errors/parser'
export { PanopticError } from './errors/base'
export * from './errors/contract'  // All contract error classes
export * from './errors/sdk'       // All SDK-specific error classes

// ─── React Integration ───
export { queryKeys, mutationEffects } from './react'

// ─── Bot Utilities ───
export { assertFresh, assertHealthy, assertTradeable } from './bot/assertions'
export { isRetryableRpcError } from './bot/retryable'

// ─── Constants ───
export { WAD, ZERO_COLLATERAL, ZERO_VALUATION } from './utils/constants'

// ─── Types ───
export type {
  Pool, PoolHealthStatus,
  Position, TokenIdLeg, PositionGreeks, LegGreeksParams,
  AccountCollateral, AccountSummaryBasic, AccountSummaryRisk,
  OracleState, SafeModeState, RiskParameters, CurrentRates,
  CollateralTracker, RiskEngine,
  Utilization, CollateralEstimate, MintCommission, BurnCommission,
  LiquidationPrices, ExercisableCheck, NetLiquidationValue,
  SyncState, SyncStatus, SyncEvent,
  TxResult, TxReceipt,
  SimulationResult, OpenPositionSimulation, ClosePositionSimulation,
  ForceExerciseSimulation, LiquidateSimulation, SettleSimulation,
  DepositSimulation, WithdrawSimulation, DispatchSimulation,
  PanopticEvent, PanopticEventType, LegUpdate, EventSubscription,
  ChunkSpread, ChunkKey, Timescale,
  ClosedPosition, RealizedPnL,
  UnderlyingToken, CollateralShare, PositionToken,
  TokenIdBuilder, DispatchCall,
} from './types'
```

---

### 4) Error Taxonomy

#### Contract Errors (from `Errors.sol`)

| Error Name | Parameters | Source |
|------------|------------|--------|
| `AccountInsolventError` | `solvent: bigint, numberOfTicks: bigint` | `Errors.sol:9` |
| `CastingError` | - | `Errors.sol:13` |
| `BelowMinimumRedemptionError` | - | `Errors.sol:16` |
| `ChunkHasZeroLiquidityError` | - | `Errors.sol:19` |
| `AlreadyInitializedError` | - | `Errors.sol:22` |
| `DepositTooLargeError` | - | `Errors.sol:25` |
| `DuplicateTokenIdError` | - | `Errors.sol:28` |
| `EffectiveLiquidityAboveThresholdError` | - | `Errors.sol:32` |
| `ExceedsMaximumRedemptionError` | - | `Errors.sol:35` |
| `InputListFailError` | - | `Errors.sol:38` |
| `InvalidTickError` | - | `Errors.sol:41` |
| `LiquidityTooHighError` | - | `Errors.sol:44` |
| `InsufficientCreditLiquidityError` | - | `Errors.sol:47` |
| `InvalidBuilderCodeError` | - | `Errors.sol:50` |
| `InvalidTokenIdParameterError` | `parameterType: bigint` | `Errors.sol:54` |
| `InvalidUniswapCallbackError` | - | `Errors.sol:57` |
| `LengthMismatchError` | - | `Errors.sol:60` |
| `NetLiquidityZeroError` | - | `Errors.sol:63` |
| `NoLegsExercisableError` | - | `Errors.sol:66` |
| `NotALongLegError` | - | `Errors.sol:69` |
| `NotBuilderError` | - | `Errors.sol:72` |
| `NotEnoughLiquidityInChunkError` | - | `Errors.sol:75` |
| `NotEnoughTokensError` | `tokenAddress: Address, assetsRequested: bigint, assetBalance: bigint` | `Errors.sol:78` |
| `NotGuardianError` | - | `Errors.sol:81` |
| `NotMarginCalledError` | - | `Errors.sol:84` |
| `NotPanopticPoolError` | - | `Errors.sol:87` |
| `PoolNotInitializedError` | - | `Errors.sol:90` |
| `PositionCountNotZeroError` | - | `Errors.sol:93` |
| `PositionNotOwnedError` | - | `Errors.sol:96` |
| `PositionTooLargeError` | - | `Errors.sol:99` |
| `PriceBoundFailError` | `currentTick: bigint` | `Errors.sol:102` |
| `PriceImpactTooLargeError` | - | `Errors.sol:105` |
| `StaleOracleError` | - | `Errors.sol:109` |
| `TooManyLegsOpenError` | - | `Errors.sol:112` |
| `TransferFailedError` | `token: Address, from: Address, amount: bigint, balance: bigint` | `Errors.sol:115` |
| `InvalidTickBoundError` | - | `Errors.sol:120` |
| `UnauthorizedUniswapCallbackError` | - | `Errors.sol:123` |
| `UnderOverFlowError` | - | `Errors.sol:126` |
| `ReentrancyError` | - | `Errors.sol:129` |
| `WrongPoolIdError` | - | `Errors.sol:132` |
| `WrongUniswapPoolError` | - | `Errors.sol:135` |
| `ZeroAddressError` | - | `Errors.sol:138` |
| `ZeroCollateralRequirementError` | - | `Errors.sol:141` |
| `TokenIdHasZeroLegsError` | - | `Errors.sol:144` |

#### SDK-Specific Errors

| Error Name | Parameters | Description |
|------------|------------|-------------|
| `SafeModeError` | `level: SafeMode, reason: string` | Pool safe mode restrictions |
| `CrossPoolError` | `requestedPool: Address, configuredPool: Address` | Cross-pool mismatch |
| `SyncTimeoutError` | `elapsedMs: bigint, blocksProcessed: bigint, blocksRemaining: bigint` | Sync timeout |
| `PositionSnapshotNotFoundError` | - | Snapshot recovery failed |
| `ChunkLimitError` | - | Exceeded 1000 chunk limit |
| `NetworkMismatchError` | `walletChainId: bigint, expectedChainId: bigint` | Wallet on wrong network |
| `ProviderLagError` | - | Provider behind minBlockNumber |
| `StaleDataError` | `blockTimestamp: bigint, currentTimestamp: bigint, stalenessSeconds: bigint` | Data too old |
| `UnhealthyPoolError` | `healthStatus: PoolHealthStatus` | Pool in degraded state |
| `OracleRateLimitedError` | - | Cannot poke oracle (< 64s since last) |
| `PanopticHelperNotDeployedError` | - | Helper contract not available |

---

### 5) Storage Schema + Key Format

#### Schema Version
```
SCHEMA_VERSION = 1
```

#### Key Format
```
panoptic-v2-sdk:v{VERSION}:chain{chainId}:pool{poolAddress}:{entity}:{id}
```

#### Storage Keys

| Entity | Key Pattern | Value Type |
|--------|-------------|------------|
| Schema version | `panoptic-v2-sdk:schemaVersion` | `number` |
| Tracked position IDs | `panoptic-v2-sdk:v1:chain{chainId}:pool{poolAddress}:positions:{account}` | `bigint[]` |
| Position mint metadata | `panoptic-v2-sdk:v1:chain{chainId}:pool{poolAddress}:positionMeta:{tokenId}` | `{ tickAtMint, timestampAtMint, blockNumberAtMint }` |
| Sync checkpoint | `panoptic-v2-sdk:v1:chain{chainId}:pool{poolAddress}:sync:{account}` | `{ lastBlock, blockHash, timestamp }` |
| Closed positions | `panoptic-v2-sdk:v1:chain{chainId}:pool{poolAddress}:closed:{account}` | `ClosedPosition[]` |
| Tracked chunks | `panoptic-v2-sdk:v1:chain{chainId}:pool{poolAddress}:chunks` | `ChunkKey[]` |
| Pending positions | `panoptic-v2-sdk:v1:chain{chainId}:pool{poolAddress}:pending:{account}` | `bigint[]` |

#### Schema Migration
- On mismatch: Clear all storage for the pool (MVP behavior)
- Future: Call `migrate()` hook

---

### 6) Multicall Strategy

Per spec.md §Implementation Constraints → Multicall & Block Consistency:

#### Same-Block Guarantee
- All aggregate reads collected in ONE `Multicall3` `eth_call`
- Returns `blockNumber` from multicall
- Additional `eth_getBlockByNumber` call to get `blockTimestamp` and `blockHash`

#### _meta Field Structure
```typescript
interface BlockMeta {
  blockNumber: bigint
  blockTimestamp: bigint      // Unix seconds
  blockHash: `0x${string}`
}
```

#### Multicall Wrapper
```typescript
async function multicallWithMeta<T>(
  publicClient: PublicClient,
  calls: MulticallCall[]
): Promise<{ results: T, _meta: BlockMeta }>
```

#### Exception: Static Prefetches
- Token decimals, symbols, pool tickSpacing fetched separately
- Cached permanently (immutable)
- Not subject to same-block consistency

#### Gas Estimation
- Separate `eth_estimateGas` call
- Cannot be bundled in multicall
- May have different `blockNumber` (documented in `_meta` if needed)

---

### 7) Event Sync Strategy

Per spec.md §Position Tracking:

#### Primary: Snapshot Recovery
1. Find last `dispatch()` transaction for account
2. Decode calldata → extract `finalPositionIdList`
3. Bootstrap position set without full event scan

#### Fallback: Full Event Reconstruction
1. Scan `OptionMinted` events from deployment/genesis
2. Scan `OptionBurnt` events
3. Build position set from event history

#### Log Query Chunking
- `maxLogsPerQuery` parameter (default: 10000)
- Chunk large block ranges to avoid RPC limits
- Resume from checkpoint on failure

#### Reorg Handling
- Store `blockHash` at sync checkpoint
- Verify continuity on next sync
- On mismatch: rollback 128 blocks, re-sync

#### Provider Lag Handling
- Accept `minBlockNumber` option
- Throw `ProviderLagError` if provider behind

#### Optimistic Updates
- Inject pending position on `openPosition()` success
- Remove on confirmed `OptionBurnt` event
- Shadow positions flagged as `{ pending: true }`

#### Sync Progress
```typescript
interface SyncState {
  lastSyncedBlock: bigint
  lastSyncedBlockHash: `0x${string}`
  positionCount: bigint
  pendingCount: bigint
}
```

---

### 8) Write Transaction Lifecycle

Per spec.md §Transaction Lifecycle:

#### Split Flow Pattern
```typescript
interface TxResult {
  hash: `0x${string}`           // Available immediately
  wait: (confirmations?: bigint) => Promise<TxReceipt>
}

interface TxReceipt {
  hash: `0x${string}`
  blockNumber: bigint
  blockHash: `0x${string}`
  gasUsed: bigint
  status: 'success' | 'reverted'
  events: PanopticEvent[]
}
```

#### Preflight Checks (Before Signing)
1. **Network mismatch**: Throw `NetworkMismatchError` if wallet chain ≠ config chain
2. **Safe mode**: For `openPosition()`, check oracle state and enforce safe mode restrictions
3. **Required params**: `slippageBps` and `spreadLimitBps` required (no defaults)

#### *AndWait Variants
- Convenience wrapper: `const { wait } = await openPosition(...); return wait()`
- Returns `TxReceipt` directly

#### Private Transactions
- Pluggable `TxBroadcaster` interface
- Default: `publicBroadcaster` (standard mempool)
- Override per-config or per-call

#### Nonce Management
- `createNonceManager()` for concurrent writes
- Fill-or-kill semantics
- Manual `reset()` required after failures

---

### 9) Minimal Test Plan

#### Unit Tests (Vitest + Mocks)

| Module | Test Coverage |
|--------|--------------|
| `config/` | Config creation, deep freeze, address resolution |
| `tokenId/` | Encoding/decoding, builder patterns |
| `storage/` | Adapter operations, key generation, serialization |
| `formatters/` | All formatter functions with edge cases |
| `errors/` | Error construction, parsing |
| `greeks/` | Client-side formulas (value, delta, gamma) |
| `utils/` | deepFreeze, constants |

#### Fork Tests (Anvil)

| Test | Description |
|------|-------------|
| `pool.test.ts` | `getPool()` returns valid pool data |
| `positions.test.ts` | Open/close position lifecycle |
| `greeks.test.ts` | Client-side greeks match contract computation |
| `tokenId.test.ts` | Encoding round-trip matches contract |

#### CI Pipeline
- Unit tests: Every commit
- Fork tests: Every commit (critical paths only)

---

### 10) Definition of Done (MVP)

**Core Functionality:**
- [ ] `createConfig()` / `updateConfig()` with deep freeze
- [ ] All read functions per API Summary
- [ ] All write functions per API Summary
- [ ] All simulation functions per API Summary
- [ ] Event watching (simple + resilient + polling)
- [ ] Position sync with snapshot recovery + event fallback
- [ ] Chunk tracking (add/remove/get/scan)
- [ ] Trade history persistence

**Type Safety:**
- [ ] All numeric values are `bigint`
- [ ] No `any` types
- [ ] All errors are typed exceptions
- [ ] Full TypeScript strict mode compliance

**Testing:**
- [ ] Unit tests for all pure functions
- [ ] Fork tests for critical paths (open/close position)
- [ ] `tsc --noEmit` passes
- [ ] `vitest run` passes

**Documentation:**
- [ ] TSDoc on all public exports
- [ ] Three working examples

**Build:**
- [ ] ESM output
- [ ] TypeScript declarations
- [ ] Tree-shakeable exports

---

### 11) Feature Coverage Matrix

| Public Function | Implementation Module | Notes |
|-----------------|----------------------|-------|
| **Config** | | |
| `createConfig()` | `src/config/createConfig.ts` | |
| `updateConfig()` | `src/config/updateConfig.ts` | |
| **Storage** | | |
| `createFileStorage()` | `src/storage/fileStorage.ts` | Node.js only |
| `createMemoryStorage()` | `src/storage/memoryStorage.ts` | Testing |
| `clearCache()` | `src/sync/index.ts` | |
| **Pool Reads** | | |
| `getPool()` | `src/reads/pool.ts` | |
| `getCurrentUtilization()` | `src/reads/pool.ts` | |
| **Position Tracking** | | |
| `syncPositions()` | `src/sync/syncPositions.ts` | |
| `getSyncStatus()` | `src/sync/index.ts` | |
| `getTrackedPositionIds()` | `src/sync/index.ts` | |
| `getClosedPositions()` | `src/sync/tradeHistory.ts` | |
| `getPositionHistory()` | `src/sync/tradeHistory.ts` | |
| `getTradeHistory()` | `src/sync/tradeHistory.ts` | |
| `getRealizedPnL()` | `src/sync/tradeHistory.ts` | |
| **Position Reads** | | |
| `getPosition()` | `src/reads/position.ts` | |
| `getPositions()` | `src/reads/position.ts` | |
| **Chunk Tracking** | | |
| `addTrackedChunks()` | `src/sync/chunks.ts` | |
| `removeTrackedChunks()` | `src/sync/chunks.ts` | |
| `getChunkSpreads()` | `src/sync/chunks.ts` | |
| `scanChunks()` | `src/sync/chunks.ts` | PanopticHelper stub |
| **Account Reads** | | |
| `getAccountCollateral()` | `src/reads/accountCollateral.ts` | |
| `getAccountSummaryBasic()` | `src/reads/accountSummary.ts` | Aggregate base account data |
| `getAccountSummaryRisk()` | `src/reads/accountSummary.ts` | Aggregate risk + margin fields |
| `getNetLiquidationValue()` | `src/reads/liquidation.ts` | PanopticHelper stub |
| **Oracle & Safe Mode** | | |
| `getOracleState()` | `src/reads/oracle.ts` | |
| `getSafeMode()` | `src/reads/safeMode.ts` | |
| **Rates & Risk** | | |
| `getCurrentRates()` | `src/reads/rates.ts` | |
| `getRiskParameters()` | `src/reads/riskParams.ts` | |
| **Collateral** | | |
| `estimateCollateralRequired()` | `src/reads/collateralEstimate.ts` | PanopticHelper stub |
| `getMaxPositionSize()` | `src/reads/collateralEstimate.ts` | PanopticHelper stub |
| **Checks** | | |
| `checkApproval()` | `src/reads/checks.ts` | |
| `isLiquidatable()` | `src/reads/liquidation.ts` | |
| `getLiquidationPrices()` | `src/reads/liquidation.ts` | PanopticHelper stub |
| **ERC4626 Previews** | | |
| `previewDeposit()` | `src/reads/erc4626.ts` | |
| `previewWithdraw()` | `src/reads/erc4626.ts` | |
| `previewMint()` | `src/reads/erc4626.ts` | |
| `previewRedeem()` | `src/reads/erc4626.ts` | |
| `convertToShares()` | `src/reads/erc4626.ts` | |
| `convertToAssets()` | `src/reads/erc4626.ts` | |
| **TokenId** | | |
| `createTokenIdBuilder()` | `src/tokenId/builder.ts` | |
| `decodeTokenId()` | `src/tokenId/decode.ts` | |
| **Greeks** | | |
| `getPositionGreeks()` | `src/reads/greeks.ts` | PanopticHelper stub |
| `getAccountGreeks()` | `src/reads/greeks.ts` | PanopticHelper stub |
| `getLegValue()` | `src/greeks/value.ts` | Client-side |
| `getLegDelta()` | `src/greeks/delta.ts` | Client-side |
| `getLegGamma()` | `src/greeks/gamma.ts` | Client-side |
| `isDefinedRisk()` | `src/greeks/definedRisk.ts` | |
| **Formatters** | | |
| `tickToPrice()` | `src/formatters/tick.ts` | |
| `tickToPriceDecimalScaled()` | `src/formatters/tick.ts` | |
| `priceToTick()` | `src/formatters/tick.ts` | |
| `formatTokenAmount()` | `src/formatters/amount.ts` | |
| `parseTokenAmount()` | `src/formatters/amount.ts` | |
| `formatBps()` | `src/formatters/percentage.ts` | |
| `formatUtilization()` | `src/formatters/percentage.ts` | |
| `formatWad()` | `src/formatters/wad.ts` | |
| `getTokenListId()` | `src/formatters/tokenList.ts` | |
| `createPoolFormatters()` | `src/formatters/poolFormatters.ts` | |
| **Error Parsing** | | |
| `parsePanopticError()` | `src/errors/parser.ts` | |
| **Serialization** | | |
| `jsonSerializer.stringify()` | `src/storage/serializer.ts` | |
| `jsonSerializer.parse()` | `src/storage/serializer.ts` | |
| **Write Functions** | | |
| `approve()` | `src/writes/approve.ts` | |
| `openPosition()` | `src/writes/openPosition.ts` | |
| `openPositionAndWait()` | `src/writes/openPosition.ts` | |
| `closePosition()` | `src/writes/closePosition.ts` | |
| `closePositionAndWait()` | `src/writes/closePosition.ts` | |
| `settleAccumulatedPremia()` | `src/writes/settle.ts` | |
| `forceExercise()` | `src/writes/forceExercise.ts` | |
| `forceExerciseAndWait()` | `src/writes/forceExercise.ts` | |
| `liquidate()` | `src/writes/liquidate.ts` | |
| `liquidateAndWait()` | `src/writes/liquidate.ts` | |
| `deposit()` | `src/writes/vault.ts` | |
| `depositAndWait()` | `src/writes/vault.ts` | |
| `withdraw()` | `src/writes/vault.ts` | |
| `withdrawAndWait()` | `src/writes/vault.ts` | |
| `mint()` | `src/writes/vault.ts` | |
| `mintAndWait()` | `src/writes/vault.ts` | |
| `redeem()` | `src/writes/vault.ts` | |
| `redeemAndWait()` | `src/writes/vault.ts` | |
| `pokeOracle()` | `src/writes/pokeOracle.ts` | |
| `dispatch()` | `src/writes/dispatch.ts` | |
| `dispatchAndWait()` | `src/writes/dispatch.ts` | |
| **Bot Utilities** | | |
| `publicBroadcaster` | `src/writes/broadcaster.ts` | |
| `createNonceManager()` | `src/writes/nonceManager.ts` | |
| `assertFresh()` | `src/bot/assertions.ts` | |
| `assertHealthy()` | `src/bot/assertions.ts` | |
| `assertTradeable()` | `src/bot/assertions.ts` | |
| `isRetryableRpcError()` | `src/bot/retryable.ts` | |
| **Simulations** | | |
| `simulateOpenPosition()` | `src/simulations/simulateOpenPosition.ts` | |
| `simulateClosePosition()` | `src/simulations/simulateClosePosition.ts` | |
| `simulateForceExercise()` | `src/simulations/simulateForceExercise.ts` | |
| `simulateLiquidate()` | `src/simulations/simulateLiquidate.ts` | |
| `simulateSettle()` | `src/simulations/simulateSettle.ts` | |
| `simulateDeposit()` | `src/simulations/simulateVault.ts` | |
| `simulateWithdraw()` | `src/simulations/simulateVault.ts` | |
| `simulateDispatch()` | `src/simulations/simulateDispatch.ts` | |
| **Events** | | |
| `watchEvents()` | `src/events/watchEvents.ts` | |
| `createEventSubscription()` | `src/events/subscription.ts` | |
| `createEventPoller()` | `src/events/poller.ts` | |
| **React** | | |
| `queryKeys` | `src/react/queryKeys.ts` | |
| `mutationEffects` | `src/react/mutationEffects.ts` | |

---

### 12) RPC Capability Assumptions

| Capability | Assumption | Rationale |
|------------|------------|-----------|
| `maxBlockRange` for `getLogs` | 10,000 blocks | Conservative default; most public RPCs support this |
| Archive node | **NOT required** | Only recent blocks needed for sync |
| `eth_getLogs` | Required | Position tracking via events |
| `eth_call` with `Multicall3` | Required | Block-consistent reads |
| `eth_getBlockByNumber` | Required | Get blockTimestamp/blockHash |
| `eth_estimateGas` | Required | Transaction simulation |
| `eth_sendRawTransaction` | Required (write mode) | Transaction submission |
| WebSocket | Optional | Required only for `watchEvents()` / `createEventSubscription()` |
| Rate limits | Configurable via `config.rpc` | Retry with exponential backoff |

---

## Bit Layout Summary (Extracted from Contracts)

### TokenId (from `contracts/types/TokenId.sol`)
```
Total: 256 bits

Bits 0-63 (64 bits): poolId
  - Bits 0-39: Pool address (5 bytes, little-endian)
  - Bits 40-47: vegoid (8 bits)
  - Bits 48-63: tickSpacing (16 bits)

Bits 64-255 (192 bits): 4 legs × 48 bits each
  Per leg (48 bits):
  - Bit 0: asset (1 bit)
  - Bits 1-7: optionRatio (7 bits)
  - Bit 8: isLong (1 bit)
  - Bit 9: tokenType (1 bit)
  - Bits 10-11: riskPartner (2 bits)
  - Bits 12-35: strike (24 bits, signed)
  - Bits 36-47: width (12 bits)
```

### PositionBalance (from `contracts/types/PositionBalance.sol`)
```
Total: 256 bits

Bits 0-127: positionSize (uint128)
Bits 128-143: poolUtilization0 (uint16)
Bits 144-159: poolUtilization1 (uint16)
Bits 160-183: tickAtMint (int24)
Bits 184-215: timestampAtMint (uint32)
Bits 216-255: blockAtMint (uint40)
```

### OraclePack (from `contracts/types/OraclePack.sol`)
```
Total: 256 bits

Bits 0-11: residual0 (12 bits)
Bits 12-23: residual1 (12 bits)
Bits 24-35: residual2 (12 bits)
Bits 36-47: residual3 (12 bits)
Bits 48-59: residual4 (12 bits)
Bits 60-71: residual5 (12 bits)
Bits 72-83: residual6 (12 bits)
Bits 84-95: residual7 (12 bits)
Bits 96-117: referenceTick (22 bits)
Bits 118-119: lockMode (2 bits)
Bits 120-141: eonsEMA (22 bits)
Bits 142-163: slowEMA (22 bits)
Bits 164-185: fastEMA (22 bits)
Bits 186-207: spotEMA (22 bits)
Bits 208-231: orderMap (24 bits)
Bits 232-255: epoch (24 bits)
```

### LiquidityChunk (from `contracts/types/LiquidityChunk.sol`)
```
Total: 256 bits

Bits 0-127: liquidity (uint128)
Bits 128-207: zeros (80 bits padding)
Bits 208-231: tickUpper (int24)
Bits 232-255: tickLower (int24)
```

### LeftRight (from `contracts/types/LeftRight.sol`)
```
Total: 256 bits (or 128 bits)

Right slot (bits 0-127): token0 value
Left slot (bits 128-255): token1 value
```

---

## Context Handoff Block

```
=== CONTEXT HANDOFF (Phase 0 → Phase 1) ===
Architecture: Flat function API, viem-native, persistent storage via adapter, single multicall for consistency
Modules completed: None (planning phase)
Next phase focus: Project skeleton, test harness, types/interfaces, storage adapters, error classes, jsonSerializer
Critical invariants to maintain:
  1. All numeric values are bigint (no number/string)
  2. No memoization of dynamic RPC data across calls
  3. Same-block guarantee via single Multicall3 eth_call
  4. Deep freeze on config objects
  5. All errors must throw typed PanopticError exceptions
===
```

```
  === CONTEXT HANDOFF (Phase 3b Fork Tests → Remaining Phase 3b) ===

  Completed: Fork test infrastructure + example fork tests (9 files, 24 skipped tests)
  Location: src/panoptic/v2/examples/__tests__/

  Files created:
    Infrastructure:
    - anvil.config.ts (fork configuration: block 24,297,000, test accounts, fixtures)
    - setup.ts (utilities: createForkClients, funding, snapshots, time control)
    - setup.test.ts (11 passing tests for infrastructure)
    - vitest.config.fork.ts (fork test configuration)
    - README.md (comprehensive documentation)

    Fork Tests (all skipped, awaiting deployment):
    - basic/01-simple-read.fork.test.ts (getPool, getOracleState, getAccountCollateral)
    - basic/02-open-position.fork.test.ts (TokenId builder, simulation, openPosition)
    - oracle-poker/integration.fork.test.ts (monitoring, poking, end-to-end workflow)

  Test status: 288 total (264 passing, 24 skipped)
  - Fork tests properly discovered and skipped with describe.skip
  - Ready to enable by removing .skip and setting TEST_POOL_ADDRESS

  Fork test patterns established:
    1. Setup with snapshots for test isolation
    2. Fund accounts with setupTestAccounts()
    3. Time manipulation with increaseTime()
    4. Block metadata verification
    5. Both success and failure scenarios
    6. End-to-end bot workflows

  Remaining Phase 3b work (as of this handoff):
    - Liquidation bot example (pending) → ✅ completed in 9b76fe26
    - Market maker bot example (pending)
    - Analytics dashboard example (pending)
    - Sepolia fork tests (pending) → ✅ completed in 31be88f3

  Next step: See latest context handoff for current status

  Critical invariants maintained:
    1. All numeric values are bigint
    2. Same-block guarantee via single Multicall3 eth_call
    3. Typed errors (PanopticError subclasses)
    4. No memoization of dynamic RPC data
    5. Fork tests use realistic mainnet state
  ===
```

---

## Phase 1: Skeleton + Test Harness

**Status**: ✅ COMPLETED

**Deliverables:**
- [x] Run `pnpm codegen:wagmi` to generate typed ABIs → `src/generated.ts`
- [x] Vitest configured, tests run with `pnpm vitest run src/panoptic/v2`
- [x] Types/interfaces per spec.md in `src/panoptic/v2/types/`
- [x] StorageAdapter with schema versioning in `src/panoptic/v2/storage/`
- [x] `createFileStorage`/`createMemoryStorage` implemented
- [x] `jsonSerializer` (BigInt tagging) fully implemented
- [x] Error base classes + all 35 contract errors + 11 SDK errors
- [x] `react/queryKeys` + `mutationEffects` implemented
- [x] `deepFreeze` utility for config immutability
- [x] Constants (WAD, MIN_TICK, MAX_TICK, etc.)

**Test Count**: 160 tests passing

**Files Created** (35 files):
- `utils/deepFreeze.ts`, `constants.ts`
- `errors/base.ts`, `contract.ts`, `sdk.ts`
- `storage/adapter.ts`, `keys.ts`, `serializer.ts`, `memoryStorage.ts`, `fileStorage.ts`
- `react/queryKeys.ts`, `mutationEffects.ts`
- `types/` (11 type definition files)

---

## Phase 2: Core Read Functions

**Status**: ✅ COMPLETED

**Deliverables:**
- [x] Client utilities: `getBlockMeta`, `multicallRead` for same-block consistency
- [x] Pool reads: `getPool`, `getUtilization`, `getOracleState`, `getRiskParameters`
- [x] Position reads: `getPosition`, `getPositions`, `getPositionGreeks` (stubs with PanopticHelperNotDeployedError)
- [x] Account reads: `getAccountCollateral`, `getAccountSummaryBasic`, `getAccountSummaryRisk`, `getNetLiquidationValue`, `getLiquidationPrices`
- [x] Collateral reads: `getCollateralData`, `getCurrentRates`
- [x] All functions return `_meta: BlockMeta` for freshness checks
- [x] Functions requiring PanopticHelper accept optional `helperAddress` parameter

**Test Count**: 188 tests passing (+28 new)

**Files Created** (11 files):
- `clients/blockMeta.ts`, `multicall.ts`, `index.ts`, `clients.test.ts`
- `reads/pool.ts`, `position.ts`, `account.ts`, `collateral.ts`, `index.ts`, `reads.test.ts`

---

## Phase 3: Write Functions + Simulation

**Status**: ✅ COMPLETED

**Deliverables:**
- [x] TokenId builder: `createTokenIdBuilder()`, `createTokenIdBuilderV4()`, `decodeTokenId()`
- [x] TokenId encoding utilities: `encodePoolId()`, `encodeLeg()`, strike conversion, etc.
- [x] TokenId constants: `STANDARD_TICK_WIDTHS`, `TOKEN_ID_BITS`, `LEG_BITS`, `LEG_LIMITS`
- [x] Write functions:
  - [x] `approve()`, `approveAndWait()`, `approvePool()`, `checkApproval()`
  - [x] `deposit()`, `withdraw()`, `mint()`, `redeem()` + AndWait variants
  - [x] `withdrawWithPositions()` - Withdrawal with position validation
  - [x] `openPosition()`, `openPositionAndWait()` - Open new positions
  - [x] `closePosition()`, `closePositionAndWait()` - Close positions
  - [x] `rollPosition()`, `rollPositionAndWait()` - Roll positions atomically
  - [x] `forceExercise()`, `forceExerciseAndWait()` - Force exercise ITM positions
  - [x] `liquidate()`, `liquidateAndWait()` - Liquidate undercollateralized accounts
  - [x] `settleAccumulatedPremia()`, `settleAccumulatedPremiaAndWait()` - Settle premia
  - [x] `pokeOracle()`, `pokeOracleAndWait()` - Update oracle
  - [x] `dispatch()`, `dispatchAndWait()` - Raw multi-operation
- [x] Transaction lifecycle: `TxResult` with `wait()` returning `TxReceipt`
- [x] Event parsing: `parsePanopticEvents()` for all event types
- [x] Nonce management: `createNonceManager()` for concurrent transactions
- [x] Simulation functions:
  - [x] `simulateOpenPosition()`
  - [x] `simulateClosePosition()`
  - [x] `simulateDeposit()`, `simulateWithdraw()`
  - [x] `simulateForceExercise()`
  - [x] `simulateLiquidate()`
  - [x] `simulateSettle()`
  - [x] `simulateDispatch()`

**Test Count**: 243 tests passing (+55 new)

**Files Created** (21 files):
- `tokenId/constants.ts`, `encoding.ts`, `builder.ts`, `decode.ts`, `index.ts`, `tokenId.test.ts`
- `writes/broadcaster.ts`, `utils.ts`, `approve.ts`, `vault.ts`, `position.ts`, `dispatch.ts`, `liquidate.ts`, `forceExercise.ts`, `settle.ts`, `pokeOracle.ts`, `index.ts`, `writes.test.ts`
- `simulations/simulateOpenPosition.ts`, `simulateClosePosition.ts`, `simulateVault.ts`, `simulateLiquidate.ts`, `simulateForceExercise.ts`, `simulateSettle.ts`, `simulateDispatch.ts`, `index.ts`, `simulations.test.ts`

**Phase 3 Final Update (2026-01-21):**
- [x] Added missing error parser exports to `index.ts`: `parsePanopticError()`, `isPanopticErrorType()`, `ParsedError` type
- [x] All 251 tests passing
- [x] TypeScript compilation clean
- [x] All Phase 3 deliverables complete

---

## Context Handoff Block (Phase 3 → Phase 3b)

```
=== CONTEXT HANDOFF (Phase 3 → Phase 3b) ===

Completed modules (85 files, 251 tests):
  - types/         : All type definitions (Pool, Position, Account, Events, Sync, Chunks, etc.)
  - errors/        : PanopticError base + 35 contract errors + 12 SDK errors
  - storage/       : StorageAdapter interface + memory/file implementations + jsonSerializer
  - utils/         : deepFreeze, constants (WAD, MIN_TICK, MAX_TICK, REORG_DEPTH, etc.)
  - react/         : queryKeys + mutationEffects for TanStack Query integration
  - clients/       : getBlockMeta, multicallRead for same-block consistency
  - reads/         : getPool, getPosition(s), getAccountCollateral, getAccountSummaryBasic/Risk, etc.
  - tokenId/       : createTokenIdBuilder, decodeTokenId, encoding utilities, constants
  - writes/        : All write functions with AndWait variants, TxResult pattern, event parsing
  - simulations/   : All simulate* functions returning SimulationResult<T>

Key patterns established:
  1. TxResult = { hash, wait(confirmations?) } - split flow for immediate hash access
  2. SimulationResult<T> = { success: true, data, gasEstimate, _meta } | { success: false, error, _meta }
  3. All reads return _meta: BlockMeta for freshness verification
  4. TokenId builder: fluent API with addCall/addPut/addLeg methods
  5. Event parsing: decodePositionBalance() and decodeLeftRightSigned() for packed values
  6. Strike encoding: two's complement conversion for signed int24 in 24-bit field

Storage keys defined (storage/keys.ts):
  - getPositionsKey(chainId, poolAddress, account)      → tracked position IDs
  - getPositionMetaKey(chainId, poolAddress, tokenId)   → mint metadata per position
  - getSyncCheckpointKey(chainId, poolAddress, account) → resumable sync state
  - getClosedPositionsKey(chainId, poolAddress, account)→ trade history
  - getTrackedChunksKey(chainId, poolAddress)           → chunk tracking
  - getPendingPositionsKey(chainId, poolAddress, account) → optimistic updates

Available features for examples (Phase 3b):
  - ✅ All read functions (pool, position, account, collateral, oracle, safe mode, ERC4626 previews)
  - ✅ All write functions with simulation (approve, vault ops, open/close/roll, liquidate, force exercise, settle, poke oracle, dispatch)
  - ✅ TokenId builder and decoder
  - ✅ Transaction lifecycle (TxResult with wait())
  - ✅ Nonce management for concurrent transactions
  - ✅ Error parsing utilities
  - ✅ React integration (queryKeys, mutationEffects)
  - ✅ Storage adapters (memory, file)
  - ❌ Position sync/tracking (Phase 4)
  - ❌ Event watching (Phase 5)
  - ❌ Formatters (Phase 5)
  - ✅ Client-side Greeks (Phase 6) - getLegValue/Delta/Gamma, calculatePosition*, isDefinedRisk
  - ✅ Bot utilities (Phase 6) - assertFresh, assertHealthy, assertTradeable, isRetryableRpcError

Critical invariants to maintain:
  1. All numeric values are bigint (no number/string for chain data)
  2. Same-block guarantee via single Multicall3 eth_call
  3. Examples must use only Phase 1-3 features
  4. Examples must be runnable and well-documented
  5. All error handling must use typed PanopticError exceptions

Next phase focus: Create practical examples (oracle poker, liquidation bot, market maker, analytics dashboard) that demonstrate SDK patterns and real-world usage
===
```

---

## Phase 3b: Examples + Demonstrations

**Status**: ✅ COMPLETED (remaining examples deferred to Phase 4b)

**Completed:**
- Basic examples (4 scripts)
- Oracle Poker Bot
- Liquidation Bot (primitive - needs Phase 4 for position discovery)
- Sepolia fork tests
- PanopticQuery integration
- TokenIdBuilder fixes + errorsAbi

**Deferred to Phase 4b:** Market Maker Bot, Analytics Dashboard (benefit from Position Tracking infrastructure)

**Goal**: Create practical examples demonstrating SDK usage with currently implemented features (Phases 1-3). These examples showcase real-world bot implementations and React integration patterns.

**Deliverables:**

### 1. Basic Examples (`src/panoptic/v2/examples/basic/`)
- [x] **`01-simple-read.ts`** - Fetch and display pool data, oracle state, account collateral
  - Demonstrates: `getPool()`, `getOracleState()`, `getAccountCollateral()`, BlockMeta usage
- [x] **`02-open-position.ts`** - Build TokenId, simulate, and open a position
  - Demonstrates: `createTokenIdBuilder()`, `simulateOpenPosition()`, `openPosition()`, TxResult pattern
- [x] **`03-close-position.ts`** - Close an existing position with slippage protection
  - Demonstrates: `getPosition()`, `simulateClosePosition()`, `closePosition()`, error handling
- [x] **`04-vault-operations.ts`** - Deposit and withdraw from collateral vaults
  - Demonstrates: ERC4626 previews, `deposit()`, `withdraw()`, `previewDeposit()`
- [x] **`README.md`** - Setup instructions and explanations for basic examples
- [x] **`tsconfig.json`** - TypeScript configuration for running examples

### 2. Oracle Poker Bot (`src/panoptic/v2/examples/oracle-poker/`)
- [x] **`src/index.ts`** - Main bot entry point with monitoring loop
  - Monitors multiple pools for oracle staleness
  - Checks if oracle can be poked (64s cooldown)
  - Executes `pokeOracle()` when conditions met
- [x] **`src/config.ts`** - Bot configuration (RPC, pools to monitor, gas settings)
- [x] **`src/logger.ts`** - Simple console logger with timestamps
- [x] **`src/monitor.ts`** - Oracle monitoring logic with `getOracleState()`
- [x] **`src/executor.ts`** - Transaction execution with retry logic
- [x] **`package.json`** - Dependencies and run scripts
- [x] **`README.md`** - Setup guide, configuration options, deployment instructions
- [x] **`.env.example`** - Environment variable template
- [x] **`tsconfig.json`** - TypeScript configuration

### 3. Liquidation Bot (`examples/liquidation-bot/`) ✅ COMPLETED
- [x] **`src/index.ts`** - Main bot with account scanning and liquidation execution
  - Scans for liquidatable accounts using `isLiquidatable()`
  - Simulates liquidations with `simulateLiquidate()`
  - Gas price limiting to avoid unprofitable liquidations
  - Parallel account scanning with sequential execution
  - Graceful shutdown handling
- [x] **`src/config.ts`** - Bot configuration (pools, accounts, gas limits)
- [x] **`package.json`** - Dependencies and run scripts
- [x] **`README.md`** - Setup guide, production considerations
- [x] **`.env.example`** - Environment variable template
- [x] **`tsconfig.json`** - TypeScript configuration

**Note**: This is a primitive example. Production bots need:
- Position discovery via events/subgraph (Phase 4)
- Profitability calculation accounting for gas costs
- MEV protection (Flashbots, private mempool)

### 4. Simple Market Maker (`examples/market-maker/`) → **DEFERRED TO PHASE 4b**

*Rationale: Benefits significantly from Position Tracking (Phase 4) for automatic position discovery and management.*

### 5. Analytics Dashboard (`examples/analytics-dashboard/`) → **DEFERRED TO PHASE 4b**

*Rationale: Position list display and account summary require `syncPositions()` and `getTrackedPositionIds()` from Phase 4.*

### 6. Testing Strategy

#### Unit Tests for Bot Logic
- [ ] Each bot example includes unit tests for core logic (config, logger, monitoring logic)
- [ ] Examples use `createMemoryStorage()` for testing
- [ ] Mock viem PublicClient responses for deterministic testing

#### Fork Tests with Anvil (`examples/__tests__/`)
Comprehensive integration tests using Anvil mainnet forks to verify examples work end-to-end in realistic environments.

**Test Infrastructure:** ✅ COMPLETED
- [x] **`setup.ts`** - Shared Anvil fork utilities (fork at specific block, fund accounts, deploy mock positions, cleanup, fixtures)
- [x] **`setup.test.ts`** - Unit tests for fork infrastructure (11 passing tests)
- [x] **`anvil.config.ts`** - Anvil configuration (fork URL, block number 24,297,000, chain ID, test accounts, fixtures)
- [x] **`network.config.ts`** - Unified config-driven testing with network abstraction (Sepolia/mainnet), test account isolation (alice-frank), `fundTestAccount()` helper
- [x] **`vitest.config.fork.ts`** - Vitest config for fork tests (longer timeouts, sequential execution)
- [x] **`README.md`** - Comprehensive fork test documentation (setup, patterns, troubleshooting)

**Coverage Requirements:**
- [x] **Basic Examples** (`basic/__tests__/*.fork.test.ts`) - ✅ COMPLETED (24 skipped tests awaiting deployment)
  - `01-simple-read.fork.test.ts` - getPool, getOracleState, getAccountCollateral, data freshness
  - `02-open-position.fork.test.ts` - TokenId builder, simulation, openPosition, error handling
  - Tests are skipped with `describe.skip` until Panoptic v2 mainnet deployment
  - All test patterns established: snapshots, funding, time manipulation, error scenarios

- [x] **Oracle Poker Bot** (`oracle-poker/__tests__/*.fork.test.ts`) - ✅ COMPLETED (skipped awaiting deployment)
  - `integration.fork.test.ts` - End-to-end bot workflow with oracle monitoring, poking, rate limiting
  - Tests cover: staleness detection, poke execution, epoch-based cooldowns, error recovery
  - Ready to enable by removing `.skip` and setting TEST_POOL_ADDRESS

- [x] **Sepolia Fork Tests** (`__tests__/sepolia/*.fork.test.ts`) - ✅ COMPLETED (running against Sepolia)
  - `sepolia.config.ts` - Contract addresses, test helpers, `fundSepoliaTestAccount()`, `createTokenIdBuilderFromPoolId()`, 6 test accounts (alice-frank)
  - `01-basic-reads.fork.test.ts` - `getPool`, `getOracleState`, `getAccountCollateral`, `getCurrentRates`
  - `02-write-simulations.fork.test.ts` - TokenId builder, deposit simulation, position simulation with collateral
  - `03-helper-functions.fork.test.ts` - `getNetLiquidationValue`, `getLiquidationPrices`, fallback behavior
  - Tests run against Anvil fork of Sepolia (deployed WETH/USDC 500 pool)
  - Includes account funding helpers for WETH (wrap ETH) and USDC (testnet mint)

- [x] **Liquidation Bot** (`sepolia/04-liquidation-bot.fork.test.ts`) - Test scanning, profitability, and execution
  - Position sync and discovery via `syncPositions()` and `getTrackedPositionIds()`
  - Liquidation eligibility checks via `isLiquidatable()`
  - Liquidation simulation via `simulateLiquidate()`
  - Position opening and tracking workflow
  - End-to-end liquidation bot workflow

- [ ] **Market Maker Bot** (`market-maker/__tests__/*.fork.test.ts`) - Test strategy, position management, and risk monitoring
  - Position opening/closing/rolling at target strikes
  - Risk threshold monitoring and adjustments
  - Safe mode handling
  - End-to-end strategy execution

- [ ] **Analytics Dashboard** (`analytics-dashboard/__tests__/*.fork.test.ts`) - Test React hooks and components with real data
  - All query hooks fetch and cache correctly
  - All mutation hooks execute and invalidate queries
  - Components render with forked data
  - Optimistic updates work correctly

**Testing Principles:**
- **Every SDK function used in examples must have fork test coverage**
- **Both success and failure paths must be tested**
- **Simulations must be validated against actual execution**
- **All bot logic branches must be exercised**
- **Tests must be deterministic** (fork at specific block, use fixtures)
- **Test isolation** (cleanup between tests using `anvil_reset`)
- **Account isolation** (each test file uses unique Anvil account to prevent nonce conflicts during parallel execution)

**Test Execution:**
- [x] `pnpm test:fork` - Run all fork tests (currently discovers 24 skipped tests)
- [x] `pnpm test:fork:watch` - Watch mode for development
- [x] `pnpm test:examples` - Run both unit and fork tests for examples
- [ ] CI pipeline runs fork tests on every commit

**Test Count Status**: 311 tests passing, 24 skipped (335 total)
  - Sepolia fork tests: running and passing (including liquidation bot tests)
  - Mainnet fork tests: 24 skipped awaiting deployment
**Test Count Target**: ~350 tests total when all examples complete

### 7. Documentation
- [ ] **`examples/README.md`** - Overview of all examples, prerequisites, common patterns
- [ ] Each example has inline code comments explaining SDK patterns
- [ ] Link examples from main SDK README

### 8. PanopticQuery Integration ✅ COMPLETED

Added support for the PanopticQuery helper contract across account/position analysis functions.

**Files Created:**
- [x] `abis/panopticQuery.ts` - PanopticQuery ABI with `as const` for proper viem type inference
- [x] `abis/types.d.ts` - Documentation of abitype int24→number mapping issue and workaround
- [x] `reads/queryUtils.ts` - New utility functions using PanopticQuery:
  - `getPortfolioValue()` - Portfolio value (NAV) without premia
  - `checkCollateralAcrossTicks()` - Collateral analysis for 301 tick data points (UI charting)
  - `optimizeTokenIdRiskPartners()` - Optimize risk partner assignments for minimum collateral

**Functions Updated (now accept `queryAddress` parameter):**
- [x] `getNetLiquidationValue()` - Uses `PanopticQuery.getNetLiquidationValue()` for accurate NLV
- [x] `getLiquidationPrices()` - Uses `PanopticQuery.getLiquidationPrices()` for liquidation ticks
- [x] `isLiquidatable()` - Uses `PanopticQuery.isAccountSolvent()` for solvency check
- [x] `estimateCollateralRequired()` - Uses `PanopticQuery.getRequiredBase()` for collateral estimation

**Test Count**: +12 new tests (280 passing at time of completion)

**Key Technical Pattern - abitype Bridge:**
```typescript
// abitype maps int24 to `number` by default, but viem requires `bigint` at runtime
// Bridge with BigInt() conversion at ABI boundaries:
const effectiveTick = atTick ?? BigInt(currentTickResult)

// Use @ts-expect-error for bigint passed to ABI expecting number:
// @ts-expect-error - abitype defaults int24 to number, but viem requires bigint at runtime
args: [poolAddress, account, tokenIds, effectiveTick],
```

**Key Constraints for Phase 3b:**
- Use only Phases 1-3 features (no position sync, no event watching, no formatters, no client-side Greeks)
- All examples must work with current implementation
- Basic bigint formatting helpers can be included in examples (TickMath conversions, decimal scaling)
- No PanopticHelper-dependent features (Greeks, collateral estimation) - document as "Phase 4+ features"
- Focus on practical, runnable code that demonstrates SDK patterns

**Test Count Target**: +50 tests (bot logic unit tests + React component tests)

**Files Created**: ~40 files across 5 example projects

---

## Context Handoff Block (Phase 3b Basic Examples → Phase 3b Bots)

```
=== CONTEXT HANDOFF (Phase 3b Basic Examples Complete) ===

Completed: 4 basic example scripts + README + tsconfig (6 files)
Location: src/panoptic/v2/examples/

Files created:
  - 01-simple-read.ts      : Read operations (getPool, getOracleState, getAccountCollateral)
  - 02-open-position.ts    : TokenId builder, simulation, opening positions
  - 03-close-position.ts   : Fetching positions, closing positions with slippage protection
  - 04-vault-operations.ts : ERC4626 vault operations (preview, deposit, withdraw)
  - README.md              : Comprehensive setup guide and documentation
  - tsconfig.json          : TypeScript configuration for examples

Key patterns demonstrated:
  1. PublicClient + WalletClient setup with viem
  2. Environment variable configuration (RPC_URL, PRIVATE_KEY, POOL_ADDRESS)
  3. BlockMeta usage for data freshness verification
  4. Same-block consistency checks
  5. TokenId builder fluent API (addCall/addPut + build())
  6. Simulation before execution pattern
  7. TxResult.wait() for transaction confirmation
  8. Typed error handling (PanopticError, PositionNotOwnedError)
  9. Error parsing with parsePanopticError()
  10. EXECUTE=true safety pattern for write operations

All examples compile successfully (TypeScript strict mode) and use actual SDK API signatures.

Remaining Phase 3b work (as of this handoff):
  - Oracle Poker Bot (8 files) - ✅ COMPLETED
  - Liquidation Bot (10 files) → ✅ completed in 9b76fe26
  - Market Maker Bot (10 files)
  - Analytics Dashboard (15+ files)
  - Fork testing infrastructure - ✅ COMPLETED
  - Sepolia fork tests - ✅ completed in 31be88f3

Next step: Implement fork tests for existing examples (basic + oracle poker) to establish testing patterns, then complete remaining bot examples
===
```

## Context Handoff Block (Phase 3b PanopticQuery Integration)

```
=== CONTEXT HANDOFF (Phase 3b PanopticQuery Integration) ===

Completed: PanopticQuery helper contract integration for account/position analysis
Test Count: 280 passing (all previous + 12 new queryUtils tests)

Files created:
  - abis/panopticQuery.ts   : PanopticQuery ABI (`as const` for viem type inference)
  - abis/types.d.ts         : Documentation of abitype int24→number issue and workaround
  - reads/queryUtils.ts     : getPortfolioValue, checkCollateralAcrossTicks, optimizeTokenIdRiskPartners
  - reads/__tests__/queryUtils.test.ts : 12 tests for new utility functions

Functions updated (now accept optional `queryAddress` parameter):
  - account.ts: getNetLiquidationValue(), getLiquidationPrices()
  - checks.ts: isLiquidatable()
  - collateralEstimate.ts: estimateCollateralRequired()

PanopticQuery ABI functions exposed:
  - getNetLiquidationValue(pool, account, includePendingPremium, tokenIds, atTick) → (value0, value1)
  - getLiquidationPrices(pool, account, tokenIds) → (liqPriceDown, liqPriceUp)
  - isAccountSolvent(pool, account, tokenIds, atTick) → bool
  - getRequiredBase(pool, tokenId, atTick) → uint256
  - getPortfolioValue(pool, account, atTick, tokenIds) → (value0, value1)
  - checkCollateralListOutput(pool, account, tokenIds) → (balanceRequired[], tickData[], liquidationPrices)
  - optimizeRiskPartners(pool, atTick, tokenId) → optimizedTokenId

Key pattern established (abitype bridge):
  The abitype library maps Solidity int24 to TypeScript `number` by default, but viem
  always returns and requires `bigint` at runtime. This creates a type mismatch.

  Solution:
  1. Use BigInt() conversion at boundaries between ABIs:
     `const effectiveTick = atTick ?? BigInt(currentTickResult)`

  2. Use @ts-expect-error for bigint passed to ABI functions expecting number:
     `// @ts-expect-error - abitype defaults int24 to number, but viem requires bigint at runtime`

  This pattern is safe because viem handles bigint correctly regardless of TypeScript types.

MIN_TICK/MAX_TICK constants for null liquidation price detection:
  - MIN_TICK = -887272n indicates no liquidation below current price
  - MAX_TICK = 887272n indicates no liquidation above current price
  - Used in getLiquidationPrices, checkCollateralAcrossTicks

Remaining Phase 3b work (as of this handoff):
  - Liquidation Bot example (pending) → ✅ completed in 9b76fe26
  - Market Maker Bot example (pending)
  - Analytics Dashboard example (pending)
  - Sepolia fork tests (pending) → ✅ completed in 31be88f3

Critical invariants maintained:
  1. All numeric values are bigint (no number/string for chain data)
  2. Same-block guarantee via single Multicall3 eth_call
  3. Typed errors (PanopticError subclasses)
  4. Functions without query/helper fall back to simplified calculations or throw PanopticHelperNotDeployedError
  5. All tests pass (280 total, 24 fork tests skipped awaiting deployment)
===
```

### 9. TokenIdBuilder Fixes + Error ABI ✅ COMPLETED

Bug fixes and improvements to tokenId encoding and error parsing.

**TokenIdBuilder Fixes (`tokenId/builder.ts`):**
- [x] Fixed `addCall/addPut` to correctly set tokenType based on asset
  - Call: `tokenType === asset` (bullish on risky token)
  - Put: `tokenType !== asset` (bearish on risky token)
- [x] Default `asset=0` (token0, e.g., WETH in WETH/USDC pairs)
- [x] Added optional `asset` parameter to `addCall/addPut` for override

**Error Parsing Improvements:**
- [x] New `errors/errorsAbi.ts` - All 38 Panoptic custom error definitions with selectors
- [x] Fixed `parser.ts` to extract error selectors from viem error messages
- [x] Exported `panopticErrorsAbi` for custom error decoding

**dispatch() Argument Fixes:**
- [x] Renamed `positionIdList → existingPositionIds` for clarity
- [x] Fixed `simulateOpenPosition` and `openPosition` to use correct dispatch args:
  - `positionIdList = [tokenId]` (positions being minted)
  - `finalPositionIdList = [...existingPositionIds, tokenId]`

**spec.md Clarifications:**
- [x] Clarified preferredAsset is the risky token (e.g., WETH)
- [x] Greeks (value/delta/gamma) are in numeraire token units (e.g., USDC)
- [x] assetIndex determines which token is the asset, other is numeraire

**Test Count**: 303 passing (+23 from Sepolia fork tests and fixes)

## Context Handoff Block (Phase 3b Liquidation Bot + Sepolia Fork Tests)

```
=== CONTEXT HANDOFF (Phase 3b Liquidation Bot + Sepolia Fork Tests) ===

Completed: Liquidation bot example + Sepolia fork tests + TokenIdBuilder fixes
Test Count: 303 passing, 24 skipped (327 total)

Files created (commit 9b76fe26 - Liquidation Bot):
  - examples/liquidation-bot/src/index.ts    : Main bot loop (298 lines)
  - examples/liquidation-bot/src/config.ts   : Environment-based configuration
  - examples/liquidation-bot/README.md       : Setup guide, production considerations
  - examples/liquidation-bot/.env.example    : Configuration template
  - examples/liquidation-bot/package.json    : Dependencies
  - examples/liquidation-bot/tsconfig.json   : TypeScript configuration

Files created (commit 31be88f3 - Sepolia Fork Tests):
  - examples/__tests__/sepolia.config.ts           : Contract addresses, funding helpers
  - examples/__tests__/sepolia/01-basic-reads.fork.test.ts
  - examples/__tests__/sepolia/02-write-simulations.fork.test.ts
  - examples/__tests__/sepolia/03-helper-functions.fork.test.ts
  - errors/errorsAbi.ts                            : 38 Panoptic error definitions

Files modified (commit 31be88f3 - TokenIdBuilder fixes):
  - tokenId/builder.ts         : Fixed addCall/addPut tokenType logic
  - errors/parser.ts           : Fixed error selector extraction
  - errors/index.ts            : Export panopticErrorsAbi
  - simulations/simulateOpenPosition.ts : Fixed dispatch args
  - writes/position.ts         : Fixed dispatch args
  - spec.md                    : Clarified asset/tokenType semantics

Sepolia deployment addresses (WETH/USDC 500 pool):
  - PanopticPool: 0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78
  - CollateralTracker0 (WETH): 0x4f29B472bebbFcEEc250a4A5BC33312F00025600
  - CollateralTracker1 (USDC): 0x244Bf88435Be52e8dFb642a718ef4b6d0A1166BF
  - PanopticHelper: 0x687F616d68c483A7223E6922F59Aef7452E26c1D

Key patterns established:
  1. createTokenIdBuilderFromPoolId(poolId) - Use contract's poolId directly for V4 pools
  2. fundSepoliaTestAccount() - Wrap ETH to WETH + mint test USDC + approve collateral trackers
  3. Error parsing with panopticErrorsAbi for cleaner error messages
  4. Call/Put semantics: Call = tokenType === asset, Put = tokenType !== asset

Phase 3b completed. Remaining examples deferred to Phase 4b:
  - Market Maker Bot example → Phase 4b (benefits from syncPositions)
  - Analytics Dashboard example → Phase 4b (benefits from getTrackedPositionIds)

Next step: Phase 4 (Position Tracking + Sync) - foundational infrastructure for position discovery

Critical invariants maintained:
  1. All numeric values are bigint
  2. Same-block guarantee via single Multicall3 eth_call
  3. Typed errors (PanopticError subclasses)
  4. Sepolia fork tests validate real contract behavior
  5. TokenIdBuilder now correctly encodes call/put semantics
===
```

---

## Phase 4: Position Tracking + Sync

**Status**: ✅ COMPLETED

**Goal**: Implement local position tracking via event sync. This is foundational infrastructure - Panoptic provides no on-chain enumeration of user positions, so the SDK must track tokenIds locally.

**Why This Matters:**
- Contract expects callers to provide `positionIdList` for all queries
- `getPosition(s)`, `getAccountSummaryBasic/Risk`, `isLiquidatable`, `closePosition` all need tokenIds
- Enables production-ready bots (liquidation bot currently has placeholder tokenIds)
- Required for computing `finalPositionIdList` in dispatch()

**Deliverables:**
- [x] `syncPositions()` - Main sync entry point with snapshot recovery, event reconstruction, incremental sync
- [x] `snapshotRecovery.ts` - Recover position state from dispatch() calldata
- [x] `eventReconstruction.ts` - Fallback via OptionMinted/OptionBurnt scanning from pool deployment
- [x] `reorgHandling.ts` - Block hash verification, 128-block rollback depth, checkpoint management
- [x] `getSyncStatus()` - Check sync state (lastSyncedBlock, blocksBehind, positionCount, hasCheckpoint)
- [x] `getTrackedPositionIds()` - Get cached tokenIds from storage
- [x] `chunkTracking.ts` - `addTrackedChunks`, `removeTrackedChunks`, `getTrackedChunks`, `getChunkSpreads`, `calculateSpreadWad`
- [x] `tradeHistory.ts` - `saveClosedPosition`, `getTradeHistory`, `getClosedPositions`, `getRealizedPnL`
- [x] `pendingPositions.ts` - Optimistic updates (`addPendingPosition`, `confirmPendingPosition`, `failPendingPosition`, `cleanupStalePendingPositions`)
- [x] `sync/index.ts` - Consolidated exports for all sync module functions

**Test Count**: 311 tests passing (+26 new sync tests)

**Files Created** (11 files):
- `sync/syncPositions.ts` - Main orchestration (344 lines)
- `sync/getSyncStatus.ts` - Sync state queries (82 lines)
- `sync/getTrackedPositionIds.ts` - Position ID queries (82 lines)
- `sync/tradeHistory.ts` - Closed position tracking (237 lines)
- `sync/chunkTracking.ts` - Liquidity chunk tracking (310 lines)
- `sync/pendingPositions.ts` - Optimistic updates (287 lines)
- `sync/snapshotRecovery.ts` - Dispatch calldata recovery (230 lines)
- `sync/eventReconstruction.ts` - Event-based position reconstruction (279 lines)
- `sync/reorgHandling.ts` - Reorg detection and checkpoint management (234 lines)
- `sync/index.ts` - Module exports (95 lines)
- `sync/sync.test.ts` - Comprehensive tests (728 lines, 26 tests)

---

## Context Handoff Block (Phase 4 → Phase 4b)

```
=== CONTEXT HANDOFF (Phase 4 Position Tracking Complete) ===

Completed: Full position tracking and sync infrastructure (11 files, 26 tests)
Test Count: 311 passing (all previous + 26 new sync tests)
Location: src/panoptic/v2/sync/

Files created:
  - syncPositions.ts       : Main orchestration - initial sync, incremental sync, reorg handling
  - getSyncStatus.ts       : Query sync state (lastSyncedBlock, blocksBehind, positionCount)
  - getTrackedPositionIds.ts : Get/check cached position IDs from storage
  - tradeHistory.ts        : Track closed positions, calculate realized PnL
  - chunkTracking.ts       : Monitor liquidity chunks for volatility surface data
  - pendingPositions.ts    : Optimistic updates for submitted transactions
  - snapshotRecovery.ts    : Recover position state from dispatch() calldata
  - eventReconstruction.ts : Fallback via OptionMinted/OptionBurnt event scanning
  - reorgHandling.ts       : Detect reorgs with 128-block rollback, checkpoint management
  - index.ts               : Consolidated exports
  - sync.test.ts           : 26 comprehensive tests

Key sync patterns established:
  1. syncPositions() orchestrates: check checkpoint → detect reorg → sync incrementally or full rebuild
  2. Snapshot recovery: decode dispatch() calldata to extract finalPositionIdList
  3. Event reconstruction: scan OptionMinted/OptionBurnt from pool deployment block
  4. Reorg handling: verify block hash continuity, rollback 128 blocks on mismatch
  5. Checkpoints: save/load sync state for resumable syncs
  6. Pending positions: optimistic updates with confirm/fail/cleanup

Sync module exports:
  - Main: syncPositions, getSyncStatus, getTrackedPositionIds, isPositionTracked, clearTrackedPositions
  - Trade history: saveClosedPosition, getTradeHistory, getClosedPositions, getRealizedPnL, clearTradeHistory
  - Chunks: addTrackedChunks, removeTrackedChunks, getTrackedChunks, getChunkSpreads, calculateSpreadWad, clearTrackedChunks
  - Pending: addPendingPosition, getPendingPositions, confirmPendingPosition, failPendingPosition, clearPendingPositions, cleanupStalePendingPositions
  - Internal: recoverSnapshot, decodeDispatchCalldata, reconstructFromEvents, getPoolDeploymentBlock, detectReorg, calculateResyncBlock, saveCheckpoint, loadCheckpoint, clearCheckpoint, verifyBlockContinuity

Storage keys used:
  - getPositionsKey(chainId, poolAddress, account)       → bigint[] of tracked tokenIds
  - getSyncCheckpointKey(chainId, poolAddress, account)  → { lastBlock, blockHash, timestamp }
  - getClosedPositionsKey(chainId, poolAddress, account) → ClosedPosition[]
  - getTrackedChunksKey(chainId, poolAddress)            → LiquidityChunkKey[]
  - getPendingPositionsKey(chainId, poolAddress, account)→ PendingPosition[]

Types added/used:
  - SyncPositionsParams, SyncPositionsResult, SyncProgressEvent
  - SyncStatusResult, GetSyncStatusParams
  - ClosedPosition, RealizedPnL (from types/sync.ts)
  - LiquidityChunkKey, LiquidityChunkSpread
  - PendingPosition (pending | confirmed | failed status)

Next phase: Phase 4b - Complete deferred examples (Market Maker Bot, Analytics Dashboard) that now benefit from position tracking

Critical invariants maintained:
  1. All numeric values are bigint
  2. Same-block guarantee via single Multicall3 eth_call
  3. Typed errors (PanopticError subclasses)
  4. Storage adapter pattern for cross-platform compatibility
  5. 128-block reorg depth constant (REORG_DEPTH from utils/constants)
===
```

---

## Phase 4b: Examples with Position Tracking

**Status**: 🚧 IN PROGRESS

**Goal**: Complete deferred examples that benefit from Position Tracking infrastructure.

**Completed:**
- [x] Liquidation bot integration with sync module (`examples/liquidation-bot/`)
- [x] Liquidation bot fork tests (`sepolia/04-liquidation-bot.fork.test.ts`)
- [x] Basic sync example 05-position-sync.ts + fork test
- [x] Basic sync example 06-trade-history.ts + fork test
- [x] Basic sync example 07-chunk-tracking.ts + fork test

**Deliverables:**

### Basic Sync Examples (`examples/basic/`)

New examples demonstrating position tracking and chunk tracking capabilities:

- [x] **`05-position-sync.ts`** - Position tracking and sync workflow ✅
  - Demonstrates `syncPositions()` for initial and incremental sync
  - Shows `getTrackedPositionIds()` to retrieve cached positions
  - Uses `getSyncStatus()` to check sync state
  - Handles `clearTrackedPositions()` for cleanup
  - Progress reporting via `onUpdate` callback
  - Storage adapter selection (memory vs file)

- [x] **`06-trade-history.ts`** - Closed position and PnL tracking ✅
  - Demonstrates `saveClosedPosition()` after closing positions
  - Shows `getTradeHistory()` and `getClosedPositions()`
  - Uses `getRealizedPnL()` for profit/loss calculation
  - Filters by date range and tokenId

- [x] **`07-chunk-tracking.ts`** - Liquidity chunk monitoring ✅
  - Demonstrates `addTrackedChunks()` for subscribing to chunks
  - Shows `getTrackedChunks()` and `getChunkSpreads()`
  - Uses `calculateSpreadWad()` for spread calculations
  - Explains chunk key format (tickLower, tickUpper, tokenType)
  - Monitors chunk liquidity changes for volatility surface

- [ ] **`08-pending-positions.ts`** - Optimistic updates workflow → **DEFERRED TO PHASE 5b**
- [ ] **`09-reorg-handling.ts`** - Chain reorganization recovery → **DEFERRED TO PHASE 5b**

### Basic Sync Fork Tests (`examples/__tests__/sepolia/`)

- [x] **`05-position-sync.fork.test.ts`** - Position sync integration tests ✅
- [x] **`06-trade-history.fork.test.ts`** - Trade history persistence tests ✅
- [x] **`07-chunk-tracking.fork.test.ts`** - Chunk tracking integration tests ✅

### Market Maker Bot (`examples/market-maker/`)
- [ ] **`src/index.ts`** - Main market maker strategy
  - Opens positions at target strikes
  - Uses `syncPositions()` + `getTrackedPositionIds()` for position discovery
  - Monitors position health with `getPosition()`
  - Closes positions on threshold conditions
  - Uses `rollPosition()` for position adjustments
- [ ] **`src/config.ts`** - Strategy configuration (strikes, position size, thresholds)
- [ ] **`src/strategy.ts`** - Market making logic (uses price/utilization)
- [ ] **`src/risk.ts`** - Position risk checks using `getAccountCollateral()`, safe mode monitoring
- [ ] **`src/executor.ts`** - Position management (open/close/roll) with simulation
- [ ] **`src/nonce.ts`** - Nonce manager wrapper for concurrent operations
- [ ] **`package.json`**, **`README.md`**, **`.env.example`**

### Analytics Dashboard (`examples/analytics-dashboard/`)
- [ ] **React + Vite + TanStack Query app** showcasing SDK integration
- [ ] **`src/hooks/usePositions.ts`** - Uses `syncPositions()` + `getTrackedPositionIds()`
- [ ] **`src/hooks/usePool.ts`**, **`useAccount.ts`**, **`useOracleState.ts`**
- [ ] **`src/hooks/useOpenPosition.ts`**, **`useClosePosition.ts`** - Mutation hooks
- [ ] **`src/components/`** - PoolOverview, PositionList, PositionDetails, AccountSummaryBasic/Risk, etc.
- [ ] **`package.json`**, **`README.md`**, **`.env.example`**

### Enhanced Liquidation Bot ✅ COMPLETED
- [x] Update liquidation bot to use `syncPositions()` for position discovery
- [x] Fork tests with position sync workflow (`sepolia/04-liquidation-bot.fork.test.ts`)
- [ ] Add event watching for real-time position updates (deferred to Phase 5)

---

## Phase 5: Events + Formatters

**Status**: ✅ COMPLETED (remaining examples deferred to Phase 5b)

**Completed:**
- [x] `watchEvents()` - Simple WebSocket watching
- [x] `createEventSubscription()` - Resilient subscription with auto-reconnect and gap filling
- [x] `createEventPoller()` - HTTP polling alternative
- [x] Event parsing utilities (`parsePoolLog`, `parseCollateralLog`)
- [x] Unit tests (29 tests)
- [x] Exports added to main `index.ts`

**Test Count**: 370 tests passing (+29 new events tests)

**Files Created** (5 files):
- `events/watchEvents.ts` - Simple one-shot WebSocket watching (273 lines)
- `events/subscription.ts` - Resilient subscription with reconnect + gap fill (323 lines)
- `events/poller.ts` - HTTP polling alternative (264 lines)
- `events/index.ts` - Module exports
- `events/events.test.ts` - Comprehensive tests (29 tests)

**Previously Completed:**
- [x] Formatters: `tickToPrice`, `priceToTick`, `formatTokenAmount`, `formatBps`, etc. (Phase 1)
- [x] `formatters/index.ts` - Module exports (added to expose all formatters)
- [x] Formatters exported from main `index.ts`

**Test Count**: 452 tests passing (+29 events + 32 formatters)

**Phase 5b Deferred:**
- [ ] Examples 08-09 (pending-positions, reorg-handling) - deferred from Phase 4b

**Bug Fixes (cbafd5e8):**
- [x] `simulations/simulateOpenPosition.ts`, `simulations/simulateVault.ts`: Removed `blockNumber` pinning from `simulateContract` and `estimateContractGas` calls to use "latest" state instead of potentially stale forked block (fixes `TransferFailed` errors in fork tests)
- [x] `sync/syncPositions.ts`: Added `accountHasPositionEvents()` check to short-circuit sync for accounts with no position history (prevents 60s timeout on fresh accounts)
- [x] Fork test infrastructure: Created unified `network.config.ts` for config-driven testing with network abstraction
- [x] Fork test parallelization: Assigned unique Anvil accounts per test file to prevent nonce conflicts during parallel execution:
  - `basic/01-simple-read.fork.test.ts` → alice (read-only)
  - `basic/02-open-position.fork.test.ts` → carol
  - `oracle-poker/integration.fork.test.ts` → dave
  - `sepolia/02-write-simulations.fork.test.ts` → alice
  - `sepolia/04-liquidation-bot.fork.test.ts` → eve/frank
  - `sepolia/05-position-sync.fork.test.ts` → alice
  - `sepolia/07-chunk-tracking.fork.test.ts` → bob

---

## Context Handoff Block (Phase 5 → Phase 6)

```
=== CONTEXT HANDOFF (Phase 5 Events Complete) ===

Completed: Full events module with WebSocket watching, resilient subscription, HTTP polling (5 files, 29 tests)
Test Count: 370 passing (all previous + 29 new events tests)
Location: src/panoptic/v2/events/

Files created:
  - watchEvents.ts      : Simple one-shot WebSocket watching, stops on disconnect
  - subscription.ts     : Resilient subscription with auto-reconnect, gap filling, exponential backoff
  - poller.ts           : HTTP polling alternative for environments without WebSocket
  - index.ts            : Module exports
  - events.test.ts      : 29 comprehensive tests

Key patterns established:
  1. watchEvents() - Simple one-shot watching, returns unwatch() function
  2. createEventSubscription() - Resilient with ReconnectConfig (maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier)
  3. createEventPoller() - Polls eth_getLogs at interval, configurable maxBlockRange
  4. Event parsing: parsePoolLog() for PanopticPool events, parseCollateralLog() for CollateralTracker events
  5. Gap filling: Subscription tracks lastProcessedBlock and fetches missed events on reconnect

Event types supported:
  - PanopticPool: OptionMinted, OptionBurnt, AccountLiquidated, ForcedExercised, PremiumSettled
  - CollateralTracker: Deposit, Withdraw

Exports added to index.ts:
  - Functions: watchEvents, createEventSubscription, createEventPoller, parsePoolLog, parseCollateralLog
  - Constants: DEFAULT_RECONNECT_CONFIG
  - Types: WatchEventsParams, CreateEventSubscriptionParams, EventSubscriptionHandle, ReconnectConfig, CreateEventPollerParams, EventPoller

Deferred to Phase 5b:
  - Examples 08-pending-positions.ts and 09-reorg-handling.ts

Next phase: Phase 6 (Client-side Greeks + Bot Utilities)

Critical invariants maintained:
  1. All numeric values are bigint
  2. Same-block guarantee via single Multicall3 eth_call
  3. Typed errors (PanopticError subclasses)
  4. Event parsing uses decodePositionBalance/decodeLeftRightSigned from writes/utils.ts
  5. Reconnect config has sensible defaults (10 attempts, 1s initial, 30s max, 2x backoff)
===
```

---

## Phase 6: Client-side Greeks + Bot Utilities

**Status**: ✅ COMPLETED (557 tests passing)

**Completed:**
- [x] Client-side greeks: `getLegValue`, `getLegDelta`, `getLegGamma` (WAD-scaled bigint outputs)
- [x] Position aggregates: `calculatePositionValue`, `calculatePositionDelta`, `calculatePositionGamma`, `calculatePositionGreeks`
- [x] `isDefinedRisk()` - Detect defined risk positions (spread with both long and short legs of same tokenType)
- [x] `isCall()` - Detect call vs put based on tokenType and asset
- [x] Premia tracking: `getAccountPremia`, `getPositionsWithPremia` (per-position via multicall)
- [x] Position data updates: `positionData()` now returns 7 values (added `swapAtMint`)
- [x] Bot assertions: `assertFresh`, `assertHealthy`, `assertTradeable`, `assertCanMint/Burn/Liquidate/ForceExercise`
- [x] `isRetryableRpcError()`, `isNonceError()`, `isGasError()` - RPC error classification

**Files Created/Modified:**
- `greeks/index.ts` - Client-side greeks (300 lines, 28 tests)
- `greeks/greeks.test.ts` - Comprehensive tests
- `bot/index.ts` - Bot utilities (280 lines, 37 tests)
- `bot/bot.test.ts` - Comprehensive tests
- `reads/premia.ts` - Premia tracking functions
- `reads/position.ts` - Updated for 7-value positionData
- `types/position.ts` - Added swapAtMint field
- `writes/utils.ts` - Added decodeLeftRightUnsigned
- `index.ts` - Export greeks and bot modules

---

## Context Handoff Block (Phase 6 → Phase 7)

```
=== CONTEXT HANDOFF (Phase 6 Complete) ===

Completed: Client-side greeks module + Bot utilities
Test Count: 557 passing (+37 bot utilities)
Location: src/panoptic/v2/greeks/, src/panoptic/v2/bot/

Greeks module (2 files, 28 tests):
  - getLegValue, getLegDelta, getLegGamma (per-leg, WAD-scaled bigint outputs)
  - calculatePositionValue/Delta/Gamma/Greeks (position-level aggregates)
  - isCall, isDefinedRisk helpers

Bot utilities module (2 files, 37 tests):
  - assertFresh(data, maxAgeSeconds) - Throws StaleDataError if data too old
  - assertHealthy(pool) - Throws UnhealthyPoolError if pool not active
  - assertTradeable(pool, safeMode?) - Checks health + safe mode
  - assertCanMint/Burn/Liquidate/ForceExercise - Safe mode action checks
  - isRetryableRpcError(error) - Classify transient RPC errors for retry
  - isNonceError, isGasError - Specific error classification

Key design decisions:
  1. Assertions throw typed errors (not return booleans) for cleaner bot code
  2. isRetryableRpcError checks: RPC codes, message patterns, nested causes
  3. Retryable: timeouts, rate limits, connection errors, nonce errors
  4. Non-retryable: execution reverts, insufficient funds, invalid params

Phase 6 also included:
  - Premia tracking (getAccountPremia, getPositionsWithPremia)
  - Position data updates (7-value positionData with swapAtMint)

Next phase: Phase 7 (Config + Polish)

Critical invariants maintained:
  1. All numeric values are bigint
  2. Same-block guarantee via single Multicall3 eth_call
  3. Typed errors (PanopticError subclasses)
  4. Bot assertions throw, don't return booleans
===
```

---

## Phase 7: Config + Polish

**Status**: Minimal - SDK is feature-complete

**Remaining (optional):**
- [ ] TSDoc review on public exports
- [ ] Final documentation cleanup
- [ ] Run `pnpm build` before publish

**Skipped (not needed for MVP):**
- `createConfig()` / `updateConfig()` / `PanopticConfig` - Users pass params directly to functions
- `clearCache()` - Individual clear functions exist (clearTrackedPositions, clearTradeHistory, etc.)
- `HealthThresholds` - Use fixed sensible defaults
- Bundled chain addresses - Users provide addresses manually
- `deepFreeze` utility - Removed (was only for createConfig)

**To implement:**
- [ ] `getAccountHistory()` - Convenience function returning `{ open: Position[], closed: ClosedPosition[] }`
- [ ] `getPoolLiquidities()` - PanopticQuery method returning tick → netLiquidity map
- [ ] `getRequiredCreditForITM()` - Calculate credit LegConfig to offset option's ITM value
- [ ] `getRequiredLoanForITM()` - Calculate loan LegConfig to offset option's ITM value
- [ ] `getDeltaHedgeParams()` - Calculate loan/credit LegConfig for delta hedging
- [ ] `getPortfolioDelta()` - Total delta including undeposited wallet balances (positions + wallet)
- [ ] `stressTest()` / `stressTestMultiple()` - Evaluate account state at hypothetical prices
- [ ] `getMarginBuffer()` - Current margin buffer (absolute + percentage)
- [ ] `createLoan()` / `createCredit()` - TokenIdBuilder methods for width=0 legs
- [ ] Delta-neutral example (`examples/delta-neutral/`) - Short put + loan hedge

---

## Final Handoff Block

```
=== SDK STATUS (Phase 6 Complete, Ready for Use) ===

Test Count: 541 passing
Branch: feat/sdk-specs

Recent commits:
  f042c27b chore(sdk): remove deepFreeze utility (unused)
  b39d7fac feat(sdk): add bot utilities module, complete Phase 6
  54917004 feat(sdk): add client-side greeks module
  272fc123 feat(sdk): add per-position premia via multicall
  6b6e3175 feat(sdk): update positionData to new 7-value return format

Module summary:
  reads/       - Pool, position, account, collateral, premia, oracle, safe mode, ERC4626
  writes/      - Approve, vault ops, open/close/roll, liquidate, force exercise, settle, dispatch
  simulations/ - All write operations have simulate* variants
  tokenId/     - Builder + decoder for TokenId encoding
  sync/        - Position tracking with event reconstruction
  events/      - WebSocket watching, resilient subscription, HTTP polling
  formatters/  - Tick/price, amounts, percentages, WAD, display utilities
  greeks/      - Client-side value/delta/gamma (per-leg + position aggregates)
  bot/         - Assertions (assertFresh/Healthy/Tradeable) + RPC error classification

Key design decisions:
  1. All numerics are bigint (except ticks, bps, chainId can be number)
  2. Same-block guarantee via single Multicall3 eth_call
  3. No memoization of dynamic RPC data across calls
  4. Errors throw (except SimulationResult returns { success: false })
  5. Greeks return WAD-scaled bigint (1e18)
  6. Bot assertions throw typed errors, don't return booleans

To publish:
  1. Run `pnpm build` and verify output
  2. Run `pnpm vitest run src/panoptic/v2` (541 tests)
  3. Update package version
  4. `pnpm publish`
===
```
