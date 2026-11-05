# Long Gamma Scalping Example

Atomically buys an ATM straddle on Panoptic and opens a delta hedge with a `swapAtMint` loan.

## Strategy overview

1. **Buy an ATM straddle** - open a long call + long put at the current tick to get positive gamma.
2. **Calculate the hedge** - use `getDeltaHedgeParams` to compute the loan leg needed to target zero delta.
3. **Open the straddle and hedge atomically** - submit both mints in one `dispatch` call so the batch reverts if either leg fails.
4. **Track the exposure** - compare straddle delta, hedge delta, and combined delta.

This is the long-gamma mirror of the reverse gamma scalping example: long gamma pays premium and benefits from realized moves if hedging gains exceed premium and costs.

## Files

| File        | Purpose                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `index.ts`  | Main example - simulate or execute atomic long straddle entry and delta hedge |
| `config.ts` | Environment loading and viem client setup                                     |

## Prerequisites

- **Sepolia ETH** for gas and token0 collateral
- **Sepolia USDC** for token1 collateral
- **Deposited collateral** in both Panoptic collateral trackers for the target pool
- **Available short-side liquidity** in the target pool
- **RPC URL** - Infura, Alchemy, or any Sepolia RPC endpoint

## Quick start

1. **Set environment variables**:

   ```bash
   export RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
   export PRIVATE_KEY=0xYOUR_PRIVATE_KEY
   export POOL_ADDRESS=0xYOUR_PANOPTIC_POOL
   ```

2. **Dry-run the strategy**:

   ```bash
   RPC_URL=$RPC_URL PRIVATE_KEY=$PRIVATE_KEY POOL_ADDRESS=$POOL_ADDRESS \
     npx tsx src/panoptic/v2/examples/long-gamma-scalping/index.ts
   ```

3. **Execute the atomic straddle and hedge batch**:

   ```bash
   RPC_URL=$RPC_URL PRIVATE_KEY=$PRIVATE_KEY POOL_ADDRESS=$POOL_ADDRESS EXECUTE=true \
     npx tsx src/panoptic/v2/examples/long-gamma-scalping/index.ts
   ```

## Configuration

| Variable                | Default       | Description                                                                  |
| ----------------------- | ------------- | ---------------------------------------------------------------------------- |
| `POSITION_SIZE`         | `10000000000` | Straddle size in token0 units                                                |
| `EXISTING_POSITION_IDS` | empty         | Comma-separated open TokenIds owned by the account                           |
| `SLIPPAGE_BPS`          | `500`         | Max tick movement for straddle and `swapAtMint` execution limits             |
| `EXECUTE`               | `false`       | Submit transactions when `true`; otherwise simulate and print the hedge plan |

`EXISTING_POSITION_IDS` is explicit on purpose. The example avoids broad historical event scans so it works with RPC providers that limit large `eth_getLogs` ranges.

## Notes

- The example does not seed liquidity. If no sellers are available, the straddle simulation fails before any transaction is sent.
- `EXECUTE=true` submits the straddle and hedge in one `dispatch` call. If either mint fails or execution exceeds `SLIPPAGE_BPS`, the full batch reverts.
- The example assumes collateral has already been deposited. Use the vault operation examples or the reverse gamma setup script as a reference for collateral deposits.
- The fork test at `src/panoptic/v2/examples/__tests__/long-gamma-scalping.fork.test.ts` seeds liquidity and verifies the full long straddle plus hedge flow.

## Disclaimer

This is an educational example for Sepolia testnet. It is not audited, not production-ready, and should not be used with real funds.
