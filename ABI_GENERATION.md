# ABI Generation Setup

This SDK uses `@wagmi/cli` to automatically generate TypeScript ABIs from Foundry build artifacts.

## Prerequisites

- Node.js >= 20.19.0 (monorepo requirement)
- pnpm (monorepo package manager)
- Foundry contracts built in `panoptic-next-core-private-post-vuln/out/`

## Installation

From the monorepo root:

```bash
# Install all dependencies including @wagmi/cli
pnpm install
```

## Generating ABIs

### Generate once

```bash
# From SDK package directory
pnpm codegen:wagmi

# Or from monorepo root
pnpm --filter @panoptic/sdk codegen:wagmi
```

This will:
1. Read Foundry artifacts from `../../../panoptic-next-core-private-post-vuln/out/`
2. Generate TypeScript ABIs in `src/generated.ts`
3. Include only V4 contracts (excludes V1 and test artifacts)

### Generate all (GraphQL + ABIs)

```bash
pnpm codegen
```

This runs both:
- `codegen:graphql` - GraphQL codegen
- `codegen:wagmi` - ABI generation

### Auto-generate on changes

The `dev` script watches for changes:

```bash
pnpm dev
```

This runs both GraphQL codegen and wagmi generation in watch mode.

## Configuration

The wagmi config is in `wagmi.config.ts`:

```typescript
import { defineConfig } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'

export default defineConfig({
  out: 'src/generated.ts',
  plugins: [
    foundry({
      project: '../../../panoptic-next-core-private-post-vuln/',
      include: [
        'PanopticPool.sol/PanopticPool.json',
        'RiskEngine.sol/RiskEngine.json',
        'CollateralTracker.sol/CollateralTracker.json',
        'PanopticFactoryV4.sol/PanopticFactory.json',
        'PanopticHelper.sol/PanopticHelper.json',
        'SemiFungiblePositionManagerV4.sol/SemiFungiblePositionManager.json',
      ],
      exclude: [
        'contracts/**',           // Duplicate artifacts
        'SemiFungiblePositionManager.sol/**',  // V1 contract
        'PanopticFactory.sol/**', // V1 contract
        '**.t.sol/**',            // Test contracts
      ],
    }),
  ],
})
```

## Contracts Included

The following V4 contract ABIs are generated:

- **PanopticPool** - Main pool contract for managing positions
- **RiskEngine** - Risk management and liquidation logic
- **CollateralTracker** - Handles collateral deposits/withdrawals
- **PanopticFactory** - Deploys new Panoptic pools (V4 version)
- **PanopticHelper** - Helper contract for view functions
- **SemiFungiblePositionManager** - Position manager (V4 version)

## Generated Output

**File**: `src/generated.ts`
**Size**: ~77KB, ~2,790 lines

Exported ABIs:
```typescript
export const collateralTrackerAbi = [...]
export const panopticFactoryAbi = [...]
export const panopticHelperAbi = [...]
export const panopticPoolAbi = [...]
export const riskEngineAbi = [...]
export const semiFungiblePositionManagerAbi = [...]
```

## Usage in Code

```typescript
import {
  panopticPoolAbi,
  riskEngineAbi,
  collateralTrackerAbi
} from './generated'
import { getContract, createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

// Create a viem client
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http()
})

// Use the ABIs with viem
const panopticPool = getContract({
  address: '0x1234567890123456789012345678901234567890',
  abi: panopticPoolAbi,
  client: publicClient
})

// Call contract methods
const poolData = await panopticPool.read.getPoolData()
```

## Updating ABIs

When contracts change in the source repo:

1. Ensure contracts are built in the source repo:
   ```bash
   cd ../../../panoptic-next-core-private-post-vuln
   forge build
   ```

2. Regenerate ABIs:
   ```bash
   cd packages/sdk
   pnpm codegen:wagmi
   ```

3. Commit `src/generated.ts` if there are changes

## Troubleshooting

### "Cannot find module" errors

Ensure the Foundry contracts are built:
```bash
cd ../../../panoptic-next-core-private-post-vuln
forge build
```

### Duplicate artifact warnings

The config explicitly excludes V1 contracts and test artifacts. If you see duplicates, check the `exclude` patterns in `wagmi.config.ts`.

### Node version mismatch

This monorepo requires Node >= 20.19.0. Check your version:
```bash
node --version
```

Use nvm to switch if needed:
```bash
nvm use 20
```

### Slow generation

The wagmi CLI may take 30-60 seconds to resolve all contracts. This is normal for large Foundry projects.

## Integration with Build Pipeline

The `codegen` script is automatically run before build:

```bash
pnpm build
# Runs: pnpm codegen && pnpm tsdown
#   → pnpm codegen:graphql
#   → pnpm codegen:wagmi
#   → pnpm tsdown
```

This ensures ABIs are always up-to-date before building the SDK.
