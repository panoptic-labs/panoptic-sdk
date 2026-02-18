/**
 * Sepolia fork configuration for integration testing
 *
 * Uses deployed Panoptic v2 contracts on Sepolia testnet.
 * Run with: anvil --fork-url $SEPOLIA_RPC_URL
 *
 * @module examples/__tests__/sepolia.config
 */

import type { Address, PublicClient, WalletClient } from 'viem'
import { parseAbi, parseUnits } from 'viem'
import { sepolia } from 'viem/chains'

/**
 * Sepolia Panoptic v2 deployment addresses
 */
export const SEPOLIA_CONTRACTS = {
  // Protocol contracts
  semifungiblePositionManager: '0x8bbCE8B1eB64118CFE6c1eAb0afe13b80EA41481' as Address,
  builderFactory: '0x34B3a4e4F14f292575ECe3EF67886C4598af459f' as Address,
  riskEngine: '0x5BA68a018fF149c38ec52D181Dd24aBabE9a07DB' as Address,
  panopticPoolImpl: '0x9ac0317FCd124aFF0B5429Beb8de17020bc45F9a' as Address,
  collateralTrackerImpl: '0xFB1c06B491305d618bb8a7a368C6e50c001C153A' as Address,
  panopticFactory: '0xE0bcA80Dfa46c81682f085b6fBD94DEDc3DDcd7a' as Address,
  /** @deprecated Use panopticQuery instead */
  panopticHelper: '0x687F616d68c483A7223E6922F59Aef7452E26c1D' as Address,
  panopticQuery: '0xDdaCA435B8eA737Dc40941cC54df9c164078afC7' as Address,

  // WETH/USDC 500 pool
  pool: {
    address: '0x09bc7ceab54607a35939e22ce935fD465191A532' as Address,
    token0: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' as Address, // WETH
    token1: '0xFFFeD8254566B7F800f6D8CDb843ec75AE49B07A' as Address, // USDC
    fee: 500,
    tickSpacing: 10,
    collateralTracker0: '0x517056fc166fF3BEC361e532415CECba45061Ad6' as Address,
    collateralTracker1: '0x3618DD38a07E9f9ff1dD2E99F7d27e7082EE8AA5' as Address,
  },
} as const

/**
 * Anvil fork configuration for Sepolia
 */
