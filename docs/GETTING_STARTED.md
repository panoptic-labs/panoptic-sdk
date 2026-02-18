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
import { getPool } from '@panoptic-eng/sdk'

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
import { approveAndWait, depositAndWait } from '@panoptic-eng/sdk'
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
import { fetchPoolId, createTokenIdBuilder } from '@panoptic-eng/sdk'

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
import { simulateOpenPosition, tickLimits, formatTokenAmount } from '@panoptic-eng/sdk'

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
import { openPositionAndWait } from '@panoptic-eng/sdk'

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
} from '@panoptic-eng/sdk'

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
} from '@panoptic-eng/sdk'

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
} from '@panoptic-eng/sdk'

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
} from '@panoptic-eng/sdk'

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
