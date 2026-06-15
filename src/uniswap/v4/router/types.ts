/**
 * Parameter and return types for the Uniswap v4 Universal Router swap path.
 * @module uniswap/v4/router/types
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import type { PoolKey, TxOverrides } from '../../../panoptic/v2/types'
import type { UniswapV4Addresses } from '../addresses'

/**
 * Parameters for {@link swapExactInViaRouter}.
 */
export interface SwapExactInViaRouterParams {
  /** Public client for reads + receipts. */
  client: PublicClient
  /** Wallet client for signing. */
  walletClient: WalletClient
  /** Account address. */
  account: Address
  /** PanopticPool address — used to resolve the underlying v4 PoolKey. */
  poolAddress: Address
  /** Chain ID (selects per-chain Uniswap v4 addresses). */
  chainId: bigint
  /** Token to sell. `address(0)` (zero address) for native ETH. */
  tokenIn: Address
  /** Exact amount of `tokenIn` to spend (must fit uint128). */
  amountIn: bigint
  /** Slippage tolerance in bps (e.g. 500n = 5%). */
  slippageBps: bigint
  /** Absolute deadline (unix seconds). If omitted, derived from block timestamp. */
  deadline?: bigint
  /** Recipient of the output. Defaults to `account`. */
  recipient?: Address
  /** Gas and transaction overrides. */
  txOverrides?: TxOverrides
  /** Override per-chain Uniswap v4 addresses (e.g. fork tests). */
  addresses?: Partial<UniswapV4Addresses>
}

/**
 * Parameters for {@link quoteSwapExactInViaRouter}.
 */
export interface QuoteSwapExactInViaRouterParams {
  /** Public client. */
  client: PublicClient
  /** PanopticPool address — used to resolve the underlying v4 PoolKey. */
  poolAddress: Address
  /** Chain ID. */
  chainId: bigint
  /** Token to sell. `address(0)` for native ETH. */
  tokenIn: Address
  /** Exact amount of `tokenIn` to spend (must fit uint128). */
  amountIn: bigint
  /** Slippage tolerance in bps (used to compute `amountOutMinimum`). */
  slippageBps: bigint
  /** Optional block number for the quote. */
  blockNumber?: bigint
  /** Override per-chain Uniswap v4 addresses (e.g. fork tests). */
  addresses?: Partial<UniswapV4Addresses>
}

/**
 * Quote result data (carried inside a `SimulationResult`).
 */
export interface SwapExactInQuote {
  /** Quoted output amount of `tokenOut`. */
  amountOut: bigint
  /** Minimum acceptable output after applying slippage. */
  amountOutMinimum: bigint
  /** Whether the swap goes currency0 → currency1. */
  zeroForOne: boolean
  /** Output token address (`address(0)` for native ETH). */
  tokenOut: Address
  /** Resolved v4 PoolKey (reused by the swap calldata builder). */
  poolKey: PoolKey
  /** Quoter's gas estimate. */
  gasEstimate: bigint
}

/**
 * Parameters for {@link swapExactOutViaRouter}.
 */
export interface SwapExactOutViaRouterParams {
  /** Public client for reads + receipts. */
  client: PublicClient
  /** Wallet client for signing. */
  walletClient: WalletClient
  /** Account address. */
  account: Address
  /** PanopticPool address — used to resolve the underlying v4 PoolKey. */
  poolAddress: Address
  /** Chain ID (selects per-chain Uniswap v4 addresses). */
  chainId: bigint
  /** Token to sell (the pay token). `address(0)` (zero address) for native ETH. */
  tokenIn: Address
  /** Exact amount of the output token to receive (must fit uint128). */
  amountOut: bigint
  /** Slippage tolerance in bps (e.g. 500n = 5%); caps the input. */
  slippageBps: bigint
  /** Absolute deadline (unix seconds). If omitted, derived from block timestamp. */
  deadline?: bigint
  /** Recipient of the output. Defaults to `account`. */
  recipient?: Address
  /** Gas and transaction overrides. */
  txOverrides?: TxOverrides
  /** Override per-chain Uniswap v4 addresses (e.g. fork tests). */
  addresses?: Partial<UniswapV4Addresses>
}

