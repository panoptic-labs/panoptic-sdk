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

### Config Immutability

- **Deep freeze**: Config objects must be fully immutable using DEEP freeze (recursive `Object.freeze`), not shallow.
- **No mutation**: After `createConfig()`, the returned object cannot be modified.

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

### Storage Adapter Behavior

- **`createLocalStorage` in Node.js**: Must throw `LocalStorageUnavailableError` with message "createLocalStorage requires browser environment. Use createFileStorage for Node.js or createMemoryStorage for testing."
- **No silent fallback**: Do NOT silently fall back to memory storage - this hides environment misconfiguration.

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
│  │ PanopticFactory │    │ PanopticHelper  │                     │
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
- `PanopticHelper` - **Note: Not yet implemented in contracts directory. This is a planned upgradable proxy contract for RPC-intensive computations.**

**Key Contract Functions for Computed Values**:
- `PanopticPool.getAccumulatedFeesAndPositionsData()` - Returns premia owed + position balances (see `contracts/PanopticPool.sol:434`)
- `PanopticPool.dispatch()` - Execute position operations (mint/burn) (see `contracts/PanopticPool.sol:577`)
- `RiskEngine.getMargin()` - Returns maintenance requirement + available balance per token (see `contracts/RiskEngine.sol:1057`)
- `CollateralTracker.deposit()` / `withdraw()` - ERC4626 vault operations (see `contracts/CollateralTracker.sol:569`, `contracts/CollateralTracker.sol:720`)
- `PanopticHelper` (upgradable proxy) - **Planned contract** for RPC-intensive computations:
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
│  │  getAccountSummary()   forceExercise()                      ││
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
2. **Same-block consistency via multicall**: All aggregate reads (`getAccountSummary()`, `getPosition()`) collect data in a single `Multicall3` call, guaranteeing all returned values reflect the same block state.
3. **Two-tier caching strategy**:
   - *Module cache* (in-memory): ABIs, contract addresses, token decimals, pool constants. Fetched once, never expires.
   - *Storage adapter* (persistent): Position tokenIds, sync checkpoints, derived indices. User-provided, survives restarts.
4. **Event-based position tracking (no subgraph)**: Positions are discovered by syncing `OptionsMinted`/`OptionsBurned` events via RPC. The storage adapter persists tokenIds for fast startup.
5. **UI-first aggregate functions**: `getAccountSummary()` batches dashboard data (positions, collateral, margin, PnL) into one RPC round-trip. Designed for React `useQuery()` patterns.
6. **Simulation for transaction previews**: `simulate*()` functions return `{ success, error?, result? }` instead of throwing, enabling "Review Transaction" modals to display errors inline.
7. **Contract abstraction**: SDK routes to the appropriate contract (PanopticPool, RiskEngine, PanopticHelper) internally. Users call `getLiquidationPrices()` without knowing which contract computes it.
8. **Viem-native types**: All numeric values are `bigint`. No `number` or `string` conversions at boundaries.

---

## Configuration

### Config Creation

```typescript
import { createConfig, createFileStorage } from 'panoptic-v2-sdk'
import { http } from 'viem'

// Create and validate config (returns frozen object)
const config = createConfig({
  chainId: 1n,
  transport: http('https://eth-mainnet.g.alchemy.com/v2/...'),
  poolAddress: '0x...', // PanopticPool address (required)
  storage: createFileStorage('./cache'), // For position tracking persistence
  builderCode: 0x1234, // Optional: builder code for fee distribution
})

// With address overrides (custom deployments, testnets)
const testConfig = createConfig({
  chainId: 31337n,
  transport: http('http://localhost:8545'),
  poolAddress: '0x...',
  storage: createMemoryStorage(), // In-memory for testing
  addresses: {
    factory: '0x...',
    sfpm: '0x...',
  },
})
```

### Config Interface

```typescript
interface PanopticConfig {
  chainId: bigint
  transport: Transport // viem Transport
  poolAddress: Address // PanopticPool contract address
  storage: StorageAdapter // For persistent position tracking
  builderCode?: bigint // Optional: fee distribution code
  preferredAsset?: 0 | 1 // Optional: which token is the "asset" for Greeks (default: 0)
  addresses?: { // Optional: override bundled addresses
    factory?: Address
    sfpm?: Address
  }

  // RPC retry policy (optional)
  rpc?: {
    maxRetries?: bigint          // Default: 3
    baseDelayMs?: bigint         // Default: 1000
    maxDelayMs?: bigint          // Default: 10000
    jitter?: boolean             // Default: true (adds randomness to prevent thundering herd)
  }
}

// For write operations, extend with walletClient
interface WriteConfig extends PanopticConfig {
  walletClient: WalletClient // viem WalletClient with account (walletClient.account is the signer)
}

// Note: Account is accessed via walletClient.account - single source of truth
```

### Dynamic Config Updates (RPC Endpoint Switching)

For environments needing to update RPC endpoints mid-session (e.g., switching from public to private RPC):

```typescript
import { updateConfig } from 'panoptic-v2-sdk'

// Original config
const config = createConfig({
  chainId: 1n,
  transport: http('https://public-rpc.example.com'),
  poolAddress: '0x...',
  storage: createFileStorage('./cache'),
})

// Update with new transport (creates new frozen config, preserves storage)
const newConfig = updateConfig(config, {
  transport: http('https://private-rpc.example.com'),
})

// newConfig:
// - New frozen object with updated transport
// - Preserves storage adapter (reconnects to same cache)
// - Preserves poolAddress, chainId, other settings
// - Old config references remain valid but stale
```

**Pattern for React apps:**
```typescript
const [config, setConfig] = useState(() => createConfig({ ... }))

// When user switches RPC
const handleRpcSwitch = (newRpcUrl: string) => {
  setConfig(current => updateConfig(current, {
    transport: http(newRpcUrl),
  }))
}
```

**Note**: Config is immutable by design. `updateConfig()` creates a new config rather than mutating. Storage adapter automatically reconnects to same underlying cache.

**Important**: `updateConfig()` is specifically for transport/RPC changes. For account switching (different signer), see the pattern below.

### Chain Validation

Chain validation is **lazy** - throws on first function use if chainId has no bundled addresses and no override provided. No explicit validateChain() needed.

### Supported Chains

The SDK bundles addresses for chains where Panoptic v2 is deployed:

| Chain | Chain ID | Status |
|-------|----------|--------|
| Ethereum Mainnet | 1 | Supported |
| Arbitrum One | 42161 | Supported |
| Base | 8453 | Supported |
| ... | ... | ... |

For unlisted chains, provide `addresses` override.

### Network Mismatch Handling

A common UI state is "Connected wallet on wrong network." The SDK handles this gracefully instead of crashing:

```typescript
// Scenario: User wallet is on Mainnet, but UI is showing Arbitrum pool

// Read functions: Return data with networkMismatch flag (don't throw)
const summary = await getAccountSummary(config, { account })
// summary.networkMismatch = true if wallet chain ≠ config.chainId
// summary.positions = [] (safe default)
// summary.pool = full pool data (still fetched!)

// Write functions: Throw NetworkMismatchError before signing
try {
  await openPosition(writeConfig, params)
} catch (e) {
  if (e instanceof NetworkMismatchError) {
    // e.walletChainId = 1 (mainnet)
    // e.expectedChainId = 42161 (arbitrum)
    showSwitchNetworkModal(e.expectedChainId)
  }
}
```

**Why differentiate reads vs. writes:**
- **Reads**: UI should still render pool data (prices, utilization) even if user is on wrong network. Disabling write buttons is sufficient.
- **Writes**: Must throw immediately to prevent signing a transaction that will fail.

```typescript
// NetworkMismatchError
class NetworkMismatchError extends PanopticError {
  walletChainId: bigint     // What the wallet is connected to
  expectedChainId: bigint   // What the config expects
}
```

### Account Switching (Different Signer)

**Pattern: Recreate WriteConfig for each account** (no new API needed)

When a user switches accounts in their wallet, create a new WriteConfig with the new walletClient:

```typescript
import { useWalletClient } from 'wagmi'

// Read config is stable (pool-scoped, no wallet)
const readConfig = createConfig({
  chainId: 1n,
  transport: http('...'),
  poolAddress: '0x...',
  storage: createLocalStorage(),
})

// Factory helper (optional, for convenience)
function createWriteConfig(walletClient: WalletClient): WriteConfig {
  return {
    ...readConfig,
    walletClient,
  }
}

// React usage
function usePanopticConfig() {
  const { data: walletClient } = useWalletClient()

  // Write config changes when wallet/account changes
  const writeConfig = useMemo(
    () => walletClient ? createWriteConfig(walletClient) : null,
    [walletClient] // walletClient changes when user switches accounts
  )

  return { readConfig, writeConfig }
}

// Usage in components
function TradeButton() {
  const { writeConfig } = usePanopticConfig()

  if (!writeConfig) return <ConnectWalletButton />

  // writeConfig.walletClient.account is always the current account
  await openPosition(writeConfig, { ... })
}
```

**Why this works:**
- Each account switch creates new WriteConfig with new walletClient
- `walletClient.account` is always the source of truth
- Read config (and storage) stays stable across account switches
- Storage adapter persists per-account data using account address as key
- Simple and explicit - no hidden state mutations

**Important**: This pattern is for switching between accounts in the same wallet. For switching RPC endpoints, use `updateConfig()` instead.

### Dynamic Config Switching (Wallet Hot-Swap)

React apps need to handle wallet lifecycle without tearing down the SDK context:
- User loads page (Guest)
- Connects wallet (Guest → Write)
- Switches account (Write → Write) - see pattern above
- Disconnects (Write → Guest)

**Pattern: Separate read config from write config**

```typescript
// Read config is stable (pool-scoped, no wallet)
const readConfig = createConfig({
  chainId: 1n,
  transport: http('...'),
  poolAddress: '0x...',
  storage: createLocalStorage(),
})

// Write config is created per-wallet, reusing read config
function createWriteConfig(walletClient: WalletClient): WriteConfig {
  return {
    ...readConfig,
    walletClient,
  }
}

// React usage
function usePanopticConfig() {
  const { data: walletClient } = useWalletClient()

  // Read config is stable - never recreated
  const readConfig = useMemo(() => createConfig({ ... }), [poolAddress])

  // Write config changes when wallet changes - this is fine
  const writeConfig = useMemo(
    () => walletClient ? createWriteConfig(walletClient) : null,
    [walletClient]
  )

  return { readConfig, writeConfig }
}

// Components
function Dashboard() {
  const { readConfig } = usePanopticConfig()
  // Always works, even without wallet
  const summary = await getAccountSummary(readConfig, { account: connectedAccount })
}

function TradeButton() {
  const { writeConfig } = usePanopticConfig()
  if (!writeConfig) return <ConnectWalletButton />
  // writeConfig available - can trade
}
```

