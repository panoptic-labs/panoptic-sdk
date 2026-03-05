/**
 * Factory write functions for the Panoptic v2 SDK.
 * @module v2/writes/factory
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticFactoryAbi } from '../../../generated'
import type { PoolKey, TxOverrides, TxResult } from '../types'
import { submitWrite } from './utils'

/**
 * Parameters for deploying a new Panoptic pool.
 */
export interface DeployNewPoolParams {
  /** Public client */
  client: PublicClient
  /** Wallet client for signing */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticFactory address */
  factoryAddress: Address
  /** V4 pool key */
  poolKey: PoolKey
  /** Risk engine address */
  riskEngine: Address
  /** Salt (uint96) */
  salt: bigint
  /** Optional transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Deploy a new Panoptic pool via the factory.
 *
 * @param params - Deployment parameters
 * @returns Transaction result with hash and wait function
 */
export async function deployNewPool(params: DeployNewPoolParams): Promise<TxResult> {
  const { client, walletClient, account, factoryAddress, poolKey, riskEngine, salt, txOverrides } =
    params

  return submitWrite({
    client,
    walletClient,
    account,
    address: factoryAddress,
    abi: panopticFactoryAbi,
    functionName: 'deployNewPool',
    args: [
      {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: poolKey.hooks,
      },
      riskEngine,
      salt,
    ],
    txOverrides,
  })
}

/**
 * Deploy a new Panoptic pool and wait for confirmation.
 *
 * @param params - Deployment parameters
 * @returns Transaction receipt
 */
export async function deployNewPoolAndWait(params: DeployNewPoolParams) {
  const result = await deployNewPool(params)
  return result.wait()
}
