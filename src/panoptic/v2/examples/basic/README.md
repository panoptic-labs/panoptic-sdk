# Basic Examples

These examples demonstrate fundamental SDK usage patterns. Each script is standalone and can be run with `tsx`.

## Prerequisites

- Node.js 18+ with `tsx` installed (`npm install -g tsx`)
- RPC endpoint (free public RPCs available)
- For write operations: a funded wallet private key

## Environment Variables

Create a `.env` file in this directory:

```bash
# Required for all examples
RPC_URL=https://eth.llamarpc.com
POOL_ADDRESS=0x... # Panoptic pool address

# Required for examples 02-04 (write operations)
PRIVATE_KEY=0x... # Your wallet private key

# Example-specific
ACCOUNT_ADDRESS=0x... # For example 01 (optional)
UNISWAP_POOL=0x... # For example 02
TOKEN_ID=123456789 # For example 03
TOKEN_INDEX=0 # For example 04 (0 or 1)

# Execution flag (prevents accidental txs)
EXECUTE=false # Set to 'true' to actually execute transactions
```

## Examples

### 01 - Simple Read Operations

Demonstrates basic read functions and data freshness verification.

```bash
tsx 01-simple-read.ts
```

**What it shows:**
- Setting up a viem PublicClient
- Fetching pool data with `getPool()`
- Fetching oracle state with `getOracleState()`
- Fetching account collateral with `getAccountCollateral()`
- Using `_meta.blockNumber` for same-block consistency verification
- Checking data freshness with `_meta.blockTimestamp`

**SDK Patterns:**
- All read functions return `_meta: BlockMeta` for data freshness
- Same-block guarantee via single multicall (when multiple reads are batched)
- Timestamps use `_meta.blockTimestamp`, NOT `Date.now()`

### 02 - Open Position

Demonstrates building a TokenId, simulating, and opening a position.

```bash
# Dry run (simulation only)
tsx 02-open-position.ts

# Execute transaction
EXECUTE=true tsx 02-open-position.ts
```

**What it shows:**
- Building TokenId with `createTokenIdBuilder()`
- Adding legs with fluent API (`.addCall()`)
- Simulating with `simulateOpenPosition()` before execution
- Opening position with `openPosition()`
- TxResult pattern: immediate hash, async `wait()` for confirmation
- Error parsing with `parsePanopticError()`

**SDK Patterns:**
- Always simulate before executing
- `SimulationResult<T>` returns `{ success: boolean, data?: T, error?: Error }`
- `TxResult` splits hash (immediate) from receipt (async wait)
- Typed error handling with PanopticError classes

### 03 - Close Position

Demonstrates fetching and closing an existing position.

```bash
# Dry run (simulation only)
tsx 03-close-position.ts

# Execute transaction
EXECUTE=true tsx 03-close-position.ts
```

**What it shows:**
- Fetching position with `getPosition()`
- Decoding TokenId with `decodeTokenId()`
- Simulating close with `simulateClosePosition()`
- Closing position with `closePosition()`
- Handling position-specific errors (PositionNotOwnedError)

**SDK Patterns:**
- Position not found throws `PositionNotOwnedError`
- TokenId decode reveals leg structure
- Close simulation shows collateral to be returned

### 04 - Vault Operations

Demonstrates ERC4626 vault deposits and withdrawals.

```bash
# Dry run (preview only)
tsx 04-vault-operations.ts

# Execute transaction
EXECUTE=true tsx 04-vault-operations.ts
```

**What it shows:**
- Previewing deposits with `previewDeposit()`
- Share/asset conversions with `convertToShares()`, `convertToAssets()`
- Depositing with `depositAndWait()` (convenience wrapper)
- ERC4626 vault semantics

**SDK Patterns:**
- Preview functions calculate expected shares/assets
- `*AndWait` variants immediately wait for confirmation
- Standard variants return TxResult for manual `wait()` control

### 05 - Position Synchronization

Demonstrates position tracking via event sync.

```bash
# Memory storage (ephemeral)
tsx 05-position-sync.ts

# File storage (persistent)
USE_FILE_STORAGE=true STORAGE_PATH=./my-data tsx 05-position-sync.ts

# Clean up after run
CLEANUP=true tsx 05-position-sync.ts
```

**What it shows:**
- Setting up storage adapters (memory vs file)
- Initial position sync with `syncPositions()`
- Incremental sync on subsequent calls
- Checking sync status with `getSyncStatus()`
- Retrieving tracked positions with `getTrackedPositionIds()`
- Progress reporting via `onUpdate` callback
- Cleaning up with `clearTrackedPositions()`

**SDK Patterns:**
- **Why sync?** Panoptic contracts don't enumerate positions on-chain; SDK tracks via events
- `syncPositions()` scans `OptionMinted`/`OptionBurnt` events
- First sync is full scan (slow), subsequent syncs are incremental (fast)
- Checkpoints enable resumable syncs across sessions
- Storage adapters: `createMemoryStorage()` (testing), `createFileStorage()` (production)
- Progress callback reports `position-opened`, `position-closed`, `progress`, `reorg-detected`

