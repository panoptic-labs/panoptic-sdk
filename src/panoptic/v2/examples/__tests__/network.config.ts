/**
 * Unified network configuration for fork tests
 *
 * Allows tests to run against any supported network by setting the NETWORK env var.
 * Defaults to Sepolia since it has active Panoptic v2 deployments.
 *
 * Usage:
 *   NETWORK=sepolia pnpm test:fork    # Run against Sepolia (default)
 *   NETWORK=mainnet pnpm test:fork    # Run against mainnet (when deployed)
 *
 * @module examples/__tests__/network.config
 */

import type { Address, Chain, Hex, PublicClient, WalletClient } from 'viem'
// ============================================================================
// Funding Utilities (Sepolia-specific, but exposed for all networks)
// ============================================================================
import { parseAbi } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

// ============================================================================
// Types
// ============================================================================

export type SupportedNetwork = 'sepolia' | 'mainnet'

export interface PoolConfig {
  address: Address
  token0: Address
  token1: Address
  fee: number
  tickSpacing: number
  collateralTracker0: Address
  collateralTracker1: Address
}

export interface TokenConfig {
  address: Address
  symbol: string
  decimals: number
}

export interface ContractsConfig {
  semifungiblePositionManager: Address
  builderFactory: Address
  riskEngine: Address
  panopticPoolImpl: Address
  collateralTrackerImpl: Address
  panopticFactory: Address
  panopticHelper: Address
  panopticQuery?: Address
  pool: PoolConfig
}

export interface NetworkConfig {
  /** Network identifier */
  network: SupportedNetwork
  /** viem Chain object */
  chain: Chain
  /** Chain ID as bigint */
  chainId: bigint
  /** RPC URL for forking (from env var) */
  forkUrl: string
  /** Block number to fork at (optional, for mainnet) */
  forkBlockNumber?: bigint
  /** Contract addresses */
  contracts: ContractsConfig
  /** Token metadata */
  tokens: {
    token0: TokenConfig
    token1: TokenConfig
  }
  /** Anvil test server config */
  anvil: {
    port: number
    host: string
  }
  /** Test account private keys (Anvil defaults) */
  testAccounts: {
    alice: Hex
    bob: Hex
    carol: Hex
    dave: Hex
    eve: Hex
    frank: Hex
  }
  /** Derived test account addresses */
  testAddresses: {
    alice: Address
    bob: Address
    carol: Address
    dave: Address
    eve: Address
    frank: Address
  }
}

// ============================================================================
// Network Configurations
// ============================================================================

const SEPOLIA_CONFIG: NetworkConfig = {
  network: 'sepolia',
  chain: sepolia,
  chainId: 11155111n,
  forkUrl: process.env.SEPOLIA_RPC_URL || '',
  contracts: {
    semifungiblePositionManager: '0x8bbCE8B1eB64118CFE6c1eAb0afe13b80EA41481',
    builderFactory: '0x34B3a4e4F14f292575ECe3EF67886C4598af459f',
    riskEngine: '0x5BA68a018fF149c38ec52D181Dd24aBabE9a07DB',
    panopticPoolImpl: '0x9ac0317FCd124aFF0B5429Beb8de17020bc45F9a',
    collateralTrackerImpl: '0xFB1c06B491305d618bb8a7a368C6e50c001C153A',
    panopticFactory: '0xE0bcA80Dfa46c81682f085b6fBD94DEDc3DDcd7a',
    panopticHelper: '0x687F616d68c483A7223E6922F59Aef7452E26c1D',
    panopticQuery: '0xDdaCA435B8eA737Dc40941cC54df9c164078afC7',
    pool: {
      address: '0x09bc7ceab54607a35939e22ce935fD465191A532',
      token0: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // WETH
      token1: '0xFFFeD8254566B7F800f6D8CDb843ec75AE49B07A', // USDC
      fee: 500,
      tickSpacing: 10,
      collateralTracker0: '0x517056fc166fF3BEC361e532415CECba45061Ad6',
      collateralTracker1: '0x3618DD38a07E9f9ff1dD2E99F7d27e7082EE8AA5',
    },
  },
  tokens: {
    token0: {
      address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
      symbol: 'WETH',
      decimals: 18,
    },
    token1: {
      address: '0xFFFeD8254566B7F800f6D8CDb843ec75AE49B07A',
      symbol: 'USDC',
      decimals: 6,
    },
  },
  anvil: {
    port: 8545,
    host: '127.0.0.1',
  },
  testAccounts: {
    alice: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    bob: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    carol: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    dave: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    eve: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    frank: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  },
  testAddresses: {
    alice: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    bob: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    carol: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    dave: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    eve: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    frank: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
  },
}

