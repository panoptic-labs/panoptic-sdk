# @panoptic-eng/sdk

TypeScript SDK for interacting with Panoptic v2 protocol.

## Prerequisites

- **Node.js** `>=20.19.0 <23.0.0` (see `.nvmrc` in repo root)
- **pnpm** package manager

## Setup

### 1. Install Node.js (via nvm)

```sh
# Install nvm if you don't have it
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Restart terminal, then install the correct Node version
nvm install
nvm use
```

### 2. Install pnpm

```sh
# Option A: via corepack (recommended, built into Node 16.13+)
corepack enable

# Option B: via npm
npm install -g pnpm
```

### 3. Install dependencies

From the monorepo root:

```sh
pnpm install
pnpm add @panoptic-eng/sdk react viem wagmi
```

### 4. Generate types

The SDK uses code generation for contract ABIs and GraphQL types:

```sh
cd packages/sdk
pnpm codegen
```

This runs:
- `codegen:graphql` - Generates TypeScript types from GraphQL schema
- `codegen:wagmi` - Generates TypeScript types from contract ABIs

### 5. Set up environment (for fork tests)

```sh
cp .env.template .env
# Add your Alchemy API key to .env
```

## Development

```sh
# Build the SDK
pnpm build

# Watch mode (rebuilds on changes)
pnpm dev

# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix
```

## Testing

```sh
# Run unit tests
pnpm test

# Run fork tests (requires ALCHEMY_API_KEY)
pnpm test:fork

# Watch mode for fork tests
pnpm test:fork:watch

# Run all tests (unit + fork)
pnpm test:examples
```

## Project Structure

```
packages/sdk/
├── src/
│   ├── panoptic/
│   │   └── v2/              # Panoptic v2 SDK
│   │       ├── clients/     # Client utilities (getBlockMeta, etc.)
│   │       ├── errors/      # Error types
│   │       ├── simulations/ # Transaction simulations
│   │       ├── sync/        # Position sync and tracking
│   │       ├── types/       # TypeScript types
│   │       ├── utils/       # Utility functions
│   │       └── examples/    # Example implementations
│   │           ├── basic/           # Basic read/write examples
│   │           ├── liquidation-bot/ # Liquidation bot example
│   │           └── oracle-poker/    # Oracle poker bot example
│   └── generated/           # Auto-generated contract types
├── contracts/               # Contract ABIs (synced from contracts repo)
├── graphql/                 # GraphQL schema and queries
└── scripts/                 # Build and sync scripts
```

## Contract ABIs

Contract ABIs are synced from the main contracts repository. See [ABI_GENERATION.md](./ABI_GENERATION.md) for details.

To sync ABIs:

```sh
pnpm sync-contracts
```

## Usage

```typescript
import {
  simulateOpenPosition,
  simulateClosePosition,
  getBlockMeta,
  TokenIdBuilder,
} from '@panoptic-eng/sdk'
```

See the [examples](./src/panoptic/v2/examples/) directory for usage patterns.