**Why this works:**
- `readConfig` is stable (same reference) - TanStack Query cache stays warm
- `writeConfig` changes on wallet switch - this is expected for write operations
- Guest mode handles `account: undefined` gracefully
- No need to recreate storage adapter or resync positions on wallet switch

### Block Pinning (Read Consistency)

Aggregate reads (`getAccountSummary`, `simulate*`) need same-block consistency. Without it, you get mixed-block state when RPC races between blocks.

```typescript
// All aggregate/simulation functions accept blockTag
const summary = await getAccountSummary(config, {
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
  await getAccountSummary(config, { account })
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
  queryFn: () => getAccountSummary(config, { account }),
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
  createLocalStorage,   // Browser localStorage
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
// '{"amount":{"__bigint":"1000000000000000000"}}'

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
import { getAccountSummary } from 'panoptic-v2-sdk'
import superjson from 'superjson'

export default async function Page() {
  const summary = await getAccountSummary(config, { account })
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
  const summary = await getAccountSummary(config, { account })
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

**Note**: The SDK's `jsonSerializer` uses `{__bigint: "..."}` tagging which is compatible with superjson's format. If you're already using superjson in your app, it will "just work."

### Sync Functions

```typescript
// Sync positions - recovers from last dispatch() tx, then syncs forward
const syncState = await syncPositions(config, {
  account: '0x...',
  // Optional parameters for controlling log queries:
  fromBlock?: bigint,           // Start block for event scan (default: pool deployment block)
  toBlock?: bigint,             // End block (default: 'latest')
  maxLogsPerQuery?: bigint,     // Max block range per eth_getLogs call (default: 10000)
  syncTimeout?: bigint,         // Max sync duration in ms (default: 300000 = 5 min)
  onUpdate?: (event: SyncEvent) => void,  // Optional callback for sync progress
})
// Returns: { lastSyncedBlock: bigint, lastSyncedBlockHash: string, positionCount: bigint }

// SyncEvent callback for reactive updates
interface SyncEvent {
  type: 'position-opened' | 'position-closed' | 'progress'
  tokenId?: bigint
  blockNumber: bigint
  progress?: { current: bigint, total: bigint }
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
  maxLogsPerQuery: 2000,  // Smaller chunks for restrictive RPCs
})

// For premium RPCs, increase for faster sync:
await syncPositions(config, {
  account: '0x...',
  maxLogsPerQuery: 50000,  // Larger chunks for Alchemy/Infura
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
  lastSyncedBlock: bigint
  lastSyncedBlockHash: string    // Store blockhash for continuity verification
  positionCount: bigint
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
  status: 'confirmed' | 'pending'  // Pending = submitted but not yet mined/indexed
  pendingTxHash?: `0x${string}`    // For pending positions only
}
```

**Lifecycle:**
1. `openPosition()` called → Shadow position added with `status: 'pending'`
2. `wait()` resolves → Position stays pending until `syncPositions()` runs
3. `syncPositions()` finds `OptionMinted` event → Shadow replaced with confirmed position
4. If tx reverts → Shadow position removed automatically

**UI usage:**
```typescript
const positions = await getPositions(config, { account })

// Show pending positions with visual indicator
positions.forEach(p => {
  if (p.status === 'pending') {
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
  limit?: bigint,               // Default: 100
  offset?: bigint,              // For pagination
})
// Returns: ClosedPosition[] (most recent first)

// Get P&L summary
const pnl = await getRealizedPnL(config, {
  account: Address,
  fromBlock?: bigint,           // Filter by time range
  toBlock?: bigint,
})
// Returns: { token0: bigint, token1: bigint, positionsClosed: bigint }
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
  tokenType: 0 | 1              // 0 = token0 (put), 1 = token1 (call)
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
  { tokenType: 1, tickLower: 200000, tickUpper: 200720 },
  { tokenType: 0, tickLower: 199280, tickUpper: 200000 },
])

// Remove chunks from tracking
removeTrackedChunks(config, [
  { tokenType: 1, tickLower: 200000, tickUpper: 200720 },
])

// Get all tracked chunk spreads (batch call)
const spreads = await getChunkSpreads(config)
// Returns: ChunkSpread[] (omits chunks with zero liquidity)

// Optional filter
const callSpreads = await getChunkSpreads(config, { tokenType: 1 })

// Hard limit: 1000 chunks per pool config
// Exceeding limit requires manual pruning via removeTrackedChunks()
```

### Scanning for Chunks (Volatility Surface)

Discover all non-empty chunks in a tick range via a single RPC call to `PanopticHelper.scanChunks()`:

```typescript
import { scanChunks, STANDARD_TICK_WIDTHS } from 'panoptic-v2-sdk'

// Scan a range for all chunks with liquidity (single RPC call)
const chunks = await scanChunks(config, {
  tickLower: 195000,
  tickUpper: 205000,
  positionWidth: STANDARD_TICK_WIDTHS['1D'],  // 720 ticks
})
// Returns: ChunkSpread[] for all non-empty chunks in the range

// Scans both tokenTypes (0 and 1) by default
// Chunks with zero liquidity (net=0, removed=0) are omitted
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

### Manual Cache Cleanup

For testing or handling account removal:

```typescript
import { clearCache } from 'panoptic-v2-sdk'

// Clear all cached data for an account
await clearCache(config, { account: '0x...' })
// Clears: positions, chunks, history from storage
// Does NOT clear: module cache (ABIs, addresses, token metadata)

// For full reset (testing scenarios)
await clearCache(config, { account: '0x...', clearStatic: true })
// Also clears static position data cache
```

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
interface Pool {
  // Static (cached after first fetch)
  address: Address                    // PanopticPool contract address
  sfpm: Address                       // SemiFungiblePositionManager address (immutable)
  riskEngine: RiskEngine              // RiskEngine with all parameters
  poolId: bigint                      // Uniswap Pool ID (uint64)
  poolKey: `0x${string}`              // Uniswap V4 PoolKey (or V3 pool address as bytes)

  // Underlying AMM (static)
  token0: TokenInfo
  token1: TokenInfo
  fee: bigint
  tickSpacing: bigint

  // Enforced tick range (static, anti-manipulation)
  minEnforcedTick: bigint
  maxEnforcedTick: bigint

  // Dynamic (fetched fresh on every call)
  currentTick: bigint                 // Current tick from SFPM.getCurrentTick()
  sqrtPriceX96: bigint                // Current sqrt price
  isSafeMode: boolean                 // True if tick deviation triggers safe mode

  // Collateral trackers (full state)
  collateralTracker0: CollateralTracker
  collateralTracker1: CollateralTracker

  // Oracle state (dynamic)
  oracle: OracleState

  // Pool health status
  healthStatus: PoolHealthStatus

  // Data freshness (for bots)
  _meta: {
    blockNumber: bigint              // Block this data was fetched at
    blockTimestamp: bigint           // Timestamp of that block (seconds)
    isStale: boolean                 // true if blockTimestamp < Date.now()/1000 - 60
  }
}

interface OracleState {
  // From getOracleTicks()
  currentTick: bigint                 // Current tick in Uniswap pool
  spotTick: bigint                    // Fast oracle tick (10-minute EMA)
  medianTick: bigint                  // Slow oracle tick (median of 8 stored observations)
  latestTick: bigint                  // Reconstructed absolute tick of latest observation
  twapTick: bigint                    // TWAP used for solvency checks in liquidations

  // From OraclePack (decoded EMAs)
  spotEMA: bigint                     // Spot EMA tick
  fastEMA: bigint                     // Fast EMA tick
  slowEMA: bigint                     // Slow EMA tick
  eonsEMA: bigint                     // Eons EMA tick

  // OraclePack metadata
  oracleTimestamp: bigint             // Last oracle update timestamp (seconds)
  oracleEpoch: bigint                 // Last oracle update epoch (64s intervals)
  referenceTick: bigint               // Reference tick for residual calculations

  // Raw packed value (for advanced use)
  oraclePack: bigint                  // Raw s_oraclePack value (uint256)
}

interface RiskEngine {
  // Static (cached after first fetch - these are immutable in the contract)
  address: Address                    // RiskEngine contract address
  guardian: Address                   // Guardian address that can override safe mode

  // Risk parameters (immutable constants)
  EMA_PERIODS: bigint                 // EMA period configuration
  MAX_TICKS_DELTA: bigint             // Maximum tick delta allowed
  MAX_TWAP_DELTA_DISPATCH: bigint     // Max TWAP delta for dispatch
  MAX_SPREAD: bigint                  // Maximum spread allowed
  BP_DECREASE_BUFFER: bigint          // Basis point decrease buffer
  MAX_CLAMP_DELTA: bigint             // Maximum clamp delta
  VEGOID: bigint                      // Vega scaling factor
  NOTIONAL_FEE: bigint                // Notional fee rate
  PREMIUM_FEE: bigint                 // Premium fee rate
  PROTOCOL_SPLIT: bigint              // Protocol fee split
  BUILDER_SPLIT: bigint               // Builder fee split
  SELLER_COLLATERAL_RATIO: bigint     // Seller collateral requirement
  BUYER_COLLATERAL_RATIO: bigint      // Buyer collateral requirement
  MAINT_MARGIN_RATE: bigint           // Maintenance margin rate
  FORCE_EXERCISE_COST: bigint         // Force exercise cost
  TARGET_POOL_UTIL: bigint            // Target pool utilization
  SATURATED_POOL_UTIL: bigint         // Saturated pool utilization
  CROSS_BUFFER_0: bigint              // Cross margin buffer for token0
  CROSS_BUFFER_1: bigint              // Cross margin buffer for token1
  MAX_OPEN_LEGS: bigint               // Maximum open legs per position
  CURVE_STEEPNESS: bigint             // Interest rate curve steepness
  MIN_RATE_AT_TARGET: bigint          // Minimum rate at target utilization
  MAX_RATE_AT_TARGET: bigint          // Maximum rate at target utilization
  TARGET_UTILIZATION: bigint          // Target utilization rate
  INITIAL_RATE_AT_TARGET: bigint      // Initial rate at target
  ADJUSTMENT_SPEED: bigint            // Rate adjustment speed
}

