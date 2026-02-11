# Liquidation Bot Example

A liquidation bot demonstrating the Panoptic v2 SDK patterns for monitoring and liquidating undercollateralized accounts.

## Overview

This bot:
1. Monitors a list of accounts for liquidation opportunities
2. **Syncs positions** using `syncPositions()` to discover account tokenIds via events
3. Checks solvency using `isLiquidatable()` via PanopticQuery
4. Simulates liquidations before execution
5. Executes profitable liquidations

## Limitations

This is an **example** for learning SDK patterns. A production bot needs:

- **Profitability Calculation**: Account for gas costs and liquidation bonus
- **MEV Protection**: Use Flashbots or private mempool
- **Better Account Discovery**: Use subgraph to find ALL accounts with positions (not just a static list)
- **Concurrent Execution**: Use nonce management for parallel liquidations
- **Error Recovery**: Handle RPC failures, reorgs, stuck transactions

## Setup

### Prerequisites

- Node.js 18+
- A funded wallet with ETH for gas
- Access to a Panoptic v2 pool (testnet or mainnet)

### Installation

```bash
cd examples/liquidation-bot
pnpm install
```

### Configuration

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Required
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=0x...your_private_key...
POOL_ADDRESS=0x...panoptic_pool_address...
QUERY_ADDRESS=0x...panoptic_query_address...
CHAIN_ID=1

# Accounts to monitor (comma-separated)
ACCOUNTS_TO_MONITOR=0xabc...,0xdef...

# Optional
POLLING_INTERVAL=15000
MAX_GAS_PRICE_GWEI=100
VERBOSE=false
STORAGE_PATH=./data
```

### Running

```bash
pnpm start
```

## How It Works

### 1. Solvency Check

Uses `isLiquidatable()` with PanopticQuery contract:

```typescript
const result = await isLiquidatable({
  client,
  poolAddress,
  account: accountAddress,
  tokenIds: accountPositions,
  queryAddress, // Required for solvency check
})

if (result.isLiquidatable) {
  // Account can be liquidated
}
```

### 2. Simulation

Before executing, simulate to verify and estimate gas:

```typescript
const simulation = await simulateLiquidate({
  client,
  poolAddress,
  account: liquidatorAddress,
  liquidatee: targetAddress,
  positionIdListFrom: [], // Liquidator's positions
  positionIdListTo: targetPositions, // Positions to liquidate
  positionIdListToFinal: [], // Close all positions
})

if (simulation.success && simulation.data.isLiquidatable) {
  console.log(`Gas estimate: ${simulation.gasEstimate}`)
}
```

### 3. Execution

Execute the liquidation via `dispatchFrom`:

```typescript
const txResult = await liquidate({
  client,
  walletClient,
  account: liquidatorAddress,
  poolAddress,
  liquidatee: targetAddress,
  positionIdListFrom: [],
  positionIdListTo: targetPositions,
  positionIdListToFinal: [],
})

const receipt = await txResult.wait()
console.log(`Liquidation tx: ${receipt.hash}`)
```

## Position Discovery

The bot uses the SDK's `syncPositions()` function for automatic position discovery:

```typescript
import { syncPositions, getTrackedPositionIds } from '@panoptic/sdk/sync'
import { createFileStorage } from '@panoptic/sdk/storage'

// Create storage adapter
const storage = createFileStorage('./data')

// Sync positions for an account (scans OptionMinted/OptionBurnt events)
await syncPositions({
  client,
  poolAddress,
  account: accountAddress,
  storage,
  chainId,
})

// Get the discovered position IDs
const tokenIds = await getTrackedPositionIds({
  chainId,
  poolAddress,
  account: accountAddress,
  storage,
})
```

### How Sync Works

1. **First sync**: Scans all `OptionMinted`/`OptionBurnt` events from pool deployment
2. **Incremental sync**: Only scans new blocks since last checkpoint
3. **Reorg handling**: Detects chain reorgs and re-syncs from safe block
4. **Persistent storage**: Saves checkpoints and position state to disk

### Better Account Discovery (Production)

For a production bot, you still need to discover WHICH accounts to monitor. Options:

- **Subgraph**: Query a Panoptic subgraph for all accounts with positions
- **Event indexing service**: Run a separate service that indexes all accounts
- **On-chain enumeration**: If available, enumerate from contract state

## Profitability

A real liquidation bot should calculate profitability:

```typescript
// Simplified profitability check
const gasEstimate = simulation.gasEstimate
const gasPrice = await client.getGasPrice()
const gasCost = gasEstimate * gasPrice

// Liquidation bonus comes from the liquidatee's collateral
// Need to estimate bonus0/bonus1 from PanopticHelper
const estimatedBonus = ... // Complex calculation

const profitable = estimatedBonus > gasCost
```

## Architecture (Production)

```
┌─────────────────┐     ┌──────────────────┐
│  Event Indexer  │────▶│  Account Database │
│  (sync service) │     │  (positions/state)│
└─────────────────┘     └────────┬─────────┘
                                 │
┌─────────────────┐              ▼
│   Price Feed    │────▶┌──────────────────┐
│   (oracle/dex)  │     │  Liquidation Bot  │
└─────────────────┘     │  (this example)   │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │   Flashbots/     │
                        │   Private Pool   │
                        └──────────────────┘
```

## Risk Warnings

- **Capital at Risk**: Liquidation requires gas and may fail
- **MEV Competition**: Other bots may front-run your liquidations
- **Smart Contract Risk**: Panoptic contracts may have bugs
- **Gas Spikes**: High gas prices can make liquidations unprofitable

## License

MIT
