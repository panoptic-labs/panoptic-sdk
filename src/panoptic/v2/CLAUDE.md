# Panoptic v2 SDK - Claude Code Guide

## Project Overview

You are implementing the `@panoptic/sdk` (Panoptic v2 SDK) MVP - a TypeScript SDK for interacting with the Panoptic v2 perpetual options protocol on EVM chains.

**Key Characteristics:**
- **Package Name**: `panoptic-v2-sdk`
- **Runtime Dependency**: viem (required)
- **Design**: Flat function API, viem-native, all numerics are `bigint`
- **No subgraph required** - SDK tracks positions locally via persistent cache

---

## Sources of Truth

| Source | Location | Purpose |
|--------|----------|---------|
| **spec.md** | `src/panoptic/v2/spec.md` | SDK behavior, interfaces, API design, implementation constraints |
| **PLAN.md** | `src/panoptic/v2/PLAN.md` | Implementation plan, phase status, context handoffs |
| **Contracts** | `contracts/*.sol` | Protocol encoding details (bit layouts, struct packing, event signatures) |
| **Generated ABIs** | `src/generated.ts` | From `pnpm codegen:wagmi` |

---

## Commands

```bash
# Type checking
tsc --noEmit

# Run all tests
pnpm vitest run src/panoptic/v2

# Run specific test file
pnpm vitest run src/panoptic/v2/path/to/file.test.ts

# Run fork tests (Anvil required)
pnpm test:fork

# Generate ABIs
pnpm codegen:wagmi
```

---

## Critical Implementation Constraints

These are **non-negotiable** constraints from spec.md §Implementation Constraints:

### Type System
- [ ] **Flat function API only** - No class-based public API, no class inheritance
- [ ] **All numeric values are `bigint`** - No exceptions (except: ticks, bps, chainId can be number)
- [ ] **No `any` types** - Never use `any`, `unknown as`, `@ts-ignore`, or `// eslint-disable`
- [ ] **No circular dependencies** - Module A cannot import B which imports A
- [ ] **No "God Files"** - Types co-located or in dedicated `types/` files

### Caching & Data Freshness
- [ ] **No memoization of dynamic RPC data** - Never cache prices, balances, utilization, pool state across calls
- [ ] **In-flight dedupe OK** - Within a single SDK function call only
- [ ] **Timestamp comparisons** - Use `_meta.blockTimestamp`, NEVER `Date.now()`

### Multicall & Block Consistency
- [ ] **Same-block guarantee** - All aggregate reads in ONE `Multicall3` `eth_call`
- [ ] **Block metadata** - Additional `eth_getBlockByNumber` for timestamp/hash
- [ ] **`_meta` field** - All reads return `{ blockNumber, blockTimestamp, blockHash }`

### Error Handling
- [ ] **Errors throw** - All public errors are typed exceptions extending `PanopticError`
- [ ] **Exception: SimulationResult** - Returns `{ success: false }` for contract reverts

### Config & Storage
- [ ] **Storage keys** - Format: `panoptic-v2-sdk:v{VERSION}:chain{chainId}:pool{address}:{entity}:{id}`
- [ ] **Chunk limit** - 1000 chunks per pool, throws `ChunkLimitError` if exceeded

### Formatters
- [ ] **Explicit precision** - All formatters require explicit `precision` parameter

---

## Module Implementation Loop

**For every module, follow this loop in order:**

### Step 1: Write
- Implement per spec.md and current phase requirements
- Include TSDoc for all public exports
- Keep modules small and composable; prefer pure functions

### Step 2: Type Check
```bash
tsc --noEmit
```
- Fix ALL type errors before proceeding
- **NEVER** use `any` to silence errors - ask for help instead

### Step 3: Test
- Write unit tests covering: happy path, edge cases, error throwing
- Run: `pnpm vitest run <test file>`
- All tests must pass

### Step 4: Verify Invariants
Reject module as "complete" if ANY fails:
- [ ] No class inheritance in public API
- [ ] All numerics are bigint (except ticks, bps, chainId)
- [ ] No memoization of dynamic RPC data across calls
- [ ] Errors throw (except SimulationResult)
- [ ] Storage keys include schema version + chainId + poolAddress
- [ ] Formatters require explicit precision
- [ ] Aggregate reads pin to same block via single multicall
- [ ] Timestamp comparisons use `_meta.blockTimestamp`
- [ ] No circular dependencies
- [ ] No `any` types

### Step 4b: Regression (Phase 3+)
```bash
pnpm vitest run src/panoptic/v2
```
- If any previously passing test fails, fix before proceeding

### Step 5: Report
Output:
- Files created/modified
- Commands run + actual results
- Test count and status
- Invariants validated (checklist)
- Any TODOs or spec ambiguities

---

## Checkpoint Workflow

**STOP after each phase for approval.** At each STOP, output:

1. Checkpoint summary (what was implemented)
2. Invariants validated (which checks passed, how)
3. Open questions / ambiguities
4. **Context Handoff Block**

### Context Handoff Block Format
```
=== CONTEXT HANDOFF (Phase N -> Phase N+1) ===
Architecture: [key decisions made]
Modules completed: [list]
Next phase focus: [what Phase N+1 will implement]
Critical invariants to maintain: [top 5]
===
```

---

## Current State (as of last update)

### Phase Status

