# Fork Test Suite

Comprehensive integration tests for the Panoptic v2 SDK examples using Anvil mainnet forks.

## Overview

Fork tests verify that SDK functions work correctly against real blockchain state by forking mainnet at a specific block number. This ensures:

1. **Real Contract Interactions**: Tests call actual deployed contracts
2. **Realistic State**: Market conditions, pool liquidity, and positions are real
3. **Integration Coverage**: Full end-to-end testing of SDK → viem → RPC → contracts
4. **Regression Protection**: Changes that break against real state are caught early

## Prerequisites

### Required
- **Reliable RPC Endpoint**: Fork tests require a stable RPC provider
  - ✅ Recommended: Alchemy, Infura, QuickNode (with archive access)
  - ❌ Not recommended: Public RPCs (rate limits cause failures)

### Environment Variables

Create `.env` in the SDK root or set these environment variables:

```bash
# Required: RPC endpoint for forking
FORK_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Optional: Override fork block number
FORK_BLOCK_NUMBER=24297000

# Optional: Override test pool address (once Panoptic v2 is deployed)
TEST_POOL_ADDRESS=0x...
```

## Running Fork Tests

### Start Anvil

Fork tests require Anvil running in the background:

```bash
# Terminal 1: Start Anvil fork
anvil \
  --fork-url $FORK_URL \
  --fork-block-number 24297000 \
  --port 8545 \
  --host 127.0.0.1
```

### Run Tests

```bash
# Terminal 2: Run fork tests
pnpm test:fork

# Watch mode for development
pnpm test:fork:watch

# Run all tests (unit + fork)
pnpm test:examples
```

## Test Structure

```
__tests__/
├── anvil.config.ts          # Fork configuration (block number, accounts, fixtures)
├── setup.ts                 # Shared utilities (funding, snapshots, time control)
├── setup.test.ts            # Unit tests for infrastructure
├── vitest.config.fork.ts    # Vitest config (timeouts, sequential execution)
├── README.md                # This file
│
├── sepolia.config.ts        # Sepolia deployment addresses
├── sepolia/                 # Sepolia fork tests (uses deployed testnet contracts)
│   ├── 01-basic-reads.fork.test.ts      # getPool, getOracleState, getAccountCollateral
│   ├── 02-write-simulations.fork.test.ts # TokenId builder, deposit preview, simulations
│   └── 03-helper-functions.fork.test.ts  # PanopticHelper: NLV, liquidation prices
│
├── basic/
│   ├── 01-simple-read.fork.test.ts      # getPool, getOracleState, getAccountCollateral
│   ├── 02-open-position.fork.test.ts    # TokenId builder, simulation, openPosition
│   ├── 03-close-position.fork.test.ts   # getPosition, closePosition
│   └── 04-vault-operations.fork.test.ts # ERC4626 previews, deposit, withdraw
│
└── oracle-poker/
    ├── monitor.fork.test.ts         # Oracle staleness detection
    ├── executor.fork.test.ts        # pokeOracle execution
    └── integration.fork.test.ts     # End-to-end bot workflow
```

## Sepolia Fork Tests (Recommended for Testing)

The Sepolia fork tests use the deployed Panoptic v2 contracts on Sepolia testnet.
This is the easiest way to run integration tests since it doesn't require mainnet RPC access.

### Prerequisites

1. **Sepolia RPC Endpoint**: Get one from Alchemy, Infura, or QuickNode
   ```bash
   export SEPOLIA_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY"
   ```

### Running Sepolia Fork Tests

```bash
# Terminal 1: Start Anvil fork of Sepolia
anvil --fork-url $SEPOLIA_RPC_URL --port 8545 --host 127.0.0.1

# Terminal 2: Run Sepolia fork tests
pnpm vitest run src/panoptic/v2/examples/__tests__/sepolia/
```

### What's Tested

1. **01-basic-reads.fork.test.ts**
   - `getPool()` - Pool state with token addresses, tick spacing, health status
   - `getOracleState()` - Oracle epoch, EMA values, median tick
   - `getAccountCollateral()` - Collateral balances for test accounts
   - `getCurrentRates()` - Interest rates from collateral trackers

2. **02-write-simulations.fork.test.ts**
   - TokenId builder - Building valid tokenIds for the Sepolia pool
   - `previewDeposit()` - Preview shares for deposit
   - `simulateDeposit()` - Deposit simulation (will fail without tokens)
   - `simulateOpenPosition()` - Position opening simulation (will fail without collateral)

3. **03-helper-functions.fork.test.ts**
   - `getNetLiquidationValue()` - NLV with PanopticHelper contract
   - `getLiquidationPrices()` - Liquidation price bounds
   - Fallback behavior without helper

### Deployed Sepolia Contracts

The tests use these deployed Panoptic v2 contracts on Sepolia:

| Contract | Address |
|----------|---------|
| SFPM | `0x8bbCE8B1eB64118CFE6c1eAb0afe13b80EA41481` |
| PanopticFactory | `0xE0bcA80Dfa46c81682f085b6fBD94DEDc3DDcd7a` |
| PanopticHelper | `0x687F616d68c483A7223E6922F59Aef7452E26c1D` |
| WETH/USDC Pool | `0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78` |

## Test Patterns

### Pattern 1: Setup with Snapshots

Use snapshots for fast test isolation:

```typescript
import { snapshotFork, restoreForkSnapshot } from '../setup'

describe('MyFeature', () => {
  let snapshotId: Hex

  beforeEach(async () => {
    snapshotId = await snapshotFork(testClient)
  })

  afterEach(async () => {
    await restoreForkSnapshot(testClient, snapshotId)
  })

  it('should do something', async () => {
    // Test here - state will be reset after
  })
})
```

### Pattern 2: Funded Accounts

Use `setupTestAccounts()` to fund accounts with ETH and tokens:

```typescript
import { setupTestAccounts, createForkClients } from '../setup'

it('should deposit into vault', async () => {
  const clients = createForkClients(TEST_FIXTURES.accounts.alice)

  // Fund with ETH and collateral tokens
  await setupTestAccounts(
    clients.testClient,
    [clients.account],
    [collateralToken0Address, collateralToken1Address]
  )

  // Now account has ETH for gas + tokens for deposit
  await deposit(...)
})
```

### Pattern 3: Time Manipulation

Use `increaseTime()` for oracle epoch testing:

```typescript
import { increaseTime, TEST_FIXTURES } from '../setup'

it('should allow oracle poke after 64 seconds', async () => {
  // Poke fails - too soon
  await expect(pokeOracle(...)).rejects.toThrow(OracleRateLimitedError)

  // Advance time by one epoch
  await increaseTime(testClient, TEST_FIXTURES.oracleEpochDuration)

  // Poke succeeds now
  await pokeOracle(...)
})
```

### Pattern 4: Block Metadata Verification

Verify `_meta` fields for data freshness:

```typescript
it('should return fresh data with metadata', async () => {
  const pool = await getPool({ client, poolAddress })

  expect(pool._meta.blockNumber).toBeGreaterThan(0n)
  expect(pool._meta.blockTimestamp).toBeGreaterThan(0n)
  expect(pool._meta.blockHash).toMatch(/^0x[a-fA-F0-9]{64}$/)

  // Verify data is recent (within last hour)
  const currentTime = BigInt(Math.floor(Date.now() / 1000))
  const age = currentTime - pool._meta.blockTimestamp
  expect(age).toBeLessThan(3600n)
})
```

## Troubleshooting

### "Failed to get fork block" or "no response"

**Problem**: Anvil can't fetch the fork block from RPC

**Solutions**:
1. Use a reliable RPC endpoint (not public RPC)
2. Ensure block number is recent and available (not pruned)
3. Check RPC rate limits
4. Use `FORK_URL` env var with a premium endpoint

### Tests timeout or hang

**Problem**: RPC calls are slow or failing

**Solutions**:
1. Increase test timeout in `vitest.config.fork.ts`
2. Check RPC endpoint health
3. Reduce number of concurrent tests (already sequential by default)
4. Use local Ethereum node if possible

### "Pool address not found" or contract errors

**Problem**: Test pool doesn't exist at fork block

**Solutions**:
1. Update `TEST_POOL_ADDRESS` to actual deployed Panoptic v2 pool
2. Update `FORK_BLOCK_NUMBER` to block after pool deployment
3. For now, tests may be skipped until Panoptic v2 mainnet deployment

### Snapshot/restore not working

**Problem**: State persists between tests

**Solutions**:
1. Ensure `snapshotFork()` is called in `beforeEach`
2. Ensure `restoreForkSnapshot()` is called in `afterEach`
3. Use `resetFork()` to fully reset to initial fork state

## Best Practices

1. **Deterministic Tests**: Always fork at a specific block number
2. **Test Isolation**: Use snapshots or `resetFork()` between tests
3. **Realistic Scenarios**: Use actual market conditions and pool states
4. **Fast Feedback**: Group related tests to minimize setup/teardown
5. **Clear Errors**: Add descriptive test names and expect messages
6. **Gas Awareness**: Verify gas estimates are reasonable
7. **Event Validation**: Check that write operations emit expected events

## Coverage Goals

Every SDK function used in examples must have fork test coverage:
- ✅ All read functions return valid data
- ✅ All write functions execute successfully
- ✅ All simulations match execution results
- ✅ All error paths are tested
- ✅ Both success and failure scenarios covered

## CI/CD Integration

Fork tests can be integrated into CI pipelines:

```yaml
# GitHub Actions example
- name: Start Anvil Fork
  run: |
    anvil --fork-url ${{ secrets.FORK_URL }} \
          --fork-block-number 24297000 \
          --port 8545 &
    sleep 5  # Wait for Anvil to start

- name: Run Fork Tests
  run: pnpm test:fork
  env:
    FORK_URL: ${{ secrets.FORK_URL }}
```

**Note**: Store `FORK_URL` in GitHub Secrets to protect API keys.

## Current Status

- ✅ Infrastructure complete (setup utilities, config, vitest config)
- ✅ Sepolia fork tests complete (basic reads, write simulations, helper functions)
- ⏳ Basic examples fork tests (in progress)
- ⏳ Oracle poker fork tests (pending)
- ⏳ Liquidation bot fork tests (pending)
- ⏳ Market maker fork tests (pending)
- ⏳ Analytics dashboard fork tests (pending)

## Future Enhancements

- [ ] Parallel test execution with port randomization
- [ ] Automatic Anvil startup/shutdown in test lifecycle
- [ ] Mock Panoptic pool deployment for isolated testing
- [ ] Performance benchmarking (RPC call counts, gas usage)
- [ ] Snapshot caching to speed up test suite
