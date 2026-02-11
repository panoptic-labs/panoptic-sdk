/**
 * Transaction broadcaster utilities for the Panoptic v2 SDK.
 * @module v2/writes/broadcaster
 */

import type { Address, Hash, PublicClient, WalletClient } from 'viem'

import type { NonceManager, TxBroadcaster } from '../types'

/**
 * Create a public broadcaster that sends transactions to the standard mempool.
 *
 * Use this factory to create a working broadcaster with a client.
 *
 * @param client - The public client for broadcasting
 * @returns A TxBroadcaster that sends to the public mempool
 *
 * @example
 * ```typescript
 * const broadcaster = createPublicBroadcaster(publicClient)
 * const hash = await broadcaster.broadcast(signedTx)
 * ```
 */
export function createPublicBroadcaster(client: PublicClient): TxBroadcaster {
  return {
    async broadcast(signedTx: `0x${string}`): Promise<Hash> {
      return client.sendRawTransaction({ serializedTransaction: signedTx })
    },
  }
}

/**
 * Default public broadcaster singleton.
 *
 * Note: This singleton requires a client to be provided via the broadcast call's context.
 * For standalone usage, use `createPublicBroadcaster(client)` instead.
 *
 * When used with write functions, the SDK handles client injection automatically.
 */
export const publicBroadcaster: TxBroadcaster = {
  async broadcast(signedTx: `0x${string}`): Promise<Hash> {
    // This singleton cannot broadcast without a client.
    // Write functions that use this broadcaster should inject their client.
    throw new Error(
      'publicBroadcaster requires a client. Use createPublicBroadcaster(client) for standalone usage.',
    )
  },
}

/**
 * Create a nonce manager for concurrent transaction submission.
 *
 * The nonce manager tracks pending nonces to allow multiple transactions
 * to be submitted without waiting for confirmation.
 *
 * @param client - The public client for querying nonces
 * @returns A NonceManager instance
 *
 * @example
 * ```typescript
 * const nonceManager = createNonceManager(client)
 * const nonce1 = await nonceManager.getNextNonce(account)
 * const nonce2 = await nonceManager.getNextNonce(account) // nonce1 + 1
 * // On failure, reset to re-fetch from chain:
 * nonceManager.reset(account)
 * ```
 */
export function createNonceManager(client: PublicClient): NonceManager {
  const pendingNonces = new Map<Address, bigint>()

  return {
    async getNextNonce(account: Address): Promise<bigint> {
      const chainNonce = BigInt(
        await client.getTransactionCount({
          address: account,
          blockTag: 'pending',
        }),
      )

      const pending = pendingNonces.get(account)
      const localNext = pending !== undefined ? pending + 1n : chainNonce
      const nextNonce = localNext > chainNonce ? localNext : chainNonce

      pendingNonces.set(account, nextNonce)
      return nextNonce
    },

    reset(account: Address): void {
      pendingNonces.delete(account)
    },
  }
}

/**
 * Configuration for write operations.
 */
export interface WriteConfig {
  /** Wallet client for signing and submitting transactions */
  walletClient: WalletClient
  /** Public client for reading state */
  publicClient: PublicClient
  /** Optional custom broadcaster */
  broadcaster?: TxBroadcaster
  /** Optional nonce manager for concurrent transactions */
  nonceManager?: NonceManager
  /** Gas price multiplier (1.0 = no change, 1.1 = 10% increase) */
  gasPriceMultiplier?: number
  /** Optional gas limit override */
  gasLimit?: bigint
}