| Phase | Status | Tests |
|-------|--------|-------|
| Phase 0: Plan | ✅ Complete | - |
| Phase 1: Skeleton + Test Harness | ✅ Complete | 160 |
| Phase 2: Core Read Functions | ✅ Complete | 188 |
| Phase 3: Write Functions + Simulation | ✅ Complete | 251 |
| Phase 3b: Examples + Demonstrations | ✅ Complete | 303 |
| Phase 4: Position Tracking + Sync | ✅ Complete | 311 |
| Phase 4b: Examples with Position Tracking | ✅ Complete | 370 |
| Phase 5: Events + Formatters | ✅ Complete | 452 |
| **Phase 6: Client-side Greeks + Bot Utilities** | ✅ Complete | 557 |
| Phase 7: Config + Polish | ⏳ Pending | - |

### Latest Context Handoff

```
=== CONTEXT HANDOFF (Phase 6 Complete → Phase 7) ===

Completed: Client-side greeks + Bot utilities
Test Count: 557 passing
Location: src/panoptic/v2/greeks/, src/panoptic/v2/bot/

Phase 6 Deliverables:
  ✅ Client-side greeks (greeks/index.ts, 28 tests):
    - getLegValue, getLegDelta, getLegGamma (per-leg calculations)
    - calculatePositionValue/Delta/Gamma/Greeks (position aggregates)
    - isCall, isDefinedRisk helpers
    - All bigint inputs, WAD-scaled bigint outputs

  ✅ Bot utilities (bot/index.ts, 37 tests):
    - assertFresh: Throws StaleDataError if data too old
    - assertHealthy: Throws UnhealthyPoolError if pool not active
    - assertTradeable: Checks pool health + safe mode
    - assertCanMint/Burn/Liquidate/ForceExercise: Safe mode checks
    - isRetryableRpcError: Classify transient RPC errors
    - isNonceError, isGasError: Specific error classification

  ✅ Premia tracking (reads/premia.ts):
    - getAccountPremia, getPositionsWithPremia (per-position via multicall)

  ✅ Position data updates:
    - positionData() returns 7 values (added swapAtMint)

Critical invariants:
  1. All numeric values are bigint (greeks use WAD=1e18 scaling)
  2. Same-block guarantee via single Multicall3 eth_call
  3. Typed errors (PanopticError subclasses)
  4. Bot assertions throw, don't return booleans
===
```

---

## Key Patterns Established

### 1. Transaction Lifecycle
```typescript
interface TxResult {
  hash: `0x${string}`
  wait: (confirmations?: bigint) => Promise<TxReceipt>
}
```

### 2. Simulation Result
```typescript
type SimulationResult<T> =
  | { success: true; data: T; gasEstimate: bigint; _meta: BlockMeta }
  | { success: false; error: ParsedError; _meta: BlockMeta }
```

### 3. Block Metadata
```typescript
interface BlockMeta {
  blockNumber: bigint
  blockTimestamp: bigint  // Unix seconds
  blockHash: `0x${string}`
}
```

### 4. TokenId Builder
```typescript
const tokenId = createTokenIdBuilder(poolId)
  .addCall({ strike: 100, width: 10, optionRatio: 1 })
  .build()
```

### 5. Storage Keys
```typescript
getPositionsKey(chainId, poolAddress, account)      // tracked tokenIds
getSyncCheckpointKey(chainId, poolAddress, account) // resumable sync
getClosedPositionsKey(chainId, poolAddress, account)// trade history
```

---

## Directory Structure

```
src/panoptic/v2/
├── types/           # Type definitions
├── errors/          # PanopticError + contract/SDK errors
├── storage/         # StorageAdapter implementations
├── utils/           # constants (WAD, MIN_TICK, MAX_TICK, etc.)
├── clients/         # getBlockMeta, multicallRead
├── reads/           # getPool, getPosition, getAccountCollateral, premia, etc.
├── writes/          # approve, deposit, openPosition, etc.
├── simulations/     # simulateOpenPosition, simulateDeposit, etc.
├── tokenId/         # createTokenIdBuilder, decodeTokenId
├── sync/            # syncPositions, position tracking
├── events/          # watchEvents, createEventSubscription, createEventPoller
├── formatters/      # tickToPrice, formatTokenAmount, formatBps, etc.
├── greeks/          # getLegValue, getLegDelta, getLegGamma, isDefinedRisk
├── bot/             # assertFresh, assertHealthy, isRetryableRpcError
├── react/           # queryKeys, mutationEffects
├── abis/            # Custom ABIs (panopticQuery, errors)
└── examples/        # Bot examples, fork tests
```

---

## Sepolia Deployment (for testing)

WETH/USDC 500 pool:
- PanopticPool: `0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78`
- CollateralTracker0 (WETH): `0x4f29B472bebbFcEEc250a4A5BC33312F00025600`
- CollateralTracker1 (USDC): `0x244Bf88435Be52e8dFb642a718ef4b6d0A1166BF`
- PanopticHelper: `0x687F616d68c483A7223E6922F59Aef7452E26c1D`

---

## Next Step

**Phase 7: Config + Polish**

- [ ] TSDoc on all public exports
- [ ] Final documentation review
- [ ] Build optimization and tree-shaking verification

**Deferred:**
- `createConfig()` / `updateConfig()` - not needed for MVP (users pass params directly)
- Bundled chain addresses - users provide addresses manually
- Examples 08-pending-positions.ts and 09-reorg-handling.ts
- Market Maker Bot (`examples/market-maker/`)
- Analytics Dashboard (`examples/analytics-dashboard/`)
