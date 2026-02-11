# Panoptic v2 TypeScript SDK Specification (MVP)

## Overview

A TypeScript SDK for interacting with the Panoptic v2 perpetual options protocol. The SDK provides a high-level, opinionated interface for trading options on EVM chains where Panoptic v2 is deployed.

### Key Characteristics

- **Protocol**: DeFi perpetual options protocol (no expiry, force exercise when ITM)
- **Package Name**: `panoptic-v2-sdk`
- **Implementation**: Greenfield TypeScript implementation
- **Target Use Cases**: Trading bots, dApp frontends, analytics backends (general purpose)
- **Release Strategy**: MVP first, actively maintained, 0.x semver (breaking changes in minor versions)

### Dependencies

| Type | Dependency | Required |
|------|------------|----------|
| Runtime | viem | Yes |
| External | RPC endpoint | Yes |

**No subgraph required**. The SDK tracks positions locally via a persistent cache that syncs from on-chain events.

### Design Principles

1. **Always-fresh chain state**: Dynamic data (prices, balances, utilization, pool state, position data) is fetched fresh on every call. Only immutable constants (ABIs, addresses, decimals, RiskEngine's immutable parameters) are cached.
2. **Same-block consistency**: Aggregate reads are collected in a single multicall to guarantee all returned data reflects the same block.
3. **Persistent derived indices**: Expensive-to-recompute derived state (position tokenIds, chunk keys, liquidation thresholds) is persisted via user-provided storage adapter—not cached RPC responses.
4. **Viem-native**: Built on viem transports and conventions. All numeric values are `bigint`.
5. **Flat function API**: Standalone functions with config as first parameter. No classes, no inheritance.
6. **Composable primitives**: Exposes low-level building blocks (`dispatch()`, token identifiers, raw calldata) for advanced integrations.
7. **Typed exceptions**: Errors throw typed exceptions extending `PanopticError`. Simulations return `{ success: false }` for UI-friendly error handling.
8. **Tree-shakeable**: All exports support tree-shaking.

---

## Implementation Constraints

These are hard constraints that govern the SDK implementation. They are non-negotiable for correctness and API consistency.

### Type System

- **Flat function API only**: No class-based public API. No class inheritance. All public functions are standalone with config as the first parameter.
- **All numeric values are `bigint`**: No exceptions.
- **No `any` types**: Do not use `any`, `unknown as`, `@ts-ignore`, or `// eslint-disable` to silence type errors. Ask for help with complex generics rather than resorting to `any`.
- **No circular dependencies**: Module A cannot import B which imports A.
- **No "God Files"**: Types are co-located with their modules or in dedicated `types/` subdirectory files, not dumped into a single global `types.ts`.

### Caching & Data Freshness

- **No memoization of dynamic RPC data**: Never cache prices, balances, utilization, pool state, position data, slot0, allowances, etc. across calls.
  - **Clarification**: In-flight dedupe within a single top-level SDK function call IS allowed (to avoid duplicate multicall entries). Cross-call memoization is FORBIDDEN.
- **Only cache truly static constants**: ABIs, contract addresses, token decimals/symbols, pool constants (tickSpacing, fee tier), RiskEngine's immutable parameters.
- **Persistent derived indices via StorageAdapter only**: Position tokenIds, chunk keys, trade history, sync checkpoints, static position mint metadata.
- **Timestamp comparisons**: Use `_meta.blockTimestamp` from RPC responses, NEVER `Date.now()`.

### Multicall & Block Consistency

- **Same-block guarantee**: All read-only aggregate data returned together must be from the same block, collected via ONE `Multicall3` `eth_call`.
- **Exception for static prefetches**: First-time static constant prefetches (token decimals, symbols, pool tickSpacing) may be fetched separately and cached permanently. These are not subject to same-block consistency since they never change.
- **Block metadata retrieval**: `Multicall3` returns `blockNumber` (not `blockTimestamp` or `blockHash`). To get both, make ONE additional `eth_getBlockByNumber` call for the returned `blockNumber`.
- **`_meta` field types** (explicit):
  - `_meta.blockNumber`: `bigint`
  - `_meta.blockTimestamp`: `bigint` (Unix seconds)
  - `_meta.blockHash`: `` `0x${string}` `` (hex string)
- **`blockHash` is critical** for reorg detection and cache checkpoint validation.
- **Gas estimation is separate**: `eth_estimateGas` calls cannot be bundled inside multicall. Gas estimation may have a different `blockNumber` than state inspection - document in `_meta` if they differ.

### Error Handling

- **All errors must throw**: Public errors must be typed exceptions (extend `PanopticError`) and thrown.
- **Exception for SimulationResult**: Simulation functions return `success: false` for contract reverts (not throw), allowing UIs to display errors gracefully without try/catch.
- **Network errors throw**: RPC failures, timeouts, and connection errors always throw.

### Config Pattern

- **Direct params**: All SDK functions accept params directly (e.g., `{ client, poolAddress, account }`). No `createConfig()` or `PanopticConfig` object - users pass what each function needs.

### Batch Operations

- **Batch atomicity**: `dispatch()` with multiple operations is atomic (all-or-nothing). Do not implement partial success handling.

### Storage Schema

Storage keys must follow this format for namespacing and versioning:

```
panoptic-v2-sdk:v{SCHEMA_VERSION}:chain{chainId}:pool{address}:{entity}:{id}
```

- **Schema versioning**: Include `schemaVersion` key in storage.
- **Version mismatch handling**: On schema version mismatch, either clear storage (MVP) or call a `migrate()` hook (future).

### Formatter Precision

- **Explicit precision required**: All formatters (`formatTokenAmount`, `formatBps`, `formatUtilization`, `formatWad`) require an explicit `precision` parameter. No hidden defaults.

### Chunk Tracking Limits

- **Hard limit**: 1000 chunks per pool config. Exceeding this throws `ChunkLimitError`.

### Dependency Versions

- **viem v2.x and wagmi v2.x**: Use current v2 syntax. Do not use deprecated v1 patterns.
- **wagmi for ABI generation only**: Configure `wagmi.config.ts` for VANILLA actions/types, NOT React hooks.

---

## Architecture

### V2 Protocol Differences

Panoptic v2 introduces significant architectural changes from v1:

- **Uniswap V4**: Built on Uniswap v4 PoolManager, using PoolKey identifiers
- **Pluggable RiskEngine**: Same Uniswap pool can have multiple PanopticPools with different RiskEngines
- **Portfolio Cross-Margin**: Collateral is managed at portfolio level via CollateralTracker using RiskEngine's parameters, not per-position
- **Perpetual Settlement**: No expiry dates; positions can be force-exercised by sellers
- **No v1 Migration**: SDK is v2-only, no compatibility with v1 positions

### Protocol Contracts

```
┌─────────────────────────────────────────────────────────────────┐
│                     Panoptic v2 Contracts                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  PanopticPool   │───▶│      SFPM       │                     │
│  │                 │    │ (Semi-Fungible  │                     │
│  │  - dispatch()   │    │  Position Mgr)  │                     │
│  │  - liquidate()  │    │                 │                     │
│  │  - forceExercise│    │  - ERC1155      │                     │
│  │  - getAccumFees │    └─────────────────┘                     │
│  └────────┬────────┘                                            │
│           │                                                     │
│  ┌────────▼────────┐    ┌─────────────────┐                     │
│  │CollateralTracker│    │   RiskEngine    │                     │
│  │  (x2: token0/1) │    │                 │                     │
│  │                 │    │  - getMargin()  │                     │
│  │  - ERC4626 vault│    │  - solvency     │                     │
│  │  - interest rate│    │  - safe mode    │                     │
│  └─────────────────┘    │  - oracle       │                     │
│                         └─────────────────┘                     │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ PanopticFactory │    │ PanopticQuery  │                     │
│  │  - deployPool   │    │ (Upgradable)    │                     │
│  └─────────────────┘    │                 │                     │
│                         │  - getLiqPrices │                     │
│                         │  - getNLV       │                     │
│                         │  - getGreeks    │                     │
│                         │  - quoteFinalPx │                     │
│                         │  - getPoolLiqs  │                     │
│                         └─────────────────┘                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Contract Source Files**:
- `PanopticPool` - `contracts/PanopticPool.sol`
- `SemiFungiblePositionManager` (SFPM) - `contracts/SemiFungiblePositionManagerV4.sol`
- `CollateralTracker` - `contracts/CollateralTracker.sol`
- `RiskEngine` - `contracts/RiskEngine.sol`
- `PanopticFactory` - `contracts/PanopticFactoryV4.sol`
- `PanopticQuery` - **Note: Not yet implemented in contracts directory. This is a planned upgradable proxy contract for RPC-intensive computations.**

**Key Contract Functions for Computed Values**:
- `PanopticPool.getAccumulatedFeesAndPositionsData()` - Returns premia owed + position balances (see `contracts/PanopticPool.sol:434`)
- `PanopticPool.dispatch()` - Execute position operations (mint/burn) (see `contracts/PanopticPool.sol:577`)
- `RiskEngine.getMargin()` - Returns maintenance requirement + available balance per token (see `contracts/RiskEngine.sol:1057`)
- `CollateralTracker.deposit()` / `withdraw()` - ERC4626 vault operations (see `contracts/CollateralTracker.sol:569`, `contracts/CollateralTracker.sol:720`)
- `PanopticQuery` (upgradable proxy) - **Planned contract** for RPC-intensive computations:
  - `getLiquidationPrices()` - Binary search for liquidation ticks
  - `getNetLiquidationValue()` - NLV at any tick
  - `getPositionGreeks()` - Value/delta/gamma for positions
  - `getMaxPositionSize()` - Max size given current collateral
  - `estimateCollateralRequired()` - Collateral needed for a position
  - `quoteFinalPrice()` - Simulate swap to get final price
  - `getPoolLiquidities()` - Uniswap net liquidities at all ticks in range
  - `scanChunks()` - Discover all non-empty chunks in a tick range (for volatility surface)

**Custom Types** (used throughout the protocol):
- `TokenId` - `contracts/types/TokenId.sol` - Encodes position leg data (asset, optionRatio, isLong, tokenType, riskPartner, strike, width)
- `LiquidityChunk` - `contracts/types/LiquidityChunk.sol` - Encodes liquidity amount and tick range
- `LeftRight` - `contracts/types/LeftRight.sol` - Dual-slot storage for token0/token1 values
- `PositionBalance` - `contracts/types/PositionBalance.sol` - Position size and utilization data
- `OraclePack` - `contracts/types/OraclePack.sol` - Oracle observation storage
- `RiskParameters` - `contracts/types/RiskParameters.sol` - Risk configuration
- `MarketState` - `contracts/types/MarketState.sol` - Market state data
- `PoolData` - `contracts/types/PoolData.sol` - Pool configuration data

### SDK Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      panoptic-v2-sdk                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Flat Function API                              ││
│  │                                                             ││
│  │  Read Functions        Write Functions      Simulation      ││
│  │  ───────────────       ───────────────      ──────────────  ││
│  │  getPool()             openPosition()       simulate*()     ││
│  │  getPosition()         closePosition()      (preview modal) ││
│  │  getAccountSummaryBasic()   forceExercise()                      ││
│  │  getLiquidationPrices()liquidate()          Position Cache  ││
│  │  getPositionGreeks()   deposit()            ─────────────── ││
│  │  ...                   withdraw()           syncPositions() ││
│  │                        dispatch() [raw]     getTracked...() ││
│  └─────────────────────────────────────────────────────────────┘│
│                          │                                      │
│              ┌───────────┼───────────┐                          │
│              │           │           │                          │
│        ┌─────▼─────┐ ┌───▼───┐ ┌─────▼─────┐                    │
│        │   viem    │ │ event │ │ storage   │                    │
│        │ transport │ │ sync  │ │ adapter   │                    │
│        └───────────┘ └───────┘ └───────────┘                    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Global Module Cache (Memoized)                 │   │
│  │  - ABIs, contract addresses, token decimals, tickSpacing │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key Architecture Decisions**:
1. **Flat function API**: No classes or inheritance. Every public function takes `config` as first parameter, enabling tree-shaking and simple composition.
2. **Same-block consistency via multicall**: All aggregate reads (`getAccountSummaryBasic()`, `getPosition()`) collect data in a single `Multicall3` call, guaranteeing all returned values reflect the same block state.
3. **Two-tier caching strategy**:
   - *Module cache* (in-memory): ABIs, contract addresses, token decimals, pool constants. Fetched once, never expires.
   - *Storage adapter* (persistent): Position tokenIds, sync checkpoints, derived indices. User-provided, survives restarts.
4. **Event-based position tracking (no subgraph)**: Positions are discovered by syncing `OptionsMinted`/`OptionsBurned` events via RPC. The storage adapter persists tokenIds for fast startup.
5. **UI-first aggregate functions**: `getAccountSummaryBasic()` batches dashboard data (positions, collateral, margin, PnL) into one RPC round-trip. Designed for React `useQuery()` patterns.
6. **Simulation for transaction previews**: `simulate*()` functions return `{ success, error?, result? }` instead of throwing, enabling "Review Transaction" modals to display errors inline.
7. **Contract abstraction**: SDK routes to the appropriate contract (PanopticPool, RiskEngine, PanopticQuery) internally. Users call `getLiquidationPrices()` without knowing which contract computes it.
8. **Viem-native types**: All numeric values are `bigint`. No `number` or `string` conversions at boundaries.

---

## Configuration

The SDK uses a **direct params** pattern - each function receives the parameters it needs directly. There is no `createConfig()` or global config object.

### Read Functions

Read functions accept a `PublicClient` and pool address:

```typescript
import { createPublicClient, http } from 'viem'
import { getPool, getPosition, getAccountCollateral } from 'panoptic-v2-sdk'

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth-mainnet.g.alchemy.com/v2/...'),
})

// Each function receives what it needs
const pool = await getPool({
  client,
  poolAddress: '0x...',
})

const position = await getPosition({
  client,
  poolAddress: '0x...',
  account: '0x...',
  tokenId: 123n,
})
```

### Write Functions

Write functions accept a `WalletClient` in addition:

```typescript
import { createWalletClient, http } from 'viem'
import { openPosition, deposit } from 'panoptic-v2-sdk'

const walletClient = createWalletClient({
  chain: mainnet,
  transport: http('...'),
  account: privateKeyToAccount('0x...'),
})

const result = await openPosition({
  client,
  walletClient,
  account,
  poolAddress: '0x...',
  existingPositionIds: [],
  tokenId,
  positionSize: 1000000000000000000n,
  tickAndSpreadLimits: [-887272n, 887272n, 0n],
})
```

### Storage for Position Tracking

Functions that need persistent storage accept a `StorageAdapter`:

```typescript
import { createFileStorage, syncPositions } from 'panoptic-v2-sdk'

const storage = createFileStorage('./cache')

await syncPositions({
  client,
  poolAddress: '0x...',
  account: '0x...',
  storage,
})
```

### Network Mismatch Handling

Write functions throw `NetworkMismatchError` if the wallet is on the wrong chain:

```typescript
try {
  await openPosition({ client, walletClient, poolAddress, ... })
} catch (e) {
  if (e instanceof NetworkMismatchError) {
    // e.walletChainId = 1 (mainnet)
    // e.expectedChainId = 42161 (arbitrum)
    showSwitchNetworkModal(e.expectedChainId)
  }
}
```

- Guest mode handles `account: undefined` gracefully
- No need to recreate storage adapter or resync positions on wallet switch

### Block Pinning (Read Consistency)

Aggregate reads (`getAccountSummaryBasic`, `simulate*`) need same-block consistency. Without it, you get mixed-block state when RPC races between blocks.

```typescript
// All aggregate/simulation functions accept blockTag
const summary = await getAccountSummaryBasic(config, {
  account,
  blockTag: 'latest',          // 'latest' | 'pending' | bigint
})

// Response includes the block used
summary._meta.blockNumber      // The block all data was fetched at
summary._meta.blockTimestamp

// For simulations
const result = await simulateOpenPosition(config, {
  account,
  tokenId,
  size,
  blockTag: 18000000n,         // Pin to specific block for reproducibility
})
```

**Atomic multicall semantics**: All aggregate reads are performed via a single `eth_call` to a Multicall3 contract. This guarantees same-block consistency - every value in the response is from the same block.

**When to use which:**
- `'latest'` (default) - Most UIs, bots wanting confirmed state
- `'pending'` - Post-tx previews, seeing mempool state
- `bigint` - Historical queries, reproducibility testing

```typescript
// Block tag options
type BlockTag = 'latest' | 'pending' | bigint
```

### RPC Failure Model

The SDK distinguishes retryable from non-retryable errors:

**Retryable** (SDK auto-retries per `config.rpc` settings):
- `429 Too Many Requests` (rate limit)
- `408 Request Timeout`
- `-32005` (log response too large)
- Transport disconnects
- Network errors

**Non-retryable** (thrown immediately):
- Contract reverts (decoded to typed errors)
- Decode errors (ABI mismatch)
- Invalid parameters
- Authentication failures

```typescript
// Check if error is retryable (for custom retry logic)
import { isRetryableRpcError } from 'panoptic-v2-sdk'

try {
  await getAccountSummaryBasic({ client, poolAddress, account, chainId, tokenIds })
} catch (e) {
  if (isRetryableRpcError(e)) {
    // SDK already retried config.rpc.maxRetries times
    // This is the final failure
    console.log('RPC temporarily unavailable')
  } else {
    // Logic error, don't retry
    throw e
  }
}
```

**Request coalescing**: The SDK does NOT de-duplicate in-flight requests. For UIs with TanStack Query that may stampede on focus/refetch, rely on TanStack Query's built-in deduplication:

```typescript
// TanStack Query already dedupes in-flight requests with same queryKey
useQuery({
  queryKey: queryKeys.accountSummary(pool, account),
  queryFn: () => getAccountSummaryBasic({ client, poolAddress, account, chainId, tokenIds }),
  // These are already deduped by TanStack Query:
  refetchOnWindowFocus: true,
  refetchOnMount: true,
})
```

---

## Position Tracking

### Why Position Tracking is Needed

The Panoptic protocol stores positions in a mapping `s_positionBalance[user][tokenId]` but provides **no on-chain enumeration** of a user's tokenIds. The contract expects callers to provide the `positionIdList` for all queries.

The SDK solves this by:
1. Syncing `OptionMinted` / `OptionBurnt` events to track position tokenIds
2. Persisting the sync state via a user-provided storage adapter
3. Providing functions to query tracked positions

### Storage Adapter Interface

Users provide a storage adapter for persistence. SDK ships with common adapters:

```typescript
// Storage adapter interface
interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

// Built-in adapters
import {
  createFileStorage,    // Node.js file-based (./cache/{key}.json)
  createMemoryStorage,  // In-memory (for testing, not persistent)
} from 'panoptic-v2-sdk'

// Custom adapter example (Redis)
const redisStorage: StorageAdapter = {
  get: (key) => redis.get(`panoptic:${key}`),
  set: (key, value) => redis.set(`panoptic:${key}`, value),
  delete: (key) => redis.del(`panoptic:${key}`),
}
```

### BigInt Serialization

`JSON.stringify({ val: 100n })` throws a TypeError. The SDK exports a standard serializer that handles BigInt hydration/dehydration:

```typescript
import { jsonSerializer } from 'panoptic-v2-sdk'

// Serialize (BigInt → tagged string)
const json = jsonSerializer.stringify({ amount: 1000000000000000000n })
// '{"amount":{"__type":"bigint","value":"1000000000000000000"}}'

// Parse (tagged string → BigInt)
const obj = jsonSerializer.parse(json)
// { amount: 1000000000000000000n }
```

**Usage with storage adapters**: The SDK uses `jsonSerializer` internally for the position cache. Custom adapters receive pre-serialized strings.

**Usage in React state**: For Redux/Zustand stores that serialize state, use `jsonSerializer` for slices containing SDK data.

### SSR Hydration (Next.js / Remix)

Server-Side Rendering frameworks serialize data from Server Components to Client Components. BigInt causes hydration mismatches.

**Pattern 1: Use superjson (Recommended)**

The `jsonSerializer` format is compatible with [superjson](https://github.com/blitz-js/superjson):

```typescript
// next.config.js - Enable superjson transformer
// Or use the superjson plugin for your framework

// Server Component
import { getAccountSummaryBasic } from 'panoptic-v2-sdk'
import superjson from 'superjson'

export default async function Page() {
  const summary = await getAccountSummaryBasic({ client, poolAddress, account, chainId, tokenIds })
  // superjson handles BigInt automatically
  return <ClientComponent data={superjson.serialize(summary)} />
}

// Client Component
'use client'
import superjson from 'superjson'

export function ClientComponent({ data }) {
  const summary = superjson.deserialize(data)
  // summary.collateral.shares0 is BigInt again
}
```

**Pattern 2: Manual serialization**

```typescript
// Server Component
import { jsonSerializer } from 'panoptic-v2-sdk'

export default async function Page() {
  const summary = await getAccountSummaryBasic({ client, poolAddress, account, chainId, tokenIds })
  return <ClientComponent serialized={jsonSerializer.stringify(summary)} />
}

// Client Component
'use client'
import { jsonSerializer } from 'panoptic-v2-sdk'

export function ClientComponent({ serialized }) {
  const summary = useMemo(() => jsonSerializer.parse(serialized), [serialized])
}
```

**Pattern 3: TanStack Query with SSR**

For TanStack Query's SSR hydration, configure the `queryClient` with a custom serializer:

```typescript
// app/providers.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Use superjson for hydration
      structuralSharing: false,  // Disable for BigInt compatibility
    },
  },
})
```

**Note**: The SDK's `jsonSerializer` uses `{__type: "bigint", value: "..."}` tagging which is compatible with superjson's format. If you're already using superjson in your app, it will "just work."

### Sync Functions

```typescript
// Sync positions - recovers from last dispatch() tx, then syncs forward
const syncState = await syncPositions(config, {
  account: '0x...',
  // Optional parameters for controlling log queries:
  fromBlock?: bigint,           // Start block for event scan (default: pool deployment block)
  toBlock?: bigint,             // End block (default: 'latest')
  maxLogsPerQuery?: bigint,     // Max block range per eth_getLogs call (default: 10000n)
  syncTimeout?: bigint,         // Max sync duration in ms (default: 300000n = 5 min)
  onUpdate?: (event: SyncEvent) => void,  // Optional callback for sync progress
})
// Returns: { lastSyncedBlock: bigint, lastSyncedBlockHash: string, positionCount: bigint }