/**
 * Parameters for {@link quoteSwapExactOutViaRouter}.
 */
export interface QuoteSwapExactOutViaRouterParams {
  /** Public client. */
  client: PublicClient
  /** PanopticPool address — used to resolve the underlying v4 PoolKey. */
  poolAddress: Address
  /** Chain ID. */
  chainId: bigint
  /** Token to sell (the pay token). `address(0)` for native ETH. */
  tokenIn: Address
  /** Exact amount of the output token to receive (must fit uint128). */
  amountOut: bigint
  /** Slippage tolerance in bps (used to compute `amountInMaximum`). */
  slippageBps: bigint
  /** Optional block number for the quote. */
  blockNumber?: bigint
  /** Override per-chain Uniswap v4 addresses (e.g. fork tests). */
  addresses?: Partial<UniswapV4Addresses>
}

/**
 * Quote result data for an exact-out swap (carried inside a `SimulationResult`).
 */
export interface SwapExactOutQuote {
  /** Quoted input amount of `tokenIn` required for the exact output. */
  amountIn: bigint
  /** Maximum acceptable input after applying slippage. */
  amountInMaximum: bigint
  /** Whether the swap goes currency0 → currency1. */
  zeroForOne: boolean
  /** Output token address (`address(0)` for native ETH). */
  tokenOut: Address
  /** Resolved v4 PoolKey (reused by the swap calldata builder). */
  poolKey: PoolKey
  /** Quoter's gas estimate. */
  gasEstimate: bigint
}

/**
 * Parameters for {@link checkRouterApproval}.
 */
export interface CheckRouterApprovalParams {
  /** Public client. */
  client: PublicClient
  /** Chain ID. */
  chainId: bigint
  /** ERC20 token being spent (must not be native ETH). */
  tokenIn: Address
  /** Token owner. */
  owner: Address
  /** Amount that must be spendable. */
  amount: bigint
  /** Override per-chain Uniswap v4 addresses (e.g. fork tests). */
  addresses?: Partial<UniswapV4Addresses>
}

/**
 * Result of {@link checkRouterApproval}.
 */
export interface RouterApprovalStatus {
  /** ERC20 → Permit2 allowance is insufficient. */
  needsErc20Approval: boolean
  /** Permit2 → Universal Router allowance is insufficient or expired. */
  needsPermit2Approval: boolean
  /** Current ERC20 → Permit2 allowance. */
  erc20Allowance: bigint
  /** Current Permit2 → router allowance amount. */
  permit2Amount: bigint
  /** Current Permit2 → router allowance expiration (unix seconds). */
  permit2Expiration: bigint
}

/**
 * Parameters for {@link approveErc20ForPermit2}.
 */
export interface ApproveErc20ForPermit2Params {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  chainId: bigint
  /** ERC20 token to approve to Permit2. */
  tokenIn: Address
  /** Amount to approve. Defaults to uint256 max. */
  amount?: bigint
  txOverrides?: TxOverrides
  addresses?: Partial<UniswapV4Addresses>
}

/**
 * Parameters for {@link approveRouterViaPermit2}.
 */
export interface ApproveRouterViaPermit2Params {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  chainId: bigint
  /** ERC20 token the router is allowed to spend via Permit2. */
  tokenIn: Address
  /** Amount to approve (must fit uint160). Defaults to uint160 max. */
  amount?: bigint
  /** Allowance expiration (unix seconds, uint48). If omitted, block timestamp + 30 days. */
  expiration?: bigint
  txOverrides?: TxOverrides
  addresses?: Partial<UniswapV4Addresses>
}
