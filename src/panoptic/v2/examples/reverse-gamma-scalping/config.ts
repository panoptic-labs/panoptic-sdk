/**
 * Shared environment configuration for reverse gamma scalping bot scripts.
 *
 * All scripts read POOL_ADDRESS from .env instead of hardcoding it.
 * Collateral tracker addresses are fetched on-chain via getPool().
 *
 * Required .env variables:
 *   RPC_URL       - RPC endpoint
 *   PRIVATE_KEY   - Wallet private key
 *   POOL_ADDRESS  - PanopticPool contract address
 *
 * Optional:
 *   QUERY_ADDRESS - PanopticQuery helper contract address (for check.ts)
 *
 * @module examples/reverse-gamma-scalping/config
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
export const WETH_DECIMALS = 18n
export const USDC_DECIMALS = 6n

export interface EnvConfig {
  rpcUrl: string
  privateKey: `0x${string}`
  poolAddress: Address
  queryAddress?: Address
}

export function loadEnv(): EnvConfig {
  const rpcUrl = process.env.RPC_URL
  if (!rpcUrl) throw new Error('RPC_URL required')

  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!privateKey) throw new Error('PRIVATE_KEY required')

  const poolAddress = process.env.POOL_ADDRESS as Address | undefined
  if (!poolAddress) throw new Error('POOL_ADDRESS required')

  const queryAddress = process.env.QUERY_ADDRESS as Address | undefined

  return { rpcUrl, privateKey, poolAddress, queryAddress }
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