// SyncEvent callback for reactive updates
interface SyncEvent {
  currentBlock: bigint
  targetBlock: bigint
  positionsFound: bigint
  progress: bigint              // 0-100
}

// Same function handles both initial sync and incremental sync:
// - No cache: finds last dispatch() tx, extracts finalPositionIdList, syncs events forward
// - Has cache: syncs events forward from last checkpoint
// - No dispatch() tx found: falls back to full event reconstruction (chunked)
// - MVP: No router/multicall handling - assumes direct dispatch() calls only

// Get sync status
const status = await getSyncStatus(config, { account: '0x...' })
// { lastSyncedBlock: bigint, isSynced: boolean, blocksBehind: bigint }
```

### Log Query Chunking

The SDK automatically chunks `eth_getLogs` queries to avoid RPC provider limits:

```typescript
// Default: 10,000 blocks per query (safe for most public RPCs)
// Alchemy/Infura typically allow 10k-100k blocks per query
// Some public RPCs cap at 2k blocks

// For restrictive RPCs, reduce chunk size:
await syncPositions(config, {
  account: '0x...',
  maxLogsPerQuery: 2000n,  // Smaller chunks for restrictive RPCs
})

// For premium RPCs, increase for faster sync:
await syncPositions(config, {
  account: '0x...',
  maxLogsPerQuery: 50000n,  // Larger chunks for Alchemy/Infura
})
```

**Chunking behavior:**
- SDK iterates `[fromBlock, fromBlock + maxLogsPerQuery]`, then `[fromBlock + maxLogsPerQuery + 1, ...]`
- Each chunk is a separate `eth_getLogs` call
- Progress is saved after each chunk (resumable on failure)
- Throws `SyncTimeoutError` if total sync exceeds `syncTimeout` (default: 5 minutes)

### Querying Tracked Positions

```typescript
// Get all tracked tokenIds for an account (from local cache)
const tokenIds = await getTrackedPositionIds(config, {
  account: '0x...',
})
// Returns: bigint[] (may include closed positions until synced)

// Get positions with full data (uses tracked tokenIds + RPC)
const positions = await getPositions(config, {
  account: '0x...',
})
// Internally: getTrackedPositionIds() → getAccumulatedFeesAndPositionsData() → filter by positionSize > 0

// Manual tokenId query (bypasses cache, user provides tokenId)
const position = await getPosition(config, {
  tokenId: 123n,
})
// Calls PanopticPool.positionData() for balance, getAccumulatedFeesAndPositionsData() for premia
```

**Note**: `syncPositions()` only tracks tokenIds locally. Position data (size, premia, ticks at mint) is always fetched fresh from the contract via `getAccumulatedFeesAndPositionsData()` which returns `PositionBalance` data for each position.

### Sync Behavior

- **Snapshot recovery**: On first sync (no cached state), SDK finds the user's last `dispatch()` transaction and extracts `finalPositionIdList` - this gives the complete position set at that point
- **Incremental sync**: From snapshot block forward, scans `OptionMinted`/`OptionBurnt` events to update
- **Write operations**: `openPosition()` and `closePosition()` automatically update local cache
- **Stale cache**: If cache is behind, `getPositions()` filters out closed positions by checking `positionSize > 0` on-chain

### Reorg Handling

The SDK implements minimum viable reorg detection to ensure cache correctness:

```typescript
interface SyncState {
  status: SyncStatus             // 'idle' | 'syncing' | 'error' | 'complete'
  lastSyncedBlock: bigint
  lastSyncedBlockHash: Hash
  targetBlock: bigint
  positionsFound: bigint
  progress: bigint               // 0-100
  errorMessage?: string
  startedAt: bigint
  completedAt?: bigint
}
```

**On each sync:**
1. Fetch current block's parent hash
2. Compare against stored `lastSyncedBlockHash`
3. If mismatch (reorg detected): roll back `REORG_SAFETY_BLOCKS` (fixed: 128 blocks) and rescan
4. If match: continue incremental sync from `lastSyncedBlock`

**Note**: This catches most reorgs. Deep reorgs (>128 blocks) are extremely rare on mainnet; if encountered, a full resync from `fromBlock` is triggered.

**Chain support**: The fixed 128-block safety depth is designed for high-finality chains (Ethereum mainnet, Arbitrum, Base). Chains with frequent deep reorgs (e.g., BSC, Polygon PoS) may require additional handling or are not recommended for MVP.

### Position Discovery

The SDK recovers positions from `dispatch()` calldata - no event scanning required.

**How it works:**
1. Query `OptionMinted` / `OptionBurnt` logs filtered by `owner` (indexed parameter)
2. Find the most recent log for the user
3. Fetch tx calldata via `eth_getTransactionByHash`
4. Decode `finalPositionIdList` from the `dispatch()` call
5. Sync events forward from that block

This works because `dispatch()` requires callers to pass `finalPositionIdList` (validated on-chain against `s_positionsHash`), making the calldata an authoritative snapshot.

**When automatic discovery fails:**
If no logs exist, or the tx isn't a direct `dispatch()` call (e.g., user interacted via aggregator/router), the SDK throws `PositionSnapshotNotFoundError`. The caller must provide a recovery hint:

```typescript
// Automatic discovery (default)
await syncPositions(config, { account })

// Manual recovery when automatic fails
await syncPositions(config, {
  account,
  snapshotTxHash: '0x...',  // A tx containing a valid dispatch() call for this account
})
```

**Why not scan all events?** Full event reconstruction is expensive and wasteful for accounts with no history. Requiring an explicit `snapshotTxHash` keeps the SDK predictable and avoids silent slow paths.

### Optimistic Updates (Pending Positions)

Between tx submission and event indexing, positions temporarily "disappear" from `getPositions()`. The SDK maintains a **pending position cache** to prevent UI flicker:

```typescript
// When openPosition() is called:
// 1. SDK injects a "shadow position" into local cache immediately
// 2. getPositions() returns [...confirmedPositions, ...pendingPositions]

interface Position {
  // ... existing fields
  pending?: boolean  // true = submitted but not yet mined/indexed
}
```

**Lifecycle:**
1. `openPosition()` called → Shadow position added with `pending: true`
2. `wait()` resolves → Position stays pending until `syncPositions()` runs
3. `syncPositions()` finds `OptionMinted` event → Shadow replaced with confirmed position
4. If tx reverts → Shadow position removed automatically

**UI usage:**
```typescript
const positions = await getPositions(config, { account })

// Show pending positions with visual indicator
positions.forEach(p => {
  if (p.pending) {
    showSpinner(p.tokenId)  // "Opening..."
  }
})
```

**Note**: Pending positions have estimated data (from simulation). Confirmed positions have authoritative on-chain data.

### Provider Lag Handling

When using separate RPCs for transactions vs. logs (e.g., fast private RPC + slow public RPC), the log provider may lag behind:

```typescript
// Scenario:
// 1. Tx mined at block 1000 on Fast RPC
// 2. syncPositions() queries Slow RPC, which is only at block 998
// 3. SDK might incorrectly think position doesn't exist

// Solution: SDK checks provider's latest block before claiming position doesn't exist
interface SyncOptions {
  // ... existing fields
  minBlockNumber?: bigint  // If provider is behind this block, throw ProviderLagError
}

// After openPosition():
const { hash, wait } = await openPosition(writeConfig, params)
const receipt = await wait()

// Sync with safety check
await syncPositions(config, {
  account,
  minBlockNumber: receipt.blockNumber,  // Ensure provider has caught up
})
```

**ProviderLagError**: Thrown if the provider's latest block is behind `minBlockNumber`. UI can show "Waiting for network sync..." rather than "Position not found."

### Storage Keys

The SDK uses predictable, versioned storage keys following this format:

```
panoptic-v2-sdk:v{SCHEMA_VERSION}:chain{chainId}:pool{poolAddress}:{entity}:{id}
```

**Examples:**
```
panoptic-v2-sdk:v1:chain1:pool0xABC:account:0x123:positions   → JSON array of tokenIds
panoptic-v2-sdk:v1:chain1:pool0xABC:account:0x123:lastBlock   → last synced block number
panoptic-v2-sdk:v1:chain1:pool0xABC:account:0x123:lastHash    → last synced block hash (for reorg detection)
panoptic-v2-sdk:v1:chain1:pool0xABC:account:0x123:history     → JSON array of ClosedPosition (trade history)
panoptic-v2-sdk:v1:chain1:pool0xABC:chunks                    → JSON array of tracked chunk keys
panoptic-v2-sdk:v1:chain1:pool0xABC:chunkData                 → JSON map of chunk key → last fetched data
```

**Schema versioning:**
- `SCHEMA_VERSION` is a constant in the SDK (starts at `1`)
- On startup, the SDK checks the stored schema version
- If the stored version differs from the SDK's version: clear all data for that pool (MVP behavior)
- Future: optional `migrate()` hook for non-destructive upgrades

### Trade History (Closed Positions)

UIs display "Past Trades" and bots calculate realized P&L. The SDK persists closed positions when `OptionBurnt` events are detected:

```typescript
interface ClosedPosition {
  tokenId: bigint

  // Open execution context (from PositionBalance.positionData())
  openedAt: {
    blockNumber: bigint          // From positionData()
    timestamp: bigint            // From positionData()
    tick: bigint                 // Execution price (from positionData())
    txHash: `0x${string}`        // From OptionMinted event
  }

  // Close execution context (captured at sync)
  closedAt: {
    blockNumber: bigint
    timestamp: bigint
    tick: bigint                 // Pool tick at close (from slot0 at that block)
    txHash: `0x${string}`        // From OptionBurnt event
  }

  // Position details (captured at close)
  positionSize: bigint
  legs: TokenIdLeg[]

  // Realized P&L (from OptionBurnt event)
  realizedPremia: {
    token0: bigint               // Net premia (short - long)
    token1: bigint
  }
  commissionFees: {
    token0: bigint               // Fees paid to close
    token1: bigint
  }
}

// Get trade history
const history = await getTradeHistory(config, {
  account: Address,
  limit?: bigint,               // Default: 100n
  offset?: bigint,              // For pagination
})
// Returns: ClosedPosition[] (most recent first)

// Get P&L summary
const pnl = await getRealizedPnL({ storage, chainId, poolAddress, account })
// Returns: RealizedPnL { total0: bigint, total1: bigint, positionCount: bigint, winCount: bigint, lossCount: bigint }
```

**How it works:**
1. `syncPositions()` detects `OptionBurnt` event
2. Before removing tokenId from active positions, capture premia data from the event
3. Move to `history` storage key with `ClosedPosition` data
4. `getTradeHistory()` reads from storage (no RPC)

**Storage size**: History is append-only. For very active accounts, consider implementing a retention policy (e.g., keep last 1000 trades) in a custom storage adapter.

---

## Chunk Spread Tracking

### What Is a Chunk Spread

A "chunk" is a unique combination of `(tokenType, tickLower, tickUpper)` representing a liquidity position range. The **spread** is the premium multiplier applied to option sellers:

```
spread = 1 + (1/VEGOID) * removedLiquidity / netLiquidity
```

- `netLiquidity`: liquidity currently deployed in Uniswap
- `removedLiquidity`: liquidity borrowed by option buyers

A spread of 1.22x means sellers collect 122% of the base Uniswap fees. The value of the spread will change across many chunks in a way that is analogous to a "volatility surface" in traditional options.

### How Chunk Data Is Fetched

The SDK calls `SFPM.getAccountLiquidity(poolKey, panopticPoolAddress, tokenType, tickLower, tickUpper)` which returns a `LeftRightUnsigned` with:
- `rightSlot()` = netLiquidity
- `leftSlot()` = removedLiquidity

### Chunk Interface

```typescript
// Key for identifying a chunk
interface ChunkKey {
  tokenType: 0n | 1n              // 0n = token0 (put), 1n = token1 (call)
  tickLower: bigint
  tickUpper: bigint
}

// Full chunk data with spread
interface ChunkSpread extends ChunkKey {
  netLiquidity: bigint          // Liquidity in Uniswap
  removedLiquidity: bigint      // Liquidity borrowed by buyers
  spreadWad: bigint             // Computed: (1 + (1/VEGOID) * removed/net) * 1e18
}

// WAD scale (1e18) - standard DeFi fixed-point
const WAD = 10n ** 18n  // 1.0 = 1e18, so spread of 1.22x = 1.22e18
```

### Chunk Tracking

**Note**: `STANDARD_TICK_WIDTHS` and `Timescale` are defined in [TokenId Creation](#standard-tick-widths) and used for both position building and chunk scanning.

Chunks are automatically tracked from user positions and can be manually extended:

```typescript
// Auto-tracking: chunks from user positions are tracked automatically during syncPositions()
await syncPositions(config, { account: '0x...' })

// Manual tracking: add specific chunks to watch
// Throws ChunkLimitError if adding would exceed 1000 chunks
addTrackedChunks(config, [
  { tokenType: 1n, tickLower: 200000n, tickUpper: 200720n },
  { tokenType: 0n, tickLower: 199280n, tickUpper: 200000n },
])

// Remove chunks from tracking
removeTrackedChunks(config, [
  { tokenType: 1n, tickLower: 200000n, tickUpper: 200720n },
])

// Get all tracked chunk spreads (batch call)
const spreads = await getChunkSpreads(config)
// Returns: ChunkSpread[] (omits chunks with zero liquidity)

// Optional filter
const callSpreads = await getChunkSpreads(config, { tokenType: 1n })

// Hard limit: 1000 chunks per pool config
// Exceeding limit requires manual pruning via removeTrackedChunks()
```

### Scanning for Chunks (Volatility Surface)

Discover all non-empty chunks in a tick range via a single RPC call to `PanopticQuery.scanChunks()`:

```typescript
import { scanChunks, STANDARD_TICK_WIDTHS } from 'panoptic-v2-sdk'

// Scan a range for all chunks with liquidity (single RPC call)
const chunks = await scanChunks(config, {
  tickLower: 195000n,
  tickUpper: 205000n,
  positionWidth: STANDARD_TICK_WIDTHS['1D'],  // 720 ticks
})
// Returns: ChunkSpread[] for all non-empty chunks in the range

// Scans both tokenTypes (0n and 1n) by default
// Chunks with zero liquidity (net=0n, removed=0n) are omitted
```

### Chunk Persistence

Tracked chunks are persisted via StorageAdapter using the standard key format (see [Storage Keys](#storage-keys)):

```
panoptic-v2-sdk:v{SCHEMA_VERSION}:chain{chainId}:pool{poolAddress}:chunks      → JSON array of tracked chunk keys
panoptic-v2-sdk:v{SCHEMA_VERSION}:chain{chainId}:pool{poolAddress}:chunkData   → JSON map of chunk key → last fetched data
```

### Live Updates via watchEvents()

When `watchEvents()` is active, chunk data auto-updates on relevant events:

```typescript
const unwatch = watchEvents({
  config,
  onLogs: (events) => {
    // Chunks touched by OptionMinted/OptionBurnt are automatically refreshed
    // in the tracked chunks list
  },
})
```

- Only affected chunks are re-fetched (not all tracked chunks)
- Updates happen automatically - no manual refresh needed
- Chunks derived from user positions remain auto-tracked

### Fetch Strategy

- **Eager batch**: All tracked chunks are fetched in a single multicall during `syncPositions()`
- **Event-driven updates**: Only chunks touched by events are re-fetched
- **Scan is on-demand**: `scanChunks()` fetches fresh data, doesn't persist

---

## Caching Policy

### What Is Cached (Global Module Cache)

Static/constant data that never changes for a given chain:

- **ABIs**: Compiled contract ABIs (loaded once)
- **Contract addresses**: Factory, SFPM addresses per chain
- **Token metadata**: Decimals, symbols (fetched once per token)
- **Pool constants**: tickSpacing, fee tier, enforced tick range (fetched once per pool)
- **PanopticPool constants**: `sfpm`, `poolId`, `poolKey`
- **RiskEngine constants**: `guardian`, `EMA_PERIODS`, `MAX_TICKS_DELTA`, `MAX_TWAP_DELTA_DISPATCH`, `MAX_SPREAD`, `BP_DECREASE_BUFFER`, `MAX_CLAMP_DELTA`, `VEGOID`, `NOTIONAL_FEE`, `PREMIUM_FEE`, `PROTOCOL_SPLIT`, `BUILDER_SPLIT`, `SELLER_COLLATERAL_RATIO`, `BUYER_COLLATERAL_RATIO`, `MAINT_MARGIN_RATE`, `FORCE_EXERCISE_COST`, `TARGET_POOL_UTIL`, `SATURATED_POOL_UTIL`, `CROSS_BUFFER_0`, `CROSS_BUFFER_1`, `MAX_OPEN_LEGS`, `CURVE_STEEPNESS`, `MIN_RATE_AT_TARGET`, `MAX_RATE_AT_TARGET`, `TARGET_UTILIZATION`, `INITIAL_RATE_AT_TARGET`, `ADJUSTMENT_SPEED`
- **CollateralTracker constants**: `panopticPool`, `riskEngine`, `poolManager`, `underlyingIsToken0`, `underlyingToken`, `token0`, `token1`, `poolFee`, `name`, `symbol`, `decimals`

**Position static data** (cached after first fetch per position):
- `tickAtMint`, `timestampAtMint`, `blockNumberAtMint`, `utilization0AtMint`, `utilization1AtMint`
- These values never change for a position, so they're cached locally after first `getPosition()` call
- Reduces RPC load for repeated position queries

### What Is NOT Cached

Dynamic on-chain state - always fetched fresh:

- Position dynamic data (`positionSize`, premia, health)
- Pool state (`currentTick`, `sqrtPriceX96`, `isSafeMode`)
- Oracle state (`spotTick`, `medianTick`, `latestTick`, `twapTick`, `spotEMA`, `fastEMA`, `slowEMA`, `eonsEMA`, `oracleTimestamp`, `oracleEpoch`, `referenceTick`, `oraclePack`)
- Account balances and collateral
- Approval allowances
- CollateralTracker dynamic state (`totalAssets`, `totalSupply`, `borrowIndex`, `lastInteractionTimestamp`, `unrealizedGlobalInterest`, `rateAtTarget`, `depositedAssets`, `insideAMM`, `creditedShares`, `currentPoolUtilization`)

**Rationale**: Frontend devs use TanStack Query / SWR. Bot devs want explicit control. No dual-caching bugs.

### Cache Scope

The global module cache is **module-scoped by default** for safety:
- Each import context (main thread, worker, iframe) has independent cache
- Prevents version conflicts and ensures isolation
- Slightly higher memory usage but safer for complex applications

```typescript
// Each context has its own cache
// worker.ts
import { getPool } from 'panoptic-v2-sdk'
const pool = await getPool(config) // Fetches and caches in worker context

// main.ts
import { getPool } from 'panoptic-v2-sdk'
const pool = await getPool(config) // Fetches and caches in main thread context
```

**Note**: Storage adapters are independent of the module cache - they persist data across sessions and contexts.

---

## Token Types

The SDK uses branded types to distinguish between different token types:

```typescript
// Branded type definitions
type UnderlyingToken = Address & { readonly __brand: 'UnderlyingToken' }
type CollateralShare = Address & { readonly __brand: 'CollateralShare' }
type PositionToken = bigint & { readonly __brand: 'PositionToken' }

// Token metadata interface
interface TokenInfo {
  address: UnderlyingToken
  symbol: string
  decimals: bigint
}
```

**Note**: No type guard functions exported. Users cast directly: `addr as UnderlyingToken`.

---

## Pool Interface

```typescript
interface PoolKey {
  currency0: Address
  currency1: Address
  fee: bigint
  tickSpacing: bigint
  hooks: Address
}

interface Pool {
  address: Address                    // PanopticPool contract address
  chainId: bigint                     // Chain ID
  poolId: bigint                      // Uniswap Pool ID (uint64)
  poolKey: PoolKey                    // Uniswap V4 PoolKey

  // Collateral trackers
  collateralTracker0: CollateralTracker
  collateralTracker1: CollateralTracker

  // Risk engine
  riskEngine: RiskEngine

  // Dynamic (fetched fresh on every call)
  currentTick: bigint                 // Current tick
  sqrtPriceX96: bigint                // Current sqrt price

  // Pool health status
  healthStatus: PoolHealthStatus

  // Block metadata
  _meta: BlockMeta
}

interface OracleState {
  epoch: bigint                       // Oracle epoch
  lastUpdateTimestamp: bigint         // Last oracle update timestamp (seconds)
  referenceTick: bigint               // Reference tick for residual calculations

  // Decoded EMAs
  spotEMA: bigint                     // Spot EMA tick
  fastEMA: bigint                     // Fast EMA tick
  slowEMA: bigint                     // Slow EMA tick
  eonsEMA: bigint                     // Eons EMA tick

  // Lock mode
  lockMode: bigint                    // Oracle lock mode state

  // Median tick
  medianTick: bigint                  // Slow oracle tick (median of stored observations)

  _meta: BlockMeta
}

interface RiskEngine {
  address: Address                    // RiskEngine contract address
  collateralRequirement: bigint       // Collateral requirement
  maintenanceMargin: bigint           // Maintenance margin rate
  commissionRate: bigint              // Commission rate
}

interface CollateralTracker {
  address: Address                    // CollateralTracker contract address
  token: Address                      // Address of underlying token
  symbol: string                      // ERC20 symbol (e.g., "pWETH")
  decimals: bigint                    // ERC20 decimals (matches underlying)

  // Dynamic (fetched fresh on every call)
  totalAssets: bigint                 // Total assets in vault
  insideAMM: bigint                   // Assets currently in Uniswap AMM
  creditedShares: bigint              // Shares held as credit
  totalShares: bigint                 // Total shares
  utilization: bigint                 // Current pool utilization
  borrowRate: bigint                  // Current borrow rate
  supplyRate: bigint                  // Current supply rate
}

// Pool health status (standardized across bots and UIs)
type PoolHealthStatus =
  | 'active'                          // Normal operation
  | 'low_liquidity'                   // Uniswap pool liquidity dangerously low OR high Panoptic utilization
  | 'paused'                          // Pool is paused (if applicable)