const MAINNET_CONFIG: NetworkConfig = {
  network: 'mainnet',
  chain: mainnet,
  chainId: 1n,
  forkUrl: process.env.FORK_URL || 'https://eth.llamarpc.com',
  forkBlockNumber: process.env.FORK_BLOCK_NUMBER
    ? BigInt(process.env.FORK_BLOCK_NUMBER)
    : undefined,
  contracts: {
    // TODO: Fill in once Panoptic v2 is deployed on mainnet
    semifungiblePositionManager: '0x0000000000000000000000000000000000000000',
    builderFactory: '0x0000000000000000000000000000000000000000',
    riskEngine: '0x0000000000000000000000000000000000000000',
    panopticPoolImpl: '0x0000000000000000000000000000000000000000',
    collateralTrackerImpl: '0x0000000000000000000000000000000000000000',
    panopticFactory: '0x0000000000000000000000000000000000000000',
    panopticHelper: '0x0000000000000000000000000000000000000000',
    pool: {
      address: (process.env.TEST_POOL_ADDRESS ||
        '0x0000000000000000000000000000000000000000') as Address,
      token0: '0x0000000000000000000000000000000000000000',
      token1: '0x0000000000000000000000000000000000000000',
      fee: 0,
      tickSpacing: 0,
      collateralTracker0: '0x0000000000000000000000000000000000000000',
      collateralTracker1: '0x0000000000000000000000000000000000000000',
    },
  },
  tokens: {
    token0: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'TOKEN0',
      decimals: 18,
    },
    token1: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'TOKEN1',
      decimals: 18,
    },
  },
  anvil: {
    port: 8545,
    host: '127.0.0.1',
  },
  testAccounts: {
    alice: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    bob: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    carol: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    dave: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    eve: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    frank: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  },
  testAddresses: {
    alice: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    bob: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    carol: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    dave: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    eve: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    frank: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
  },
}