interface CollateralTracker {
  // Static (cached after first fetch)
  address: Address                    // CollateralTracker contract address
  panopticPool: Address               // Parent PanopticPool address
  riskEngine: Address                 // RiskEngine address
  poolManager: Address                // Uniswap V4 PoolManager (zero if V3)
  underlyingIsToken0: boolean         // True if underlying is token0
  underlyingToken: Address            // Address of underlying token
  token0: Address                     // Uniswap pool token0
  token1: Address                     // Uniswap pool token1
  poolFee: bigint                     // Uniswap pool fee tier
  name: string                        // ERC20 name (e.g., "Panoptic WETH/USDC 0.3% Collateral")
  symbol: string                      // ERC20 symbol (e.g., "pWETH")
  decimals: bigint                    // ERC20 decimals (matches underlying)

  // Dynamic (fetched fresh on every call)
  totalAssets: bigint                 // Total assets in vault (excludes fees, donations)
  totalSupply: bigint                 // Total shares (internal + credited)
  borrowIndex: bigint                 // Global compound interest index (WAD)
  lastInteractionTimestamp: bigint    // Last interest compounding time
  unrealizedGlobalInterest: bigint    // Accumulated undistributed interest
  rateAtTarget: bigint                // Current interest rate at target utilization

  // From getPoolData()
  depositedAssets: bigint             // Cached assets held by PanopticPool
  insideAMM: bigint                   // Assets currently in Uniswap AMM
  creditedShares: bigint              // Shares held as credit
  currentPoolUtilization: bigint      // Utilization in BPS (s_assetsInAMM * 10000 / totalAssets)
}

// Pool health status (standardized across bots and UIs)
type PoolHealthStatus =
  | 'active'                          // Normal operation
  | 'low_liquidity'                   // Uniswap pool liquidity dangerously low OR high Panoptic utilization
  | 'paused'                          // Pool is paused (if applicable)

// Health thresholds (configurable in PanopticConfig)
interface HealthThresholds {
  minUniswapLiquidityToken0?: bigint  // Min Uniswap net liquidity for token0
  minUniswapLiquidityToken1?: bigint  // Min Uniswap net liquidity for token1
  maxUtilizationBps?: bigint          // Max utilization before low_liquidity (default: 9000 = 90%)
}

// Add to PanopticConfig
interface PanopticConfig {
  // ... existing fields
  healthThresholds?: HealthThresholds  // Optional: custom health thresholds
}

// Pool is marked 'low_liquidity' if ANY of:
// 1. Uniswap net liquidity < minUniswapLiquidityToken0 (if set)
// 2. Uniswap net liquidity < minUniswapLiquidityToken1 (if set)
// 3. utilization0 > maxUtilizationBps (default 90%)
// 4. utilization1 > maxUtilizationBps (default 90%)

// Utilization is separate (dynamic state)
interface Utilization {
  utilization0: bigint               // basis points (0-10000)
  utilization1: bigint
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
const pool = await getPool(config)

// Create builder with current pool state
const builder = createTokenIdBuilder(pool)

// Build tokenId with standard timescale (e.g., 1-day expiry profile)
const tokenId = builder.longCall({
  strike: 200000,                         // Center tick
  timescale: '1D',                        // Uses STANDARD_TICK_WIDTHS['1D'] = 720
  optionRatio: 1,                         // 1-127, required
})
// Returns: bigint (the tokenId)

// Or with custom width
const tokenId2 = builder.shortPut({
  strike: 199500,
  width: 1000,                            // Custom width in ticks
  optionRatio: 1,
})

// Use tokenId in all operations
await openPosition(writeConfig, { tokenId, size: 1000n, ... })
```

### Standard Tick Widths

Predefined widths matching DTE gamma profiles:

```typescript
export const STANDARD_TICK_WIDTHS = {
  '1H': 240,
  '1D': 720,
  '1W': 2400,
  '1M': 4800,
  '1Y': 15000,
} as const

type Timescale = keyof typeof STANDARD_TICK_WIDTHS
```

**Special case: width = 0 (Loan/Credit legs)**

A leg with `width = 0` represents a pure collateral operation rather than an options position:
- `width = 0` + `isLong = 0` → **Loan**: Borrow collateral from the pool
- `width = 0` + `isLong = 1` → **Credit**: Lend collateral to the pool

These legs have no strike range and cannot be exercised. The `validateIsExercisable()` check explicitly excludes `width = 0` legs from being considered exercisable.

### Standalone Price Utilities

Price conversion is standalone (no pool context needed, just decimals):

```typescript
import { priceToTick, tickToPrice } from 'panoptic-v2-sdk'

// Convert human price to tick
const tick = priceToTick(2000.50, decimals0, decimals1)

// Convert tick to human price
const price = tickToPrice(-195300, decimals0, decimals1)
```

### TokenId Builder Interface

```typescript
interface TokenIdBuilder {
  // Pool context (from construction)
  readonly tickSpacing: bigint
  readonly minEnforcedTick: bigint
  readonly maxEnforcedTick: bigint

  // Basic strategies - returns tokenId directly
  // Must provide either `timescale` OR `width`, not both
  longCall(params: {
    strike: bigint                        // Center tick: (tickLower + tickUpper) / 2
    optionRatio: bigint                   // 1-127, required
  } & ({ timescale: Timescale } | { width: bigint })): bigint

  longPut(params: {
    strike: bigint
    optionRatio: bigint
  } & ({ timescale: Timescale } | { width: bigint })): bigint

  shortCall(params: {
    strike: bigint
    optionRatio: bigint
  } & ({ timescale: Timescale } | { width: bigint })): bigint

  shortPut(params: {
    strike: bigint
    optionRatio: bigint
  } & ({ timescale: Timescale } | { width: bigint })): bigint

  // Common multi-leg spreads (MVP)
  callSpread(params: {
    longStrike: bigint
    shortStrike: bigint
    optionRatio: bigint
  } & ({ timescale: Timescale } | { width: bigint })): bigint

  putSpread(params: {
    longStrike: bigint
    shortStrike: bigint
    optionRatio: bigint
  } & ({ timescale: Timescale } | { width: bigint })): bigint

  ironCondor(params: {
    putLongStrike: bigint
    putShortStrike: bigint
    callShortStrike: bigint
    callLongStrike: bigint
    optionRatio: bigint
  } & ({ timescale: Timescale } | { width: bigint })): bigint

  strangle(params: {
    putStrike: bigint
    callStrike: bigint
    isLong: boolean                       // true = long strangle, false = short strangle
    optionRatio: bigint
  } & ({ timescale: Timescale } | { width: bigint })): bigint

  // Panoptic-specific strategies (width = 0)
  createLoan(params: {
    tokenType: 0 | 1                      // Which token to borrow (0 = token0, 1 = token1)
    optionRatio: bigint
  }): bigint

  createCredit(params: {
    tokenType: 0 | 1                      // Which token to lend (0 = token0, 1 = token1)
    optionRatio: bigint
  }): bigint
}
```

### TokenId Low-Level Utilities

The SDK exposes low-level functions mirroring the on-chain `TokenIdLibrary` for advanced use cases. See `contracts/types/TokenId.sol` for the authoritative bit layout and encoding rules.

```typescript
// Decoding (extract fields from tokenId)
function getPoolId(tokenId: bigint): bigint
function getTickSpacing(tokenId: bigint): bigint
function getAsset(tokenId: bigint, legIndex: number): 0 | 1
function getOptionRatio(tokenId: bigint, legIndex: number): bigint
function getIsLong(tokenId: bigint, legIndex: number): 0 | 1
function getTokenType(tokenId: bigint, legIndex: number): 0 | 1
function getRiskPartner(tokenId: bigint, legIndex: number): number
function getStrike(tokenId: bigint, legIndex: number): bigint
function getWidth(tokenId: bigint, legIndex: number): bigint

// Encoding (build tokenId from parts)
function addPoolId(tokenId: bigint, poolId: bigint): bigint
function addLeg(tokenId: bigint, legIndex: number, params: {
  optionRatio: bigint, asset: 0 | 1, isLong: 0 | 1,
  tokenType: 0 | 1, riskPartner: number, strike: bigint, width: bigint
}): bigint

// Helpers
function countLegs(tokenId: bigint): number
function countLongs(tokenId: bigint): number
function asTicks(tokenId: bigint, legIndex: number, tickSpacing: bigint): { tickLower: bigint, tickUpper: bigint }
function flipToBurnToken(tokenId: bigint): bigint
function clearLeg(tokenId: bigint, legIndex: number): bigint

// Validation
function validateTokenId(tokenId: bigint): void       // Throws if invalid
function isExercisable(tokenId: bigint): boolean      // Has exercisable long leg (width > 0)
```

**Note on multi-leg builders**: These builders do NOT validate strike ordering or strategy logic. They encode the legs as specified. If strikes are illogical (e.g., long strike > short strike in call spread), the contract will revert on execution. Users should use simulateOpenPosition() to validate before submitting.

**Panoptic-specific strategies**:
- **createLoan**: Creates a `width = 0`, `isLong = 0` leg to borrow collateral from the pool
- **createCredit**: Creates a `width = 0`, `isLong = 1` leg to lend collateral to the pool

**Usage example:**
```typescript
const pool = await getPool(config)
const builder = createTokenIdBuilder(pool)

// Traditional options strategies
const callSpreadId = builder.callSpread({
  longStrike: 200000n,
  shortStrike: 201000n,
  timescale: '1W',
  optionRatio: 1n,
})

const ironCondorId = builder.ironCondor({
  putLongStrike: 198000n,
  putShortStrike: 199000n,
  callShortStrike: 201000n,
  callLongStrike: 202000n,
  timescale: '1D',
  optionRatio: 1n,
})

// Panoptic-specific strategies (width = 0)
const loanId = builder.createLoan({
  tokenType: 0,         // Borrow token0
  optionRatio: 1n,
})

const creditId = builder.createCredit({
  tokenType: 1,         // Lend token1
  optionRatio: 1n,
})

// Use tokenIds in operations
await openPosition(writeConfig, {
  tokenId: callSpreadId,
  size: 1000000000000000000n,
  slippageBps: 50n,
  spreadLimitBps: 500n,
})
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
const legs = decodeTokenId(tokenId)
// Returns: TokenIdLeg[] (up to 4 legs)

interface TokenIdLeg {
  asset: 0 | 1
  tokenType: 0 | 1
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
  pool: Address                // PanopticPool address (use getPool() for full Pool data)
  owner: Address

  // Position data
  positionSize: bigint         // Number of contracts
  legs: TokenIdLeg[]           // Up to 4 legs (decoded from tokenId)