// Utilization is separate (dynamic state)
interface Utilization {
  utilization0: bigint               // basis points (0n-10000n)
  utilization1: bigint
  _meta: BlockMeta
}
```

---

## TokenId Creation

### Design Philosophy

All position operations use `tokenId` (bigint) as the primary identifier. The SDK provides builder functions to create valid tokenIds from human-readable parameters.

Users specify positions using:
- **Strike**: The center tick of the position (`strike = (tickLower + tickUpper) / 2`)
- **Width**: Either a standard timescale or a custom width in ticks

```typescript
import {
  createTokenIdBuilder,
  STANDARD_TICK_WIDTHS,
  priceToTick,
  tickToPrice
} from 'panoptic-v2-sdk'

// Fetch fresh pool state
const pool = await getPool({ client, poolAddress })

// Create builder with pool address and tick spacing
const builder = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)

// Build tokenId using addCall/addPut + build() pattern
const tokenId = builder
  .addCall({
    strike: 200000n,                       // Center tick
    width: 720n,                           // Width in ticks (e.g., STANDARD_TICK_WIDTHS['1D'])
    optionRatio: 1n,                       // 1-127, required
    isLong: true,                          // true = long, false = short
  })
  .build()
// Returns: bigint (the tokenId)

// Short put example
const tokenId2 = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)
  .addPut({
    strike: 199500n,
    width: 1000n,
    optionRatio: 1n,
    isLong: false,
  })
  .build()

// Use tokenId in all operations
await openPosition({ client, walletClient, account, poolAddress, existingPositionIds: [], tokenId, positionSize: 1000n, ... })
```

### Standard Tick Widths

Predefined widths matching DTE gamma profiles:

```typescript
export const STANDARD_TICK_WIDTHS = {
  '1H': 240n,
  '1D': 720n,
  '1W': 2400n,
  '1M': 4800n,
  '1Y': 15000n,
} as const

type Timescale = keyof typeof STANDARD_TICK_WIDTHS
```

**Special case: width = 0n (Loan/Credit legs)**

A leg with `width = 0n` represents a pure collateral operation rather than an options position:
- `width = 0n` + `isLong = 0n` → **Loan**: Borrow tokens from the pool, pay interest at vault rate
- `width = 0n` + `isLong = 1n` → **Credit**: Send tokens to the pool (they earn NO interest while credited)

These legs have no strike range and cannot be exercised. The `validateIsExercisable()` check explicitly excludes `width = 0n` legs from being considered exercisable.

**Loan mechanics:**
- Borrows tokens from CollateralTracker, paying the same interest rate as vault depositors earn
- `tokenType` determines which token is borrowed (0 = token0, 1 = token1)
- `strike` field relates to the notional amount (computed via `PanopticMath.getAmountsMoved` with width temporarily set to 2)
- Loans have margin requirements (not purely collateral adjustments)
- Use cases: leverage trading, hedging exposure in other protocols, cross-protocol arbitrage

**Credit mechanics:**
- Sends tokens to the pool; these tokens earn NO interest while credited
- Closing a credit returns the tokens, which then resume earning vault interest
- Credits have margin requirements
- Use cases: See "ITM Abstraction" and "Premium Pre-payment" patterns below

**Key differences from options:**
- No exercise risk (cannot be force-exercised)
- Interest flows differently: loans pay interest, credits forego interest
- Can be combined with option legs in the same tokenId (up to 4 total legs)
- Credit and option legs should be risk partners (recommended for proper margin calculation)

### Standalone Price Utilities

Price conversion is standalone (no pool context needed, just decimals):

```typescript
import { priceToTick, tickToPrice } from 'panoptic-v2-sdk'

// Convert human price to tick
const tick = priceToTick('2000.50', decimals0, decimals1)

// Convert tick to human price
const price = tickToPrice(-195300n, decimals0, decimals1)
```

### TokenId Builder Interface

The builder uses a chainable `addLeg`/`addCall`/`addPut`/`addLoan`/`addCredit` pattern followed by `build()`:

```typescript
interface TokenIdBuilder {
  // Add a generic leg with full control
  addLeg(config: LegConfig): TokenIdBuilder

  // Convenience: add a call leg (sets tokenType=1, asset=0 by default)
  addCall(config: {
    strike: bigint                        // Center tick
    width: bigint                         // Width in ticks
    optionRatio: bigint                   // 1-127
    isLong: boolean                       // true = long, false = short
    riskPartner?: bigint                  // Leg index to pair with (default: self)
    asset?: bigint                        // Override asset (default: 0n)
  }): TokenIdBuilder

  // Convenience: add a put leg (sets tokenType=0, asset=0 by default)
  addPut(config: {
    strike: bigint
    width: bigint
    optionRatio: bigint
    isLong: boolean
    riskPartner?: bigint
    asset?: bigint
  }): TokenIdBuilder

  // Add a loan leg (width=0, isLong=false)
  addLoan(config: {
    tokenType: bigint                     // 0n = token0, 1n = token1
    optionRatio: bigint
    strike?: bigint                       // Default: 0n
    riskPartner?: bigint
  }): TokenIdBuilder

  // Add a credit leg (width=0, isLong=true)
  addCredit(config: {
    tokenType: bigint
    optionRatio: bigint
    strike?: bigint
    riskPartner?: bigint
  }): TokenIdBuilder

  // Build the final tokenId
  build(): bigint

  // Get current leg count
  legCount(): bigint

  // Reset builder state
  reset(): TokenIdBuilder
}

// Create builder from pool address + tick spacing
function createTokenIdBuilder(
  poolAddress: Address,
  tickSpacing: bigint,
  vegoid?: bigint
): TokenIdBuilder

// Create builder from V4 pool ID hex
function createTokenIdBuilderV4(
  poolIdHex: Hex,
  tickSpacing: bigint,
  vegoid?: bigint
): TokenIdBuilder

// Create builder from numeric pool ID
function createBuilderFromPoolId(poolId: bigint): TokenIdBuilder
```

Multi-leg strategies are composed by chaining `addCall`/`addPut` calls:

```typescript
// Call spread example
const callSpreadId = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)
  .addCall({ strike: 200000n, width: 720n, optionRatio: 1n, isLong: true, riskPartner: 1n })
  .addCall({ strike: 201000n, width: 720n, optionRatio: 1n, isLong: false, riskPartner: 0n })
  .build()

// Iron condor example
const ironCondorId = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)
  .addPut({ strike: 198000n, width: 720n, optionRatio: 1n, isLong: true, riskPartner: 1n })
  .addPut({ strike: 199000n, width: 720n, optionRatio: 1n, isLong: false, riskPartner: 0n })
  .addCall({ strike: 201000n, width: 720n, optionRatio: 1n, isLong: false, riskPartner: 3n })
  .addCall({ strike: 202000n, width: 720n, optionRatio: 1n, isLong: true, riskPartner: 2n })
  .build()

// Loan example
const loanId = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)
  .addLoan({ tokenType: 0n, optionRatio: 1n })
  .build()
```

### TokenId Low-Level Utilities

The SDK exposes low-level functions mirroring the on-chain `TokenIdLibrary` for advanced use cases. See `contracts/types/TokenId.sol` for the authoritative bit layout and encoding rules.

```typescript
// Decoding (extract fields from tokenId)
function getPoolId(tokenId: bigint): bigint
function getTickSpacing(tokenId: bigint): bigint
function getAsset(tokenId: bigint, legIndex: bigint): 0n | 1n
function getOptionRatio(tokenId: bigint, legIndex: bigint): bigint
function getIsLong(tokenId: bigint, legIndex: bigint): 0n | 1n
function getTokenType(tokenId: bigint, legIndex: bigint): 0n | 1n
function getRiskPartner(tokenId: bigint, legIndex: bigint): bigint
function getStrike(tokenId: bigint, legIndex: bigint): bigint
function getWidth(tokenId: bigint, legIndex: bigint): bigint

// Encoding (build tokenId from parts)
function addPoolId(tokenId: bigint, poolId: bigint): bigint
function addLeg(tokenId: bigint, legIndex: bigint, params: {
  optionRatio: bigint, asset: 0n | 1n, isLong: 0n | 1n,
  tokenType: 0n | 1n, riskPartner: bigint, strike: bigint, width: bigint
}): bigint

// Helpers
function countLegs(tokenId: bigint): bigint
function countLongs(tokenId: bigint): bigint
function asTicks(tokenId: bigint, legIndex: bigint, tickSpacing: bigint): { tickLower: bigint, tickUpper: bigint }
function flipToBurnToken(tokenId: bigint): bigint
function clearLeg(tokenId: bigint, legIndex: bigint): bigint

// Validation
function validateTokenId(tokenId: bigint): void       // Throws if invalid
function isExercisable(tokenId: bigint): boolean      // Has exercisable long leg (width > 0n)
```

**Note on multi-leg builders**: These builders do NOT validate strike ordering or strategy logic. They encode the legs as specified. If strikes are illogical (e.g., long strike > short strike in call spread), the contract will revert on execution. Users should use simulateOpenPosition() to validate before submitting.

**Panoptic-specific strategies**:
- **createLoan**: Creates a `width = 0n`, `isLong = 0n` leg to borrow collateral from the pool
- **createCredit**: Creates a `width = 0n`, `isLong = 1n` leg to lend collateral to the pool

**Usage example:**
```typescript
const pool = await getPool(config)
const builder = createTokenIdBuilder(pool)

// Traditional options strategies
// Call spread: long call at lower strike + short call at higher strike
const callSpreadId = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)
  .addCall({ strike: 200000n, width: 2400n, optionRatio: 1n, isLong: true, riskPartner: 1n })
  .addCall({ strike: 201000n, width: 2400n, optionRatio: 1n, isLong: false, riskPartner: 0n })
  .build()

// Iron condor: put spread + call spread
const ironCondorId = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)
  .addPut({ strike: 198000n, width: 720n, optionRatio: 1n, isLong: true, riskPartner: 1n })
  .addPut({ strike: 199000n, width: 720n, optionRatio: 1n, isLong: false, riskPartner: 0n })
  .addCall({ strike: 201000n, width: 720n, optionRatio: 1n, isLong: false, riskPartner: 3n })
  .addCall({ strike: 202000n, width: 720n, optionRatio: 1n, isLong: true, riskPartner: 2n })
  .build()

// Loan (width = 0n, isLong = false)
const loanId = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)
  .addLoan({ tokenType: 0n, optionRatio: 1n })
  .build()

// Credit (width = 0n, isLong = true)
const creditId = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)
  .addCredit({ tokenType: 1n, optionRatio: 1n })
  .build()

// Use tokenIds in operations
await openPosition({
  client,
  walletClient,
  account,
  poolAddress,
  existingPositionIds: [],
  tokenId: callSpreadId,
  positionSize: 1000000000000000000n,
  tickLimitLow: -887272n,
  tickLimitHigh: 887272n,
})
```

### Loan and Credit Use Cases

**Use Case 1: ITM Abstraction (Short Put with Offsetting Credit)**

When you sell an ITM (in-the-money) option, the intrinsic value is sent to you immediately. For example, if price = 2000 USDC/ETH and you sell a put at strike 2500, you receive ~500 USDC of intrinsic value. This makes PnL tracking confusing because you must pay this back when closing.

A credit leg "abstracts away" the ITM amount by immediately returning it to the pool:

```typescript
// Step 1: Build the ITM short put
const builder = createTokenIdBuilder(pool)

// Step 2: Get the required credit to offset ITM value
const creditParams = await getRequiredCreditForITM({
  client,
  poolAddress,
  tokenId: builder.shortPut({
    strike: 250000n,      // ITM put (current price ~200000)
    width: 720n,
    optionRatio: 1n,
  }),
  positionSize: 1000000000000000000n,
})

// Step 3: Build combined tokenId with option + credit as risk partners
const tokenId = createTokenIdBuilder(pool)
  .addPut({
    strike: 250000n,
    width: 720n,
    optionRatio: 1n,
    isLong: false,
    riskPartner: 0n,      // Partner with credit leg
  })
  .addLeg({
    ...creditParams,       // Full LegConfig from getRequiredCreditForITM
    riskPartner: 0n,       // Partner with put leg
  })
  .build()

// Result: ITM amount is abstracted away, PnL starts at ~0
```

**Use Case 2: Premium Pre-payment (Long Call with Credit)**

Long options in Panoptic don't pay premium upfront—instead, premium accrues over time ("streamia"). A credit can pre-pay expected premium for a more TradFi-like experience:

```typescript
// User has 200 USDC and wants to buy a call
// Without credit: they get liquidated when accumulated streamia > 200 USDC
// With credit: they "lock in" 200 USDC as max loss

const builder = createTokenIdBuilder(pool)

// Long call + 200 USDC credit to pre-pay premium
const tokenId = builder
  .addCall({
    strike: 210000n,
    width: 720n,
    optionRatio: 1n,
    isLong: true,
    riskPartner: 0n,
  })
  .addLeg({
    asset: 0n,
    optionRatio: 1n,       // Represents ~200 USDC credit
    isLong: true,          // Credit (width=0 + isLong=1)
    tokenType: 1n,         // USDC (token1)
    riskPartner: 0n,
    strike: /* calculated for 200 USDC */,
    width: 0n,             // Credit leg
  })
  .build()

// User knows max loss = 200 USDC (the credit amount)
// More predictable UX similar to traditional options
```

**Use Case 3: Delta Hedging with Loans and Credits**

Loans and credits can adjust a position's delta exposure. This enables delta-neutral strategies entirely on-chain:

- **Add credit** → Increases delta (more long exposure to the underlying)
- **Add loan** → Decreases delta (more short exposure to the underlying)

Example: Create a delta-neutral short put (synthetic straddle):

```typescript
const builder = createTokenIdBuilder(pool)

// Short put has positive delta (~0.5 for ATM)
// To neutralize, add a loan to short ~50% of notional

// Step 1: Calculate the delta hedge needed
const hedgeParams = await getDeltaHedgeParams({
  client,
  poolAddress,
  tokenId: builder.shortPut({
    strike: currentTick,    // ATM put
    width: 720n,
    optionRatio: 1n,
  }),
  positionSize: 1000000000000000000n,
  targetDelta: 0n,          // Delta-neutral
})

// Step 2: Build combined position with hedge
const tokenId = createTokenIdBuilder(pool)
  .addPut({
    strike: currentTick,
    width: 720n,
    optionRatio: 1n,
    isLong: false,
    riskPartner: 0n,
  })
  .addLeg({
    ...hedgeParams,         // Loan leg to offset delta
    riskPartner: 0n,
  })
  .build()

// Result: Short put + loan = delta-neutral position
// Profits from volatility/gamma, not directional moves
```

**Adjusting delta over time:**

```typescript
// Position delta drifted to +0.3, need to reduce

// Option 1: Add more loan to the position (roll into new tokenId)
// Option 2: Close and reopen with adjusted loan size

// Get current position delta
const greeks = await getPositionGreeks({ client, poolAddress, tokenId, account })
console.log(`Current delta: ${greeks.delta}`)

// Calculate adjustment needed
const adjustment = await getDeltaHedgeParams({
  client,
  poolAddress,
  tokenId,
  positionSize,
  targetDelta: 0n,
  currentDelta: greeks.delta,  // Account for existing delta
})
```

**Use Case 4: Standalone Loan for Leverage**

Borrow tokens to increase position size beyond deposited collateral:

```typescript
const loanId = builder.createLoan({
  tokenType: 0n,           // Borrow WETH
  optionRatio: 2n,         // 2x the base amount
})

// Use borrowed WETH for external strategies, hedging, or arbitrage
```

### Credit and Loan Helper Utilities

The `getRequiredCreditForITM()` function calculates the credit parameters needed to offset an option's ITM value:

```typescript
const creditParams = await getRequiredCreditForITM({
  client,
  poolAddress,
  tokenId,
  positionSize,
})
// Returns: RequiredCreditForITM with credit0, credit1, _meta
```

**Delta hedging utility:**

```typescript
// Calculate loan params to achieve target delta
const hedgeParams = await getDeltaHedgeParams({
  client,
  poolAddress,
  chainId,
  tokenId,
  positionSize,
  targetDelta,               // Target delta (0n for delta-neutral)
  currentDelta?,             // Optional: current delta if adjusting
})
// Returns: DeltaHedgeResult with hedgeLeg, hedgeAmount, hedgeType, etc.
```

### How Strike and Width Map to Ticks

The SDK computes `tickLower` and `tickUpper` from `strike` and `width`:

```typescript
// Width comes from timescale or custom value
const effectiveWidth = 'timescale' in params
  ? STANDARD_TICK_WIDTHS[params.timescale]
  : params.width

// Compute tick bounds
const halfWidth = effectiveWidth / 2
tickLower = strike - halfWidth
tickUpper = strike + halfWidth

// Both are aligned to tickSpacing
tickLower = Math.floor(tickLower / tickSpacing) * tickSpacing
tickUpper = Math.ceil(tickUpper / tickSpacing) * tickSpacing
```

### TokenId Decoding

For inspection/debugging, decode a tokenId back to its components:

```typescript
const decoded = decodeTokenId(tokenId)
// Returns: DecodedTokenId with legs array

interface TokenIdLeg {
  index: bigint                           // Leg index (0-3)
  asset: bigint                           // Asset type (0n or 1n)
  tokenType: bigint                       // Token type (0n or 1n)
  isLong: boolean
  tickLower: bigint
  tickUpper: bigint
  strike: bigint                          // Computed: (tickLower + tickUpper) / 2
  width: bigint                           // Computed: tickUpper - tickLower
  optionRatio: bigint
  riskPartner: bigint
}
```

### Strike Validation

SDK validates strike strictly and **throws** if invalid:
- Strike must be within enforced range (minEnforcedTick, maxEnforcedTick) after width expansion
- Computed tickLower/tickUpper must fit within enforced range
- **Tick alignment**: If computed tickLower/tickUpper are NOT aligned to tickSpacing, throws InvalidTickError
  - Users must provide strikes that result in properly aligned ticks
  - No automatic alignment - explicit errors prevent unexpected position parameters

---

## Position Interface

```typescript
interface Position {
  // Identifiers
  tokenId: bigint              // ERC1155 token ID (SFPM)
  poolAddress: Address         // PanopticPool address (use getPool() for full Pool data)
  owner: Address

  // Position data
  positionSize: bigint         // Number of contracts
  legs: TokenIdLeg[]           // Up to 4 legs (decoded from tokenId)

  // Mint-time metadata (from PositionBalance via positionData())
  tickAtMint: bigint           // Current tick at mint (execution price)
  poolUtilization0AtMint: bigint   // Pool utilization token0 at mint (bps)
  poolUtilization1AtMint: bigint   // Pool utilization token1 at mint (bps)
  blockNumberAtMint: bigint    // Block number when position was minted
  timestampAtMint: bigint      // Block timestamp when position was minted (seconds)
  swapAtMint: boolean          // Whether a swap occurred at mint

  // Computed values (net premia = short - long)
  premiaOwed0: bigint          // Net premia for token0 (positive = earned, negative = owed)
  premiaOwed1: bigint          // Net premia for token1 (positive = earned, negative = owed)

  // Status
  pending?: boolean            // true = submitted but not yet mined/indexed

  // Greeks context
  assetIndex: bigint           // Which token is the "asset" for Greeks calculations (0n or 1n)

  // Block metadata
  _meta: BlockMeta             // Block at which position was fetched
}
```

**Note**: `getPosition()` requires explicit `owner` and `tokenId` parameters. Always returns a Position object - for closed positions, `positionSize` will be `0n`. `getPositions()` automatically filters out positions with `positionSize === 0n`.

### How Position Data is Computed

The SDK fetches position data by composing contract calls (batched via multicall):

1. **`PanopticPool.getAccumulatedFeesAndPositionsData(user, includePending, tokenIds)`**
   - Returns `shortPremia`, `longPremia`, and `PositionBalance[]` array
   - `PositionBalance` is a packed uint256 containing: positionSize, utilizations at mint, ticks at mint, block number and timestamps at mint

2. **`RiskEngine.getMargin(positionBalanceArray, positionIdList, atTick, user, shortPremia, longPremia, ct0, ct1)`**
   - Returns `tokenData0`, `tokenData1` (each a `LeftRightUnsigned`), and `globalUtilizations`
   - `tokenData0.leftSlot()` = maintenance requirement for token0
   - `tokenData0.rightSlot()` = available balance for token0
   - Same pattern for `tokenData1`
   - `globalUtilizations` contains pool utilization data for cross-margin calculations

3. **`RiskEngine.isAccountSolvent(...)`**
   - Returns `boolean` indicating whether the account meets margin requirements
   - Applies cross-margin buffer logic (`CROSS_BUFFER_0`, `CROSS_BUFFER_1`) and surplus scaling
   - SDK calls this directly rather than re-implementing the cross-margin math

---

## Closed Position Interface

When a position is closed (burned, force exercised, or liquidated), it moves from the active positions set to a closed positions history. This preserves important context about *why* a position closed.

```typescript
interface ClosedPosition {
  tokenId: bigint
  owner: Address
  poolAddress: Address
  positionSize: bigint

  // Open/close context
  openBlock: bigint
  closeBlock: bigint
  openTimestamp: bigint
  closeTimestamp: bigint
  tickAtOpen: bigint
  tickAtClose: bigint

  // Realized P&L
  realizedPnL0: bigint
  realizedPnL1: bigint
  premiaCollected0: bigint
  premiaCollected1: bigint

  // Closure reason
  closureReason: 'closed' | 'liquidated' | 'force_exercised'
}
```

### Closed Position Tracking

The SDK tracks closed positions by listening to `OptionBurnt`, `ForcedExercised`, and `AccountLiquidated` events. All three events have the account as an indexed parameter, enabling efficient filtering.

### Querying Closed Positions

```typescript
// Get closed positions from local storage
const closed = await getClosedPositions({ storage, chainId, poolAddress, account })
// Returns: ClosedPosition[]

// Get trade history (alias)
const history = await getTradeHistory({ storage, chainId, poolAddress, account })
// Returns: ClosedPosition[]

// Get realized PnL
const pnl = await getRealizedPnL({ storage, chainId, poolAddress, account })
// Returns: RealizedPnL { total0, total1, positionCount, winCount, lossCount }