**Environment Variables:**
- `CHAIN_ID` - Chain ID (default: 1)
- `USE_FILE_STORAGE` - Set to 'true' for persistent storage
- `STORAGE_PATH` - Directory for file storage (default: ./sync-data)
- `CLEANUP` - Set to 'true' to clear positions after run

### 06 - Trade History

Demonstrates closed position tracking and PnL analysis.

```bash
# Memory storage (ephemeral)
tsx 06-trade-history.ts

# File storage (persistent)
USE_FILE_STORAGE=true STORAGE_PATH=./my-history tsx 06-trade-history.ts

# Clean up after run
CLEANUP=true tsx 06-trade-history.ts
```

**What it shows:**
- Saving closed positions with `saveClosedPosition()`
- Querying trade history with `getTradeHistory()`
- Filtering by closure reason (`closed`, `liquidated`, `force_exercised`)
- Filtering by block range (`fromBlock`, `toBlock`)
- Pagination with `limit` and `offset`
- Aggregating realized PnL with `getRealizedPnL()`
- Clearing history with `clearTradeHistory()`

**SDK Patterns:**
- **Why track history?** Panoptic contracts don't store historical position data
- `syncPositions()` automatically saves closed positions when it detects `OptionBurnt` events
- History is stored locally via StorageAdapter (memory or file)
- PnL is aggregated from individual position records

**NOTE:** Actual PnL calculation (realizedPnL0/1, premiaCollected0/1) requires the PanopticQuery contract, which is not yet finalized. The example uses placeholder values for demonstration.

**Environment Variables:**
- `CHAIN_ID` - Chain ID (default: 1)
- `USE_FILE_STORAGE` - Set to 'true' for persistent storage
- `STORAGE_PATH` - Directory for file storage (default: ./trade-history-data)
- `CLEANUP` - Set to 'true' to clear history after run

## Common Patterns

### Client Setup

```typescript
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

// Read-only client
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
})

// Write client (requires account)
const account = privateKeyToAccount(PRIVATE_KEY)
const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http(RPC_URL),
})
```

### Error Handling

```typescript
import { PanopticError, parsePanopticError } from '../../src/panoptic/v2'

try {
  await someWriteFunction(...)
} catch (error) {
  if (error instanceof PanopticError) {
    const parsed = parsePanopticError(error)
    if (parsed) {
      console.error(`Contract error: ${parsed.errorName}`)
      console.error(`From contract: ${parsed.contractName}`)
    }
  } else {
    // RPC or network error
    console.error('Unexpected error:', error)
  }
}
```

### Transaction Pattern

```typescript
// Pattern 1: Manual wait
const txResult = await openPosition(...)
console.log('Submitted:', txResult.hash)
const receipt = await txResult.wait(1n) // Wait for 1 confirmation
console.log('Confirmed:', receipt.blockNumber)

// Pattern 2: AndWait convenience
const receipt = await openPositionAndWait(...) // Immediately waits
console.log('Confirmed:', receipt.blockNumber)
```

### Data Freshness

```typescript
const pool = await getPool({ client, poolAddress })

// Check staleness
const currentTime = BigInt(Math.floor(Date.now() / 1000))
const ageSeconds = currentTime - pool._meta.blockTimestamp

if (ageSeconds > 60n) {
  console.warn('Data may be stale')
}

// Verify same-block consistency
const oracle = await getOracleState({ client, poolAddress })
if (pool._meta.blockNumber !== oracle._meta.blockNumber) {
  console.warn('Reads from different blocks')
}
```

## Safety Notes

1. **Always simulate before executing**
   - Simulations show gas, collateral requirements, and catch reverts
   - Production bots should NEVER skip simulation

2. **Use EXECUTE flag**
   - Examples default to `EXECUTE=false` to prevent accidental transactions
   - Explicitly set `EXECUTE=true` when ready

3. **Check data freshness**
   - Use `_meta.blockTimestamp` to verify data age
   - For time-sensitive operations, reject stale data

4. **Handle errors gracefully**
   - Contract errors throw typed PanopticError classes
   - Use `parsePanopticError()` for human-readable error info

5. **Mind slippage**
   - Always specify `slippageBps` explicitly (no defaults)
   - 100 bps = 1% slippage tolerance

## Next Steps

After mastering these basics:
- See `examples/oracle-poker/` for a production bot pattern
- See `examples/liquidation-bot/` for profit-seeking bot logic
- See `examples/market-maker/` for continuous position management
- See `examples/analytics-dashboard/` for React + TanStack Query integration

## Troubleshooting

### "PanopticHelperNotDeployedError"
Some functions (Greeks, collateral estimation) require PanopticHelper contract, which is not yet deployed. These are stubs for Phase 4+.

### "POOL_ADDRESS not found"
Ensure you're using a valid Panoptic v2 pool address for your network.

### "Simulation failed"
- Check account has sufficient collateral
- Verify oracle is not stale
- Check safe mode restrictions
- See error details with `parsePanopticError()`

### Type errors with imports
Examples use `@panoptic/sdk/panoptic/v2` which assumes the SDK is built. Run `pnpm build` in the SDK root first.