const NETWORK_CONFIGS: Record<SupportedNetwork, NetworkConfig> = {
  sepolia: SEPOLIA_CONFIG,
  mainnet: MAINNET_CONFIG,
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the current network from NETWORK env var
 * Defaults to 'sepolia' since it has active deployments
 */
export function getCurrentNetwork(): SupportedNetwork {
  const network = process.env.NETWORK || 'sepolia'
  if (network !== 'sepolia' && network !== 'mainnet') {
    throw new Error(`Unsupported network: ${network}. Use 'sepolia' or 'mainnet'.`)
  }
  return network
}

/**
 * Get configuration for the current network
 */
export function getNetworkConfig(): NetworkConfig {
  return NETWORK_CONFIGS[getCurrentNetwork()]
}

/**
 * Get configuration for a specific network
 */
export function getNetworkConfigFor(network: SupportedNetwork): NetworkConfig {
  return NETWORK_CONFIGS[network]
}

/**
 * Get Anvil RPC URL
 */
export function getAnvilRpcUrl(): string {
  const config = getNetworkConfig()
  return `http://${config.anvil.host}:${config.anvil.port}`
}

/**
 * Check if the current network has valid contract deployments
 */
export function hasValidDeployments(): boolean {
  const config = getNetworkConfig()
  return config.contracts.pool.address !== '0x0000000000000000000000000000000000000000'
}

/**
 * Assert that the current network has valid deployments
 * Throws if contracts are not deployed (zero address)
 */
export function assertValidDeployments(): void {
  if (!hasValidDeployments()) {
    const network = getCurrentNetwork()
    throw new Error(
      `Panoptic v2 is not deployed on ${network}. ` +
        `Set NETWORK=sepolia to run tests against Sepolia testnet.`,
    )
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

// Export current network config as default for easy access
const config = getNetworkConfig()

export const NETWORK = config.network
export const CHAIN = config.chain
export const CHAIN_ID = config.chainId
export const CONTRACTS = config.contracts
export const TOKENS = config.tokens
export const TEST_ACCOUNTS = config.testAccounts
export const TEST_ADDRESSES = config.testAddresses

// Re-export createTokenIdBuilder for convenience (takes poolId from getPool().poolId)
export { createTokenIdBuilder } from '../../tokenId'

// ABIs for token setup
const weth9Abi = parseAbi([
  'function deposit() payable',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

const mintableErc20Abi = parseAbi([
  'function mint(address _to, uint256 _amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

/**
 * Setup parameters for funding test accounts
 */
export interface FundingParams {
  /** Public client for reading */
  client: PublicClient
  /** Wallet client for transactions */
  walletClient: WalletClient
  /** Account address being funded */
  account: Address
  /** Amount of token0 to fund (in smallest unit) */
  token0Amount?: bigint
  /** Amount of token1 to fund (in smallest unit) */
  token1Amount?: bigint
  /** Whether to approve collateral trackers */
  approveCollateral?: boolean
}

/**
 * Wrap ETH to WETH (for networks where token0 is WETH)
 */
export async function wrapEthToWeth(params: {
  walletClient: WalletClient
  account: Address
  amount: bigint
}): Promise<`0x${string}`> {
  const { walletClient, account, amount } = params
  const networkConfig = getNetworkConfig()

  const hash = await walletClient.writeContract({
    address: networkConfig.tokens.token0.address,
    abi: weth9Abi,
    functionName: 'deposit',
    value: amount,
    account,
    chain: networkConfig.chain,
  })

  return hash
}

/**
 * Mint test tokens (for testnets with mintable tokens)
 */
export async function mintTestToken(params: {
  walletClient: WalletClient
  account: Address
  tokenAddress: Address
  to: Address
  amount: bigint
}): Promise<`0x${string}`> {
  const { walletClient, account, tokenAddress, to, amount } = params
  const networkConfig = getNetworkConfig()

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: mintableErc20Abi,
    functionName: 'mint',
    args: [to, amount],
    account,
    chain: networkConfig.chain,
  })

  return hash
}

/**
 * Approve collateral tracker to spend tokens
 */
export async function approveCollateralTracker(params: {
  walletClient: WalletClient
  account: Address
  tokenAddress: Address
  collateralTrackerAddress: Address
  amount: bigint
}): Promise<`0x${string}`> {
  const { walletClient, account, tokenAddress, collateralTrackerAddress, amount } = params
  const networkConfig = getNetworkConfig()

  // Use appropriate ABI based on token (WETH vs ERC20)
  const abi =
    tokenAddress.toLowerCase() === networkConfig.tokens.token0.address.toLowerCase()
      ? weth9Abi
      : mintableErc20Abi

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi,
    functionName: 'approve',
    args: [collateralTrackerAddress, amount],
    account,
    chain: networkConfig.chain,
  })

  return hash
}

/**
 * Fund a test account with tokens for fork testing.
 *
 * On Sepolia:
 * - Wraps ETH to WETH using WETH9.deposit()
 * - Mints USDC using the test USDC contract's mint() function
 * - Optionally approves collateral trackers to spend tokens
 *
 * @example
 * ```typescript
 * await fundTestAccount({
 *   client,
 *   walletClient,
 *   account: aliceAddress,
 *   token0Amount: parseUnits('10', 18),  // 10 WETH
 *   token1Amount: parseUnits('10000', 6), // 10,000 USDC
 *   approveCollateral: true,
 * })
 * ```
 */
export async function fundTestAccount(params: FundingParams): Promise<{
  token0Balance: bigint
  token1Balance: bigint
}> {
  const networkConfig = getNetworkConfig()
  const {
    client,
    walletClient,
    account,
    token0Amount = 0n,
    token1Amount = 0n,
    approveCollateral = true,
  } = params

  // 1. Fund token0 (WETH on Sepolia - wrap ETH)
  if (token0Amount > 0n) {
    const wrapHash = await wrapEthToWeth({ walletClient, account, amount: token0Amount })
    await client.waitForTransactionReceipt({ hash: wrapHash })
  }

  // 2. Fund token1 (mintable on Sepolia)
  if (token1Amount > 0n) {
    const mintHash = await mintTestToken({
      walletClient,
      account,
      tokenAddress: networkConfig.tokens.token1.address,
      to: account,
      amount: token1Amount,
    })
    await client.waitForTransactionReceipt({ hash: mintHash })
  }

  // 3. Approve collateral trackers if requested
  if (approveCollateral) {
    const maxApproval = 2n ** 256n - 1n // MaxUint256

    // Approve token0 for collateralTracker0
    if (token0Amount > 0n) {
      const approveToken0Hash = await approveCollateralTracker({
        walletClient,
        account,
        tokenAddress: networkConfig.tokens.token0.address,
        collateralTrackerAddress: networkConfig.contracts.pool.collateralTracker0,
        amount: maxApproval,
      })
      await client.waitForTransactionReceipt({ hash: approveToken0Hash })
    }

    // Approve token1 for collateralTracker1
    if (token1Amount > 0n) {
      const approveToken1Hash = await approveCollateralTracker({
        walletClient,
        account,
        tokenAddress: networkConfig.tokens.token1.address,
        collateralTrackerAddress: networkConfig.contracts.pool.collateralTracker1,
        amount: maxApproval,
      })
      await client.waitForTransactionReceipt({ hash: approveToken1Hash })
    }
  }

  // 4. Return final balances
  const [token0Balance, token1Balance] = await Promise.all([
    client.readContract({
      address: networkConfig.tokens.token0.address,
      abi: weth9Abi,
      functionName: 'balanceOf',
      args: [account],
    }),
    client.readContract({
      address: networkConfig.tokens.token1.address,
      abi: mintableErc20Abi,
      functionName: 'balanceOf',
      args: [account],
    }),
  ])

  return { token0Balance, token1Balance }
}