// Get account history from events (on-chain query)
const history = await getAccountHistory({
  client, poolAddress, account, fromBlock?, toBlock?,
})
// Returns: AccountHistory with trades[]
```

### Storage and Retention

Closed positions are persisted via the storage adapter:

```
panoptic-v2-sdk:v{VERSION}:chain{chainId}:pool{address}:closedPositions:{account}
```

---

## Position Greeks

Position value and sensitivities. The SDK provides two modes:
1. **Via PanopticQuery** (recommended): `getPositionGreeks()` - single RPC call, batches position data fetch + calculation
2. **Pure client-side**: `getLegValue()`, `getLegDelta()`, `getLegGamma()` - no RPC, for bots that already have position data

**Contract Implementation**:
- Greeks calculations are primarily handled by `PanopticQuery.getPositionGreeks()` (planned contract)
- Position data comes from `PanopticPool.getAccumulatedFeesAndPositionsData()` (see `contracts/PanopticPool.sol:434`)
- Greeks formulas are based on the Panoptic LP-based option model
- Value depends on current price relative to the position's strike and width (see `contracts/types/TokenId.sol` for how strike/width are encoded)

### Interfaces

```typescript
interface LegGreeksParams {
  strike: bigint                // Strike tick (center of position)
  width: bigint                 // Position width in ticks (tickUpper - tickLower)
  tokenType: 0n | 1n              // 0n = token0, 1n = token1
  isLong: boolean
  optionRatio: bigint           // 1-127
  positionSize: bigint          // Contract amount
}

interface PositionGreeks {
  value: bigint                 // Position value in numeraire token units (e.g., USDC)
  delta: bigint                 // dValue/dPrice, in numeraire token units
  gamma: bigint                 // d²Value/dPrice², in numeraire token units
}
```

### Defined Risk Detection

The SDK automatically detects if a position is "defined risk" based on its structure:

```typescript
// SDK-provided helper
function isDefinedRisk(legs: TokenIdLeg[]): boolean
// Returns true if position has 2+ legs with same tokenType but opposite isLong values
// (e.g., spreads, iron condors)

// Logic:
// - Group legs by tokenType
// - For any tokenType group with 2+ legs: check if both long and short exist
// - If yes → defined risk
```

### Per-Leg Greeks

Calculate Greeks for a single leg (low-level API):

- **Inputs**: `tick` or `sqrtPriceX96` (Uniswap-native)
- **Outputs**: `value` in token units, `delta`/`gamma` in WAD (1e18)

```typescript
// Position value at a given tick
const value = getLegValue({
  leg: LegGreeksParams,
  tick: bigint,                 // Current tick
  mintTick: bigint,             // Tick at mint (for ITM calculation)
  assetIndex: 0n | 1n,          // Which token is the "asset" (risky token, e.g., WETH)
  definedRisk: boolean,         // True for spreads/defined-risk strategies
})
// Returns: bigint (numeraire token units, e.g., USDC)

// Delta (dValue/dPrice)
const delta = getLegDelta({
  leg: LegGreeksParams,
  tick: bigint,
  mintTick?: bigint,            // Optional, for ITM adjustment
  assetIndex: 0n | 1n,
  definedRisk: boolean,
})
// Returns: bigint (numeraire token units)

// Gamma (d²Value/dPrice²)
const gamma = getLegGamma({
  leg: LegGreeksParams,
  tick: bigint,
  assetIndex: 0n | 1n,
})
// Returns: bigint (numeraire token units)
```

### Full Position Greeks (via PanopticQuery)

Calculate aggregate Greeks for positions. Single RPC call via PanopticQuery:

```typescript
// For a single position (if you already have Position object)
const greeks = await getPositionGreeks(config, {
  position: Position,           // From getPosition()
  tick: bigint,                 // Current tick to evaluate at
  assetIndex?: 0n | 1n,           // Optional: override Position.assetIndex for this calculation
})
// Returns: PositionGreeks (summed across all legs)
// - value: bigint (numeraire token units, e.g., USDC)
// - delta: bigint (numeraire token units)
// - gamma: bigint (numeraire token units)
// assetIndex determines which token is the "asset" (risky token, e.g., WETH) - the other token is the numeraire
// If omitted, uses Position.assetIndex (set from config.preferredAsset at position creation)

// For all positions (fetches position data + computes Greeks in one call)
const allGreeks = await getAccountGreeks(config, {
  account: Address,
  tick: bigint,
  assetIndex?: 0n | 1n,           // Optional: override for all positions
})
// Returns: { positions: Map<bigint, PositionGreeks>, total: PositionGreeks }
```

### Portfolio Delta (Planned)

> **Note**: `getPortfolioDelta()` is not yet implemented. Use `getAccountGreeks()` for position-level delta.

The `getPortfolioDelta()` function would calculate total delta exposure including undeposited wallet balances:

```typescript
const portfolio = await getPortfolioDelta({
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  storage: StorageAdapter,        // Uses tracked positions from sync
  assetIndex?: 0n | 1n,           // Which token is the risky asset (default: 0n)
})

// Returns:
// {
//   walletDelta: bigint,         // Delta from undeposited pool tokens in wallet
//   positionsDelta: bigint,      // Delta from all tracked Panoptic positions
//   totalDelta: bigint,          // walletDelta + positionsDelta
//   _meta: BlockMeta,
// }
```

**How wallet delta is calculated:**
- Only considers pool tokens (token0 and token1), not other wallet assets
- The "risky" token (determined by `assetIndex`) contributes delta: 1 token = +1 delta
- The "stable" token contributes 0 delta (holding stables is delta-neutral)
- Example: If token0 is WETH (risky, assetIndex=0) and token1 is USDC:
  - Holding 2 WETH in wallet → walletDelta = +2e18 (in WAD)
  - Holding 5000 USDC in wallet → walletDelta = 0 (stables are neutral)

**Requirements:**
- Positions must be synced first (uses `getTrackedPositionIds` internally)
- Same-block guarantee: wallet balances and positions fetched in single multicall

**Use case:** A market maker wants to know their total delta exposure across:
1. Open Panoptic positions (from options, loans, credits)
2. Undeposited tokens sitting in their wallet

```typescript
// Check if portfolio is delta-neutral
const { totalDelta } = await getPortfolioDelta({
  client,
  poolAddress,
  account,
  storage,
})

if (totalDelta > DELTA_THRESHOLD) {
  // Portfolio is too long, add loan to reduce delta
  const hedgeParams = await getDeltaHedgeParams({ ... })
}
```

**Contract routing**: The SDK hides the PanopticQuery routing. Users call `getPositionGreeks()` or `getAccountGreeks()` and the SDK routes to the helper contract automatically.

### How Greeks Are Calculated

The formulas use the Panoptic LP-based option model where value depends on price relative to the position's range.

#### Common Definitions

```
rangeFactor = tickToPrice(width / 2)   // width is in ticks (tickUpper - tickLower)
isAssetToken0 = (assetIndex === 0n)
strikeP = tickToQuoteTokenPrice(isAssetToken0, strike)
returnMultiplier = isLong ? -positionSize * optionRatio : positionSize * optionRatio
isPut = (tokenType == 0n && isAssetToken0) || (tokenType == 1n && !isAssetToken0)
```

#### Base Value

The base value of the LP position at current `price`:

```
if price < strikeP / rangeFactor:
    baseValue = returnMultiplier * price
else if price > strikeP * rangeFactor:
    baseValue = returnMultiplier * strikeP
else:  // price in range
    baseValue = ((2 * sqrt(price * strikeP * rangeFactor) - price - strikeP) / (rangeFactor - 1)) * returnMultiplier
```

#### ITM Adjustment

The in-the-money adjustment based on `mintPrice`:

**For Puts:**
```
if mintPrice < strikeP / rangeFactor:
    ITM = (strikeP - mintPrice) * returnMultiplier
else if mintPrice > strikeP * rangeFactor:
    ITM = 0
else:
    ITM = (returnMultiplier * (sqrt(strikeP * rangeFactor) - sqrt(mintPrice))²) / (rangeFactor - 1)
```

**For Calls:**
```
if mintPrice < strikeP / rangeFactor:
    ITM = 0
else if mintPrice > strikeP * rangeFactor:
    ITM = (1 - strikeP / mintPrice) * returnMultiplier
else:
    ITM = ((sqrt(rangeFactor) - sqrt(strikeP / mintPrice))² / (rangeFactor - 1)) * returnMultiplier
```

#### Position Value

**For Puts:**
```
debt = -returnMultiplier
value = debt * strikeP + baseValue + ITM
```

**For Calls:**
```
debt = -returnMultiplier
if definedRisk:
    value = (debt + baseValue / price + (ITM * mintPrice) / price) * price
else:
    value = (debt + baseValue / price + ITM) * price
```

#### Delta (∂Value/∂Price)

**Base Delta:**
```
if price < strikeP / rangeFactor:
    baseDelta = returnMultiplier  // for puts
else if price > strikeP * rangeFactor:
    baseDelta = 0
else:
    baseDelta = returnMultiplier * ((sqrt(strikeP * rangeFactor) / sqrt(price) - 1) / (rangeFactor - 1))
```

**For Puts:**
```
delta = baseDelta
```

**For Calls:**
```
debtDelta = -returnMultiplier

// ITM delta (only if mintPrice provided)
if mintPrice < strikeP / rangeFactor:
    ITMDelta = 0
else if mintPrice > strikeP * rangeFactor:
    ITMDelta = (1 - strikeP / mintPrice) * returnMultiplier
else:
    ITMDelta = ((sqrt(rangeFactor) - sqrt(strikeP / mintPrice))² / (rangeFactor - 1)) * returnMultiplier

if definedRisk:
    delta = debtDelta + baseDelta
else:
    delta = debtDelta + baseDelta + ITMDelta
```

#### Gamma (∂²Value/∂Price²)

```
// Note: sign is flipped for gamma (long has positive gamma)
gammaMultiplier = isLong ? positionSize * optionRatio : -positionSize * optionRatio

if price < strikeP / rangeFactor:
    gamma = 0
else if price > strikeP * rangeFactor:
    gamma = 0
else:
    gamma = (gammaMultiplier * sqrt(strikeP * price * rangeFactor)) / (2 * (rangeFactor - 1))
```

---

## Account Collateral

```typescript
interface TokenCollateral {
  assets: bigint               // Underlying token amount
  shares: bigint               // Vault shares held
  availableAssets: bigint      // Assets available (not locked)
  lockedAssets: bigint         // Assets locked by positions
}

interface AccountCollateral {
  account: Address
  poolAddress: Address
  token0: TokenCollateral
  token1: TokenCollateral
  legCount: bigint             // Current open legs
  _meta: BlockMeta
}
```

### How Account Collateral is Computed

`getAccountCollateral(config, { account })` automatically uses tracked tokenIds from the position cache.

The SDK fetches account collateral by composing contract calls (batched via multicall):

1. **`getTrackedPositionIds()`** - Get tokenIds from local cache
2. **`PanopticPool.getAccumulatedFeesAndPositionsData(user, true, tokenIds)`**
   - Returns `shortPremia`, `longPremia`, `PositionBalance[]`
3. **`RiskEngine.getMargin(positionBalances, atTick, user, tokenIds, shortPremia, longPremia, ct0, ct1)`**
   - Returns `tokenData0`, `tokenData1`, `globalUtilizations`
   - `tokenData.leftSlot()` = maintenance requirement
   - `tokenData.rightSlot()` = available balance (including settled premia)
4. **`CollateralTracker.balanceOf(user)`** for shares

---

## Account Premia

Premia tracking for collecting earned/owed fees across positions.

```typescript
interface AccountPremia {
  /** Total short premium owed TO the account for token 0 */
  shortPremium0: bigint
  /** Total short premium owed TO the account for token 1 */
  shortPremium1: bigint
  /** Total long premium owed BY the account for token 0 */
  longPremium0: bigint
  /** Total long premium owed BY the account for token 1 */
  longPremium1: bigint
  /** Whether pending (unsettled) premium was included */
  includePendingPremium: boolean
  _meta: BlockMeta
}

interface PositionsWithPremiaResult {
  /** Positions with full data including per-position premia */
  positions: Position[]  // Each includes premiaOwed0/1
  /** Total short premium for token 0 */
  shortPremium0: bigint
  /** Total short premium for token 1 */
  shortPremium1: bigint
  /** Total long premium for token 0 */
  longPremium0: bigint
  /** Total long premium for token 1 */
  longPremium1: bigint
  includePendingPremium: boolean
  _meta: BlockMeta
}
```

### How Account Premia is Computed

`getAccountPremia()` and `getPositionsWithPremia()` use `PanopticPool.getAccumulatedFeesAndPositionsData()`:

```typescript
// Get aggregate premia (fast)
const premia = await getAccountPremia({
  client, poolAddress, account, tokenIds,
  includePendingPremium: true,  // Include unsettled premia (default)
})

// Get per-position premia (uses multicall for N positions)
const result = await getPositionsWithPremia({
  client, poolAddress, account, tokenIds,
  includePendingPremium: true,
})
for (const pos of result.positions) {
  console.log(`Position ${pos.tokenId}: ${pos.premiaOwed0}, ${pos.premiaOwed1}`)
}
```

**Note**: Short premium is earned by the account (selling options), long premium is owed by the account (buying options). The `Position.premiaOwed0/1` fields are the net (short - long).

---

## Account Summary (UI Aggregate)

The SDK provides two levels of account summary for React dashboards. `getAccountSummaryBasic` batches pool state, collateral, and positions into one multicall. `getAccountSummaryRisk` extends this with risk metrics from PanopticQuery.

```typescript
interface AccountSummaryBasic {
  account: Address
  pool: Pool
  collateral: AccountCollateral
  positions: Position[]
  healthStatus: PoolHealthStatus
  networkMismatch: boolean
  _meta: BlockMeta
}

interface AccountSummaryRisk extends AccountSummaryBasic {
  // Portfolio-level Greeks
  totalGreeks: PositionGreeks

  // Net liquidation value
  netLiquidationValue0: bigint
  netLiquidationValue1: bigint

  // Margin state
  maintenanceMargin0: bigint
  maintenanceMargin1: bigint
  marginExcess0: bigint
  marginExcess1: bigint
  marginShortfall0: bigint
  marginShortfall1: bigint
  currentMargin0: bigint
  currentMargin1: bigint
  isLiquidatable: boolean

  // Liquidation prices
  liquidationPrices: LiquidationPrices
}

const basic = await getAccountSummaryBasic({
  client,
  poolAddress,
  account,
  chainId,
  tokenIds,
})
// Returns: AccountSummaryBasic

const risk = await getAccountSummaryRisk({
  client,
  poolAddress,
  account,
  chainId,
  tokenIds,
  queryAddress,  // PanopticQuery contract address (required for risk metrics)
})
// Returns: AccountSummaryRisk
```

### Guest Mode (No Wallet Connected)

When `account` is undefined, read functions return **safe zero-state objects** instead of throwing. This eliminates conditional logic in React hooks:

```typescript
// Works identically for guests and connected users
const { data: summary } = useQuery({
  queryKey: queryKeys.accountSummary(pool, account),  // account may be undefined
  queryFn: () => getAccountSummaryBasic({ client, poolAddress, account, chainId, tokenIds }),
})

// Guest mode returns:
// - pool: Full pool state (still fetched!)
// - collateralTracker0/1: Global data (totalAssets, totalSupply), user fields = 0n
// - collateral: ZERO_COLLATERAL (all bigints = 0n, isHealthy = true)
// - positions: []
// - netLiquidationValue: { value0: 0n, value1: 0n }
// - liquidationPrices: { liquidationTickDown: null, liquidationTickUp: null, ... }
// - totalGreeks: { value: 0n, delta: 0n, gamma: 0n }
```

**Why this matters**: React Query/SWR hooks don't like conditional execution. Without guest mode, UI code becomes cluttered with `if (!account) return null` checks.

### How Account Summary Is Computed

The SDK constructs a single multicall to PanopticQuery that batches:
1. Pool slot0 (price, tick)
2. Pool utilizations
3. CollateralTracker state (totalAssets, totalSupply, user shares)
4. Account collateral via RiskEngine
5. All position balances and premia
6. Greeks for all positions
7. Net liquidation value
8. Liquidation prices

**Why this exists**: React dashboards typically need all this data. Without `getAccountSummaryBasic()`, a dashboard would make 8+ separate RPC calls. This batches them into one.

**Note**: This is optimized for UI, not bots. Bots that only need specific data should use individual functions.

### Polling Strategy for UIs

`getAccountSummaryBasic()` is a "heavy" call (positions, Greeks, NLV, liquidation prices). For live price animations, use a two-tier polling strategy:

```typescript
// Heavy poll (30s) - full dashboard refresh
const { data: summary } = useQuery({
  queryKey: queryKeys.accountSummary(pool, account),
  queryFn: () => getAccountSummaryBasic({ client, poolAddress, account, chainId, tokenIds }),
  refetchInterval: 30_000,
})

// Light poll (5s) - just price for animations
const { data: poolState } = useQuery({
  queryKey: queryKeys.poolState(pool),
  queryFn: () => getPool(config),
  refetchInterval: 5_000,
})

// Greeks are computed from summary.positions + poolState.currentTick
// UI can animate Greeks locally between heavy polls using the light poll price
```

**Why split**: Price changes every block. Positions/Greeks/NLV change only on user actions. Polling the heavy endpoint at 5s wastes RPC calls.

---

## Stress Testing (Planned)

> **Note**: Stress testing functions (`stressTest`, `stressTestMultiple`) are not yet implemented. Use `checkCollateralAcrossTicks()` from PanopticQuery for similar functionality.

The `stressTest()` function would evaluate account state at hypothetical price levels, enabling "what-if" analysis for risk management dashboards.

```typescript
interface StressTestResult {
  // Full account state at stressed price
  summary: AccountSummaryBasic        // Same structure as getAccountSummaryBasic()

  // Stress-specific fields
  stressedTick: bigint           // The tick used for stress calculation
  priceChangeBps: bigint         // The price change applied (input echo)

  // Quick-access risk metrics
  marginBuffer: bigint           // Absolute: currentMargin - maintenanceMargin
  marginBufferPct: bigint        // Percentage: (buffer / maintenanceMargin) * 10000 (bps)
  isLiquidatable: boolean        // Would account be liquidated at this price?
  shortfall0: bigint             // Margin shortfall in token0 (0 if healthy)
  shortfall1: bigint             // Margin shortfall in token1 (0 if healthy)
}

// Single scenario
const stressed = await stressTest({
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  storage: StorageAdapter,
  priceChangeBps: -2000n,        // -20% price move
})

// stressed.marginBufferPct might be 1800 (18%) after -20% move
// stressed.isLiquidatable = false (still safe)

// Multiple scenarios (batched in single multicall)
const scenarios = await stressTestMultiple({
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  storage: StorageAdapter,
  priceChanges: [-1000n, -2000n, -4000n],  // -10%, -20%, -40%
})

// Returns: StressTestResult[] (one per scenario)
// scenarios[2].isLiquidatable might be true at -40%
```

**Dashboard usage (Worst-Case 24h Loss):**

```typescript
// Find the worst realistic scenario
const worstCase = await stressTest({
  client,
  poolAddress,
  account,
  storage,
  priceChangeBps: -2000n,  // Assume -20% is "worst case 24h"
})

const worstCaseLoss = currentNLV - worstCase.summary.netLiquidationValue.value0
// Display: "Worst-Case 24h Loss: -$XX.XX"
```

**Risk Breakdown Modal:**

```typescript
const scenarios = await stressTestMultiple({
  client,
  poolAddress,
  account,
  storage,
  priceChanges: [-2000n, -4000n],  // -20%, -40%
})

// Display:
// ETH −20% → Margin Buffer: 18%
// ETH −40% → Liquidation
scenarios.forEach(s => {
  console.log(`${s.priceChangeBps / 100n}% → ${
    s.isLiquidatable ? 'Liquidation' : `Margin Buffer: ${s.marginBufferPct / 100n}%`
  }`)
})
```

**Implementation note:** Stress testing uses `checkCollateralAcrossTicks()` from PanopticQuery to evaluate margin at arbitrary ticks without simulating actual trades.

---

## Margin Buffer

The margin buffer represents the safety cushion between current collateral and liquidation threshold:

```typescript
interface MarginBuffer {
  // Absolute values
  buffer0: bigint                // currentMargin0 - maintenanceMargin0
  buffer1: bigint                // currentMargin1 - maintenanceMargin1

  // Percentages (in basis points)
  bufferPct0: bigint             // (buffer0 / maintenanceMargin0) * 10000
  bufferPct1: bigint             // (buffer1 / maintenanceMargin1) * 10000

  // Minimum across both tokens (for UI display)
  minBufferPct: bigint           // min(bufferPct0, bufferPct1)

  _meta: BlockMeta
}

const buffer = await getMarginBuffer({
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  tokenIds: bigint[],
})

// UI color coding:
// Green:  minBufferPct > 3000 (>30%)
// Yellow: minBufferPct 1500-3000 (15-30%)
// Red:    minBufferPct < 1500 (<15%)
```

**Note:** Margin buffer is also included in `stressTest()` results for stressed scenarios.

---

## PanopticQuery Utilities

The PanopticQuery contract provides specialized read functions for portfolio analysis and optimization. These require a `queryAddress` parameter.

### getPortfolioValue

Calculate portfolio NAV (Net Asset Value) without premia. Useful for PnL tracking separate from liquidation value.

```typescript
interface PortfolioValue {
  value0: bigint               // Portfolio value in token0
  value1: bigint               // Portfolio value in token1
  atTick: bigint               // Tick at which value was calculated
  _meta: BlockMeta
}

const portfolio = await getPortfolioValue({
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  tokenIds: bigint[],
  atTick?: bigint,             // Defaults to current tick
  queryAddress: Address,       // PanopticQuery contract
})
```

### checkCollateralAcrossTicks

Evaluate collateral balance vs requirement across a range of ticks. Returns 301 data points for charting liquidation risk in a UI.

```typescript
interface CollateralDataPoint {
  tick: bigint
  balance: bigint              // Available collateral at this tick
  required: bigint             // Required collateral at this tick
}

interface CollateralAcrossTicks {
  dataPoints: CollateralDataPoint[]  // 301 points across tick range
  liquidationPriceDown: bigint | null  // Tick where liquidation occurs below (null if none)
  liquidationPriceUp: bigint | null    // Tick where liquidation occurs above (null if none)
  _meta: BlockMeta
}

const analysis = await checkCollateralAcrossTicks({
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  tokenIds: bigint[],
  queryAddress: Address,
})

