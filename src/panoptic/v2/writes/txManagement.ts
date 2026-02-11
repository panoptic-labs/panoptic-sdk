/**
 * Transaction replacement utilities for the Panoptic v2 SDK.
 * Provides speedUp and cancel functionality for pending transactions.
 * @module v2/writes/txManagement
 */

import type { Address, Hash, PublicClient, WalletClient } from 'viem'

import type { TxBroadcaster, TxResult } from '../types'
import { createTxResult } from './utils'

/** Default gas price multiplier for replacement (12.5% bump = minimum for replacement) */
const DEFAULT_GAS_PRICE_MULTIPLIER = 1.125

/**
 * Parameters for speeding up a pending transaction.
 */
export interface SpeedUpParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Hash of the pending transaction to speed up */
  hash: Hash
  /** Explicit max fee per gas (overrides multiplier) */
  maxFeePerGas?: bigint
  /** Explicit max priority fee per gas (overrides multiplier) */
  maxPriorityFeePerGas?: bigint
  /** Multiplier for gas price bump (default 1.125 = 12.5%, minimum to replace) */
  gasPriceMultiplier?: number
  /** Custom broadcaster for MEV protection */
  broadcaster?: TxBroadcaster
}

/**
 * Parameters for cancelling a pending transaction.
 */
export interface CancelParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address (for self-transfer) */
  account: Address
  /** Hash of the pending transaction to cancel */
  hash: Hash
  /** Explicit max fee per gas (overrides multiplier) */
  maxFeePerGas?: bigint
  /** Explicit max priority fee per gas (overrides multiplier) */
  maxPriorityFeePerGas?: bigint
  /** Multiplier for gas price bump (default 1.125 = 12.5%, minimum to replace) */
  gasPriceMultiplier?: number
  /** Custom broadcaster for MEV protection */
  broadcaster?: TxBroadcaster
}

/**
 * Apply a multiplier to a bigint gas value.
 * Uses integer arithmetic to avoid floating point issues.
 */
function applyMultiplier(value: bigint, multiplier: number): bigint {
  // Convert multiplier to basis points (e.g., 1.125 => 11250)
  const bps = BigInt(Math.ceil(multiplier * 10000))
  return (value * bps) / 10000n
}

/**
 * Compute bumped gas parameters from the original transaction.
 */
function computeBumpedGas(
  originalMaxFeePerGas: bigint | undefined,
  originalMaxPriorityFeePerGas: bigint | undefined,
  explicitMaxFeePerGas: bigint | undefined,
  explicitMaxPriorityFeePerGas: bigint | undefined,
  multiplier: number,
): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const maxFeePerGas =
    explicitMaxFeePerGas ?? applyMultiplier(originalMaxFeePerGas ?? 0n, multiplier)

  const maxPriorityFeePerGas =
    explicitMaxPriorityFeePerGas ?? applyMultiplier(originalMaxPriorityFeePerGas ?? 0n, multiplier)

  return { maxFeePerGas, maxPriorityFeePerGas }
}

/**
 * Speed up a pending transaction by resubmitting with higher gas.
 *
 * Fetches the original transaction, extracts its parameters,
 * bumps the gas price, and resubmits with the same nonce.
 *
 * @param params - Speed up parameters
 * @returns TxResult for the replacement transaction
 * @throws Error if the original transaction is not found
 *
 * @example
 * ```typescript
 * // Speed up with default 12.5% bump
 * const result = await speedUpTransaction({
 *   client,
 *   walletClient,
 *   hash: pendingTxHash,
 * })
 *
 * // Speed up with explicit gas prices
 * const result = await speedUpTransaction({
 *   client,
 *   walletClient,
 *   hash: pendingTxHash,
 *   maxFeePerGas: 50_000_000_000n, // 50 gwei
 *   maxPriorityFeePerGas: 3_000_000_000n, // 3 gwei
 * })
 * ```
 */
export async function speedUpTransaction(params: SpeedUpParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    hash,
    maxFeePerGas: explicitMaxFee,
    maxPriorityFeePerGas: explicitMaxPriority,
    gasPriceMultiplier = DEFAULT_GAS_PRICE_MULTIPLIER,
    broadcaster,
  } = params

  const tx = await client.getTransaction({ hash })

  const { maxFeePerGas, maxPriorityFeePerGas } = computeBumpedGas(
    tx.maxFeePerGas ?? undefined,
    tx.maxPriorityFeePerGas ?? undefined,
    explicitMaxFee,
    explicitMaxPriority,
    gasPriceMultiplier,
  )

  if (broadcaster) {
    const request = await walletClient.prepareTransactionRequest({
      account: tx.from,
      to: tx.to ?? undefined,
      data: tx.input,
      value: tx.value,
      nonce: tx.nonce,
      gas: tx.gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      chain: walletClient.chain,
    })

    const signedTx = await walletClient.signTransaction({
      ...request,
      account: tx.from,
    } as unknown as Parameters<WalletClient['signTransaction']>[0])
    const replacementHash = await broadcaster.broadcast(signedTx)
    return createTxResult(client, replacementHash)
  }

  const replacementHash = await walletClient.sendTransaction({
    account: tx.from,
    to: tx.to ?? undefined,
    data: tx.input,
    value: tx.value,
    nonce: tx.nonce,
    gas: tx.gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chain: walletClient.chain,
  })

  return createTxResult(client, replacementHash)
}

/**
 * Cancel a pending transaction by sending a 0-value self-transfer
 * with the same nonce and higher gas price.
 *
 * @param params - Cancel parameters
 * @returns TxResult for the cancellation transaction
 * @throws Error if the original transaction is not found
 *
 * @example
 * ```typescript
 * const result = await cancelTransaction({
 *   client,
 *   walletClient,
 *   account,
 *   hash: pendingTxHash,
 * })
 * await result.wait()
 * ```
 */
export async function cancelTransaction(params: CancelParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    hash,
    maxFeePerGas: explicitMaxFee,
    maxPriorityFeePerGas: explicitMaxPriority,
    gasPriceMultiplier = DEFAULT_GAS_PRICE_MULTIPLIER,
    broadcaster,
  } = params

  const tx = await client.getTransaction({ hash })

  const { maxFeePerGas, maxPriorityFeePerGas } = computeBumpedGas(
    tx.maxFeePerGas ?? undefined,
    tx.maxPriorityFeePerGas ?? undefined,
    explicitMaxFee,
    explicitMaxPriority,
    gasPriceMultiplier,
  )

  if (broadcaster) {
    const request = await walletClient.prepareTransactionRequest({
      account,
      to: account,
      value: 0n,
      nonce: tx.nonce,
      gas: 21000n,
      maxFeePerGas,
      maxPriorityFeePerGas,
      chain: walletClient.chain,
    })

    const signedTx = await walletClient.signTransaction({
      ...request,
      account,
    } as unknown as Parameters<WalletClient['signTransaction']>[0])
    const cancelHash = await broadcaster.broadcast(signedTx)
    return createTxResult(client, cancelHash)
  }

  const cancelHash = await walletClient.sendTransaction({
    account,
    to: account,
    value: 0n,
    nonce: tx.nonce,
    gas: 21000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chain: walletClient.chain,
  })

  return createTxResult(client, cancelHash)
}
