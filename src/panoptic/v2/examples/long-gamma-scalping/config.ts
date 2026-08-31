/**
 * Shared environment configuration for the long gamma scalping example.
 *
 * Required .env variables:
 *   RPC_URL       - RPC endpoint
 *   PRIVATE_KEY   - Wallet private key
 *   POOL_ADDRESS  - PanopticPool contract address
 *
 * Optional:
 *   POSITION_SIZE          - Straddle size in token0 units (default: 1e10)
 *   EXISTING_POSITION_IDS  - Comma-separated open TokenIds owned by the account
 *   SLIPPAGE_BPS           - Max tick movement for execution limits (default: 500)
 *   EXECUTE                - Set to "true" to submit transactions
 *
 * @module examples/long-gamma-scalping/config
 */

import 'dotenv/config'

import {
  type Address,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

export const CHAIN_ID = 11155111n

export interface EnvConfig {
  rpcUrl: string
  privateKey: `0x${string}`
  poolAddress: Address
  positionSize: bigint
  existingPositionIds: bigint[]
  slippageBps: bigint
  execute: boolean
}

function parseTokenIds(value: string | undefined): bigint[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => BigInt(part))
}

export function loadEnv(): EnvConfig {
  const rpcUrl = process.env.RPC_URL
  if (!rpcUrl) throw new Error('RPC_URL required')

  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!privateKey) throw new Error('PRIVATE_KEY required')

  const poolAddress = process.env.POOL_ADDRESS as Address | undefined
  if (!poolAddress) throw new Error('POOL_ADDRESS required')

  const positionSize = BigInt(process.env.POSITION_SIZE ?? String(10n ** 10n))
  if (positionSize <= 0n) throw new Error('POSITION_SIZE must be greater than zero')

  const slippageBps = BigInt(process.env.SLIPPAGE_BPS ?? '500')
  if (slippageBps < 0n) throw new Error('SLIPPAGE_BPS cannot be negative')

  return {
    rpcUrl,
    privateKey,
    poolAddress,
    positionSize,
    existingPositionIds: parseTokenIds(process.env.EXISTING_POSITION_IDS),
    slippageBps,
    execute: process.env.EXECUTE === 'true',
  }
}

export interface Clients {
  client: PublicClient
  walletClient: WalletClient
  account: ReturnType<typeof privateKeyToAccount>
}

export function createClients(env: EnvConfig): Clients {
  const account = privateKeyToAccount(env.privateKey)
  const client = createPublicClient({ chain: sepolia, transport: http(env.rpcUrl) })
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(env.rpcUrl),
  })

  return { client: client as PublicClient, walletClient, account }
}