// Chart the liquidation zone
for (const point of analysis.dataPoints) {
  const ratio = (point.balance * 10000n) / point.required  // bps
  console.log(`Tick ${point.tick}: ${ratio} bps margin`)
}
```

### optimizeTokenIdRiskPartners

Find the optimal risk partner assignment for a multi-leg TokenId to minimize collateral requirements.

```typescript
const optimizedTokenId = await optimizeTokenIdRiskPartners({
  client: PublicClient,
  poolAddress: Address,
  tokenId: bigint,             // TokenId to optimize
  atTick?: bigint,             // Defaults to current tick
  queryAddress: Address,
})

// Use the optimized tokenId when opening position
await openPosition({ ...params, tokenId: optimizedTokenId })
```

**Note:** Only works for TokenIds with 2+ legs. Single-leg positions return unchanged.

---

## Net Liquidation Value

The net liquidation value (NLV) represents the approximate token delta if all positions were closed at a given tick. This is useful for portfolio valuation and risk analysis.

```typescript
interface NetLiquidationValue {
  value0: bigint               // NLV in terms of token0
  value1: bigint               // NLV in terms of token1
  atTick: bigint               // Tick at which NLV was calculated
  includedPendingPremium: boolean
  _meta: BlockMeta
}

const nlv = await getNetLiquidationValue({
  client,
  poolAddress,
  account,
  tokenIds,
  atTick?,                     // Optional: tick to evaluate at
  queryAddress,                // PanopticQuery contract address
  includePendingPremium?,      // Default: true
})
// Returns: NetLiquidationValue
```

### How NLV Is Computed

The SDK calls `PanopticQuery.getNetLiquidationValue()` which computes all the math on-chain in a single RPC call:

```
NLV = Σ(leg token amounts at atTick) + Σ(exercised amounts) + (shortPremia - longPremia)
```

**Contract routing**: The SDK hides the PanopticQuery routing. Users call `getNetLiquidationValue()` and the SDK routes to the helper contract automatically.

---

## Safe Mode

```typescript
type SafeMode = 'normal' | 'restricted' | 'emergency'

interface SafeModeState {
  mode: SafeMode
  canMint: boolean
  canBurn: boolean
  canForceExercise: boolean
  canLiquidate: boolean
  reason?: string
  _meta: BlockMeta
}

// Get current safe mode
const state = await getSafeMode({ client, poolAddress })
// { mode: 'normal', canMint: true, canBurn: true, canForceExercise: true, canLiquidate: true, _meta: { ... } }
```

**Pre-flight enforcement**: `openPosition()` internally checks safe mode and throws `SafeModeError` if minting is blocked.

---

## Transaction Model

### Write Functions

All write functions use `tokenId` as the position identifier. Use `*AndWait()` variants for confirmation:

```typescript
// Create tokenId first
const tokenId = createTokenIdBuilder(pool.address, pool.poolKey.tickSpacing)
  .addCall({ strike: 200000n, width: 100n, optionRatio: 1n, isLong: true })
  .build()

// Open position - requires explicit existingPositionIds
const result = await openPosition({
  client,
  walletClient,
  account,
  poolAddress,
  existingPositionIds: [],  // Positions held before this mint
  tokenId,
  positionSize: 1000000000000000000n,
  tickAndSpreadLimits: [-887272n, 887272n, 0n],  // [tickLimitLow, tickLimitHigh, spreadLimitTick]
})

// Wait for confirmation
const receipt = await result.wait()
```

**Note**: `openPosition()` requires explicit `existingPositionIds` array. The SDK does NOT auto-build from storage - caller provides it.

### Tick and Spread Limits (Required)

Position operations accept explicit tick limit parameters:

```typescript
// Each position operation accepts these parameters individually:
tickLimitLow: bigint       // Lower tick limit (always <= tickLimitHigh)
tickLimitHigh: bigint      // Upper tick limit (always >= tickLimitLow)
spreadLimit?: bigint       // Spread limit (use 0n for no spread limit, default: 0n)
swapAtMint?: boolean       // Whether to swap at mint (swaps tick limit order, default: false)

// Example:
{
  tickLimitLow: -887272n,
  tickLimitHigh: 887272n,
  spreadLimit: 0n,         // No spread limit
  swapAtMint: false,       // No swap
}
```

**`swapAtMint` behavior**: When `true`, the SDK swaps `tickLimitLow` and `tickLimitHigh` before passing to the contract. This enables single-sided exposure by instructing the contract to swap tokens during mint.

**Note**: The `TickAndSpreadLimits` tuple type (`readonly [bigint, bigint, bigint]`) is **deprecated**. Use explicit parameters instead.

### Which Operations Need These Parameters

| Operation | Tick Limits |
|-----------|-------------|
| `openPosition` | Required (`tickLimitLow`, `tickLimitHigh`, `spreadLimit?`, `swapAtMint?`) |
| `closePosition` | Required (same) |
| `rollPosition` | Required (separate close + open limits: `closeTickLimitLow/High`, `openTickLimitLow/High`) |
| `forceExercise` | No (uses `dispatchFrom`) |
| `deposit` | No |
| `withdraw` | No |

### Gas Handling

```typescript
// Default: viem estimates gas via simulation (eth_estimateGas)
await openPosition(writeConfig, { ... })

// Override: user provides explicit gas (skips estimation)
await openPosition(writeConfig, {
  ...,
  gas: 500_000n,
})
```

**Error surfacing via gas estimation**: When the SDK calls `eth_estimateGas`, it runs a simulation. If the transaction would revert, the simulation fails and the SDK surfaces a typed error (e.g., `AccountInsolventError`, `SafeModeError`) **before** the user signs. This prevents wasting gas on transactions that will fail.

For `liquidate()`, the SDK uses `isLiquidatable()` checks first, but the final `eth_estimateGas` call provides an additional safety net.

### Approvals

Approvals are **explicit** - no autoApprove option:

```typescript
// Check approval
const needsApproval = await checkApproval(config, {
  token: '0x...',
  spender: pool.collateralTracker0,
  amount: 1000000000000000000n,
})

// Approve if needed
if (needsApproval) {
  await approve(writeConfig, {
    token: '0x...',
    spender: pool.collateralTracker0,
    amount: maxUint256,
  })
}

// Then execute operation
await openPosition(writeConfig, { ... })
```

---

## Position Operations

All position operations (open, close, settle) are implemented via the `PanopticPool.dispatch()` function (see `contracts/PanopticPool.sol:577`). The SDK provides convenient wrappers for common operations.

**Contract Implementation Details**:
- Opening a position calls `dispatch()` with a `mint` operation internally
- Closing a position calls `dispatch()` with a `burn` operation internally
- The dispatch function routes to `PanopticPool._validatePositionList()` and interacts with the `SemiFungiblePositionManager` (see `contracts/SemiFungiblePositionManagerV4.sol`)
- Position data is tracked using the `TokenId` type (see `contracts/types/TokenId.sol`)
- Accumulated fees are computed via `PanopticPool.getAccumulatedFeesAndPositionsData()` (see `contracts/PanopticPool.sol:434`)

### Open Position

```typescript
const result = await openPosition({
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,
  poolAddress: Address,
  existingPositionIds: bigint[],  // Positions held before this mint
  tokenId: bigint,                // Created via TokenIdBuilder
  positionSize: bigint,
  tickAndSpreadLimits: [bigint, bigint, bigint],  // [tickLimitLow, tickLimitHigh, spreadLimitTick]
  usePremiaAsCollateral?: boolean,
  builderCode?: bigint,
})
// Returns TxResult: { hash, wait }

const receipt = await result.wait()
```

### Close Position

```typescript
const result = await closePosition({
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,
  poolAddress: Address,
  positionIdList: bigint[],       // Current positions including the one being closed
  tokenId: bigint,
  positionSize: bigint,
  tickAndSpreadLimits: [bigint, bigint, bigint],
  usePremiaAsCollateral?: boolean,
  builderCode?: bigint,
})
```

### Roll Position

Atomically close one position and open another in a single transaction:

```typescript
const result = await rollPosition({
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,
  poolAddress: Address,
  positionIdList: bigint[],       // Current positions
  oldTokenId: bigint,             // Position to close
  oldPositionSize: bigint,
  newTokenId: bigint,             // Position to open
  newPositionSize: bigint,
  closeLimits: [bigint, bigint, bigint],
  openLimits: [bigint, bigint, bigint],
  usePremiaAsCollateral?: boolean,
  builderCode?: bigint,
})
```

### Settle Accumulated Premia

Settles accumulated premia for all positions in `positionIdList`. Internally calls `dispatch()` with the current position size for each position (which triggers settlement without changing position sizes).

```typescript
const { hash } = await settleAccumulatedPremia({
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,
  poolAddress: Address,
  positionIdList: bigint[],       // All positions to settle
  usePremiaAsCollateral?: boolean,
  builderCode?: bigint,
})
```

---

## Simulation (Preview for UI)

Simulation functions power "Review Transaction" modals in React UIs. They answer "What will happen?" and "Will it succeed?" before the user signs.

### SimulationResult Pattern

All simulation functions return a discriminated union:

```typescript
type SimulationResult<TData> =
  | {
      success: true
      data: TData              // Operation-specific result (strictly typed)
      gasEstimate: bigint      // Estimated gas for the transaction
      tokenFlow?: TokenFlow    // Token balance changes (if applicable)
      _meta: BlockMeta
    }
  | {
      success: false
      error: PanopticError     // Typed error (e.g., AccountInsolventError)
      _meta: BlockMeta
    }

interface TokenFlow {
  delta0: bigint               // Change in token0 balance
  delta1: bigint               // Change in token1 balance
  balanceBefore0: bigint
  balanceBefore1: bigint
  balanceAfter0: bigint
  balanceAfter1: bigint
}
```

**Error handling philosophy**:
- `success: false` for contract reverts (logic errors) - allows UI to show "Insufficient Collateral" as red text, not a crashed modal
- **Throws** only for network/RPC errors (node down, malformed request)

### How Simulation Works

Simulations use a **multicall pattern** via `eth_call`:

1. **Call 1**: The action (e.g., `dispatch()` to open position)
2. **Call 2+**: Inspection calls (e.g., `RiskEngine.getMargin()` to see post-trade state)
3. **Execute via `eth_call`**: EVM runs both sequentially; Call 2 sees state changes from Call 1
4. **Decode**: Gas = total simulation gas, `data` = decoded inspection results

### simulateOpenPosition

```typescript
interface OpenPositionSimulation {
  position: Position             // The position that would be created
  greeks: PositionGreeks         // Greeks at current tick
  amount0Required: bigint        // Token0 required
  amount1Required: bigint        // Token1 required
  postCollateral0: bigint        // Post-trade collateral token0
  postCollateral1: bigint        // Post-trade collateral token1
  postMarginExcess0: bigint | null
  postMarginExcess1: bigint | null
  commission0: bigint | null
  commission1: bigint | null
}

const result = await simulateOpenPosition({
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  existingPositionIds: bigint[],
  tokenId: bigint,
  positionSize: bigint,
  tickAndSpreadLimits: [bigint, bigint, bigint],
})
// Returns: SimulationResult<OpenPositionSimulation>

if (result.success) {
  console.log('Gas estimate:', result.gasEstimate)
  console.log('Post-trade collateral:', result.data.postCollateral0, result.data.postCollateral1)
} else {
  console.log('Would fail:', result.error.message)
}
```

### simulateClosePosition

```typescript
interface ClosePositionSimulation {
  amount0Received: bigint
  amount1Received: bigint
  premiaCollected0: bigint | null
  premiaCollected1: bigint | null
  postCollateral0: bigint
  postCollateral1: bigint
  realizedPnL0: bigint | null
  realizedPnL1: bigint | null
}

const result = await simulateClosePosition({
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  positionIdList: bigint[],
  tokenId: bigint,
  positionSize: bigint,
  tickAndSpreadLimits: [bigint, bigint, bigint],
})
// Returns: SimulationResult<ClosePositionSimulation>
```

### simulateForceExercise

```typescript
interface ForceExerciseSimulation {
  exerciseFee0: bigint
  exerciseFee1: bigint
  canExercise: boolean
  reason?: string
}

const result = await simulateForceExercise({
  client: PublicClient,
  poolAddress: Address,
  account: Address,              // The exerciser
  user: Address,                 // Position owner being exercised
  positionIdListFrom: bigint[],  // Exerciser's positions
  positionIdListTo: bigint[],    // User's positions
  positionIdListToFinal: bigint[], // User's positions after exercise
})
// Returns: SimulationResult<ForceExerciseSimulation>
// Uses dispatchFrom (no tickAndSpreadLimits needed)
```

### simulateLiquidate

```typescript
interface LiquidateSimulation {
  bonus0: bigint
  bonus1: bigint
  positionsClosed: bigint[]      // tokenIds that will be closed
  isLiquidatable: boolean
  shortfall0: bigint
  shortfall1: bigint
}

const result = await simulateLiquidate({
  client: PublicClient,
  poolAddress: Address,
  account: Address,              // The liquidator
  liquidatee: Address,
  positionIdListFrom: bigint[],  // Liquidator's positions
  positionIdListTo: bigint[],    // Liquidatee's positions
  positionIdListToFinal: bigint[], // Liquidatee's positions after (usually [])
})
// Returns: SimulationResult<LiquidateSimulation>
// Uses dispatchFrom (no tickAndSpreadLimits needed)
```

### simulateSettle

```typescript
interface SettleSimulation {
  premiaReceived0: bigint
  premiaReceived1: bigint
  postCollateral0: bigint
  postCollateral1: bigint
}

const result = await simulateSettle(config, {
  account: Address,
  tokenId: bigint,
})
// Returns: SimulationResult<SettleSimulation>
```

### simulateDeposit / simulateWithdraw

```typescript
interface DepositSimulation {
  sharesMinted: bigint         // Shares minted
  postAssets: bigint           // Post-deposit assets
  postShares: bigint           // Post-deposit shares
}

interface WithdrawSimulation {
  sharesBurned: bigint         // Shares burned
  assetsReceived: bigint       // Underlying tokens received
  postAssets: bigint           // Post-withdraw assets
  postShares: bigint           // Post-withdraw shares
  canWithdraw: boolean         // Whether withdrawal is possible
  reason?: string              // Reason if canWithdraw is false
}

const depositResult = await simulateDeposit(config, {
  account: Address,
  token: Address,              // token0 or token1
  assets: bigint,
})

const withdrawResult = await simulateWithdraw(config, {
  account: Address,
  token: Address,
  assets: bigint,
})
```

### simulateDispatch (Advanced)

For raw dispatch operations. Returns the same simulation data as other `simulate*` functions:

```typescript
interface DispatchSimulation {
  netAmount0: bigint
  netAmount1: bigint
  positionsCreated: bigint[]
  positionsClosed: bigint[]
  postCollateral0: bigint
  postCollateral1: bigint
  postMarginExcess0: bigint | null
  postMarginExcess1: bigint | null
}

const result = await simulateDispatch({
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  positionIdList: bigint[],
  finalPositionIdList: bigint[],
  positionSizes: bigint[],
  tickAndSpreadLimitsArray: [bigint, bigint, bigint][],
})
// Returns: SimulationResult<DispatchSimulation>
```

**Note**: `simulateDispatch` uses the same multicall simulation pattern as `simulateOpenPosition` etc. - it runs the dispatch via `eth_call`, then inspection calls to capture post-trade state.

---

## Raw Dispatch (Advanced)

For power users who need batch operations, atomic rolls, or custom multi-leg flows. All position operations (`openPosition`, `closePosition`, `settleAccumulatedPremia`) are wrappers around `dispatch()`.

### Dispatch Parameters

```typescript
interface DispatchParams {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  poolAddress: Address
  positionIdList: bigint[]                          // Current positions
  finalPositionIdList: bigint[]                     // Positions after operation
  positionSizes: bigint[]                           // Size for each position
  tickAndSpreadLimitsArray: [bigint, bigint, bigint][]  // Limits per position
  usePremiaAsCollateral?: boolean
  builderCode?: bigint
}

// Maps to PanopticPool.dispatch():
// dispatch(positionIdList, finalPositionIdList, positionSizes, tickAndSpreadLimitsArray, usePremiaAsCollateral, builderCode)
```

### Position Size Semantics

The `positionSize` field determines the operation type:

| positionSize | Operation | Description |
|--------------|-----------|-------------|
| `> 0` (new position) | **Mint** | Open new position with specified size |
| `> currentSize` | **Mint (add)** | Add to existing position |
| `== currentSize` | **Settle premia** | Settle accumulated premia, no size change |
| `!= currentSize` (any other value) | **Burn (close 100%)** | Close entire position |

**Important**: There is no partial close. Any `positionSize` that doesn't match the current minted size results in closing 100% of the position.

```typescript
// Examples:
const currentSize = position.positionSize  // e.g., 1000000000000000000n

// Open new position
positionSizes: [1000000000000000000n]

// Settle premia only (pass exact current size)
positionSizes: [currentSize]

// Close entire position (any value != currentSize closes 100%)
positionSizes: [0n]  // closes 100%
```

### Batch Operations

`dispatch()` executes multiple operations atomically (all-or-nothing):

```typescript
import { dispatch, rollPosition } from 'panoptic-v2-sdk'

// For rolls, use the convenience wrapper:
const result = await rollPosition({
  client,
  walletClient,
  account,
  poolAddress,
  positionIdList: [oldTokenId],
  oldTokenId,
  oldPositionSize,
  newTokenId,
  newPositionSize,
  closeLimits: [-887272n, 887272n, 0n],
  openLimits: [-887272n, 887272n, 0n],
})

// For complex batches, use dispatch directly:
const result = await dispatch({
  client,
  walletClient,
  account,
  poolAddress,
  positionIdList: [tokenId1, tokenId2],
  finalPositionIdList: [tokenId1, tokenId2, newTokenId],
  positionSizes: [size1, size2, newSize],
  tickAndSpreadLimitsArray: [
    [-887272n, 887272n, 0n],
    [-887272n, 887272n, 0n],
    [-887272n, 887272n, 0n],
  ],
})
```

### FinalPositionIdList

The caller must provide `finalPositionIdList` (the complete list of tokenIds the user will hold after the transaction). This is validated on-chain against `s_positionsHash`.

If the list is incorrect, the transaction will revert with `IncorrectPositionList`. Use `syncPositions()` to get current positions before building the list.

---

## Force Exercise

Perpetual options in Panoptic v2 can be force-exercised when they are long (eg. long put/long call). The exerciser pays a fee to close the position owner's long legs.

**Contract Implementation**: See `PanopticPool._forceExercise()` (`contracts/PanopticPool.sol:1610`)
- Emits `ForceExercised` event with exerciser, owner, tokenId, and exercise fee
- Exercise cost is calculated by the `RiskEngine.exerciseCost()` function
- Uses `RiskEngine` to determine which legs are exercisable
- Uses `dispatchFrom` (no tickAndSpreadLimits needed)

```typescript
// Execute force exercise
const result = await forceExercise({
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,                // The exerciser
  poolAddress: Address,
  user: Address,                   // Position owner being exercised
  positionIdListFrom: bigint[],    // Exerciser's positions
  positionIdListTo: bigint[],      // User's positions
  positionIdListToFinal: bigint[], // User's positions after exercise
  usePremiaAsCollateral?: bigint,
})
```

**Detecting exercisability**: Use `simulateForceExercise()` to check if a position can be force exercised. A `success: true` result indicates the position is exercisable.

---

## Liquidation

Accounts become liquidatable when their collateral falls below maintenance requirements. Liquidators can close the account's positions and receive a bonus.

**Contract Implementation**: See `PanopticPool._liquidate()` (`contracts/PanopticPool.sol:1494`)
- Emits `AccountLiquidated` event with liquidator, liquidatee, and bonus amounts
- Solvency is checked via `RiskEngine.isAccountSolvent()`
- Liquidation bonus is calculated by `RiskEngine.getLiquidationBonus()`
- Uses `RiskEngine.getMargin()` to determine collateral requirements (see `contracts/RiskEngine.sol:1057`)
- Uses `dispatchFrom` (no tickAndSpreadLimits needed)

```typescript
// Check if liquidatable at current tick
const check = await isLiquidatable(config, {
  account: Address,
})
// { liquidatable: boolean, shortfall0: bigint, shortfall1: bigint }

// Get liquidation prices (ticks where account becomes insolvent)
const prices = await getLiquidationPrices(config, {
  account: Address,
})
// Returns: LiquidationPrices

interface LiquidationPrices {
  lowerTick: bigint | null       // Tick where liquidation occurs below (null if none)
  upperTick: bigint | null       // Tick where liquidation occurs above (null if none)
  isLiquidatable: boolean        // Whether already liquidatable at current tick
  _meta: BlockMeta
}

// Execute liquidation
const result = await liquidate({
  client: PublicClient,
  walletClient: WalletClient,
  account: Address,                // The liquidator
  poolAddress: Address,
  liquidatee: Address,
  positionIdListFrom: bigint[],    // Liquidator's positions
  positionIdListTo: bigint[],      // Liquidatee's positions
  positionIdListToFinal: bigint[], // Liquidatee's positions after (usually [])
  usePremiaAsCollateral?: bigint,
})
```

### How Liquidation Prices Are Computed

The SDK calls `PanopticQuery.getLiquidationPrices()` which performs an on-chain binary search over the tick range. This is a single RPC call - the helper contract handles all the iteration internally.

**Contract routing**: The SDK hides the PanopticQuery routing. Users call `getLiquidationPrices()` and the SDK routes to the helper contract automatically.

**Note**: `PanopticQuery` is a planned contract not yet implemented. SDK implementers should prepare for this helper contract to be deployed as an upgradable proxy.

---

## Oracle Data

Full oracle state exposure:

**Contract Implementation**:
- Oracle data is stored in `PanopticPool.s_oraclePack` (see `contracts/PanopticPool.sol:183`)
- Oracle structure defined in `contracts/types/OraclePack.sol`
- Oracle ticks are computed via `RiskEngine.getOracleTicks()` which processes the 8-slot observation queue
- TWAP tick accessed via `PanopticPool.getTWAP()` (see `contracts/PanopticPool.sol:1956`)
- Full oracle state via `PanopticPool.getOracleTicks()` (see `contracts/PanopticPool.sol:1911`)
- The oracle stores 4 EMAs (spot, fast, slow, eons) and maintains an 8-slot queue of price observations
- Updates occur on-chain during position operations when enough time has passed (64s minimum interval)

See the `OracleState` interface definition in the [Pool Interface](#pool-interface) section for full structure.

```typescript
const oracle = await getOracleState({ client, poolAddress })

