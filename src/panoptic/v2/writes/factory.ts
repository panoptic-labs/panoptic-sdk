/**
 * Factory write functions for the Panoptic v2 SDK.
 * @module v2/writes/factory
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticFactoryV3Abi, panopticFactoryV4Abi } from '../../../generated'
import type { PoolKey, TxOverrides, TxResult } from '../types'
import { submitWrite } from './utils'

interface DeployNewPoolCommon {
  /** Public client */
  client: PublicClient
  /** Wallet client for signing */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticFactory address */
  factoryAddress: Address
  /** Risk engine address */
  riskEngine: Address
  /** Salt (uint96) */
  salt: bigint
  /** Optional transaction overrides */
  txOverrides?: TxOverrides
}

export interface DeployNewPoolV3Params extends DeployNewPoolCommon {
  /** Token 0 address */
  token0: Address
  /** Token 1 address */
  token1: Address
  /** Fee tier (uint24) */
  fee: bigint
}

export interface DeployNewPoolV4Params extends DeployNewPoolCommon {
  /** V4 pool key */
  poolKey: PoolKey
}

export type DeployNewPoolParams =
  | ({ version: 'v3' } & DeployNewPoolV3Params)
  | ({ version: 'v4' } & DeployNewPoolV4Params)

/**
 * Deploy a new Panoptic pool via the factory.
 *
 * @param params - Deployment parameters (versioned: 'v3' or 'v4')
 * @returns Transaction result with hash and wait function
 */
export async function deployNewPool(params: DeployNewPoolParams): Promise<TxResult> {
  const { client, walletClient, account, factoryAddress, riskEngine, salt, txOverrides } = params

  if (params.version === 'v3') {
    return submitWrite({
      client,
      walletClient,
      account,
      address: factoryAddress,
      abi: panopticFactoryV3Abi,
      functionName: 'deployNewPool',
      args: [params.token0, params.token1, params.fee, riskEngine, salt],
      txOverrides,
    })
  }

  return submitWrite({
    client,
    walletClient,
    account,
    address: factoryAddress,
    abi: panopticFactoryV4Abi,
    functionName: 'deployNewPool',
    args: [
      {
        currency0: params.poolKey.currency0,
        currency1: params.poolKey.currency1,
        fee: Number(params.poolKey.fee),
        tickSpacing: Number(params.poolKey.tickSpacing),
        hooks: params.poolKey.hooks,
      },
      riskEngine,
      salt,
    ],
    txOverrides,
  })
}

/**
 * Deploy a new Panoptic pool and wait for confirmation.
 */
export async function deployNewPoolAndWait(params: DeployNewPoolParams) {
  const result = await deployNewPool(params)
  return result.wait()
}
