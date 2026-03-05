# @panoptic-eng/sdk

TypeScript SDK for interacting with the Panoptic v2 perpetual options protocol on EVM chains.

## Quick Start

```bash
npm install @panoptic-eng/sdk viem
```

```typescript
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  getPool,
  fetchPoolId,
  approveAndWait,
  depositAndWait,
  createTokenIdBuilder,
  simulateOpenPosition,
  openPositionAndWait,
  tickLimits,
  formatTokenAmount,
} from '@panoptic-eng/sdk/v2'

// 1. Setup clients
const account = privateKeyToAccount('0xYOUR_PRIVATE_KEY')
const client = createPublicClient({ chain: sepolia, transport: http() })
const walletClient = createWalletClient({ account, chain: sepolia, transport: http() })

// 2. Read pool data
const pool = await getPool({ client, poolAddress: '0x...', chainId: 11155111n })

// 3. Approve + deposit collateral
await approveAndWait({
  client,
  walletClient,
  account: account.address,
  tokenAddress: pool.poolKey.currency0,
  spenderAddress: pool.collateralTracker0.address,
  amount: 2n ** 256n - 1n,
})
await depositAndWait({
  client,
  walletClient,
  account: account.address,
  collateralTrackerAddress: pool.collateralTracker0.address,
  assets: parseUnits('1', 18),
})

// 4. Build a position and simulate
const { poolId } = await fetchPoolId({ client, poolAddress: '0x...' })
const tokenId = createTokenIdBuilder(poolId)
  .addCall({ strike: 200_000n, width: 10n, optionRatio: 1n })
  .build()

const limits = tickLimits(pool.currentTick, 500n)
const sim = await simulateOpenPosition({
  client,
  poolAddress: '0x...',
  account: account.address,
  tokenId,
  positionSize: 10n ** 15n,
  existingPositionIds: [],
  tickLimitLow: limits.low,
  tickLimitHigh: limits.high,
})

if (!sim.success) throw new Error(`Simulation failed: ${sim.error}`)
console.log('Gas estimate:', sim.gasEstimate)
console.log(
  'Token0 required:',
  formatTokenAmount(sim.data.amount0Required, BigInt(pool.collateralTracker0.decimals), 6n),
)

// 5. Execute
await openPositionAndWait({
  client,
  walletClient,
  account: account.address,
  poolAddress: '0x...',
  tokenId,
  positionSize: 10n ** 15n,
  existingPositionIds: [],
  tickLimitLow: limits.low,
  tickLimitHigh: limits.high,
})
```

## Feature Overview

| Category | Capabilities |
|----------|-------------|
| **Pool Data** | Full pool state, utilization, oracle, risk parameters, liquidity distribution, interest rates |
| **Trading** | Open, close, roll positions with simulation-first workflow; tick limit slippage control |
| **Collateral** | ERC-4626 vault deposits/withdrawals, approval helpers, collateral estimation, max position sizing |
| **TokenId Builder** | Chainable builder for calls, puts, loans, credits; multi-leg spreads (up to 4 legs) |
| **Risk & Margin** | Margin buffer, liquidation prices, net liquidation value, collateral-across-ticks analysis |
| **Liquidation** | Liquidation checks, simulation, execution; force exercise for ITM longs |
| **Greeks** | Client-side value, delta, gamma in natural token units; swap-aware delta; loan effective delta |
| **Events** | WebSocket watcher, resilient subscription with auto-reconnect, HTTP polling |
| **Position Tracking** | Event-based sync with resumable checkpoints; file and memory storage adapters |
| **Trade History** | Local trade history with filters, realized PnL aggregation |
| **Price History** | Historical tick/sqrtPriceX96 data, streamia (premia) history, Uniswap fee history |
| **Bot Utilities** | Data freshness assertions, pool health checks, safe mode guards, RPC error classifiers |
| **Oracle** | Oracle state reads, poke with epoch rate-limit handling |
| **Pool Deployment** | Mine vanity pool addresses, simulate and deploy new Panoptic pools |
| **Formatters** | Prices, token amounts, BPS, utilization, WAD values — all with explicit precision |
| **Errors** | Typed error classes for every failure mode (revert decoding, RPC, validation) |

## Documentation

| Document                                     | Description                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Getting Started](./docs/GETTING_STARTED.md) | Full walkthrough: setup → deposit → trade → greeks → risk → events → bots → deployment |
| [API Reference](./docs/SDK_API_REFERENCE.md) | Every exported function grouped by module with signatures and descriptions         |
| [Examples](./src/panoptic/v2/examples/)      | Runnable example scripts (bots, fork tests, common workflows)                      |

## Notes

- `GetVaultHistory` applies `first`/`skip` independently per event stream. For unified timeline pagination, merge and sort all streams client-side first, then page that merged array (for example, with a helper like `fetchVaultHistoryRows`).

### Example Bots

| Directory | Description |
|-----------|-------------|
| [`examples/liquidation-bot/`](./src/panoptic/v2/examples/liquidation-bot/) | Monitors accounts, detects undercollateralized positions, and executes liquidations |
| [`examples/oracle-poker/`](./src/panoptic/v2/examples/oracle-poker/) | Keeps Panoptic oracle observations fresh by poking within epoch constraints |
| [`examples/reverse-gamma-scalping/`](./src/panoptic/v2/examples/reverse-gamma-scalping/) | Delta-hedged strategy using loans, credits, and swap-aware greeks |

---

## Contributing

### Prerequisites

- **Node.js** `>=20.19.0 <23.0.0` (see `.nvmrc` in repo root)
- **pnpm** package manager

### Setup

```sh
# Install Node.js via nvm
nvm install && nvm use

# Enable pnpm
corepack enable

# Install dependencies (from monorepo root)
pnpm install

# Generate contract types
cd packages/sdk
pnpm codegen
```

### Development

```sh
pnpm build          # Build the SDK
pnpm dev            # Watch mode
pnpm typecheck      # Type checking
pnpm lint           # Linting
pnpm lint:fix       # Auto-fix lint issues
```

### Testing

```sh
pnpm test              # Unit tests
pnpm test:fork         # Fork tests (requires ALCHEMY_API_KEY in .env)
pnpm test:fork:watch   # Watch mode for fork tests
pnpm test:examples     # All tests (unit + fork)
```

### Project Structure

```text
packages/sdk/
├── docs/                       # SDK documentation
├── src/
│   ├── panoptic/
│   │   └── v2/                 # Panoptic v2 SDK
│   │       ├── reads/          # Pool, position, account reads
│   │       ├── writes/         # Transaction functions
│   │       ├── simulations/    # Dry-run simulations
│   │       ├── tokenId/        # TokenId encoding/decoding
│   │       ├── sync/           # Position tracking via events
│   │       ├── events/         # Event watching and polling
│   │       ├── formatters/     # Display formatters
│   │       ├── greeks/         # Client-side greeks
│   │       ├── bot/            # Bot utilities
│   │       ├── clients/        # viem client helpers
│   │       ├── storage/        # Storage adapters
│   │       ├── errors/         # Typed error classes
│   │       ├── types/          # TypeScript types
│   │       ├── utils/          # Constants
│   │       └── examples/       # Example scripts
│   └── generated/              # Auto-generated contract types
├── contracts/                  # Contract ABIs
└── scripts/                    # Build and sync scripts
```

### Contract ABIs

Contract ABIs are synced from the main contracts repository. See [ABI_GENERATION.md](./ABI_GENERATION.md) for details.

```sh
pnpm sync-contracts
```