  // Mint-time metadata (from PositionBalance via positionData())
  tickAtMint: bigint           // Current tick at mint (execution price)
  utilization0AtMint: bigint   // Pool utilization token0 at mint (bps)
  utilization1AtMint: bigint   // Pool utilization token1 at mint (bps)
  blockNumberAtMint: bigint    // Block number when position was minted
  timestampAtMint: bigint      // Block timestamp when position was minted (seconds)

  // Computed values (from PanopticPool.getAccumulatedFeesAndPositionsData)
  shortPremia0: bigint         // Short premia owed to this position (token0)
  shortPremia1: bigint         // Short premia owed to this position (token1)
  longPremia0: bigint          // Long premia owed by this position (token0)
  longPremia1: bigint          // Long premia owed by this position (token1)

  // Status
  status: 'confirmed' | 'pending'  // Pending = submitted but not yet mined/indexed
  pendingTxHash?: `0x${string}`    // For pending positions only

  // Greeks context (from config.preferredAsset, can be overridden per position)
  assetIndex: 0 | 1            // Which token is the "asset" for Greeks calculations
}
```

**Note**: `getPosition({ tokenId, account? })` returns `null` for closed positions (positionSize = 0). The `account` parameter defaults to the connected wallet (from WriteConfig). Throws if tokenId belongs to different pool than configured. Warns if tokenId is not in the account's position cache (may indicate stale cache).

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
  // Position identifiers
  tokenId: bigint
  pool: Address
  owner: Address

  // Mint-time metadata (makes position instance unique)
  tickAtMint: bigint
  blockNumberAtMint: bigint
  timestampAtMint: bigint
  utilization0AtMint: bigint
  utilization1AtMint: bigint

  // Position data at close
  positionSize: bigint         // Size when closed
  legs: TokenIdLeg[]

  // Closure information
  closedAt: {
    blockNumber: bigint
    blockTimestamp: bigint
    txHash: `0x${string}`
  }
  closureReason: 'burned' | 'forceExercised' | 'liquidated'

  // For force exercise (closureReason === 'forceExercised')
  exerciser?: Address
  exerciseFee?: { token0: bigint, token1: bigint }

  // For liquidation (closureReason === 'liquidated')
  liquidator?: Address
  liquidationBonus?: { token0: bigint, token1: bigint }

  // Final premia at close
  finalPremia?: { token0: bigint, token1: bigint }
}
```

### Closed Position Tracking

The SDK tracks closed positions by listening to `OptionBurnt`, `ForceExercised`, and `AccountLiquidated` events. All three events have the account as an indexed parameter, enabling efficient filtering:

```typescript
// Single eth_getLogs call with OR on event signatures:
// topic0 = [OptionBurnt.selector, ForceExercised.selector, AccountLiquidated.selector]
// topic1 = accountAddress (indexed in all three events)
```

### Querying Closed Positions

```typescript
// Get closed positions with optional filter
const closed = await getClosedPositions(config, {
  account,
  closureReason?: 'forceExercised' | 'liquidated' | 'burned',
  fromBlock?: bigint,
  toBlock?: bigint,
})
// Returns: ClosedPosition[]

// Get full position history (open + closed)
const history = await getPositionHistory(config, { account })
// Returns: { open: Position[], closed: ClosedPosition[] }

// Check if a specific position was force exercised or liquidated
const wasLiquidated = closed.some(p =>
  p.tokenId === tokenId &&
  p.blockNumberAtMint === position.blockNumberAtMint &&
  p.closureReason === 'liquidated'
)
```

### Storage and Retention

Closed positions are persisted via the storage adapter:

```
panoptic-v2-sdk:v{VERSION}:chain{chainId}:pool{address}:closedPositions:{account}
```

**Retention policy**: Maximum 1000 closed positions per account per pool. Oldest positions are pruned when limit is exceeded. This can be configured via `maxClosedPositions` in config.

---

## Position Greeks

Position value and sensitivities. The SDK provides two modes:
1. **Via PanopticHelper** (recommended): `getPositionGreeks()` - single RPC call, batches position data fetch + calculation
2. **Pure client-side**: `getLegValue()`, `getLegDelta()`, `getLegGamma()` - no RPC, for bots that already have position data

**Contract Implementation**:
- Greeks calculations are primarily handled by `PanopticHelper.getPositionGreeks()` (planned contract)
- Position data comes from `PanopticPool.getAccumulatedFeesAndPositionsData()` (see `contracts/PanopticPool.sol:434`)
- Greeks formulas are based on the Panoptic LP-based option model
- Value depends on current price relative to the position's strike and width (see `contracts/types/TokenId.sol` for how strike/width are encoded)

### Interfaces

```typescript
interface LegGreeksParams {
  strike: bigint                // Strike tick (center of position)
  width: bigint                 // Position width in ticks (tickUpper - tickLower)
  tokenType: 0 | 1              // 0 = token0, 1 = token1
  isLong: boolean
  optionRatio: bigint           // 1-127
  positionSize: bigint          // Contract amount
}

interface PositionGreeks {
  value: bigint                 // Position value in numeraire token units (token decimals)
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
  assetIndex: 0 | 1,            // Which token is the "asset" (numeraire)
  definedRisk: boolean,         // True for spreads/defined-risk strategies
})
// Returns: bigint (token units, using numeraire token decimals)

// Delta (dValue/dPrice)
const delta = getLegDelta({
  leg: LegGreeksParams,
  tick: bigint,
  mintTick?: bigint,            // Optional, for ITM adjustment
  assetIndex: 0 | 1,
  definedRisk: boolean,
})
// Returns: bigint (numeraire token units)

// Gamma (d²Value/dPrice²)
const gamma = getLegGamma({
  leg: LegGreeksParams,
  tick: bigint,
  assetIndex: 0 | 1,
})
// Returns: bigint (numeraire token units)
```

### Full Position Greeks (via PanopticHelper)

Calculate aggregate Greeks for positions. Single RPC call via PanopticHelper:

```typescript
// For a single position (if you already have Position object)
const greeks = await getPositionGreeks(config, {
  position: Position,           // From getPosition()
  tick: bigint,                 // Current tick to evaluate at
  assetIndex?: 0 | 1,           // Optional: override Position.assetIndex for this calculation
})
// Returns: PositionGreeks (summed across all legs)
// - value: bigint (numeraire token units)
// - delta: bigint (numeraire token units)
// - gamma: bigint (numeraire token units)
// assetIndex determines which token is used as numeraire for Greeks
// If omitted, uses Position.assetIndex (set from config.preferredAsset at position creation)

// For all positions (fetches position data + computes Greeks in one call)
const allGreeks = await getAccountGreeks(config, {
  account: Address,
  tick: bigint,
  assetIndex?: 0 | 1,           // Optional: override for all positions
})
// Returns: { positions: Map<bigint, PositionGreeks>, total: PositionGreeks }
```

**Contract routing**: The SDK hides the PanopticHelper routing. Users call `getPositionGreeks()` or `getAccountGreeks()` and the SDK routes to the helper contract automatically.

### How Greeks Are Calculated

The formulas use the Panoptic LP-based option model where value depends on price relative to the position's range.

#### Common Definitions

```
rangeFactor = tickToPrice(width / 2)   // width is in ticks (tickUpper - tickLower)
isAssetToken0 = (assetIndex == 0)
strikeP = tickToQuoteTokenPrice(isAssetToken0, strike)
returnMultiplier = isLong ? -positionSize * optionRatio : positionSize * optionRatio
isPut = (tokenType == 0 && isAssetToken0) || (tokenType == 1 && !isAssetToken0)
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
interface AccountCollateral {
  pool: Address
  account: Address

  // Deposited collateral (shares in CollateralTracker)
  shares0: bigint
  shares1: bigint

  // From RiskEngine.getMargin() - maintenance requirement (left slot)
  maintenanceRequired0: bigint
  maintenanceRequired1: bigint

  // From RiskEngine.getMargin() - available balance including settled premia (right slot)
  availableBalance0: bigint
  availableBalance1: bigint

  // Current pool utilization (from globalUtilizations return value)
  utilization0: bigint         // basis points (0-10000)
  utilization1: bigint

  // Computed health status
  isHealthy: boolean           // availableBalance >= maintenanceRequired (per token)

  // Leg tracking
  openLegCount: bigint         // Current open legs (max 25)
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

## Account Summary (UI Aggregate)

A single-call aggregate for React dashboards. Batches the most common dashboard data into one multicall:

```typescript
interface AccountSummary {
  // Full pool state (includes oracle, collateral trackers, risk engine)
  pool: Pool

  // Account collateral/margin state (from getMargin + isAccountSolvent)
  collateral: AccountCollateral

  // User's share balances in collateral trackers
  userShares0: bigint            // User's shares in collateralTracker0
  userShares1: bigint            // User's shares in collateralTracker1
  userAssets0: bigint            // User's assets (shares * price) in token0
  userAssets1: bigint            // User's assets (shares * price) in token1

  // Positions with Greeks
  positions: Array<{
    position: Position
    greeks: PositionGreeks       // Value/delta/gamma at current tick
  }>

  // Portfolio-level data
  netLiquidationValue: NetLiquidationValue
  liquidationPrices: LiquidationPrices
  totalGreeks: PositionGreeks    // Summed across all positions