// Poke oracle - checks rate limit first, throws OracleRateLimitedError if < 64s since last update
const { hash } = await pokeOracle({ client, walletClient, account, poolAddress })
```

---

## Interest Rates

MVP exposes current rates only (no IRM internals or projection):

**Contract Implementation**:
- Interest rates are calculated by `CollateralTracker.interestRate()` (see `contracts/CollateralTracker.sol:1062`)
- Each CollateralTracker (token0 and token1) has its own independent interest rate
- Rates are based on pool utilization using an adaptive PID controller in `RiskEngine`
- Rate updates via `RiskEngine.updateInterestRate()` (see `contracts/RiskEngine.sol:2183`)
- Accrued interest tracked per-user in CollateralTracker storage
- Interest accrual happens on `CollateralTracker._accrueInterest()` (see `contracts/CollateralTracker.sol:907`)

```typescript
interface CurrentRates {
  borrowRate0: bigint          // Current borrow rate for token0
  supplyRate0: bigint          // Current supply rate for token0
  borrowRate1: bigint          // Current borrow rate for token1
  supplyRate1: bigint          // Current supply rate for token1
  _meta: BlockMeta
}

const rates = await getCurrentRates({ client, poolAddress })
```

---

## Collateral Estimation

Collateral estimation simulates opening the position to get accurate utilization impact:

```typescript
interface CollateralEstimate {
  required0: bigint              // Collateral required for token0
  required1: bigint              // Collateral required for token1
  postMarginExcess0: bigint      // Margin excess after opening for token0
  postMarginExcess1: bigint      // Margin excess after opening for token1
  canOpen: boolean               // True if current balance sufficient
  _meta: BlockMeta
}

const estimate = await estimateCollateralRequired({
  client,
  poolAddress,
  account,
  tokenId,
  positionSize,
  atTick?,                       // Optional: tick to evaluate at
  queryAddress?,                 // PanopticQuery contract address
})
```

### How Estimation Works

The SDK calls `PanopticQuery.estimateCollateralRequired()` which computes all the math on-chain in a single RPC call, including utilization impact simulation.

**Contract routing**: The SDK hides the PanopticQuery routing. Users call `estimateCollateralRequired()` and the SDK routes to the helper contract automatically.

### Max Position Size

Find the maximum position size that can be opened given current collateral:

```typescript
const maxSize = await getMaxPositionSize(config, {
  account: Address,
  tokenId: bigint,               // The position type to open
  atTick: bigint,                // Required: tick to evaluate at
})
// Returns: bigint (maximum position size)
```

### How Max Size Is Computed

The SDK calls `PanopticQuery.getMaxPositionSize()` which performs the calculation on-chain in a single RPC call.

---

## Risk Parameters

Full RiskEngine parameter exposure:

```typescript
interface RiskParameters {
  collateralRequirement: bigint    // Collateral requirement
  maintenanceMargin: bigint        // Maintenance margin rate
  commissionRate: bigint           // Commission rate
  targetUtilization: bigint        // Target pool utilization
  saturatedUtilization: bigint     // Saturated pool utilization
  itmSpreadMultiplier: bigint      // ITM spread multiplier
  _meta: BlockMeta
}

const params = await getRiskParameters({ client, poolAddress })
```

---

## Commission Estimation

Commissions are charged on position mint and burn. Commission amounts are included in simulation results rather than as standalone estimation functions.

**Contract Implementation**: See `CollateralTracker.settleMint()` and `CollateralTracker.settleBurn()`

Commission data is available in:
- `OpenPositionSimulation.commission0` / `commission1` - commission charged on open
- Simulation token flow data shows net amounts after commissions

**Note**: There are no standalone `estimateMintCommission` or `estimateBurnCommission` functions. Use `simulateOpenPosition` and `simulateClosePosition` to see commission impact.

---

## ERC4626 Vault Operations

Full ERC4626 exposure for CollateralTracker (all four variants):

```typescript
// Token-based operations (specify underlying token amount)
// Deposit (handles native ETH contract-side)
const result = await deposit(writeConfig, {
  token: Address,          // token0 or token1
  assets: bigint,          // amount of underlying tokens
  gas?: bigint,
})
// { hash }

// Withdraw
const result = await withdraw(writeConfig, {
  token: Address,
  assets: bigint,          // amount of underlying tokens to receive
  gas?: bigint,
})
// { hash }

// Share-based operations (specify share amount)
// Mint specific number of shares
const result = await mint(writeConfig, {
  token: Address,
  shares: bigint,          // number of shares to mint
  gas?: bigint,
})
// { hash }

// Redeem specific number of shares
const result = await redeem(writeConfig, {
  token: Address,
  shares: bigint,          // number of shares to redeem
  gas?: bigint,
})
// { hash }

// *AndWait variants available for all four operations
const result = await depositAndWait(writeConfig, { ...params })
// { hash, receipt, events }

// Preview functions
const shares = await previewDeposit(config, { token, assets })
const assets = await previewWithdraw(config, { token, assets })
const assets = await previewMint(config, { token, shares })
const assets = await previewRedeem(config, { token, shares })

// Conversion utilities
const shares = await convertToShares(config, { token, assets })
const assets = await convertToAssets(config, { token, shares })
```

---

## Event Watching

Live events only (position sync handles historical):

```typescript
import { watchEvents, type PanopticEvent } from 'panoptic-v2-sdk'

const unwatch = watchEvents({
  config,

  // Optional: filter by event type (omit for all events)
  eventTypes: ['OptionMinted', 'OptionBurnt'],

  onLogs: (events: PanopticEvent[]) => {
    for (const event of events) {
      switch (event.eventName) {
        case 'OptionMinted':
          console.log('Minted:', event.args.tokenId)
          console.log('Legs:', event.legs) // includes liquidityDelta
          break
        case 'OptionBurnt':
          console.log('Burned:', event.args.tokenId)
          break
        case 'ForceExercised':
          console.log('Exercised:', event.args.tokenId)
          break
        case 'AccountLiquidated':
          console.log('Liquidated:', event.args.liquidatee)
          break
        // ... all protocol events
      }
    }
  },

  onError: (error) => {
    console.error('Watch error:', error)
  },
})

// Cleanup
unwatch()
```

### Event Types

```typescript
type PanopticEventType =
  | 'OptionMinted' | 'OptionBurnt' | 'AccountLiquidated' | 'ForcedExercised'
  | 'PremiumSettled' | 'Deposit' | 'Withdraw' | 'BorrowRateUpdated'
  | 'LiquidityChunkUpdated' | 'ProtocolLossRealized' | 'ModifyLiquidity'
  | 'Swap' | 'Donate'

// All events extend BaseEvent
interface BaseEvent {
  type: PanopticEventType
  transactionHash: Hash
  blockNumber: bigint
  blockHash: Hash
  logIndex: bigint
}

// Example event types:
interface OptionMintedEvent extends BaseEvent {
  type: 'OptionMinted'
  recipient: Address
  tokenId: bigint
  positionSize: bigint
  poolUtilization0: bigint
  poolUtilization1: bigint
  tickAtMint: bigint
  timestampAtMint: bigint
  blockAtMint: bigint
  swapAtMint: boolean
}

interface OptionBurntEvent extends BaseEvent {
  type: 'OptionBurnt'
  recipient: Address
  tokenId: bigint
  positionSize: bigint
  premiaByLeg: readonly [bigint, bigint, bigint, bigint]
}

// PanopticEvent is a union of all event types
type PanopticEvent =
  | OptionMintedEvent | OptionBurntEvent | AccountLiquidatedEvent
  | ForcedExercisedEvent | PremiumSettledEvent | DepositEvent
  | WithdrawEvent | BorrowRateUpdatedEvent | LiquidityChunkUpdatedEvent
  | ProtocolLossRealizedEvent | ModifyLiquidityEvent | SwapEvent | DonateEvent

interface LegUpdate {
  legIndex: bigint
  liquidityDelta: bigint
  amount0Delta: bigint
  amount1Delta: bigint
}
```

### Resilient Subscriptions (Bots)

`watchEvents()` is one-shot - if the WebSocket disconnects, it stops. Long-running bots need automatic reconnection:

```typescript
import { createEventSubscription } from 'panoptic-v2-sdk'

const subscription = createEventSubscription({
  config,

  // Optional: filter by event type (omit for all events)
  eventTypes: ['OptionMinted', 'OptionBurnt', 'AccountLiquidated'],

  onLogs: (events: PanopticEvent[]) => {
    // Process events
  },

  onError: (error: Error) => {
    // Log errors (subscription will auto-reconnect)
    console.error('Subscription error:', error)
  },

  onReconnect: (attempt: bigint, nextDelayMs: bigint) => {
    // Optional: track reconnection attempts
    console.log(`Reconnecting (attempt ${attempt}, next in ${nextDelayMs}ms)`)
  },

  onConnected: () => {
    // Optional: track connection state
    console.log('Subscription connected')
  },

  // Reconnection strategy (optional, these are defaults)
  reconnect: {
    maxAttempts: 10n,           // Give up after 10 failures (0n = infinite)
    initialDelayMs: 1000n,      // First retry after 1s
    maxDelayMs: 30000n,         // Cap at 30s between retries
    backoffMultiplier: 2n,      // Exponential backoff
  },
})

// Start watching
subscription.start()

// Check state
subscription.isConnected()    // boolean
subscription.reconnectAttempts // bigint

// Stop (cleans up, no more reconnects)
subscription.stop()
```

**Gap handling**: On reconnect, the subscription fetches missed events from `lastProcessedBlock` to `latestBlock` before resuming live watching. This ensures no events are missed during disconnection.

```typescript
// The subscription tracks processed blocks internally
interface EventSubscription {
  start(): void
  stop(): void
  isConnected(): boolean
  reconnectAttempts: bigint
  lastProcessedBlock: bigint   // For gap detection
}
```

### Event Polling (HTTP Transport)

For environments where WebSocket connections are unreliable or unavailable, use the polling-based alternative:

```typescript
import { createEventPoller } from 'panoptic-v2-sdk'

const poller = createEventPoller({
  config,

  onLogs: (events: PanopticEvent[]) => {
    // Process events
  },

  onError: (error: Error) => {
    console.error('Polling error:', error)
  },

  // Optional settings
  intervalMs: 12000n,           // Default: 12s (1 block on mainnet)
  maxBlockRange: 1000n,         // Max blocks to query per poll
})

// Start polling
poller.start()

// Stop polling
poller.stop()
```

**How it works:**
- Polls eth_getLogs every `intervalMs` for new blocks
- Tracks last processed block to avoid duplicate events
- Automatically chunks large block ranges to avoid RPC limits
- Default 12s interval matches mainnet block time

**When to use which:**
- `watchEvents()` - Real-time updates, WebSocket available
- `createEventSubscription()` - Production bots with WebSocket, needs reliability
- `createEventPoller()` - HTTP-only environments, cloud proxies, unreliable WebSockets

**Note**: HTTP transports work with polling but not subscriptions.

---

## Error Handling

All errors throw typed exceptions with original cause. The SDK wraps contract errors from `contracts/libraries/Errors.sol` into typed TypeScript classes.

```typescript
class PanopticError extends Error {
  readonly name: string
  readonly cause?: Error      // Original viem error for debugging
}
```

### Contract Errors (from Errors.sol)

```typescript
// Solvency & Margin
class AccountInsolventError extends PanopticError {
  solvent: bigint
  numberOfTicks: bigint
}
class NotMarginCalledError extends PanopticError {}

// Token & Collateral
class NotEnoughTokensError extends PanopticError {
  tokenAddress: Address
  assetsRequested: bigint
  assetBalance: bigint
}
class NotEnoughLiquidityInChunkError extends PanopticError {}
class InsufficientCreditLiquidityError extends PanopticError {}
class DepositTooLargeError extends PanopticError {}
class BelowMinimumRedemptionError extends PanopticError {}
class ExceedsMaximumRedemptionError extends PanopticError {}
class ZeroCollateralRequirementError extends PanopticError {}

// Position & TokenId
class InvalidTokenIdParameterError extends PanopticError {
  parameterType: bigint  // 0n=poolId, 1n=ratio, 2n=tokenType, 3n=riskPartner, 4n=strike, 5n=width, 6n=duplicateChunk
}
class PositionNotOwnedError extends PanopticError {}
class PositionTooLargeError extends PanopticError {}
class PositionCountNotZeroError extends PanopticError {}
class DuplicateTokenIdError extends PanopticError {}
class TokenIdHasZeroLegsError extends PanopticError {}
class TooManyLegsOpenError extends PanopticError {}
class InputListFailError extends PanopticError {}

// Tick & Price
class InvalidTickError extends PanopticError {}
class InvalidTickBoundError extends PanopticError {}
class PriceBoundFailError extends PanopticError {
  currentTick: bigint
}
class PriceImpactTooLargeError extends PanopticError {}

// Liquidity
class ChunkHasZeroLiquidityError extends PanopticError {}
class LiquidityTooHighError extends PanopticError {}
class NetLiquidityZeroError extends PanopticError {}
class EffectiveLiquidityAboveThresholdError extends PanopticError {}

// Oracle & Safe Mode
class StaleOracleError extends PanopticError {}

// Exercise
class NoLegsExercisableError extends PanopticError {}
class NotALongLegError extends PanopticError {}

// Pool & Initialization
class PoolNotInitializedError extends PanopticError {}
class AlreadyInitializedError extends PanopticError {}
class WrongPoolIdError extends PanopticError {}
class WrongUniswapPoolError extends PanopticError {}

// Authorization
class NotPanopticPoolError extends PanopticError {}
class NotGuardianError extends PanopticError {}
class NotBuilderError extends PanopticError {}
class InvalidBuilderCodeError extends PanopticError {}
class InvalidUniswapCallbackError extends PanopticError {}
class UnauthorizedUniswapCallbackError extends PanopticError {}

// Transfer & Casting
class TransferFailedError extends PanopticError {
  token: Address
  from: Address
  amount: bigint
  balance: bigint
}
class CastingError extends PanopticError {}
class UnderOverFlowError extends PanopticError {}

// Reentrancy
class ReentrancyError extends PanopticError {}

// Other
class ZeroAddressError extends PanopticError {}
```

### SDK-Specific Errors

```typescript
// Safe mode (SDK interprets oracle state)
class SafeModeError extends PanopticError {
  level: SafeMode
  reason: string
}

// Cross-pool mismatch
class CrossPoolError extends PanopticError {
  requestedPool: Address
  configuredPool: Address
}

// Sync timeout
class SyncTimeoutError extends PanopticError {
  elapsedMs: bigint
  blocksProcessed: bigint
  blocksRemaining: bigint
}

// Position discovery
class PositionSnapshotNotFoundError extends PanopticError {}

// Storage
class LocalStorageUnavailableError extends PanopticError {}
class ChunkLimitError extends PanopticError {}

// Network
class NetworkMismatchError extends PanopticError {
  walletChainId: bigint
  expectedChainId: bigint
}
```

### Usage

```typescript
try {
  await openPosition(writeConfig, { ... })
} catch (error) {
  if (error instanceof SafeModeError) {
    console.log(`Blocked by safe mode level ${error.level}: ${error.reason}`)
  } else if (error instanceof AccountInsolventError) {
    console.log(`Insolvent: ${error.solvent}`)
  } else if (error instanceof NotEnoughTokensError) {
    console.log(`Need ${error.assetsRequested}, have ${error.assetBalance}`)
  }
  // Original viem error available for debugging
  console.log('Original:', error.cause)
}
```

---

## SDK Logging

SDK uses **warn-once** patterns for degraded modes:

```typescript
// Logged once per session when relevant
console.warn('[panoptic-sdk] Position cache is stale, call syncPositions()')
```

No other console output. Errors are thrown, not logged.

---

## React Integration

The SDK exports a full React integration package including TanStack Query hooks, query keys, and mutation effects. The `react/` module provides pre-built hooks for all read, write, and simulation functions with automatic cache invalidation.

### Query Keys

```typescript
// panoptic-v2-sdk/query-keys.ts

export const queryKeys = {
  all: (chainId: bigint) => ['panoptic', chainId.toString()] as const,

  // Pool
  pool: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all(chainId), 'pool', poolAddress] as const,

  // Positions
  positions: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all(chainId), 'positions', poolAddress, account] as const,
  position: (chainId: bigint, poolAddress: Address, tokenId: bigint) =>
    [...queryKeys.all(chainId), 'position', poolAddress, tokenId.toString()] as const,

  // Account
  accountSummary: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all(chainId), 'accountSummary', poolAddress, account] as const,
  collateral: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all(chainId), 'collateral', poolAddress, account] as const,
  userShares: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all(chainId), 'userShares', poolAddress, account] as const,

  // Allowances (for deposit flows)
  allowance: (chainId: bigint, token: Address, owner: Address, spender: Address) =>
    [...queryKeys.all(chainId), 'allowance', token, owner, spender] as const,

  // Greeks & Risk
  positionGreeks: (chainId: bigint, poolAddress: Address, tokenId: bigint) =>
    [...queryKeys.all(chainId), 'greeks', poolAddress, tokenId.toString()] as const,
  liquidationPrices: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all(chainId), 'liquidationPrices', poolAddress, account] as const,
  netLiquidationValue: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all(chainId), 'nlv', poolAddress, account] as const,

  // Utilization
  utilization: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all(chainId), 'utilization', poolAddress] as const,

  // Chunks
  chunkSpreads: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all(chainId), 'chunkSpreads', poolAddress] as const,

  // Oracle
  oracleState: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all(chainId), 'oracle', poolAddress] as const,

  // Sync status
  syncStatus: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all(chainId), 'syncStatus', poolAddress, account] as const,
}
```

### Mutation Effects (Invalidation Map)

Tells developers exactly what goes stale after each action. This is "side-effect documentation as code":

```typescript
// panoptic-v2-sdk/query-keys.ts

export const mutationEffects = {
  // Position operations
  openPosition: (chainId: bigint, poolAddress: Address, account: Address) => [
    queryKeys.positions(chainId, poolAddress, account),
    queryKeys.collateral(chainId, poolAddress, account),
    queryKeys.accountSummary(chainId, poolAddress, account),
    queryKeys.pool(chainId, poolAddress),                    // Utilization changes
    queryKeys.utilization(chainId, poolAddress),
    queryKeys.liquidationPrices(chainId, poolAddress, account),
    queryKeys.netLiquidationValue(chainId, poolAddress, account),
    queryKeys.chunkSpreads(chainId, poolAddress),            // Spread may change
  ],

  closePosition: (chainId: bigint, poolAddress: Address, account: Address) => [
    queryKeys.positions(chainId, poolAddress, account),
    queryKeys.collateral(chainId, poolAddress, account),
    queryKeys.accountSummary(chainId, poolAddress, account),
    queryKeys.pool(chainId, poolAddress),
    queryKeys.utilization(chainId, poolAddress),
    queryKeys.liquidationPrices(chainId, poolAddress, account),
    queryKeys.netLiquidationValue(chainId, poolAddress, account),
    queryKeys.chunkSpreads(chainId, poolAddress),
  ],

  // Collateral operations
  deposit: (chainId: bigint, poolAddress: Address, account: Address) => [
    queryKeys.collateral(chainId, poolAddress, account),
    queryKeys.userShares(chainId, poolAddress, account),
    queryKeys.accountSummary(chainId, poolAddress, account),
    queryKeys.liquidationPrices(chainId, poolAddress, account),
    queryKeys.netLiquidationValue(chainId, poolAddress, account),
  ],

  withdraw: (chainId: bigint, poolAddress: Address, account: Address) => [
    queryKeys.collateral(chainId, poolAddress, account),
    queryKeys.userShares(chainId, poolAddress, account),
    queryKeys.accountSummary(chainId, poolAddress, account),
    queryKeys.liquidationPrices(chainId, poolAddress, account),
    queryKeys.netLiquidationValue(chainId, poolAddress, account),
  ],

  // Approval
  approve: (chainId: bigint, token: Address, owner: Address, spender: Address) => [
    queryKeys.allowance(chainId, token, owner, spender),
  ],

  // Settlement
  settle: (chainId: bigint, poolAddress: Address, account: Address) => [
    queryKeys.collateral(chainId, poolAddress, account),
    queryKeys.positions(chainId, poolAddress, account),
    queryKeys.accountSummary(chainId, poolAddress, account),
  ],

  // Third-party actions (forceExercise, liquidate)
  forceExercise: (chainId: bigint, poolAddress: Address, account: Address) => [
    queryKeys.positions(chainId, poolAddress, account),
    queryKeys.collateral(chainId, poolAddress, account),
    queryKeys.accountSummary(chainId, poolAddress, account),
    queryKeys.pool(chainId, poolAddress),
    queryKeys.utilization(chainId, poolAddress),
    queryKeys.chunkSpreads(chainId, poolAddress),
  ],

  liquidate: (chainId: bigint, poolAddress: Address, account: Address) => [
    queryKeys.positions(chainId, poolAddress, account),
    queryKeys.collateral(chainId, poolAddress, account),
    queryKeys.accountSummary(chainId, poolAddress, account),
    queryKeys.pool(chainId, poolAddress),
    queryKeys.utilization(chainId, poolAddress),
    queryKeys.chunkSpreads(chainId, poolAddress),
  ],
}
```

### Usage Example (TanStack Query)

```typescript
// In user's codebase (copy from docs)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAccountSummaryBasic,
  openPosition,
  queryKeys,
  mutationEffects,
} from 'panoptic-v2-sdk'

// Dashboard hook
function usePanopticDashboard(chainId: bigint, poolAddress: Address, account: Address) {
  return useQuery({
    queryKey: queryKeys.accountSummary(chainId, poolAddress, account),
    queryFn: () => getAccountSummaryBasic({ client, poolAddress, account, chainId, tokenIds }),
  })
}

