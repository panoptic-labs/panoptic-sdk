# Intermediate Examples

These examples combine multiple SDK reads, safety checks, and strategy-control patterns.

## 17 - Risk Guardrails

Demonstrates a preflight guardrail layer that bots can run before automated writes.

```bash
RPC_URL=https://ethereum-rpc.publicnode.com \
POOL_ADDRESS=0x... \
tsx 17-risk-guardrails.ts
```

Optional configuration:

```bash
CHAIN_ID=1
OPERATION=mint # mint | burn | liquidate | forceExercise
MAX_DATA_AGE_SECONDS=60
WARN_UTILIZATION_BPS=8000
HALT_UTILIZATION_BPS=9500
```

What it shows:

- Fetching pool and safe-mode state.
- Enforcing freshness with `assertFresh()`.
- Enforcing pool status with `assertHealthy()`.
- Respecting safe-mode permissions with `assertCanMint()`, `assertCanBurn()`,
  `assertCanLiquidate()`, and `assertCanForceExercise()`.
- Adding configurable utilization thresholds.
- Classifying RPC errors with `isRetryableRpcError()`, `isNonceError()`, and `isGasError()`.

The example returns an explicit decision:

```text
Decision: HALT (halt)

[HALT] utilization
     Utilization is above the halt threshold.
     observed: 97.50%
     threshold: < 95.00%
```

Tests:

```bash
bun test src/panoptic/v2/examples/__tests__/intermediate/17-risk-guardrails.test.ts
```

The fork integration test is optional and does not use the monorepo deployment config:

```bash
anvil --fork-url $FORK_URL --port 8545 --host 127.0.0.1
TEST_POOL_ADDRESS=0x... \
bun test src/panoptic/v2/examples/__tests__/intermediate/17-risk-guardrails.fork.test.ts
```
