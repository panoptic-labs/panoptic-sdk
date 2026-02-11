# Oracle Poker Bot

An automated bot that monitors Panoptic v2 pools and pokes their oracles to keep them up-to-date. The oracle updates exponential moving averages (EMAs) and median tick calculations used by the protocol.

## Overview

The Panoptic v2 oracle operates on 64-second epochs. Each pool's oracle can be "poked" once per epoch to update its state with fresh data from the underlying Uniswap pool. This bot:

- Monitors multiple Panoptic pools simultaneously
- Checks oracle staleness (time since last update)
- Automatically pokes oracles when a new epoch has started
- Includes gas price protection to avoid high-cost transactions
- Implements retry logic for transient failures

## Why Poke the Oracle?

The oracle provides critical data for the Panoptic protocol:
- **EMAs**: Spot, Fast, Slow, and Eons exponential moving averages
- **Median Tick**: Used for spread calculations
- **Reference Tick**: Current price reference

While the oracle updates automatically during normal pool operations (mints, burns, etc.), there can be periods of inactivity. Running an oracle poker ensures the oracle stays fresh, which is beneficial for:
- Accurate position pricing
- Up-to-date risk calculations
- Protocol health monitoring

## Architecture

```
src/
├── index.ts      - Main bot loop and orchestration
├── config.ts     - Configuration loading from environment
├── logger.ts     - Timestamped logging utility
├── monitor.ts    - Oracle status checking logic
└── executor.ts   - Transaction execution with retry logic
```

## Prerequisites

- Node.js 18+ and pnpm
- A funded wallet (for gas fees)
- RPC endpoint for your target network
- Panoptic pool address(es) to monitor

## Installation

1. Navigate to this directory:
```bash
cd src/panoptic/v2/examples/oracle-poker
```

2. Install dependencies:
```bash
pnpm install
```

3. Copy the environment template:
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:
```bash
# Required
RPC_URL=https://eth.llamarpc.com
PRIVATE_KEY=0x...
POOL_ADDRESSES=0x...
CHAIN_ID=1

# Optional
POLLING_INTERVAL=30000
MAX_GAS_PRICE_GWEI=100
MAX_RETRIES=3
VERBOSE=false
```

## Configuration

### Required Variables

- **`RPC_URL`**: Ethereum RPC endpoint (e.g., Infura, Alchemy, public RPC)
- **`PRIVATE_KEY`**: Private key for the bot's wallet (must have ETH for gas)
- **`POOL_ADDRESSES`**: Comma-separated list of Panoptic pool addresses
- **`CHAIN_ID`**: Network chain ID (1 for mainnet, 11155111 for Sepolia)

### Optional Variables

- **`POLLING_INTERVAL`** (default: 30000): How often to check pools in milliseconds
- **`MAX_GAS_PRICE_GWEI`** (default: 100): Skip pokes if gas exceeds this price
- **`MAX_RETRIES`** (default: 3): Number of retry attempts for failed transactions
- **`RETRY_DELAY_MS`** (default: 5000): Delay between retries in milliseconds
- **`VERBOSE`** (default: false): Enable debug logging

## Usage

### Development Mode (with auto-restart)

```bash
pnpm dev
```

### Production Mode

```bash
pnpm start
```

### Type Checking

```bash
pnpm build
```

## How It Works

1. **Initialization**
   - Loads configuration from environment variables
   - Creates viem PublicClient and WalletClient
   - Logs bot configuration

2. **Monitoring Loop** (runs every `POLLING_INTERVAL` ms)
   - Fetches oracle state for all configured pools
   - Calculates current epoch: `currentTimestamp / 64`
   - Compares to oracle's last update epoch
   - Identifies pools that need poking

3. **Gas Price Check**
   - Fetches current network gas price
   - Skips pokes if gas exceeds `MAX_GAS_PRICE_GWEI`