// Open position mutation with auto-invalidation
function useOpenPosition(chainId: bigint, poolAddress: Address, account: Address) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params) => openPosition(writeConfig, params),
    onSuccess: () => {
      // Invalidate all affected queries
      mutationEffects.openPosition(chainId, poolAddress, account).forEach(key => {
        queryClient.invalidateQueries({ queryKey: key })
      })
    },
  })
}
```

**React hooks**: The SDK also ships a full `react/` module with pre-built TanStack Query hooks (e.g., `usePool`, `usePosition`, `useAccountCollateral`, `useOpenPosition`, etc.) for rapid UI development. See the React Integration section for details.

---

## Error Parsing

Viem wraps errors in multiple layers (`ContractFunctionExecutionError` → `cause` → `cause`). UI developers shouldn't have to recursively unwrap to find your typed error.

### parsePanopticError

```typescript
interface UIError {
  code: string                    // Machine-readable (e.g., "INSOLVENT", "SAFE_MODE")
  title: string                   // Short heading (e.g., "Not Enough Collateral")
  message: string                 // Detailed message with values
  raw?: PanopticError             // Original typed error if available
}

// Accepts ANY error, returns clean UI-ready object
const uiError = parsePanopticError(error)

// Examples:
// AccountInsolventError → { code: "INSOLVENT", title: "Not Enough Collateral", message: "You need 0.5 ETH more" }
// SafeModeError(2n) → { code: "SAFE_MODE", title: "Pool Restricted", message: "Only covered positions allowed" }
// Unknown → { code: "UNKNOWN", title: "Transaction Failed", message: "..." }
```

### How It Works

```typescript
export function parsePanopticError(error: unknown): UIError {
  // 1. Unwrap Viem layers (ContractFunctionExecutionError.cause.cause...)
  const rootCause = unwrapViemError(error)

  // 2. Match known SDK errors
  if (rootCause instanceof AccountInsolventError) {
    return {
      code: 'INSOLVENT',
      title: 'Not Enough Collateral',
      message: `You need ${formatTokenAmount(rootCause.shortfall0, decimals0)} more ${symbol0}`,
      raw: rootCause,
    }
  }

  if (rootCause instanceof SafeModeError) {
    const messages = {
      1: 'Minor price deviation detected',
      2: 'Only covered positions allowed',
      3: 'Trading paused - oracle deviation too high',
    }
    return {
      code: 'SAFE_MODE',
      title: 'Pool Restricted',
      message: messages[rootCause.mode] ?? 'Pool is in safe mode',
      raw: rootCause,
    }
  }

  // 3. Handle raw Solidity revert strings (e.g., "PL" = Position Limit)
  if (isRevertString(rootCause, 'PL')) {
    return { code: 'POSITION_LIMIT', title: 'Position Limit Reached', message: 'Maximum 32 positions per account' }
  }

  // 4. Fallback
  return {
    code: 'UNKNOWN',
    title: 'Transaction Failed',
    message: rootCause?.message ?? 'An unknown error occurred',
  }
}
```

**Note**: `parsePanopticError` is for UI display. Bots should catch typed errors directly for programmatic handling.

---

## Formatters

BigInt values need formatting for display. The SDK provides two levels of formatters:

1. **Core formatters**: Pure functions that always require explicit parameters (decimals, precision)
2. **Pool-bound formatters**: A convenience factory that captures pool context for less verbose call sites

### Core Formatters (Pure Functions)

These are stateless pure functions. Always available, easy to test, no hidden dependencies.

```typescript
// ─────────────────────────────────────────────────────────────
// Tick ↔ Price conversion
// ─────────────────────────────────────────────────────────────

// Tick to human-readable price (adjusts for token decimals)
tickToPrice(tick: bigint, decimals0: bigint, decimals1: bigint, precision: bigint): string
// Example: tickToPrice(200000n, 18n, 6n, 4n) → "485165195409790.2770"

// Tick to price without decimal adjustment (raw 1.0001^tick)
tickToPriceDecimalScaled(tick: bigint, precision: bigint): string
// Example: tickToPriceDecimalScaled(200000n, 4n) → "485165195.4098"

// Price to tick (inverse of tickToPriceDecimalScaled)
priceToTick(price: string, decimals0: bigint, decimals1: bigint): bigint
// Example: priceToTick("1234.56", 18n, 6n) → 200000n

// ─────────────────────────────────────────────────────────────
// Token amounts
// ─────────────────────────────────────────────────────────────

// Format raw amount to human-readable string - PRECISION REQUIRED
formatTokenAmount(amount: bigint, decimals: bigint, precision: bigint): string
// Example: formatTokenAmount(1500000000000000000n, 18n, 4n) → "1.5000"
// Example: formatTokenAmount(1500000000000000000n, 18n, 2n) → "1.50"

// Parse human-readable string to raw amount
parseTokenAmount(amount: string, decimals: bigint): bigint
// Example: parseTokenAmount("1.5", 18n) → 1500000000000000000n

// ─────────────────────────────────────────────────────────────
// Percentage/ratio formatters - PRECISION REQUIRED
// ─────────────────────────────────────────────────────────────

// Basis points (100 = 1%)
formatBps(bps: bigint, precision: bigint): string
// Example: formatBps(50n, 2n) → "0.50%"
// Example: formatBps(50n, 1n) → "0.5%"

// Utilization (stored as 0n-10000n, where 10000n = 100%)
formatUtilization(util: bigint, precision: bigint): string
// Example: formatUtilization(7500n, 2n) → "75.00%"
// Example: formatUtilization(7500n, 0n) → "75%"

// WAD-scaled values (1e18 = 1.0)
formatWad(wad: bigint, precision: bigint): string
// Example: formatWad(1220000000000000000n, 2n) → "1.22"
// Example: formatWad(1220000000000000000n, 4n) → "1.2200"

// All formatters require explicit precision to prevent inconsistent UI formatting
```

### Pool-Bound Formatters (Convenience Factory)

For UI code where you're working with a single pool and don't want to pass decimals on every call:

```typescript
interface PoolFormatters {
  // Tick/price (uses pool's token decimals)
  tickToPrice(tick: bigint): string
  priceToTick(price: string): bigint

  // Token amounts (uses respective token's decimals)
  formatAmount0(amount: bigint, precision: bigint): string
  formatAmount1(amount: bigint, precision: bigint): string
  parseAmount0(amount: string): bigint
  parseAmount1(amount: string): bigint
}

// Factory - captures pool context once
createPoolFormatters(pool: Pick<Pool, 'token0' | 'token1'>): PoolFormatters
```

**Usage:**

```typescript
const pool = await getPool(config, poolAddress)
const fmt = createPoolFormatters(pool)

// No decimals needed at call sites
const priceStr = fmt.tickToPrice(position.currentTick)
const amount0Str = fmt.formatAmount0(collateral.assets, 4n)
const amount1Str = fmt.formatAmount1(premia.token1, 2n)
```

**When to use which:**

| Use Case | Recommended |
|----------|-------------|
| Unit tests | Core formatters (explicit, predictable) |
| Multi-pool views | Core formatters (different decimals per pool) |
| Single-pool UI components | Pool-bound formatters (less verbose) |
| Library/utility code | Core formatters (no hidden state) |

### Why Export These

1. **Tick math is non-trivial**: `price = 1.0001^tick * 10^(decimals0-decimals1)`
2. **Consistency**: All UIs display values the same way
3. **No dependencies**: Pure functions, no BigNumber libraries required
4. **Flexibility**: Core formatters for full control, pool-bound for convenience

### Token Metadata Integration

UIs need logos, full names, and CoinGecko IDs. The SDK does NOT bundle token lists - instead, it exports a helper to generate standard token identifiers for use with external token list providers:

```typescript
// Generate standard token ID for external token lists
getTokenListId(chainId: bigint, address: Address): string
// Example: getTokenListId(1, '0xC02a...') → 'ethereum:0xc02a...' (checksummed)

// TokenInfo includes the standard fields for compatibility
interface TokenInfo {
  address: Address
  symbol: string
  decimals: bigint
  // Note: No logo, name, or coingeckoId - use external token lists
}
```

**Usage with external token lists:**
```typescript
import { getTokenListId } from 'panoptic-v2-sdk'
import { tokenList } from '@uniswap/default-token-list'  // or any token list

const pool = await getPool(config)
const tokenId = getTokenListId(config.chainId, pool.token0.address)
const metadata = tokenList.tokens.find(t => getTokenListId(t.chainId, t.address) === tokenId)
// metadata.logoURI, metadata.name, etc.
```

**Why not bundle token lists**: Token lists are large, frequently updated, and chain-specific. Bundling them would bloat the SDK and create staleness issues.

---

## Transaction Lifecycle

UIs need the transaction hash immediately (for "View on Etherscan" toast) while still waiting for confirmation.

### Split Flow Pattern

All write functions return a `{ hash, wait }` tuple:

```typescript
// Open position - get hash immediately
const result = await openPosition({
  client,
  walletClient,
  account,
  poolAddress,
  existingPositionIds: [],
  tokenId,
  positionSize: 1000000000000000000n,
  tickAndSpreadLimits: [-887272n, 887272n, 0n],
})

// 1. Show toast immediately with hash
showToast('Transaction Submitted', { hash: result.hash, explorerUrl: `https://etherscan.io/tx/${result.hash}` })

// 2. Wait for confirmation in background
const receipt = await result.wait()

// 3. Update UI with confirmed state
invalidateQueries()
showToast('Position Opened', { receipt })
```

### TxResult Interface

```typescript
interface TxResult {
  hash: Hash                     // Transaction hash (available immediately)
  wait: (confirmations?: bigint) => Promise<TxReceipt>  // Wait for confirmation
}

interface TxResultWithReceipt extends TxResult {
  receipt: TxReceipt             // Pre-resolved receipt (for *AndWait variants)
}

interface TxReceipt {
  hash: Hash
  blockNumber: bigint
  blockHash: Hash
  gasUsed: bigint
  status: 'success' | 'reverted'
  events: PanopticEvent[]        // Decoded events from the transaction
}
```

### Convenience: *AndWait Variants

For scripts/bots that don't need the split flow:

```typescript
// Blocks until confirmed - returns full receipt directly
const receipt = await openPositionAndWait({
  client,
  walletClient,
  account,
  poolAddress,
  existingPositionIds: [],
  tokenId,
  positionSize: 1000000000000000000n,
  tickAndSpreadLimits: [-887272n, 887272n, 0n],
})
```

**Note**: `*AndWait` is just sugar for `const { wait } = await openPosition(...); return wait()`.

---

## Bot Execution Extras

Production bots need additional controls beyond basic write functions.

### Private Transactions

For MEV protection, the SDK supports pluggable private transaction broadcasters:

```typescript
interface TxBroadcaster {
  broadcast: (signedTx: `0x${string}`) => Promise<Hash>  // Returns txHash
}

// Built-in: public mempool (default)
import { publicBroadcaster } from 'panoptic-v2-sdk'

// Example: Flashbots broadcaster (user implements)
const flashbotsBroadcaster: TxBroadcaster = {
  name: 'flashbots',
  async sendTransaction(tx) {
    return await flashbotsProvider.sendPrivateTransaction(tx)
  },
}

// Use in write config
const writeConfig: WriteConfig = {
  ...readConfig,
  walletClient,
  broadcaster: flashbotsBroadcaster,  // Optional, defaults to publicBroadcaster
}

// Or per-call override (broadcaster support is implementation-specific)
const result = await openPosition({
  client,
  walletClient,
  account,
  poolAddress,
  existingPositionIds: [],
  tokenId,
  positionSize: size,
  tickAndSpreadLimits: [-887272n, 887272n, 0n],
})
```

**Note**: The SDK ships `publicBroadcaster` only. Private broadcasters (Flashbots, MEV Blocker, etc.) are user-provided.

### Nonce Management

Rapid-fire transactions (e.g., bot opening multiple positions) can cause nonce collisions. The SDK provides an optional nonce manager:

```typescript
import { createNonceManager } from 'panoptic-v2-sdk'

// Create nonce manager for an account
const nonceManager = createNonceManager({
  publicClient: config.publicClient,
  account: walletClient.account.address,
})

// Use in write config
const writeConfig: WriteConfig = {
  ...readConfig,
  walletClient,
  nonceManager,  // Optional
}

// Now concurrent writes are safe
await Promise.all([
  openPosition(writeConfig, { tokenId: id1, ... }),
  openPosition(writeConfig, { tokenId: id2, ... }),
  closePosition(writeConfig, { tokenId: id3, ... }),
])
// NonceManager increments locally, no RPC race
```

**How it works:**
1. First call fetches nonce from RPC
2. Subsequent calls increment locally (no RPC)
3. Nonces are reserved sequentially - no gaps allowed
4. **Fill-or-kill semantics**: If a transaction fails, subsequent transactions with higher nonces are stuck until the failed nonce is manually handled

```typescript
interface NonceManager {
  getNextNonce: (account: Address) => Promise<bigint>  // Gets next available nonce
  reset: (account: Address) => void                     // Reset nonce tracking
}
```

**Important**: NonceManager does NOT automatically recover from transaction failures. If a transaction with nonce N fails, all subsequent transactions with nonces N+1, N+2, etc. will be stuck. After a failure, call `nonceManager.reset()` to resync with the network and clear the queue.

**Use cases:**
- High-frequency trading bots sending many transactions rapidly
- Applications that batch multiple operations concurrently
- NOT recommended for applications where transaction failures are common

### Kill-Switch Helpers

Bots need to halt trading when data is stale or pool is unhealthy:

```typescript
import { assertFresh, assertHealthy } from 'panoptic-v2-sdk'

// Before any trade, check freshness
const pool = await getPool(config)

// Throws StaleDataError if data too old
assertFresh(pool, 30n)  // maxAgeSeconds
// Checks: currentTimestamp - data._meta.blockTimestamp > maxAgeSeconds

// Throws UnhealthyPoolError if pool is degraded
assertHealthy(pool)
// Checks: pool.healthStatus === 'active'

// Throws if safe mode restricts trading
assertTradeable(pool, safeMode?)
// Checks pool health and safe mode restrictions
```

**Additional safe mode assertions:**
```typescript
assertCanMint(safeMode)          // Throws if minting blocked
assertCanBurn(safeMode)          // Throws if burning blocked
assertCanLiquidate(safeMode)     // Throws if liquidation blocked
assertCanForceExercise(safeMode) // Throws if force exercise blocked
```

**RPC error classification:**
```typescript
isRetryableRpcError(error)       // True for transient RPC errors
isNonceError(error)              // True for nonce-related errors
isGasError(error)                // True for gas-related errors
```

**Error types:**
```typescript
class StaleDataError extends PanopticError {}
class UnhealthyPoolError extends PanopticError {}
```

**Bot pattern:**
```typescript
async function executeStrategy(client: PublicClient, walletClient: WalletClient, poolAddress: Address) {
  const pool = await getPool({ client, poolAddress })

  try {
    assertFresh(pool, 30n)
    assertHealthy(pool)
  } catch (e) {
    if (e instanceof StaleDataError) {
      console.error('RPC node stale, skipping trade')
      return
    }
    if (e instanceof UnhealthyPoolError) {
      console.error(`Pool ${e.healthStatus}, skipping trade`)
      return
    }
    throw e
  }

  // Safe to trade
  await openPosition({ client, walletClient, poolAddress, ... })
}
```

---

## Type Exports

The SDK exports all types, functions, and constants from the main entry point. Key exports include:

```typescript
export {
  // Storage adapters
  createFileStorage,
  createMemoryStorage,
  type StorageAdapter,
  jsonSerializer,

  // SDK types
  type Pool, type PoolKey, type PoolHealthStatus,
  type Position, type TokenIdLeg, type ClosedPosition,
  type AccountCollateral, type TokenCollateral,
  type AccountSummaryBasic, type AccountSummaryRisk,
  type CollateralTracker, type RiskEngine,
  type OracleState, type SafeMode, type SafeModeState,
  type RiskParameters, type CurrentRates, type Utilization,
  type CollateralEstimate, type LiquidationPrices,
  type NetLiquidationValue, type PositionGreeks,
  type LegGreeksParams, type RealizedPnL,
  type SyncState, type SyncStatus, type SyncResult,
  type TxResult, type TxResultWithReceipt, type TxReceipt,
  type BlockMeta,

  // Chunk types
  type ChunkSpread, type ChunkKey,
  STANDARD_TICK_WIDTHS,

  // Simulation types
  type SimulationResult, type TokenFlow,
  type OpenPositionSimulation, type ClosePositionSimulation,
  type ForceExerciseSimulation, type LiquidateSimulation,
  type SettleSimulation, type DepositSimulation,
  type WithdrawSimulation, type DispatchSimulation,

  // Event types
  type PanopticEvent, type PanopticEventType,
  type LegUpdate, type EventSubscription, type SyncEvent,
  createEventSubscription,
  createEventPoller,

  // Error types
  PanopticError,
  AccountInsolventError, SafeModeError, InvalidTickError,
  SyncTimeoutError, ProviderLagError, NetworkMismatchError,
  StaleDataError, UnhealthyPoolError, ChunkLimitError,
  // ... all contract and SDK-specific errors

  // TokenId builder
  createTokenIdBuilder, createTokenIdBuilderV4, createBuilderFromPoolId,
  decodeTokenId, countLegs,
  type TokenIdBuilder,

  // Greeks
  getLegValue, getLegDelta, getLegGamma,
  calculatePositionGreeks, isDefinedRisk, isCall,
  getAccountGreeks, getDeltaHedgeParams,

  // Bot utilities
  assertFresh, assertHealthy, assertTradeable,
  assertCanMint, assertCanBurn, assertCanLiquidate, assertCanForceExercise,
  isRetryableRpcError, isNonceError, isGasError,
  type TxBroadcaster, type NonceManager,
  publicBroadcaster, createNonceManager,

  // Standalone utilities
  priceToTick, tickToPrice, tickToPriceDecimalScaled,
  WAD,

  // Formatters
  formatTokenAmount, parseTokenAmount,
  formatBps, formatUtilization, formatWad,
  createPoolFormatters, type PoolFormatters,
  getTokenListId,

  // Error parsing
  parsePanopticError,

  // React integration
  queryKeys, mutationEffects,
  // Plus full React hooks module (react/)

  // Raw dispatch
  dispatch, type DispatchCall,
}

// Note: viem types and transports NOT re-exported
// Users import from viem directly
```

---

## API Summary

### Read Functions

```typescript
// Pool
getPool({ client, poolAddress, chainId }): Promise<Pool>
getPoolMetadata({ client, poolAddress }): Promise<PoolMetadata>
getUtilization({ client, poolAddress }): Promise<Utilization>

// Position Tracking (local cache)
syncPositions({ client, chainId, poolAddress, account, storage }): Promise<SyncResult>
getSyncStatus({ storage, chainId, poolAddress, account }): Promise<SyncStatus>
getTrackedPositionIds({ storage, chainId, poolAddress, account }): Promise<bigint[]>
getClosedPositions({ storage, chainId, poolAddress, account }): Promise<ClosedPosition[]>
getTradeHistory({ storage, chainId, poolAddress, account }): Promise<ClosedPosition[]>
getRealizedPnL({ storage, chainId, poolAddress, account }): Promise<RealizedPnL>
getAccountHistory({ client, poolAddress, account }): Promise<AccountHistory>

// Positions (RPC queries)
getPosition({ client, poolAddress, owner, tokenId }): Promise<Position>
getPositions({ client, poolAddress, owner, tokenIds }): Promise<{ positions: Position[], _meta: BlockMeta }>

// Chunk Spread Tracking
addTrackedChunks(config, chunks: ChunkKey[]): void
removeTrackedChunks(config, chunks: ChunkKey[]): void
getChunkSpreads(config, { tokenType? }?): Promise<ChunkSpread[]>
scanChunks(config, { tickLower, tickUpper, positionWidth }): Promise<ChunkSpread[]>

// Account
getAccountCollateral({ client, poolAddress, account }): Promise<AccountCollateral>
getAccountSummaryBasic({ client, poolAddress, account, chainId, tokenIds }): Promise<AccountSummaryBasic>
getAccountSummaryRisk({ client, poolAddress, account, chainId, tokenIds, queryAddress }): Promise<AccountSummaryRisk>
getNetLiquidationValue({ client, poolAddress, account, tokenIds, queryAddress }): Promise<NetLiquidationValue>
getMarginBuffer({ client, poolAddress, account, tokenIds, queryAddress }): Promise<MarginBuffer>

// Premia
getAccountPremia({ client, poolAddress, account, tokenIds, includePendingPremium? }): Promise<AccountPremia>
getPositionsWithPremia({ client, poolAddress, account, tokenIds, includePendingPremium? }): Promise<PositionsWithPremiaResult>

// Stress Testing
stressTest({ client, poolAddress, account, storage, priceChangeBps }): Promise<StressTestResult>
stressTestMultiple({ client, poolAddress, account, storage, priceChanges }): Promise<StressTestResult[]>

// Oracle & Safe Mode
getOracleState({ client, poolAddress }): Promise<OracleState>
getSafeMode({ client, poolAddress }): Promise<SafeModeState>

// Rates & Risk
getCurrentRates({ client, poolAddress }): Promise<CurrentRates>
getRiskParameters({ client, poolAddress }): Promise<RiskParameters>

// Collateral
estimateCollateralRequired({ client, poolAddress, account, tokenId, positionSize, queryAddress? }): Promise<CollateralEstimate>
getMaxPositionSize({ client, poolAddress, account, tokenId, queryAddress }): Promise<MaxPositionSize>

// Checks
checkApproval({ client, token, spender, amount, account }): Promise<ApprovalStatus>
isLiquidatable({ client, poolAddress, account, tokenIds, queryAddress }): Promise<LiquidationCheck>
getLiquidationPrices({ client, poolAddress, account, tokenIds, queryAddress }): Promise<LiquidationPrices>

// ERC4626 previews
previewDeposit(config, { token, assets }): Promise<bigint>
previewWithdraw(config, { token, assets }): Promise<bigint>
previewMint(config, { token, shares }): Promise<bigint>
previewRedeem(config, { token, shares }): Promise<bigint>
convertToShares(config, { token, assets }): Promise<bigint>
convertToAssets(config, { token, shares }): Promise<bigint>

// TokenId utilities
createTokenIdBuilder(poolAddress, tickSpacing, vegoid?): TokenIdBuilder
decodeTokenId(tokenId): DecodedTokenId

