# ABI Generation Setup

This SDK uses `@wagmi/cli` to automatically generate TypeScript ABIs from Foundry build artifacts.

## Prerequisites

- Node.js >= 20.19.0 (monorepo requirement)
- pnpm (monorepo package manager)
- Foundry contracts built in local packages:
  - `packages/panoptic-v2-core/out/` — core contracts
  - `packages/panoptic-helper/out/` — PanopticQuery helper

## Building Foundry Artifacts

Before generating ABIs, build both contract packages:

```bash
cd packages/panoptic-v2-core && forge build
cd packages/panoptic-helper && forge build --skip test
```

## Generating ABIs

### Primary config (`wagmi.config.ts` → `src/generated.ts`)

```bash
pnpm codegen:wagmi
```

This generates TypeScript ABIs for:
- **CollateralTrackerV2** — Handles collateral deposits/withdrawals
- **PanopticPoolV2** — Main pool contract for managing positions
- **PanopticFactoryV4** — Deploys new Panoptic pools (V4 version)
- **RiskEngine** — Risk management and liquidation logic
- **SemiFungiblePositionManagerV3** — Position manager (V3/Uniswap version)
- **SemiFungiblePositionManagerV4** — Position manager (V4/Uniswap version)
- **PanopticQuery** — Helper contract for batch view functions (from panoptic-helper)

Exported names:
```typescript
export const collateralTrackerV2Abi = [...]
export const panopticFactoryV4Abi = [...]
export const panopticPoolV2Abi = [...]
export const panopticQueryAbi = [...]
export const riskEngineAbi = [...]
export const semiFungiblePositionManagerV3Abi = [...]
export const semiFungiblePositionManagerV4Abi = [...]
```

### Secondary config (`panoptic_v2_wagmi_config.ts` → `src/abis/panoptic_v2_abis.ts`)

```bash
pnpm exec wagmi generate --config panoptic_v2_wagmi_config.ts
```

Generates the same ABIs plus `builderFactoryAbi` and `builderWalletAbi` from `RiskEngine.sol`.

### Generate all (GraphQL + ABIs)

```bash
pnpm codegen
```

## Configuration

Both wagmi configs point to local packages with `forge: { build: false }` (you must build first):
- `../panoptic-v2-core/` — core contracts
- `../panoptic-helper/` — PanopticQuery

## Troubleshooting

### "Cannot find module" errors

Ensure the Foundry contracts are built:
```bash
cd packages/panoptic-v2-core && forge build
cd packages/panoptic-helper && forge build --skip test
```

### panoptic-helper build fails

The test file has a compilation error. Use `forge build --skip test` to build only the source contracts.