4. **Execution**
   - Calls `pokeOracle()` for each pool that needs updating
   - Executes pokes in parallel when multiple pools need updates
   - Implements retry logic for transient failures
   - Waits for transaction confirmation

5. **Error Handling**
   - Detects rate limit errors (oracle already poked this epoch)
   - Retries on transient RPC errors
   - Logs all failures with details
   - Continues monitoring even after failures

## SDK Functions Used

This bot demonstrates several Panoptic v2 SDK patterns:

### Read Functions
- **`getOracleState()`**: Fetch oracle state including epoch and last update time

### Write Functions
- **`pokeOracle()`**: Submit oracle poke transaction
- Returns `TxResult` with `wait()` method for confirmation

### Error Handling
- **`OracleRateLimitedError`**: Thrown when oracle was recently poked
- **`PanopticError`**: Base class for protocol errors

## Logs

The bot produces timestamped logs with the following levels:

- **INFO**: Normal operations (pokes, status updates)
- **WARN**: Non-critical issues (high gas, rate limits)
- **ERROR**: Failed transactions, RPC errors
- **DEBUG**: Detailed state information (requires `VERBOSE=true`)

Example output:
```
[2024-01-15T10:30:00.000Z] [INFO] === Iteration 1 ===
[2024-01-15T10:30:00.100Z] [INFO] Found 1 pool(s) that need poking
[2024-01-15T10:30:00.200Z] [INFO] Current gas price: 25.50 gwei
[2024-01-15T10:30:00.300Z] [INFO] Poking oracle for pool 0x1234... (attempt 1/3)...
[2024-01-15T10:30:00.400Z] [INFO] Transaction submitted: 0xabcd...
[2024-01-15T10:30:15.000Z] [INFO] Oracle poked successfully for pool 0x1234... (block 12345678, gas used: 150000)
```

## Gas Costs

Oracle pokes are relatively inexpensive:
- Typical gas usage: ~100,000-150,000 gas
- At 30 gwei and 2000 USD/ETH: ~$0.06-0.09 per poke
- At 100 gwei and 2000 USD/ETH: ~$0.20-0.30 per poke

The `MAX_GAS_PRICE_GWEI` setting helps control costs during network congestion.

## Security Considerations

- **Private Key**: Never commit your `.env` file or expose your private key
- **Wallet Funding**: Only fund the bot wallet with the minimum ETH needed for operations
- **Gas Limits**: The bot respects `MAX_GAS_PRICE_GWEI` to prevent excessive costs
- **RPC Endpoint**: Use a reliable RPC provider to avoid missed pokes

## Troubleshooting

### Bot reports "Oracle rate limited"
This is normal - it means another transaction already poked the oracle this epoch. The bot will check again next iteration.

### Transactions failing with insufficient funds
Ensure the bot wallet has enough ETH for gas fees.

### RPC errors or timeouts
- Verify your `RPC_URL` is correct and accessible
- Consider using a paid RPC provider for better reliability
- Increase `RETRY_DELAY_MS` if RPC is rate-limiting

### No pools need poking
This is normal during active trading periods - positions being opened/closed automatically update the oracle.

## Advanced Usage

### Monitoring Multiple Networks

Run separate bot instances with different `.env` files:

```bash
# Mainnet bot
RPC_URL=https://eth.llamarpc.com CHAIN_ID=1 pnpm start

# Sepolia bot
RPC_URL=https://sepolia.llamarpc.com CHAIN_ID=11155111 pnpm start
```

### Custom Polling Strategies

Adjust `POLLING_INTERVAL` based on your needs:
- **Every 30s** (default): Good balance of freshness and efficiency
- **Every 60s**: Less frequent checks, lower RPC usage
- **Every 10s**: More aggressive, catches new epochs quickly

### Running as a Service

For production deployment, use a process manager like PM2:

```bash
pm2 start "pnpm start" --name oracle-poker
pm2 save
pm2 startup
```

## License

This example is part of the Panoptic v2 SDK and is provided as-is for educational purposes.
