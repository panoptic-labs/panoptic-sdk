# Reverse Gamma Scalping Bot

Sells ATM straddles on Panoptic and delta-hedges with loans to profit when realized volatility is lower than implied volatility.

## Strategy overview

1. **Open a short straddle** — sell an ATM call + ATM put at the current tick, collecting premium (premia) from buyers.
2. **Delta-hedge continuously** — when the portfolio delta drifts beyond a threshold, open a loan leg with `swapAtMint` to push delta back toward zero.
3. **Profit condition** — if realized vol stays below the implied vol priced into the straddle, the collected premia exceeds hedging costs.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Main bot — straddle entry, hedge loop, graceful shutdown, PnL report |
| `setup.ts` | One-time collateral deposit (0.4 ETH + 500 USDC) |
| `swapper.ts` | Price mover for testing — opens+closes loans to shift price ~1% |
| `check.ts` | Read-only position and collateral inspector |
| `close-all.ts` | Emergency close of all open positions |

## Prerequisites

- **Sepolia ETH** for gas (> 0.5 ETH recommended; 0.4 goes to collateral)
- **Sepolia USDC** — 500+ USDC from a testnet faucet
- **RPC URL** — Infura, Alchemy, or any Sepolia RPC endpoint

## Quick start

1. **Set environment variables** — create a `.env` or export inline:

   ```bash
   export RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
   export PRIVATE_KEY=0xYOUR_PRIVATE_KEY
   ```

2. **Deposit collateral** (one-time):

   ```bash
   RPC_URL=$RPC_URL PRIVATE_KEY=$PRIVATE_KEY \
     npx tsx src/panoptic/v2/examples/reverse-gamma-scalping/setup.ts
   ```

3. **Start the bot**:

   ```bash
   RPC_URL=$RPC_URL PRIVATE_KEY=$PRIVATE_KEY \
     npx tsx src/panoptic/v2/examples/reverse-gamma-scalping/index.ts
   ```

4. **(Optional)** In a second terminal, create price movement to trigger hedges:

   ```bash
   RPC_URL=$RPC_URL PRIVATE_KEY=$PRIVATE_KEY \
     npx tsx src/panoptic/v2/examples/reverse-gamma-scalping/swapper.ts
   ```

5. **Shut down gracefully** — press `q` + Enter (or Ctrl+C). The bot closes all positions before exiting and prints a PnL report.

## Monitoring

Inspect positions and collateral for any account (defaults to the hardcoded deployer address):

```bash
RPC_URL=$RPC_URL \
  npx tsx src/panoptic/v2/examples/reverse-gamma-scalping/check.ts [account_address]
```

## Emergency shutdown

Close all open positions immediately (loans first, then options):

```bash
RPC_URL=$RPC_URL PRIVATE_KEY=$PRIVATE_KEY \
  npx tsx src/panoptic/v2/examples/reverse-gamma-scalping/close-all.ts
```

## Configuration

Key tunables at the top of `index.ts`:

| Parameter | Default | Description |
|---|---|---|
| `positionSize` | `10^15` (0.001 WETH) | Notional size of each straddle leg |
| `deltaThresholdBps` | `200` (2%) | Re-hedge when \|delta\| / positionSize exceeds this |
| `hedgeCheckIntervalMs` | `30000` (30 s) | Polling interval between hedge checks |
| `slippageToleranceBps` | `500` (5%) | Max slippage for `swapAtMint` hedges |
| `maxIterations` | `100` | Bot stops after this many hedge cycles |

The swapper (`swapper.ts`) has its own tunables: `SWAP_INTERVAL_BLOCKS` (4), `SWAP_SIZE` (tuned for ~1% impact), and `DIRECTION` (`'random'` / `'alternate'` / `'up'` / `'down'`).

## Disclaimer

This is an **educational example** for **Sepolia testnet only**. It is not audited, not production-ready, and should not be used with real funds.
