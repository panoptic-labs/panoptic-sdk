/**
 * Transaction types for the Panoptic v2 SDK.
 * @module v2/types/tx
 */

import type { Address, Hash } from 'viem'

import type { PanopticEvent } from './events'

/**
 * Transaction result returned by write functions.
 * Provides immediate access to hash and a wait function for confirmation.
 */
export interface TxResult {
  /** Transaction hash, available immediately */
  hash: Hash
  /** Wait for transaction confirmation */
  wait: (confirmations?: bigint) => Promise<TxReceipt>
}

/**
 * Transaction result with receipt already awaited.
 * Returned by *AndWait convenience functions.
 */
export interface TxResultWithReceipt extends TxResult {
  /** The transaction receipt */
  receipt: TxReceipt
}

/**
 * Transaction receipt after confirmation.
 */
export interface TxReceipt {
  /** Transaction hash */
  hash: Hash
  /** Block number */
  blockNumber: bigint
  /** Block hash */
  blockHash: Hash
  /** Gas used */
  gasUsed: bigint
  /** Transaction status */
  status: 'success' | 'reverted'
  /** Parsed Panoptic events from the transaction */
  events: PanopticEvent[]
}

/**
 * Transaction broadcaster interface for private transaction support.
 * Allows plugging in Flashbots or other MEV protection services.
 */
export interface TxBroadcaster {
  /**
   * Broadcast a signed transaction.
   * @param signedTx - The signed transaction bytes
   * @returns The transaction hash
   */
  broadcast: (signedTx: `0x${string}`) => Promise<Hash>
}

/**
 * Gas and transaction overrides for write operations.
 * Supports EIP-1559 gas parameters, explicit nonce, and custom broadcasters.
 */
export interface TxOverrides {
  /** EIP-1559 max fee per gas */
  maxFeePerGas?: bigint
  /** EIP-1559 max priority fee per gas (tip) */
  maxPriorityFeePerGas?: bigint
  /** Gas limit override */
  gas?: bigint
  /** Explicit nonce (for concurrent tx submission) */
  nonce?: bigint
  /** Custom broadcaster for MEV protection (Flashbots, private mempool) */
  broadcaster?: TxBroadcaster
}

/**
 * Nonce manager for concurrent transaction submission.
 */
export interface NonceManager {
  /** Get the next nonce for an account */
  getNextNonce: (account: Address) => Promise<bigint>
  /** Reset nonce tracking (e.g., after failure) */
  reset: (account: Address) => void
}

/**
 * Dispatch call for raw multi-operation transactions.
 */
export interface DispatchCall {
  /** TokenId to operate on */
  tokenId: bigint
  /** Position size change (positive = mint, negative = burn) */
  positionSize: bigint
  /** Whether this is a long (true) or short (false) */
  isLong: boolean
  /** Recipient address (usually the sender) */
  recipient?: Address
}