// Position Greeks
// Via RPC (recommended for UI)
getPositionGreeks({ client, poolAddress, owner, tokenId }): Promise<PositionGreeks & { _meta }>
getAccountGreeks({ client, chainId, poolAddress, account, storage }): Promise<AccountGreeksResult>
// Pure client-side (for bots with position data already)
getLegValue(leg, currentTick, mintTick, positionSize, poolTickSpacing, definedRisk, assetIndex?): bigint
getLegDelta(leg, currentTick, positionSize, poolTickSpacing, mintTick, definedRisk, assetIndex?): bigint
getLegGamma(leg, currentTick, positionSize, poolTickSpacing, assetIndex?): bigint
calculatePositionGreeks(input: PositionGreeksInput): PositionGreeksResult
isDefinedRisk(legs): boolean

// PanopticQuery utilities (requires queryAddress)
getPortfolioValue({ client, poolAddress, account, tokenIds, queryAddress }): Promise<PortfolioValue>
checkCollateralAcrossTicks({ client, poolAddress, account, tokenIds, queryAddress }): Promise<CollateralAcrossTicks>
optimizeTokenIdRiskPartners({ client, poolAddress, tokenId, queryAddress }): Promise<bigint>
getPoolLiquidities({ client, poolAddress, queryAddress, startTick, nTicks }): Promise<PoolLiquidities>
getDeltaHedgeParams({ client, poolAddress, chainId, tokenId, positionSize, targetDelta }): Promise<DeltaHedgeResult>

// Formatters (pure, no RPC)
// Core formatters - explicit parameters
tickToPrice(tick, decimals0, decimals1, precision): string   // Human-readable with decimals
tickToPriceDecimalScaled(tick, precision): string            // Raw, no decimal adjustment
priceToTick(price, decimals0, decimals1): bigint
formatTokenAmount(amount, decimals, precision): string       // precision REQUIRED
parseTokenAmount(amount, decimals): bigint
formatBps(bps, precision): string                            // precision REQUIRED
formatUtilization(util, precision): string                   // precision REQUIRED
formatWad(wad, precision): string                            // precision REQUIRED
// Pool-bound formatter factory
createPoolFormatters(config): PoolFormatters                 // Captures decimals for convenience

// Error parsing
parsePanopticError(error: unknown): UIError

// Token metadata integration
getTokenListId(chainId, address): string

// BigInt serialization
jsonSerializer.stringify(value): string
jsonSerializer.parse(text): any
```

### Write Functions

All write functions return `TxResult = { hash, wait }`:
- `hash`: Available immediately for UI toasts
- `wait(confirmations?)`: Returns `TxReceipt` when confirmed

```typescript
// Approvals
approve({ client, walletClient, account, token, spender, amount }): Promise<TxResult>
approvePool({ client, walletClient, account, poolAddress }): Promise<TxResult>  // Approves both tokens

// Positions (use dispatch internally)
openPosition({ client, walletClient, account, poolAddress, existingPositionIds, tokenId, positionSize, tickLimitLow, tickLimitHigh, spreadLimit?, swapAtMint? }): Promise<TxResult>
closePosition({ client, walletClient, account, poolAddress, positionIdList, tokenId, positionSize, tickLimitLow, tickLimitHigh, spreadLimit?, swapAtMint? }): Promise<TxResult>
rollPosition({ client, walletClient, account, poolAddress, positionIdList, oldTokenId, oldPositionSize, newTokenId, newPositionSize, closeTickLimitLow, closeTickLimitHigh, openTickLimitLow, openTickLimitHigh }): Promise<TxResult>
settleAccumulatedPremia({ client, walletClient, account, poolAddress, positionIdList }): Promise<TxResult>
// *AndWait variants available for all

// Force exercise & Liquidation (use dispatchFrom - no tickAndSpreadLimits)
forceExercise({ client, walletClient, account, poolAddress, user, positionIdListFrom, positionIdListTo, positionIdListToFinal }): Promise<TxResult>
liquidate({ client, walletClient, account, poolAddress, liquidatee, positionIdListFrom, positionIdListTo, positionIdListToFinal }): Promise<TxResult>

// Collateral (ERC4626 - all four variants)
deposit({ client, walletClient, account, collateralTrackerAddress, assets }): Promise<TxResult>
withdraw({ client, walletClient, account, collateralTrackerAddress, assets }): Promise<TxResult>
withdrawWithPositions({ client, walletClient, account, poolAddress, collateralTrackerAddress, assets, positionIdList, tickAndSpreadLimitsArray }): Promise<TxResult>
mint({ client, walletClient, account, collateralTrackerAddress, shares }): Promise<TxResult>
redeem({ client, walletClient, account, collateralTrackerAddress, shares }): Promise<TxResult>
// *AndWait variants available for all

// Oracle
pokeOracle({ client, walletClient, account, poolAddress }): Promise<TxResult>

// Transaction management
speedUpTransaction({ client, walletClient, account, ... }): Promise<TxResult>
cancelTransaction({ client, walletClient, account, ... }): Promise<TxResult>

// Raw (advanced)
dispatch({ client, walletClient, account, poolAddress, positionIdList, finalPositionIdList, positionSizes, tickAndSpreadLimitsArray }): Promise<TxResult>
```

### Simulation Functions (Preview for UI)

```typescript
// All return SimulationResult<TData> - success: true with data, or success: false with error
simulateOpenPosition({ client, poolAddress, account, existingPositionIds, tokenId, positionSize, tickLimitLow, tickLimitHigh, spreadLimit?, swapAtMint? }): Promise<SimulationResult<OpenPositionSimulation>>
simulateClosePosition({ client, poolAddress, account, positionIdList, tokenId, positionSize, tickLimitLow, tickLimitHigh, spreadLimit?, swapAtMint? }): Promise<SimulationResult<ClosePositionSimulation>>
simulateForceExercise({ client, poolAddress, account, user, positionIdListFrom, positionIdListTo, positionIdListToFinal }): Promise<SimulationResult<ForceExerciseSimulation>>
simulateLiquidate({ client, poolAddress, account, liquidatee, positionIdListFrom, positionIdListTo, positionIdListToFinal }): Promise<SimulationResult<LiquidateSimulation>>
simulateSettle({ client, poolAddress, account, positionIdList }): Promise<SimulationResult<SettleSimulation>>
simulateDeposit({ client, collateralTrackerAddress, account, assets }): Promise<SimulationResult<DepositSimulation>>
simulateWithdraw({ client, collateralTrackerAddress, account, assets }): Promise<SimulationResult<WithdrawSimulation>>
simulateDispatch({ client, poolAddress, account, positionIdList, finalPositionIdList, positionSizes, tickAndSpreadLimitsArray }): Promise<SimulationResult<DispatchSimulation>>
```

### Event Watching

```typescript
// Simple (UIs, short-lived)
watchEvents({ config, eventTypes?, onLogs, onError? }): () => void

// Resilient (Bots, long-running)
createEventSubscription({ config, eventTypes?, onLogs, onError?, onReconnect?, reconnect? }): EventSubscription

// eventTypes is optional - omit for all events, or specify array like ['OptionMinted', 'OptionBurnt']
```

---

## Testing

### Test Strategy

| Layer | Tool | What It Tests |
|-------|------|---------------|
| Unit | Vitest + mocks | Strategy validation, tick math, error construction |
| Fork | Anvil | Critical path: open/close position sanity |

### CI Pipeline

- Unit tests: Every commit
- Fork tests: Every commit (critical paths only)

---

## Documentation

- **Primary**: Dedicated documentation site with guides and API reference (auto-generated from TSDoc)
- **Secondary**: Comprehensive TSDoc comments on all public APIs
- **Examples**: `/examples` directory with:
  - **Market Maker Bot** - Continuous position management with Greeks monitoring and risk management
  - **Delta Hedging Bot** - Maintains delta-neutral portfolio by dynamically adjusting positions based on Greeks
  - **Analytics Dashboard** - React app demonstrating SDK integration with TanStack Query, displaying positions, Greeks, chunk spreads, and trade history
- **Deprecation**: TypeScript `@deprecated` comments only (no runtime warnings)

---

## Non-Goals (MVP)

1. **Black-Scholes pricing**: No BS model, no theta/vega (delta/gamma use LP-based model)
2. **Caching dynamic state**: Consumer handles (TanStack Query, SWR, etc.)
3. **V1 compatibility**: No migration helpers
4. **Pool deployment**: SDK doesn't deploy pools
5. **Subgraph**: Position tracking via local event sync, no external indexer
6. **Position transfers**: SDK treats positions as account-bound
7. **V4 hook support**: SDK targets Panoptic protocol only, no generic V4 hook interactions
8. **Plugin system**: SDK is monolithic
9. **Pool discovery**: poolAddress required as parameter
10. **ETH wrapping**: Native ETH handled contract-side
11. **Historical queries**: No helpers for querying at past blocks (use viem directly with archive RPC)
12. **IRM projection**: Only current rates exposed, no hypothetical scenarios

---

## Post-MVP Considerations

Features explicitly deferred for potential v0.2+:

- Pool discovery (list available pools without knowing addresses)
- Historical query helpers (query at past blocks for P&L charts)

---

## Changelog

| Decision | Resolution |
|----------|------------|
| Client architecture | **Flat functions** - no class inheritance |
| Strategy builder | **Stateless** - pass pool to each method |
| Error handling | **Throw everywhere** - no result objects |
| Auto-approve | **Dropped** - explicit approve() calls |
| Wait pattern | **Separate functions** - openPosition() vs openPositionAndWait() |
| Subgraph | **Removed** - position tracking via local event sync with persistent storage |
| TokenId utils | **Exported** - createTokenIdBuilder, decodeTokenId, countLegs, etc. |
| Position computed values | **From core contracts** - PanopticPool.getAccumulatedFeesAndPositionsData() + RiskEngine.getMargin() |
| Prepare methods | **Dropped** - use viem directly |
| Collateral estimation | **RiskEngine.getMargin()** - no separate helper contract needed |
| IRM exposure | **Just current rates** - no internals |
| Event watching | **Live only** - position sync handles historical via event scanning |
| Guardian API | **Merged into getSafeMode()** |
| Native ETH | **Contract-side** - deposit handles it |
| Roll position | **Implemented** - rollPosition() convenience wrapper + dispatch() for advanced |
| Custom strategies | **Deferred** - buildCustomStrategy() post-MVP |
| Settle premia | **Single tokenId only** |
| Liquidation sim | **Dropped** - just isLiquidatable() + liquidate() |
| Cache | **Global module cache** |
| Branded types | **Kept** - type safety |
| Utilization | **Separate call** - getUtilization() |
| Transport re-exports | **Dropped** - import from viem |
| checkCanMint | **Dropped** - asserted in openPosition() |
| Force exercise est | **Dropped** |
| Event filtering | **All events only** |
| Commission est | **Included in simulations** - commission fields in OpenPositionSimulation |
| Price utils | **Standalone exports** |
| Tick validation | **Strict throw** |
| Fork tests | **Critical paths** - open/close |
| Progress callbacks | **Dropped** |
| Asset param | **Inferred** from strategy type |
| Leg count | **In AccountCollateral** |
| Examples | **Minimal /examples** - trading bot |
| Config pattern | **Direct params** - each function receives what it needs, no global config object |
| Chain validation | **Lazy** - on first use |
| Error cause | **Included** - for debugging |
| Trackers | **In Pool response** |
| Overlap flag | **Dropped** |
| RiskEngine addr | **In Pool** |
| Raw vs computed | **Computed only** - from contracts |
| Cross-pool fetch | **Throws** |
| Event leg data | **Keep liquidityDelta** |
| Slippage defaults | **Force explicit** |
| SDK logging | **Warn once** |
| Helper contract | **PanopticQuery** - required for risk metrics, liquidation prices, collateral estimation |
| Option ratio | **Configurable** (1-127) |
| Dispatch | **Exported** for power users |
| Example focus | **Trading bot** |
| Slippage enforce | **TypeScript required** |
| Pool identifier | **PanopticPool only** |
| Wallet balance | **Protocol only** |
| Position tracking | **Persistent local cache** - user provides StorageAdapter, SDK syncs from events |
| Snapshot recovery | **From dispatch() calldata** - extract `finalPositionIdList` from last tx to bootstrap without full scan |
| getAccountCollateral | **Auto from cache** - uses tracked tokenIds internally |
| watchEvents | **Keep public** - users may want raw event streams |
| Closed position | **Return null** - positionSize = 0 treated as not found |
| getPosition cache | **Warn if not cached** - queries RPC but warns if tokenId not in cache |
| Multi-pool | **One config per pool** - storage keys include poolAddress |
| computeTokenId | **Export utility** - users can know tokenId before submitting |
| Strategy bounds | **Removed** - Strategy is just legs array |
| Oracle poke | **Check + submit** - throws OracleRateLimitedError if < 64s |
| Example | **Market maker loop** - continuous position management |
| Liquidation info | **Boolean + shortfall** - all positions closed on liquidation |
| ERC4626 variants | **All four** - deposit/withdraw/mint/redeem |
| Collateral estimate tick | **User provides** - for scenario analysis |
| Error messages | **Raw data only** - user/UI builds message |
| Gas estimation | **Use viem default** - no explicit estimate functions |
| TokenId-first API | **All operations use tokenId** - openPosition(), closePosition(), estimateCollateralRequired() take tokenId not Strategy |
| TokenId builder | **Chainable builder** - builder.addCall().addPut().build() returns bigint |
| Strategy type | **Internal only** - not exported, users work with tokenId |
| Collateral estimation | **SDK-side computation** - calculate expected utilization from position size + current pool state |
| Chunk spread tracking | **Auto from positions** - SDK tracks chunks touched by user positions, plus manual addTrackedChunks() |
| Chunk fetch strategy | **Eager batch** - all tracked chunks fetched in multicall during syncPositions() |
| Chunk discovery | **scanChunks()** - discover all non-empty chunks in a tick range with positionWidth |
| Chunk persistence | **Persisted to storage** - cached via StorageAdapter like positions |
| Chunk live updates | **Auto via watchEvents()** - affected chunks re-fetched on OptionMinted/OptionBurnt |
| Chunk update scope | **Affected only** - only re-fetch chunks touched by events, not all tracked |
| Chunk return data | **Full data** - netLiquidity, removedLiquidity, and computed spread |
| Empty chunks | **Omit from results** - chunks with zero liquidity not included in scan/get results |
| Standard tick widths | **Exported constant** - STANDARD_TICK_WIDTHS with 1H/1D/1W/1M/1Y keys |
| Liquidation prices | **PanopticQuery** - single RPC call, on-chain binary search |
| Net liquidation value | **PanopticQuery** - single RPC call, all math on-chain |
| Max position size | **PanopticQuery** - single RPC call |
| Position Greeks | **Dual mode** - PanopticQuery for UI (single RPC), pure client-side for bots with data |
| TokenId builder params | **Strike + timescale/width** - users provide strike (center tick) and either timescale (1H/1D/1W/1M/1Y) or custom width, not tickLower/tickUpper |
| Greeks assetIndex | **Config + Position** - preferredAsset in config (default 0n), stored as assetIndex on Position, used for Greeks |
| Greeks definedRisk | **Auto-detected** - isDefinedRisk() helper infers from position structure (2+ legs same tokenType with opposite isLong) |
| Greeks mintPrice | **Derived from Position** - getPositionGreeks() converts Position.tickAtMint to mintPrice automatically |
| Position account param | **Optional, defaults to self** - getPosition/getPositions account defaults to connected wallet, explicit for liquidation/forceExercise queries |
| Snapshot recovery | **Log-based** - find OptionMinted/OptionBurnt logs → txHash → decode calldata, fallback to event reconstruction |
| Collateral estimation | **SDK-side utilization** - compute post-open utilization client-side (eth_call doesn't return logs) |
| Reorg handling | **Minimum viable** - store blockHash, verify continuity, rollback 128 blocks on mismatch |
| Caching terminology | **Clarified** - "no memoization of dynamic RPC reads" + "persistent derived indices" |
| Greeks numerics | **Token units** - value/delta/gamma in numeraire token units (e.g., USDC), spread in WAD (1e18) |
| Width units | **Raw ticks** - width is tickUpper - tickLower (in ticks), formula uses width/2 |
| Gas estimation | **Surfaces errors** - eth_estimateGas simulation catches reverts before signing |
| WriteConfig | **walletClient only** - removed separate account field, use walletClient.account |
| Log query chunking | **Explicit params** - syncPositions accepts fromBlock/toBlock/maxLogsPerQuery/syncTimeout for production reliability |
| PanopticQuery | **Required for MVP** - upgradable proxy for RPC-intensive computations (liquidation prices, NLV, Greeks, collateral estimation, max size, quoteFinalPrice, pool liquidities) |
| getAccountSummaryBasic | **UI aggregate** - single multicall for dashboard data (pool state, collateral trackers, positions, Greeks, NLV, liquidation prices) |
| Simulation functions | **Preview for UI** - simulateOpenPosition, simulateClosePosition, etc. return SimulationResult<TData> with success/error discriminated union |
| SimulationResult pattern | **Typed results** - success: true with data, success: false with PanopticError. Throws only for network errors, not contract reverts |
| Multicall simulation | **Action + inspection** - simulations run dispatch() then inspection calls via eth_call to see post-trade state |
| QueryKey factory | **React integration** - queryKeys object + mutationEffects map for TanStack Query/SWR cache invalidation |
| React hooks | **Full hooks module** - react/ provides TanStack Query hooks for all read, write, and simulation functions |
| Collateral estimation | **PanopticQuery** - replaced SDK-side utilization calculation with single RPC call |
| UI polling strategy | **Two-tier** - heavy poll (30s) for getAccountSummaryBasic, light poll (5s) for getPool price |
| Historical queries | **Out of scope** - deferred to post-MVP |
| Multi-pool | **Multiple configs** - SDK stays single-pool per config, UI creates multiple |
| Error messages | **Structured only** - SDK returns typed errors with raw data, UI builds messages |
| Guest mode | **Zero-state objects** - account optional in read functions, returns safe defaults for unconnected users |
| parsePanopticError | **UI helper** - unwraps viem layers, returns { code, title, message } for display |
| Formatters | **Pure utilities** - tickToPrice, formatTokenAmount, formatBps, formatUtilization, formatWad |
| Transaction lifecycle | **Split flow** - write functions return { hash, wait } tuple for immediate UI feedback |
| BigInt serialization | **jsonSerializer export** - handles BigInt in JSON.stringify/parse for storage and React state |
| Optimistic updates | **Pending positions** - shadow positions injected immediately, resolved on sync |
| Network mismatch | **Graceful handling** - reads return data + flag, writes throw NetworkMismatchError |
| Pool staleness | **_meta field** - blockNumber, blockTimestamp, isStale for bot kill-switches |
| Pool health | **HealthStatus enum** - 'active' | 'low_liquidity' | 'paused' for standardized checks |
| Provider lag | **ProviderLagError** - thrown if sync provider behind minBlockNumber |
| Token metadata | **getTokenListId helper** - generate standard IDs for external token list lookups |
| Dynamic config | **Separate read/write configs** - readConfig stable, writeConfig changes on wallet switch |
| Trade history | **Persisted closed positions** - getTradeHistory(), getRealizedPnL() from local storage |
| SSR hydration | **superjson compatible** - jsonSerializer format works with Next.js/Remix SSR patterns |
| Execution context | **From positionData()** - Position includes blockNumberAtMint, timestampAtMint, tickAtMint for P&L tracking without extra RPC |
| Resilient subscriptions | **createEventSubscription()** - auto-reconnect with exponential backoff, gap handling for missed events |
| Block pinning | **blockTag parameter** - 'latest' | 'pending' | bigint for read consistency, atomic multicall guarantees same-block |
| RPC failure model | **Retry taxonomy** - auto-retry retryable errors, isRetryableRpcError() export, config.rpc retry settings |
| Private transactions | **TxBroadcaster interface** - pluggable broadcasters for Flashbots/MEV protection |
| Nonce management | **createNonceManager()** - local nonce tracking for concurrent writes |
| Kill-switch helpers | **assertFresh/assertHealthy/assertTradeable** - bot safety checks for stale data and unhealthy pools |
| Chunk limit | **1000 chunks hard limit** - throws ChunkLimitError, manual pruning required |
| Event polling | **createEventPoller()** - HTTP-based polling for unreliable WebSocket environments, 12s default interval |
| Sync callbacks | **onUpdate callback** - syncPositions() accepts optional callback for reactive updates |
| Multi-leg spreads | **Common spreads in MVP** - callSpread, putSpread, ironCondor, strangle, createLoan, createCredit builders added to TokenIdBuilder |
| Spread validation | **No validation** - trust user input, contract revert on invalid strikes |
| Greeks assetIndex override | **Dynamic parameter** - getPositionGreeks() accepts optional assetIndex to override Position default |
| RPC endpoint switching | **User responsibility** - create new PublicClient with new transport |
| Account switching | **User responsibility** - create new WalletClient with new account |
| Pool health thresholds | **Fixed defaults** - no configurable thresholds, use hardcoded sensible defaults |
| Formatters precision | **Always required** - no defaults, forces explicit display decisions |
| NonceManager semantics | **Fill-or-kill** - no auto-recovery, manual reset() required after failures |
| Reorg depth | **Fixed 128 blocks** - designed for high-finality chains (Ethereum, Arbitrum, Base) |
| Position static data | **Cached after first fetch** - tickAtMint, timestampAtMint never change, reduces RPC load |
| Cache scope | **Module-scoped by default** - independent cache per context (worker, iframe) for isolation |
| Cache cleanup | **Individual clear functions** - clearTrackedPositions(), clearTradeHistory(), clearTrackedChunks(), clearCheckpoint() |
| Failed positions | **Remove on failure** - no failed status tracking, clean state only |
| Tick alignment | **Throw InvalidTickError** - no automatic alignment, explicit errors prevent surprises |
| Examples | **Three examples** - Market maker (existing) + delta hedging bot + analytics dashboard |
| Router/multicall handling | **None in MVP** - assumes direct dispatch() calls only, no decoding of nested calls |
| Batch operations | **Sequential Promise.all** - no SDK-level batch optimization, users handle concurrency |
| ABI exports | **Minimal** - only for power users, most don't need ABIs |
| Pool validation | **Trust user input** - no validation of poolAddress, RPC errors guide debugging |
| Chain switching | **UI responsibility** - SDK throws NetworkMismatchError with clear data, UI handles wallet_switchEthereumChain |
| Price conversions | **No caching** - recalculate each time as pure functions, fast enough |
| Leg deduplication | **No optimization** - each Position has independent legs array |
| Swap routing | **Single pool only** - no multi-hop, users compose with Uniswap SDK if needed |
