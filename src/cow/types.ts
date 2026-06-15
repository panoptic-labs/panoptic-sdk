/**
 * Parameter and return types for the CoW Protocol swap path.
 * @module cow/types
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'

import type { TxOverrides } from '../panoptic/v2/types'

/** Order kind: 'sell' = exact-in, 'buy' = exact-out. */
export type CowOrderKind = 'sell' | 'buy'

/** Order-book lifecycle states. */
export type CowOrderStatus = 'presignaturePending' | 'open' | 'fulfilled' | 'cancelled' | 'expired'

/** Parameters for {@link quoteCowSwap}. */
export interface QuoteCowSwapParams {
  /** Chain ID (selects the order-book API). */
  chainId: bigint
  /** ERC20 token to sell (native ETH not supported). */
  sellToken: Address
  /** Token to buy. The zero address (native ETH) maps to the CoW buy sentinel. */
  buyToken: Address
  /** 'sell' = exact-in (amount is sellAmountBeforeFee), 'buy' = exact-out (amount is buyAmountAfterFee). */
  kind: CowOrderKind
  /** Exact amount being quoted (see `kind`). */
  amount: bigint
  /** Order owner — the API validates balances/fees against this account. */
  from: Address
  /** Slippage tolerance in bps applied to the signed limit amounts. */
  slippageBps: bigint
  /** Order validity window in seconds (drives `validTo`). Defaults to 30 minutes. */
  validForSeconds?: bigint
  /** Override the order-book API base URL (e.g. tests). */
  apiUrl?: string
}

/**
 * Quote result data (carried inside a `SimulationResult`).
 *
 * `orderSellAmount`/`orderBuyAmount` are the limit amounts to sign: fee folded
 * into the sell side (`feeAmount` is signed as 0 per the current fee model)
 * and slippage applied to the non-exact side.
 */
export interface CowQuote {
  kind: CowOrderKind
  sellToken: Address
  buyToken: Address
  /** Quoted sell amount, excluding fee. */
  sellAmount: bigint
  /** Quoted buy amount (net). */
  buyAmount: bigint
  /** Quoted protocol fee, in the sell token. */
  feeAmount: bigint
  /** Total sell-token outflow at the quoted price (sellAmount + feeAmount). */
  sellAmountTotal: bigint
  /** Sell amount to sign (sell orders: gross; buy orders: slippage-padded max). */
  orderSellAmount: bigint
  /** Buy amount to sign (sell orders: slippage-reduced min; buy orders: exact). */
  orderBuyAmount: bigint
  /** Order expiry (unix seconds, uint32). */
  validTo: bigint
  /** Order-book quote id, echoed on order submission for tracing. */
  quoteId: number | null
}

/** Parameters for {@link signAndSubmitCowOrder}. */
export interface SignAndSubmitCowOrderParams {
  walletClient: WalletClient
  /** Order owner (signer). */
  account: Address
  chainId: bigint
  /** Quote to turn into a signed order. */
  quote: CowQuote
  /** Recipient of the buy token. Defaults to `account`. */
  receiver?: Address
  /** Override the order-book API base URL (e.g. tests). */
  apiUrl?: string
}

/** Result of posting an order: the order-book UID (not a tx hash). */
export interface CowOrderResult {
  orderUid: Hex
}

/** Parameters for {@link cancelCowOrder}. */
export interface CancelCowOrderParams {
  walletClient: WalletClient
  account: Address
  chainId: bigint
  orderUid: Hex
  apiUrl?: string
}

/** Parameters for {@link getCowOrderStatus}. */
export interface GetCowOrderStatusParams {
  chainId: bigint
  orderUid: Hex
  apiUrl?: string
}

/** Result of {@link getCowOrderStatus}. */
export interface CowOrderState {
  status: CowOrderStatus
  /** Cumulative executed amounts (partial fills included). */
  executedSellAmount: bigint
  executedBuyAmount: bigint
  /** Settlement tx hash, available once at least one trade has executed. */
  settlementTxHash?: Hex
}

/** Parameters for {@link checkCowApproval}. */
export interface CheckCowApprovalParams {
  client: PublicClient
  /** ERC20 token being sold. */
  sellToken: Address
  /** Token owner. */
  owner: Address
  /** Amount that must be spendable by the vault relayer. */
  amount: bigint
}

/** Result of {@link checkCowApproval}. */
export interface CowApprovalStatus {
  needsApproval: boolean
  /** Current ERC20 → VaultRelayer allowance. */
  allowance: bigint
}

/** Parameters for {@link approveErc20ForCow}. */
export interface ApproveErc20ForCowParams {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  /** ERC20 token to approve to the vault relayer. */
  sellToken: Address
  /** Amount to approve. Defaults to uint256 max. */
  amount?: bigint
  txOverrides?: TxOverrides
}
