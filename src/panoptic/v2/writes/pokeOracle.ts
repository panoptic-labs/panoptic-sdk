/**
 * Oracle poke function for the Panoptic v2 SDK.
 * @module v2/writes/pokeOracle
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { OracleRateLimitedError } from '../errors'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { submitWrite } from './utils'

/**
 * Parameters for poking the oracle.
 */
export interface PokeOracleParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Whether to check rate limit before calling (optional) */
  checkRateLimit?: boolean
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Poke the oracle to update its state.
 *
 * This function can be called to advance the oracle epoch.
 * Note: The oracle can only be poked once per epoch (64 seconds).
 *
 * @param params - Poke oracle parameters
 * @returns TxResult
 * @throws OracleRateLimitedError if checkRateLimit is true and oracle was recently poked
 *
 * @example
 * ```typescript
 * const result = await pokeOracle({
 *   client,
 *   walletClient,
 *   account,
 *   poolAddress,
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function pokeOracle(params: PokeOracleParams): Promise<TxResult> {
  const { client, walletClient, account, poolAddress, checkRateLimit = false, txOverrides } = params

  if (checkRateLimit) {
    // Check current oracle state to see if we can poke
    // Fetch oracle data and block in parallel
    const [oracleData, block] = await Promise.all([
      client.readContract({
        address: poolAddress,
        abi: panopticPoolAbi,
        functionName: 'getOracleTicks',
      }),
      client.getBlock(),
    ])

    // oracleData[4] is the oraclePack
    const oraclePack = oracleData[4]
    // Epoch is in bits 232-255 (24 bits)
    const epoch = oraclePack >> 232n

    const currentEpoch = block.timestamp / 64n

    // If current epoch equals oracle epoch, we can't poke yet
    if (currentEpoch <= epoch) {
      const lastUpdate = epoch * 64n
      throw new OracleRateLimitedError(lastUpdate, block.timestamp)
    }
  }

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'pokeOracle',
    args: [],
    txOverrides,
  })
}

/**
 * Poke oracle and wait for confirmation.
 */
export async function pokeOracleAndWait(params: PokeOracleParams): Promise<TxReceipt> {
  const result = await pokeOracle(params)
  return result.wait()
}
