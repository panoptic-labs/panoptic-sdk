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
  getPool, fetchPoolId, approveAndWait, depositAndWait,
  createTokenIdBuilder, simulateOpenPosition, openPositionAndWait,
  tickLimits, formatTokenAmount,
} from '@panoptic-eng/sdk'

// 1. Setup clients
const account = privateKeyToAccount('0xYOUR_PRIVATE_KEY')
const client = createPublicClient({ chain: sepolia, transport: http() })
const walletClient = createWalletClient({ account, chain: sepolia, transport: http() })

// 2. Read pool data
const pool = await getPool({ client, poolAddress: '0x...', chainId: 11155111n })

// 3. Approve + deposit collateral
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

// 4. Build a position and simulate
const { poolId } = await fetchPoolId({ client, poolAddress: '0x...' })
const tokenId = createTokenIdBuilder(poolId)
  .addCall({ strike: 200_000n, width: 10n, optionRatio: 1n })
  .build()

const limits = tickLimits(pool.currentTick, 500n)
const sim = await simulateOpenPosition({
  client, poolAddress: '0x...', account: account.address,
  tokenId, positionSize: 10n ** 15n, existingPositionIds: [],
  tickLimitLow: limits.low, tickLimitHigh: limits.high,
})

if (!sim.success) throw new Error(`Simulation failed: ${sim.error}`)
console.log('Gas estimate:', sim.gasEstimate)
console.log('Token0 required:', formatTokenAmount(
  sim.data.amount0Required, BigInt(pool.collateralTracker0.decimals), 6n
))

// 5. Execute
await openPositionAndWait({
  client, walletClient, account: account.address, poolAddress: '0x...',
  tokenId, positionSize: 10n ** 15n, existingPositionIds: [],
  tickLimitLow: limits.low, tickLimitHigh: limits.high,
})
```

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](./docs/GETTING_STARTED.md) | Full walkthrough: setup, deposit, build positions, simulate, trade, monitor, close |
| [API Reference](./docs/SDK_API_REFERENCE.md) | Every exported function grouped by module with signatures and descriptions |
| [Examples](./src/panoptic/v2/examples/) | Runnable example scripts (bots, fork tests, common workflows) |

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