  // Data freshness
  _meta: {
    blockNumber: bigint
    blockTimestamp: bigint
    blockHash: `0x${string}`
  }
}

const summary = await getAccountSummary(config, {
  account?: Address,  // Optional - supports Guest Mode
})
// Returns: AccountSummary
```

### Guest Mode (No Wallet Connected)

When `account` is undefined, read functions return **safe zero-state objects** instead of throwing. This eliminates conditional logic in React hooks:

```typescript
// Works identically for guests and connected users
const { data: summary } = useQuery({
  queryKey: queryKeys.accountSummary(pool, account),  // account may be undefined
  queryFn: () => getAccountSummary(config, { account }),
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

The SDK constructs a single multicall to PanopticHelper that batches:
1. Pool slot0 (price, tick)
2. Pool utilizations
3. CollateralTracker state (totalAssets, totalSupply, user shares)
4. Account collateral via RiskEngine
5. All position balances and premia
6. Greeks for all positions
7. Net liquidation value
8. Liquidation prices

**Why this exists**: React dashboards typically need all this data. Without `getAccountSummary()`, a dashboard would make 8+ separate RPC calls. This batches them into one.

**Note**: This is optimized for UI, not bots. Bots that only need specific data should use individual functions.

### Polling Strategy for UIs

`getAccountSummary()` is a "heavy" call (positions, Greeks, NLV, liquidation prices). For live price animations, use a two-tier polling strategy:

```typescript
// Heavy poll (30s) - full dashboard refresh
const { data: summary } = useQuery({
  queryKey: queryKeys.accountSummary(pool, account),
  queryFn: () => getAccountSummary(config, { account }),
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

## Net Liquidation Value

The net liquidation value (NLV) represents the approximate token delta if all positions were closed at a given tick. This is useful for portfolio valuation and risk analysis.

```typescript
interface NetLiquidationValue {
  value0: bigint               // NLV in terms of token0
  value1: bigint               // NLV in terms of token1
}

const nlv = await getNetLiquidationValue(config, {
  account: Address,
  atTick: bigint,              // Required: tick to evaluate at
  includePendingPremium?: boolean,  // Default: true
})
// Returns: NetLiquidationValue
```

### How NLV Is Computed

The SDK calls `PanopticHelper.getNetLiquidationValue()` which computes all the math on-chain in a single RPC call:

```
NLV = Σ(leg token amounts at atTick) + Σ(exercised amounts) + (shortPremia - longPremia)
```

**Contract routing**: The SDK hides the PanopticHelper routing. Users call `getNetLiquidationValue()` and the SDK routes to the helper contract automatically.

---

## Safe Mode

```typescript
type SafeMode = 0 | 1 | 2 | 3

// 0: Normal operation
// 1: Minor deviation - normal operation
// 2: Moderate deviation - only covered positions allowed
// 3: Severe deviation - all minting blocked

interface SafeModeState {
  level: SafeMode
  isLocked: boolean           // Guardian lock state
  guardian: Address           // Guardian address
}

// Get current safe mode (includes guardian info)
const state = await getSafeMode(config)
// { level: 0, isLocked: false, guardian: '0x...' }
```

**Pre-flight enforcement**: `openPosition()` internally checks safe mode and throws `SafeModeError` if minting is blocked.

---

## Transaction Model

### Write Functions

All write functions use `tokenId` as the position identifier. Use `*AndWait()` variants for confirmation:

```typescript
// Create tokenId first
const tokenId = builder.longCall({ tickLower: 200000, tickUpper: 200100, optionRatio: 1 })

// Open position - SDK auto-builds positionIdList from cache
const { hash } = await openPosition(writeConfig, {
  tokenId,
  size: 1000000000000000000n,
  slippageBps: 50n,        // Required (no defaults)
  spreadLimitBps: 500n,    // Required for open
})

// Wait for confirmation
const result = await openPositionAndWait(writeConfig, {
  tokenId,
  size: 1000n,
  slippageBps: 50n,
  spreadLimitBps: 500n,
  confirmations: 1, // optional, defaults to 1
})
// result: { hash, receipt, events }
```

**Note**: `openPosition()` automatically builds the `positionIdList` by fetching tracked tokenIds from cache and appending the new tokenId.

### Slippage & Spread (Required)

Both parameters are **TypeScript required** - no defaults:

```typescript
slippageBps: bigint       // Required. 0 = no slippage, 10000 = 100%
spreadLimitBps: bigint    // Required for open. Controls removedLiquidity/netLiquidity ratio
```

### Which Operations Need These Parameters

| Operation | Slippage | Spread Limit |
|-----------|----------|--------------|
| `openPosition` | Required | Required |
| `closePosition` | Required | No |
| `forceExercise` | Required | No |
| `deposit` | No | No |
| `withdraw` | No | No |

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

For `liquidate()` and `forceExercise()`, the SDK uses `isLiquidatable()` / `isForceExercisable()` checks first, but the final `eth_estimateGas` call provides an additional safety net.

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
const { hash } = await openPosition(writeConfig, {
  tokenId: bigint,            // Created via TokenIdBuilder
  size: bigint,
  slippageBps: bigint,        // Required
  spreadLimitBps: bigint,     // Required
  usePremiaAsCollateral?: boolean,
  gas?: bigint,
})

// With wait
const result = await openPositionAndWait(writeConfig, {
  ...params,
  confirmations?: bigint,
})
// { hash, receipt, events }
```

### Close Position

```typescript
const { hash } = await closePosition(writeConfig, {
  tokenId: bigint,
  slippageBps: bigint,        // Required
  gas?: bigint,
})
```

### Settle Accumulated Premia

Single tokenId only (use `dispatch()` for batch):

```typescript
const { hash } = await settleAccumulatedPremia(writeConfig, {
  tokenId: bigint,
  gas?: bigint,
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
      gas: bigint              // Estimated gas for the transaction
      data: TData              // Operation-specific result (strictly typed)
    }
  | {
      success: false
      error: PanopticError     // Typed error (e.g., AccountInsolventError)
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
  // Post-trade solvency (via RiskEngine inspection)
  postTradeCollateral: AccountCollateral

  // Cost analysis
  upfrontPremia: bigint        // Net premia paid/received immediately
  swapFees: bigint             // Fees paid to Uniswap

  // Execution warnings
  priceImpactBps: bigint       // Slippage warning for UI
}

const result = await simulateOpenPosition(config, {
  account: Address,
  tokenId: bigint,
  size: bigint,
  slippageBps: bigint,
  spreadLimitBps: bigint,
})
// Returns: SimulationResult<OpenPositionSimulation>

if (result.success) {
  console.log('Gas estimate:', result.gas)
  console.log('Post-trade health:', result.data.postTradeCollateral.isHealthy)
} else {
  console.log('Would fail:', result.error.message)
}
```

### simulateClosePosition

```typescript
interface ClosePositionSimulation {
  postTradeCollateral: AccountCollateral

  // What you receive
  settledPremia: { token0: bigint, token1: bigint }
  swapFees: bigint

  priceImpactBps: bigint
}

const result = await simulateClosePosition(config, {
  account: Address,
  tokenId: bigint,
  slippageBps: bigint,
})
// Returns: SimulationResult<ClosePositionSimulation>
```

### simulateForceExercise

```typescript
interface ForceExerciseSimulation {
  // Exerciser receives
  exerciseBonus: { token0: bigint, token1: bigint }

  // Position owner impact
  ownerLoss: { token0: bigint, token1: bigint }

  priceImpactBps: bigint
}

const result = await simulateForceExercise(config, {
  account: Address,           // The exerciser
  tokenId: bigint,
  owner: Address,             // Position owner being exercised
  slippageBps: bigint,
})
// Returns: SimulationResult<ForceExerciseSimulation>
```

### simulateLiquidate

```typescript
interface LiquidateSimulation {
  // Liquidator receives
  liquidationBonus: { token0: bigint, token1: bigint }

  // Liquidatee impact
  liquidateeLoss: { token0: bigint, token1: bigint }
  positionsLiquidated: bigint[]  // tokenIds that will be closed
}

const result = await simulateLiquidate(config, {
  account: Address,           // The liquidator
  liquidatee: Address,
  positionIds: bigint[],
  slippageBps: bigint,
})
// Returns: SimulationResult<LiquidateSimulation>
```

### simulateSettle

```typescript
interface SettleSimulation {
  settledPremia: { token0: bigint, token1: bigint }
  postSettleCollateral: AccountCollateral
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
  sharesReceived: bigint       // Shares minted
  postDepositCollateral: AccountCollateral
}

interface WithdrawSimulation {
  assetsReceived: bigint       // Underlying tokens received
  postWithdrawCollateral: AccountCollateral

  // Warning if withdrawal impacts health
  healthWarning?: string       // e.g., "Withdrawal would reduce margin buffer to 5%"
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
  postTradeCollateral: AccountCollateral
  totalPremia: { token0: bigint, token1: bigint }
  totalSwapFees: bigint
  priceImpactBps: bigint
}

const result = await simulateDispatch(config, {
  account: Address,
  calls: DispatchCall[],
  slippageBps: bigint,
})
// Returns: SimulationResult<DispatchSimulation>
```

**Note**: `simulateDispatch` uses the same multicall simulation pattern as `simulateOpenPosition` etc. - it runs the dispatch via `eth_call`, then inspection calls to capture post-trade state.

---

## Raw Dispatch (Advanced)

For power users who need batch operations, atomic rolls, or custom multi-leg flows. All position operations (`openPosition`, `closePosition`, `settleAccumulatedPremia`) are wrappers around `dispatch()`.

### DispatchCall Format

```typescript
interface DispatchCall {
  tokenId: bigint              // Position tokenId
  positionSize: bigint         // See sizing rules below
  slippageBps: bigint          // Per-call slippage tolerance
  spreadLimitBps: bigint       // Max bid-ask spread allowed
}

// The SDK encodes calls into the contract's expected format:
// PanopticPool.dispatch(TokenId[], PositionSizes[], SlippageParams, FinalPositionIdList)
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
{ tokenId: newTokenId, positionSize: 1000000000000000000n, ... }

// Add to existing position
{ tokenId, positionSize: currentSize + 500000000000000000n, ... }

// Settle premia only (pass exact current size)
{ tokenId, positionSize: currentSize, ... }

// Close entire position (any value != currentSize closes 100%)
{ tokenId, positionSize: 0n, ... }           // closes 100%
{ tokenId, positionSize: currentSize - 1n, ... }  // also closes 100%
```

### Batch Operations

`dispatch()` executes multiple calls atomically (all-or-nothing):

```typescript
import { dispatch } from 'panoptic-v2-sdk'

// Atomic roll: close old position + open new position in single tx
const { hash } = await dispatch(writeConfig, {
  calls: [
    { tokenId: oldTokenId, positionSize: 0n, slippageBps: 50n, spreadLimitBps: 500n },
    { tokenId: newTokenId, positionSize: newSize, slippageBps: 50n, spreadLimitBps: 500n },
  ],
  gas?: bigint,
})

// Batch settle premia for multiple positions (pass exact sizes)
const { hash } = await dispatch(writeConfig, {
  calls: positions.map(p => ({
    tokenId: p.tokenId,
    positionSize: p.positionSize,  // Exact size = settle only
    slippageBps: 0n,
    spreadLimitBps: 0n,
  })),
})

// Complex multi-leg strategy in single tx
const { hash } = await dispatch(writeConfig, {
  calls: [
    { tokenId: leg1TokenId, positionSize: size1, slippageBps: 50n, spreadLimitBps: 500n },
    { tokenId: leg2TokenId, positionSize: size2, slippageBps: 50n, spreadLimitBps: 500n },
    { tokenId: leg3TokenId, positionSize: size3, slippageBps: 50n, spreadLimitBps: 500n },
  ],
})
```

### FinalPositionIdList

The SDK automatically computes `finalPositionIdList` (the complete list of tokenIds the user will hold after the transaction) based on the calls and current cached positions. This is validated on-chain against `s_positionsHash`.

If the cache is stale, the transaction will revert with `IncorrectPositionList`. Call `syncPositions()` to refresh before retrying.

---

## Force Exercise

Perpetual options in Panoptic v2 can be force-exercised when they are long (eg. long put/long call). The exerciser pays a fee to close the position owner's long legs.

**Contract Implementation**: See `PanopticPool._forceExercise()` (`contracts/PanopticPool.sol:1610`)
- Emits `ForceExercised` event with exerciser, owner, tokenId, and exercise fee
- Exercise cost is calculated by the `RiskEngine.exerciseCost()` function
- Uses `RiskEngine` to determine which legs are exercisable

```typescript
// Check if exercisable
const check = await isForceExercisable(config, {
  tokenId: bigint,
  owner: Address,
})
// { exercisable: boolean, exercisableLegs: bigint[], reason?: string }

// Execute (no estimation in MVP)
const { hash } = await forceExercise(writeConfig, {
  tokenId: bigint,
  owner: Address,
  slippageBps: bigint,      // Required
  gas?: bigint,
})
```

---

## Liquidation

Accounts become liquidatable when their collateral falls below maintenance requirements. Liquidators can close the account's positions and receive a bonus.

**Contract Implementation**: See `PanopticPool._liquidate()` (`contracts/PanopticPool.sol:1494`)
- Emits `AccountLiquidated` event with liquidator, liquidatee, and bonus amounts
- Solvency is checked via `RiskEngine.isAccountSolvent()`
- Liquidation bonus is calculated by `RiskEngine.getLiquidationBonus()`
- Uses `RiskEngine.getMargin()` to determine collateral requirements (see `contracts/RiskEngine.sol:1057`)

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
  // Collateral state at current tick
  collateralBalance0: bigint
  requiredCollateral0: bigint
  collateralBalance1: bigint
  requiredCollateral1: bigint

  // Liquidation boundaries (via binary search in RiskEngine)
  liquidationTickDown: bigint | null   // null if no liquidation below current tick
  liquidationTickUp: bigint | null     // null if no liquidation above current tick
}

// Execute liquidation
const { hash } = await liquidate(writeConfig, {
  account: Address,
  positionIds: bigint[],
  slippageBps: bigint,      // Required
  gas?: bigint,
})
```

### How Liquidation Prices Are Computed

The SDK calls `PanopticHelper.getLiquidationPrices()` which performs an on-chain binary search over the tick range. This is a single RPC call - the helper contract handles all the iteration internally.

**Contract routing**: The SDK hides the PanopticHelper routing. Users call `getLiquidationPrices()` and the SDK routes to the helper contract automatically.

**Note**: `PanopticHelper` is a planned contract not yet implemented. SDK implementers should prepare for this helper contract to be deployed as an upgradable proxy.

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
const oracle = await getOracleState(config)

// Poke oracle - checks rate limit first, throws OracleRateLimitedError if < 64s since last update
const { hash } = await pokeOracle(writeConfig)
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
  rate0: bigint              // Current annualized rate for token0
  rate1: bigint              // Current annualized rate for token1
}

const rates = await getCurrentRates(config)
```

---

## Collateral Estimation

Collateral estimation simulates opening the position to get accurate utilization impact:

```typescript
interface CollateralEstimate {
  // From RiskEngine.getMargin() with computed utilization
  maintenanceRequired0: bigint   // Maintenance requirement token0
  maintenanceRequired1: bigint   // Maintenance requirement token1
  availableBalance0: bigint      // Available balance token0
  availableBalance1: bigint      // Available balance token1

  // Post-open utilization (computed SDK-side)
  estimatedUtilization0: bigint  // Estimated pool utilization after opening (bps)
  estimatedUtilization1: bigint

  // Computed
  additionalRequired0: bigint    // How much more collateral needed for token0
  additionalRequired1: bigint    // How much more collateral needed for token1
  canOpen: boolean               // True if current balance sufficient
}

const estimate = await estimateCollateralRequired(config, {
  account: Address,
  tokenId: bigint,               // The position to open
  size: bigint,
  atTick: bigint,                // Required: tick to evaluate at
})
```

### How Estimation Works

The SDK calls `PanopticHelper.estimateCollateralRequired()` which computes all the math on-chain in a single RPC call, including utilization impact simulation.

**Contract routing**: The SDK hides the PanopticHelper routing. Users call `estimateCollateralRequired()` and the SDK routes to the helper contract automatically.

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

The SDK calls `PanopticHelper.getMaxPositionSize()` which performs the calculation on-chain in a single RPC call.

---

## Risk Parameters

Full RiskEngine parameter exposure:

```typescript
interface RiskParameters {
  // Collateral requirements
  vegoid: bigint
  crossBuffer0: bigint
  crossBuffer1: bigint
  sellerCollateralRatio: bigint
  buyerCollateralRatio: bigint
  maintMarginRate: bigint
  forceExerciseCost: bigint
  // Interest rate model
  targetPoolUtil: bigint
  saturatedPoolUtil: bigint
  curveSteepness: bigint
  minRateAtTarget: bigint
  maxRateAtTarget: bigint
  targetUtilization: bigint
  adjustmentSpeed: bigint
  // Commission fees
  notionalFee: bigint            // Fee on notional (shortAmount + longAmount) at mint
  premiumFee: bigint             // Fee on realized premium at burn
  protocolSplit: bigint          // Protocol's share of commission (DECIMALS-scaled)
  builderSplit: bigint           // Builder's share of commission (DECIMALS-scaled)
  feeRecipient: bigint           // Builder address (0 = burn fees instead of split)
  // Admin
  guardian: Address
}

const params = await getRiskParameters(config)
```

---

## Commission Estimation

Commissions are charged on position mint and burn. The SDK provides estimation for UI display:

**Contract Implementation**: See `CollateralTracker.settleMint()` and `CollateralTracker.settleBurn()`

### On Mint (Opening Position)

Commission is charged on the notional amount:

```typescript
// commission = (shortAmount + longAmount) * notionalFee / DECIMALS
interface MintCommission {
  total: bigint                  // Total commission in underlying token
  protocolShare: bigint          // Amount to protocol (burned if no feeRecipient)
  builderShare: bigint           // Amount to builder (0 if no feeRecipient)
}

const commission = await estimateMintCommission(config, {
  tokenId: bigint,
  positionSize: bigint,
  tokenType: 0 | 1,              // Which collateral tracker
})
```

### On Burn (Closing Position)

Commission is charged only if there's realized premium, using the minimum of two calculations:

```typescript
// premiumBased = abs(realizedPremium) * premiumFee / DECIMALS
// notionalBased = (shortAmount + longAmount) * 10 * notionalFee / DECIMALS
// commission = min(premiumBased, notionalBased)
interface BurnCommission {
  total: bigint                  // Total commission (0 if no realized premium)
  protocolShare: bigint
  builderShare: bigint
  // Breakdown for transparency
  premiumBasedFee: bigint        // What premium-based would be
  notionalBasedFee: bigint       // What notional-based would be (10x multiplier)
  appliedMethod: 'premium' | 'notional'  // Which was lower
}

const commission = await estimateBurnCommission(config, {
  tokenId: bigint,
  account: Address,              // To fetch current position state
  tokenType: 0 | 1,
})
```

### Fee Distribution

When `feeRecipient` is 0 (no builder set), commissions are burned (shares destroyed).
When `feeRecipient` is set, commissions are split:
- `protocolSplit` → RiskEngine contract
- `builderSplit` → feeRecipient address

**Note**: Commission estimation requires simulating the position to determine `shortAmount`, `longAmount`, and `realizedPremium`. The simulation is included in `simulateOpenPosition` and `simulateClosePosition` results.

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
type PanopticEvent =
  | {
      eventName: 'OptionMinted'
      args: { tokenId: bigint; owner: Address; positionSize: bigint }
      legs: LegUpdate[]
    }
  | {
      eventName: 'OptionBurnt'
      args: { tokenId: bigint; owner: Address; premiaByLeg: bigint[] }
      legs: LegUpdate[]
    }
  | {
      eventName: 'ForceExercised'
      args: { ... }
      legs: LegUpdate[]
    }
  | {
      eventName: 'AccountLiquidated'
      args: { ... }
      legs: LegUpdate[]
    }
  | { eventName: 'PremiumSettled'; args: { ... } }
  | { eventName: 'CollateralDeposited'; args: { ... } }
  | { eventName: 'CollateralWithdrawn'; args: { ... } }
  // ... all protocol events

interface LegUpdate {
  tokenType: 0 | 1
  tickLower: bigint
  tickUpper: bigint
  liquidityDelta: bigint      // Kept for position tracking
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
    maxAttempts: 10,           // Give up after 10 failures (0 = infinite)
    initialDelayMs: 1000,      // First retry after 1s
    maxDelayMs: 30000,         // Cap at 30s between retries
    backoffMultiplier: 2,      // Exponential backoff
  },
})