export const SEPOLIA_ANVIL_CONFIG = {
  /**
   * Fork URL - Sepolia RPC endpoint
   * Set SEPOLIA_RPC_URL environment variable
   */
  forkUrl: process.env.SEPOLIA_RPC_URL || '',

  /**
   * Chain ID for Sepolia
   */
  chainId: 11155111n,

  /**
   * Anvil server configuration
   */
  anvilPort: 8545,
  anvilHost: '127.0.0.1',

  /**
   * Test account private keys (Anvil defaults)
   * These accounts have 10,000 ETH each on Anvil
   */
  testAccounts: {
    // Anvil account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
    alice: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
    // Anvil account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
    bob: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`,
    // Anvil account #2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
    carol: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as `0x${string}`,
    // Anvil account #3: 0x90F79bf6EB2c4f870365E785982E1f101E93b906
    dave: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as `0x${string}`,
    // Anvil account #4: 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
    eve: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' as `0x${string}`,
    // Anvil account #5: 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
    frank: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as `0x${string}`,
  },

  /**
   * Derived test account addresses
   */
  testAddresses: {
    alice: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    bob: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
    carol: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address,
    dave: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address,
    eve: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as Address,
    frank: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc' as Address,
  },
} as const

/**
 * Get Anvil RPC URL
 */
export function getAnvilRpcUrl(): string {
  return `http://${SEPOLIA_ANVIL_CONFIG.anvilHost}:${SEPOLIA_ANVIL_CONFIG.anvilPort}`
}

/**
 * Token metadata for formatting
 */
export const SEPOLIA_TOKENS = {
  WETH: {
    address: SEPOLIA_CONTRACTS.pool.token0,
    symbol: 'WETH',
    decimals: 18,
  },
  USDC: {
    address: SEPOLIA_CONTRACTS.pool.token1,
    symbol: 'USDC',
    decimals: 6, // USDC typically has 6 decimals
  },
} as const

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
export interface SepoliaFundingParams {
  /** Public client for reading */
  client: PublicClient
  /** Wallet client for transactions */
  walletClient: WalletClient
  /** Account address being funded */
  account: Address
  /** Amount of WETH to wrap (in wei) */
  wethAmount?: bigint
  /** Amount of USDC to mint (in USDC units, 6 decimals) */
  usdcAmount?: bigint
  /** Whether to approve collateral trackers */
  approveCollateral?: boolean
}

/**
 * Wrap ETH to WETH on Sepolia
 * Uses WETH9 contract's deposit() function
 */
export async function wrapEthToWeth(params: {
  walletClient: WalletClient
  account: Address
  amount: bigint
}): Promise<`0x${string}`> {
  const { walletClient, account, amount } = params

  const hash = await walletClient.writeContract({
    address: SEPOLIA_TOKENS.WETH.address,
    abi: weth9Abi,
    functionName: 'deposit',
    value: amount,
    account,
    chain: sepolia,
  })

  return hash
}

/**
 * Mint USDC on Sepolia (test USDC has public mint function)
 */
export async function mintUsdc(params: {
  walletClient: WalletClient
  account: Address
  to: Address
  amount: bigint
}): Promise<`0x${string}`> {
  const { walletClient, account, to, amount } = params

  const hash = await walletClient.writeContract({
    address: SEPOLIA_TOKENS.USDC.address,
    abi: mintableErc20Abi,
    functionName: 'mint',
    args: [to, amount],
    account,
    chain: sepolia,
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

  const abi = tokenAddress === SEPOLIA_TOKENS.WETH.address ? weth9Abi : mintableErc20Abi

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi,
    functionName: 'approve',
    args: [collateralTrackerAddress, amount],
    account,
    chain: sepolia,
  })

  return hash
}

/**
 * Fund a test account with WETH and USDC for Sepolia fork testing.
 *
 * - Wraps ETH to WETH using WETH9.deposit()
 * - Mints USDC using the test USDC contract's mint() function
 * - Optionally approves collateral trackers to spend tokens
 *
 * @example
 * ```typescript
 * await fundSepoliaTestAccount({
 *   client,
 *   walletClient,
 *   account: aliceAddress,
 *   wethAmount: parseUnits('10', 18),  // 10 WETH
 *   usdcAmount: parseUnits('10000', 6), // 10,000 USDC
 *   approveCollateral: true,
 * })
 * ```
 */
export async function fundSepoliaTestAccount(params: SepoliaFundingParams): Promise<{
  wethBalance: bigint
  usdcBalance: bigint
}> {
  const {
    client,
    walletClient,
    account,
    wethAmount = parseUnits('10', 18), // Default: 10 WETH
    usdcAmount = parseUnits('10000', 6), // Default: 10,000 USDC
    approveCollateral = true,
  } = params

  // 1. Wrap ETH to WETH
  if (wethAmount > 0n) {
    const wrapHash = await wrapEthToWeth({ walletClient, account, amount: wethAmount })
    await client.waitForTransactionReceipt({ hash: wrapHash })
  }

  // 2. Mint USDC
  if (usdcAmount > 0n) {
    const mintHash = await mintUsdc({ walletClient, account, to: account, amount: usdcAmount })
    await client.waitForTransactionReceipt({ hash: mintHash })
  }

  // 3. Approve collateral trackers if requested
  if (approveCollateral) {
    const maxApproval = 2n ** 256n - 1n // MaxUint256

    // Approve WETH for collateralTracker0
    if (wethAmount > 0n) {
      const approveWethHash = await approveCollateralTracker({
        walletClient,
        account,
        tokenAddress: SEPOLIA_TOKENS.WETH.address,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker0,
        amount: maxApproval,
      })
      await client.waitForTransactionReceipt({ hash: approveWethHash })
    }

    // Approve USDC for collateralTracker1
    if (usdcAmount > 0n) {
      const approveUsdcHash = await approveCollateralTracker({
        walletClient,
        account,
        tokenAddress: SEPOLIA_TOKENS.USDC.address,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker1,
        amount: maxApproval,
      })
      await client.waitForTransactionReceipt({ hash: approveUsdcHash })
    }
  }

  // 4. Return final balances
  const [wethBalance, usdcBalance] = await Promise.all([
    client.readContract({
      address: SEPOLIA_TOKENS.WETH.address,
      abi: weth9Abi,
      functionName: 'balanceOf',
      args: [account],
    }),
    client.readContract({
      address: SEPOLIA_TOKENS.USDC.address,
      abi: mintableErc20Abi,
      functionName: 'balanceOf',
      args: [account],
    }),
  ])

  return { wethBalance, usdcBalance }
}