// Start watching
subscription.start()

// Check state
subscription.isConnected()    // boolean
subscription.reconnectAttempts // number

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
  intervalMs: 12000,           // Default: 12s (1 block on mainnet)
  maxBlockRange: 1000,         // Max blocks to query per poll
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
  parameterType: bigint  // 0=poolId, 1=ratio, 2=tokenType, 3=riskPartner, 4=strike, 5=width, 6=duplicateChunk
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

## React Integration (QueryKey Factory)

The SDK exports standardized query keys and mutation effects for React apps using TanStack Query, SWR, or similar libraries. This prevents cache invalidation bugs where developers forget to refresh data after mutations.

**Note**: The SDK does NOT ship React hooks. This avoids peer dependency conflicts (TanStack Query v4 vs v5, etc.). Instead, we export keys and a mutation effects map - users wire their own hooks.

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
  getAccountSummary,
  openPosition,
  queryKeys,
  mutationEffects,
} from 'panoptic-v2-sdk'

// Dashboard hook
function usePanopticDashboard(chainId: bigint, poolAddress: Address, account: Address) {
  return useQuery({
    queryKey: queryKeys.accountSummary(chainId, poolAddress, account),
    queryFn: () => getAccountSummary(config, { account }),
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

**Why not ship hooks**: React ecosystem fragmentation (TanStack v4/v5, SWR, RTK Query) means any hook package would force version choices. Keys-only approach works with any library.

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
// SafeModeError(2) → { code: "SAFE_MODE", title: "Pool Restricted", message: "Only covered positions allowed" }
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

// Raw tick to price (no decimal adjustment)
// Returns price as 1.0001^tick - useful for internal calculations
tickToPrice(tick: bigint): string
// Example: tickToPrice(200000n) → "485165195.409790277..."

// Decimal-scaled tick to price (human-readable)
// Adjusts for token decimal difference: price * 10^(decimals0 - decimals1)
tickToPriceDecimalScaled(tick: bigint, decimals0: bigint, decimals1: bigint): string
// Example: tickToPriceDecimalScaled(200000n, 18n, 6n) → "485165195409790.277..."

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

// Utilization (stored as 0-10000, where 10000 = 100%)
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
const { hash, wait } = await openPosition(writeConfig, {
  tokenId,
  size: 1000000000000000000n,
  slippageBps: 50n,
  spreadLimitBps: 500n,
})

// 1. Show toast immediately with hash
showToast('Transaction Submitted', { hash, explorerUrl: `https://etherscan.io/tx/${hash}` })

// 2. Wait for confirmation in background
const receipt = await wait()

// 3. Update UI with confirmed state
invalidateQueries()
showToast('Position Opened', { receipt })
```

### TxResult Interface

```typescript
interface TxResult {
  hash: `0x${string}`            // Transaction hash (available immediately)
  wait: (confirmations?: bigint) => Promise<TxReceipt>  // Wait for confirmation
}

interface TxReceipt {
  hash: `0x${string}`
  blockNumber: bigint
  blockHash: `0x${string}`
  gasUsed: bigint
  status: 'success' | 'reverted'
  events: PanopticEvent[]        // Decoded events from the transaction
}
```

### Convenience: *AndWait Variants

For scripts/bots that don't need the split flow:

```typescript
// Blocks until confirmed - returns full receipt directly
const receipt = await openPositionAndWait(writeConfig, {
  tokenId,
  size: 1000000000000000000n,
  slippageBps: 50n,
  spreadLimitBps: 500n,
  confirmations: 1,  // Optional, defaults to 1
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
  sendTransaction(tx: SignedTransaction): Promise<`0x${string}`>  // Returns txHash
  name: string
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

// Or per-call override
const { hash } = await openPosition(writeConfig, {
  tokenId,
  size,
  slippageBps: 50n,
  spreadLimitBps: 500n,
  broadcaster: flashbotsBroadcaster,  // Override for this call only
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
  getNonce(): Promise<number>      // Gets next available nonce
  confirmNonce(nonce: bigint): void  // Mark nonce as used
  reset(): Promise<void>           // Resync from RPC (call after transaction failure)
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
assertFresh(pool, { maxStalenessSeconds: 30 })
// Checks: pool._meta.blockTimestamp < Date.now()/1000 - maxStalenessSeconds

// Throws UnhealthyPoolError if pool is degraded
assertHealthy(pool)
// Checks: pool.healthStatus === 'active'

// Combined check
assertTradeable(pool, { maxStalenessSeconds: 30 })
// Checks both freshness and health
```

**Error types:**
```typescript
class StaleDataError extends PanopticError {
  blockTimestamp: bigint
  currentTimestamp: bigint
  stalenessSeconds: bigint
}

class UnhealthyPoolError extends PanopticError {
  healthStatus: PoolHealthStatus  // 'low_liquidity' | 'paused'
}
```

**Bot pattern:**
```typescript
async function executeStrategy(config: PanopticConfig) {
  const pool = await getPool(config)

  try {
    assertTradeable(pool, { maxStalenessSeconds: 30 })
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
  await openPosition(writeConfig, { ... })
}
```

---

## Type Exports

```typescript
export {
  // Config
  createConfig,
  updateConfig,                  // Dynamic config updates
  type PanopticConfig,
  type WriteConfig,
  type HealthThresholds,         // Pool health configuration

  // Storage adapters
  createFileStorage,
  createMemoryStorage,
  createLocalStorage,
  type StorageAdapter,

  // Cache management
  clearCache,

  // ABIs (minimal exports for power users only)
  // Note: Most users don't need ABIs since SDK wraps all contract calls

  // SDK types
  type Pool,
  type Position,
  type TokenIdLeg,
  type AccountCollateral,
  type AccountSummary,
  type CollateralTracker,
  type OracleState,
  type RiskEngine,
  type SafeModeState,
  type RiskParameters,
  type CurrentRates,
  type Utilization,
  type CollateralEstimate,
  type MintCommission,
  type BurnCommission,
  type LiquidationPrices,
  type ExercisableCheck,
  type NetLiquidationValue,
  type LegGreeksParams,
  type PositionGreeks,
  type SyncState,
  type SyncStatus,
  type ClosedPosition,
  type RealizedPnL,
  type TxResult,
  type TxReceipt,

  // Chunk spread types
  type ChunkSpread,
  type ChunkKey,
  STANDARD_TICK_WIDTHS,
  type Timescale,

  // Simulation types
  type SimulationResult,
  type OpenPositionSimulation,
  type ClosePositionSimulation,
  type ForceExerciseSimulation,
  type LiquidateSimulation,
  type SettleSimulation,
  type DepositSimulation,
  type WithdrawSimulation,
  type DispatchSimulation,

  // Branded types
  type UnderlyingToken,
  type CollateralShare,
  type PositionToken,

  // Event types
  type PanopticEvent,
  type PanopticEventType,        // Union of event name strings for filtering
  type LegUpdate,
  type EventSubscription,
  createEventSubscription,
  createEventPoller,             // HTTP polling alternative
  type SyncEvent,                // Sync progress callback event

  // Error types
  type PanopticError,
  type AccountInsolventError,
  type SafeModeError,
  type InvalidTickError,
  type SyncTimeoutError,
  type ProviderLagError,
  type NetworkMismatchError,
  type StaleDataError,
  type UnhealthyPoolError,
  type ChunkLimitError,          // Chunk tracking limit exceeded
  // ... all errors

  // Pool health
  type PoolHealthStatus,

  // TokenId builder
  createTokenIdBuilder,
  decodeTokenId,
  type TokenIdBuilder,

  // Standalone utilities
  priceToTick,
  tickToPrice,
  isDefinedRisk,
  WAD,  // 10n ** 18n - for interpreting spreadWad

  // Formatters (UI display)
  tickToPriceDecimalScaled,      // Decimal-adjusted tick to price
  formatTokenAmount,
  parseTokenAmount,
  formatBps,
  formatUtilization,
  formatWad,
  getTokenListId,                // For external token list integration
  createPoolFormatters,          // Pool-bound formatter factory
  type PoolFormatters,

  // Serialization (BigInt-safe JSON)
  jsonSerializer,

  // Error parsing (UI display)
  parsePanopticError,
  type UIError,

  // React integration (query keys)
  queryKeys,
  mutationEffects,

  // Zero-state constants (Guest Mode)
  ZERO_COLLATERAL,
  ZERO_VALUATION,

  // Bot execution extras
  type TxBroadcaster,
  publicBroadcaster,
  createNonceManager,
  type NonceManager,
  assertFresh,
  assertHealthy,
  assertTradeable,
  isRetryableRpcError,

  // Raw dispatch (advanced)
  dispatch,
  type DispatchCall,
}

// Note: viem types and transports NOT re-exported
// Users import from viem directly
```

---

## API Summary

### Read Functions

```typescript
// Pool
getPool(config): Promise<Pool>
getCurrentUtilization(config): Promise<Utilization>

// Position Tracking (local cache)
syncPositions(config, { account, fromBlock?, toBlock?, maxLogsPerQuery?, syncTimeout? }): Promise<SyncState>
getSyncStatus(config, { account }): Promise<SyncStatus>
getTrackedPositionIds(config, { account }): Promise<bigint[]>
getClosedPositions(config, { account, closureReason?, fromBlock?, toBlock? }): Promise<ClosedPosition[]>
getPositionHistory(config, { account }): Promise<{ open: Position[], closed: ClosedPosition[] }>
getTradeHistory(config, { account, limit?, offset? }): Promise<ClosedPosition[]>
getRealizedPnL(config, { account, fromBlock?, toBlock? }): Promise<RealizedPnL>

// Positions (RPC queries)
getPosition(config, { tokenId, account? }): Promise<Position | null>  // account defaults to connected wallet
getPositions(config, { account? }): Promise<Position[]>  // Uses tracked tokenIds, account defaults to connected wallet

// Chunk Spread Tracking
addTrackedChunks(config, chunks: ChunkKey[]): void
removeTrackedChunks(config, chunks: ChunkKey[]): void
getChunkSpreads(config, { tokenType? }?): Promise<ChunkSpread[]>
scanChunks(config, { tickLower, tickUpper, positionWidth }): Promise<ChunkSpread[]>

// Account
getAccountCollateral(config, { account }): Promise<AccountCollateral>
getAccountSummary(config, { account }): Promise<AccountSummary>  // UI aggregate - single multicall
getNetLiquidationValue(config, { account, atTick, includePendingPremium? }): Promise<NetLiquidationValue>

// Oracle & Safe Mode
getOracleState(config): Promise<OracleState>
getSafeMode(config): Promise<SafeModeState>

// Rates & Risk
getCurrentRates(config): Promise<CurrentRates>
getRiskParameters(config): Promise<RiskParameters>

// Collateral
estimateCollateralRequired(config, { account, tokenId, size, atTick }): Promise<CollateralEstimate>
getMaxPositionSize(config, { account, tokenId, atTick }): Promise<bigint>

// Commission estimation
estimateMintCommission(config, { tokenId, positionSize, tokenType }): Promise<MintCommission>
estimateBurnCommission(config, { tokenId, account, tokenType }): Promise<BurnCommission>

// Checks
checkApproval(config, { token, spender, amount }): Promise<boolean>
isLiquidatable(config, { account }): Promise<{ liquidatable: boolean, shortfall0: bigint, shortfall1: bigint }>
getLiquidationPrices(config, { account }): Promise<LiquidationPrices>
isForceExercisable(config, { tokenId, owner }): Promise<ExercisableCheck>

// ERC4626 previews
previewDeposit(config, { token, assets }): Promise<bigint>
previewWithdraw(config, { token, assets }): Promise<bigint>
previewMint(config, { token, shares }): Promise<bigint>
previewRedeem(config, { token, shares }): Promise<bigint>
convertToShares(config, { token, assets }): Promise<bigint>
convertToAssets(config, { token, shares }): Promise<bigint>

// TokenId utilities
createTokenIdBuilder(pool): TokenIdBuilder
decodeTokenId(tokenId): TokenIdLeg[]

// Position Greeks
// Via PanopticHelper (recommended for UI)
getPositionGreeks(config, { position, tick }): Promise<PositionGreeks>
getAccountGreeks(config, { account, tick }): Promise<{ positions: Map<bigint, PositionGreeks>, total: PositionGreeks }>
// Pure client-side (for bots with position data already)
getLegValue({ leg, tick, mintTick, assetIndex, definedRisk }): bigint
getLegDelta({ leg, tick, mintTick?, assetIndex, definedRisk }): bigint
getLegGamma({ leg, tick, assetIndex }): bigint
isDefinedRisk(legs: TokenIdLeg[]): boolean

// PanopticHelper utilities
quoteFinalPrice(config, { amountIn, zeroForOne }): Promise<{ finalTick: bigint, finalPrice: bigint }>
getPoolLiquidities(config, { tickLower, tickUpper }): Promise<Map<number, bigint>>  // tick → netLiquidity

// Formatters (pure, no RPC)
// Core formatters - explicit parameters
tickToPrice(tick): string                                    // Raw, no decimal adjustment
tickToPriceDecimalScaled(tick, decimals0, decimals1): string // Human-readable with decimals
priceToTick(price, decimals0, decimals1): bigint
formatTokenAmount(amount, decimals, precision): string       // precision REQUIRED
parseTokenAmount(amount, decimals): bigint
formatBps(bps, precision): string                            // precision REQUIRED
formatUtilization(util, precision): string                   // precision REQUIRED
formatWad(wad, precision): string                            // precision REQUIRED
// Pool-bound formatter factory
createPoolFormatters(pool): PoolFormatters                   // Captures decimals for convenience

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
approve(config, { token, spender, amount }): Promise<TxResult>

// Positions (all use tokenId)
openPosition(config, { tokenId, size, slippageBps, spreadLimitBps, ... }): Promise<TxResult>
openPositionAndWait(config, { ..., confirmations? }): Promise<TxResultWithReceipt>

closePosition(config, { tokenId, slippageBps, ... }): Promise<TxResult>
closePositionAndWait(config, { ... }): Promise<TxResultWithReceipt>

settleAccumulatedPremia(config, { tokenId, ... }): Promise<TxResult>

// Force exercise
forceExercise(config, { tokenId, owner, slippageBps, ... }): Promise<TxResult>

// Liquidation
liquidate(config, { account, positionIds, slippageBps, ... }): Promise<TxResult>

// Collateral (ERC4626 - all four variants)
deposit(config, { token, assets, ... }): Promise<TxResult>
withdraw(config, { token, assets, ... }): Promise<TxResult>
mint(config, { token, shares, ... }): Promise<TxResult>
redeem(config, { token, shares, ... }): Promise<TxResult>
// *AndWait variants available for all four

// Oracle
pokeOracle(config): Promise<TxResult> // Throws OracleRateLimitedError if < 64s since last update

// Raw (advanced)
dispatch(config, { calls, slippageBps, ... }): Promise<TxResult>
```

### Simulation Functions (Preview for UI)

```typescript
// All return SimulationResult<TData> - success: true with data, or success: false with error
simulateOpenPosition(config, { account, tokenId, size, slippageBps, spreadLimitBps }): Promise<SimulationResult<OpenPositionSimulation>>
simulateClosePosition(config, { account, tokenId, slippageBps }): Promise<SimulationResult<ClosePositionSimulation>>
simulateForceExercise(config, { account, tokenId, owner, slippageBps }): Promise<SimulationResult<ForceExerciseSimulation>>
simulateLiquidate(config, { account, liquidatee, positionIds, slippageBps }): Promise<SimulationResult<LiquidateSimulation>>
simulateSettle(config, { account, tokenId }): Promise<SimulationResult<SettleSimulation>>
simulateDeposit(config, { account, token, assets }): Promise<SimulationResult<DepositSimulation>>
simulateWithdraw(config, { account, token, assets }): Promise<SimulationResult<WithdrawSimulation>>
simulateDispatch(config, { account, calls, slippageBps }): Promise<SimulationResult<DispatchSimulation>>
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
9. **Pool discovery**: poolAddress required in config
10. **ETH wrapping**: Native ETH handled contract-side
11. **Roll position**: Use dispatch() for atomic rolls
12. **Custom multi-leg strategies**: Use low-level TokenId methods (addLeg, etc.) with dispatch()
13. **React hooks**: SDK exports query keys, not hooks (avoid peer dependency conflicts)
14. **Historical queries**: No helpers for querying at past blocks (use viem directly with archive RPC)
15. **IRM projection**: Only current rates exposed, no hypothetical scenarios

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
| TokenId utils | **Hidden internally** - not exported |
| Position computed values | **From core contracts** - PanopticPool.getAccumulatedFeesAndPositionsData() + RiskEngine.getMargin() |
| Prepare methods | **Dropped** - use viem directly |
| Collateral estimation | **RiskEngine.getMargin()** - no separate helper contract needed |
| IRM exposure | **Just current rates** - no internals |
| Event watching | **Live only** - position sync handles historical via event scanning |
| Guardian API | **Merged into getSafeMode()** |
| Native ETH | **Contract-side** - deposit handles it |
| Roll position | **Dropped** - use dispatch() |
| Custom strategies | **Deferred** - buildCustomStrategy() post-MVP |
| Settle premia | **Single tokenId only** |
| Liquidation sim | **Dropped** - just isLiquidatable() + liquidate() |
| Cache | **Global module cache** |
| Branded types | **Kept** - type safety |
| Utilization | **Separate call** - getCurrentUtilization() |
| Transport re-exports | **Dropped** - import from viem |
| checkCanMint | **Dropped** - asserted in openPosition() |
| Force exercise est | **Dropped** |
| Event filtering | **All events only** |
| Commission est | **Dropped** |
| Price utils | **Standalone exports** |
| Tick validation | **Strict throw** |
| Fork tests | **Critical paths** - open/close |
| Progress callbacks | **Dropped** |
| Asset param | **Inferred** from strategy type |
| Leg count | **In AccountCollateral** |
| Examples | **Minimal /examples** - trading bot |
| Config pattern | **createConfig() helper** |
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
| Helper contract | **Not needed** - SDK composes PanopticPool + RiskEngine calls directly |
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
| TokenId builder | **Returns tokenId directly** - builder.longCall() returns bigint, not Strategy |
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
| Liquidation prices | **PanopticHelper** - single RPC call, on-chain binary search |
| Net liquidation value | **PanopticHelper** - single RPC call, all math on-chain |
| Max position size | **PanopticHelper** - single RPC call |
| Position Greeks | **Dual mode** - PanopticHelper for UI (single RPC), pure client-side for bots with data |
| TokenId builder params | **Strike + timescale/width** - users provide strike (center tick) and either timescale (1H/1D/1W/1M/1Y) or custom width, not tickLower/tickUpper |
| Greeks assetIndex | **Config + Position** - preferredAsset in config (default 0), stored as assetIndex on Position, used for Greeks |
| Greeks definedRisk | **Auto-detected** - isDefinedRisk() helper infers from position structure (2+ legs same tokenType with opposite isLong) |
| Greeks mintPrice | **Derived from Position** - getPositionGreeks() converts Position.tickAtMint to mintPrice automatically |
| Position account param | **Optional, defaults to self** - getPosition/getPositions account defaults to connected wallet, explicit for liquidation/forceExercise queries |
| Snapshot recovery | **Log-based** - find OptionMinted/OptionBurnt logs → txHash → decode calldata, fallback to event reconstruction |
| Collateral estimation | **SDK-side utilization** - compute post-open utilization client-side (eth_call doesn't return logs) |
| Reorg handling | **Minimum viable** - store blockHash, verify continuity, rollback 128 blocks on mismatch |
| Caching terminology | **Clarified** - "no memoization of dynamic RPC reads" + "persistent derived indices" |
| Greeks numerics | **Token units** - value/delta/gamma in numeraire token units, spread in WAD (1e18) |
| Width units | **Raw ticks** - width is tickUpper - tickLower (in ticks), formula uses width/2 |
| Gas estimation | **Surfaces errors** - eth_estimateGas simulation catches reverts before signing |
| WriteConfig | **walletClient only** - removed separate account field, use walletClient.account |
| Log query chunking | **Explicit params** - syncPositions accepts fromBlock/toBlock/maxLogsPerQuery/syncTimeout for production reliability |
| PanopticHelper | **Required for MVP** - upgradable proxy for RPC-intensive computations (liquidation prices, NLV, Greeks, collateral estimation, max size, quoteFinalPrice, pool liquidities) |
| getAccountSummary | **UI aggregate** - single multicall for dashboard data (pool state, collateral trackers, positions, Greeks, NLV, liquidation prices) |
| Simulation functions | **Preview for UI** - simulateOpenPosition, simulateClosePosition, etc. return SimulationResult<TData> with success/error discriminated union |
| SimulationResult pattern | **Typed results** - success: true with data, success: false with PanopticError. Throws only for network errors, not contract reverts |
| Multicall simulation | **Action + inspection** - simulations run dispatch() then inspection calls via eth_call to see post-trade state |
| QueryKey factory | **React integration** - queryKeys object + mutationEffects map for TanStack Query/SWR cache invalidation |
| No React hooks | **Keys only** - avoid peer dependency conflicts with TanStack v4/v5, SWR, RTK Query |
| Collateral estimation | **PanopticHelper** - replaced SDK-side utilization calculation with single RPC call |
| UI polling strategy | **Two-tier** - heavy poll (30s) for getAccountSummary, light poll (5s) for getPool price |
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
| RPC endpoint switching | **updateConfig() factory** - creates new frozen config preserving storage adapter for dynamic RPC switching |
| Account switching | **Recreate WriteConfig pattern** - no new API, documented pattern of creating new WriteConfig per account |
| Pool health thresholds | **Configurable** - healthThresholds in config with Uniswap liquidity + Panoptic utilization checks (default 90%) |
| Formatters precision | **Always required** - no defaults, forces explicit display decisions |
| NonceManager semantics | **Fill-or-kill** - no auto-recovery, manual reset() required after failures |
| Reorg depth | **Fixed 128 blocks** - designed for high-finality chains (Ethereum, Arbitrum, Base) |
| Position static data | **Cached after first fetch** - tickAtMint, timestampAtMint never change, reduces RPC load |
| Cache scope | **Module-scoped by default** - independent cache per context (worker, iframe) for isolation |
| Cache cleanup | **clearCache() export** - manual cleanup API for testing and account removal |
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
