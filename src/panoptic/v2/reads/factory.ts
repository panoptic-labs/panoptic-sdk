/**
 * Factory read functions for the Panoptic v2 SDK.
 *
 * Reads from the PanopticFactory contract (V2 only).
 *
 * @module v2/reads/factory
 */

import type { Address, PublicClient } from 'viem'

import { panopticFactoryAbi } from '../../../generated'
import type { PoolKey } from '../types'

/**
 * Parameters for getPanopticPoolAddress.
 */
export interface GetPanopticPoolAddressParams {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** V4 pool key */
  poolKey: PoolKey
  /** Risk engine address */
  riskEngine: Address
}

/**
 * Get the PanopticPool address for a given pool key and risk engine.
 *
 * @param params - Read parameters
 * @returns The PanopticPool address
 */
export async function getPanopticPoolAddress(
  params: GetPanopticPoolAddressParams,
): Promise<Address> {
  const { client, factoryAddress, poolKey, riskEngine } = params

  return client.readContract({
    address: factoryAddress,
    abi: panopticFactoryAbi,
    functionName: 'getPanopticPool',
    args: [
      {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: poolKey.hooks,
      },
      riskEngine,
    ],
  })
}

/**
 * Parameters for getFactoryTokenURI.
 */
export interface GetFactoryTokenURIParams {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** Token ID (encoded pool address) */
  tokenId: bigint
}

/**
 * Get the token URI from the PanopticFactory NFT.
 *
 * @param params - Read parameters
 * @returns The token URI string
 */
export async function getFactoryTokenURI(params: GetFactoryTokenURIParams): Promise<string> {
  const { client, factoryAddress, tokenId } = params

  return client.readContract({
    address: factoryAddress,
    abi: panopticFactoryAbi,
    functionName: 'tokenURI',
    args: [tokenId],
  })
}

/**
 * Parameters for getFactoryOwnerOf.
 */
export interface GetFactoryOwnerOfParams {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** Token ID (encoded pool address) */
  tokenId: bigint
}

/**
 * Get the owner of a PanopticFactory NFT.
 *
 * @param params - Read parameters
 * @returns The owner address
 */
export async function getFactoryOwnerOf(params: GetFactoryOwnerOfParams): Promise<Address> {
  const { client, factoryAddress, tokenId } = params

  return client.readContract({
    address: factoryAddress,
    abi: panopticFactoryAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  })
}

/**
 * Parameters for minePoolAddress.
 */
export interface MinePoolAddressParams {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** Deployer address (msg.sender for deployment) */
  deployerAddress: Address
  /** V4 pool key */
  poolKey: PoolKey
  /** Risk engine address */
  riskEngine: Address
  /** Starting salt (uint96) */
  salt: bigint
  /** Number of mining iterations */
  loops: bigint
  /** Minimum rarity target */
  minTargetRarity: bigint
}

/**
 * Result of pool address mining.
 */
export interface MinePoolAddressResult {
  /** Best salt found */
  bestSalt: bigint
  /** Highest rarity achieved */
  highestRarity: bigint
}

/**
 * Mine for an optimal pool address salt with high rarity.
 *
 * @param params - Mining parameters
 * @returns The best salt and its rarity score
 */
export async function minePoolAddress(
  params: MinePoolAddressParams,
): Promise<MinePoolAddressResult> {
  const {
    client,
    factoryAddress,
    deployerAddress,
    poolKey,
    riskEngine,
    salt,
    loops,
    minTargetRarity,
  } = params

  const result = await client.readContract({
    address: factoryAddress,
    abi: panopticFactoryAbi,
    functionName: 'minePoolAddress',
    args: [
      deployerAddress,
      {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: poolKey.hooks,
      },
      riskEngine,
      salt,
      loops,
      minTargetRarity,
    ],
  })

  return { bestSalt: BigInt(result[0]), highestRarity: result[1] }
}

/**
 * Parameters for getFactoryConstructMetadata.
 */
export interface GetFactoryConstructMetadataParams {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** PanopticPool address (or predicted address) */
  panopticPoolAddress: Address
  /** Token 0 symbol */
  symbol0: string
  /** Token 1 symbol */
  symbol1: string
  /** Fee tier */
  fee: bigint
}

/**
 * Construct NFT metadata for a pool via the factory contract.
 *
 * @param params - Read parameters
 * @returns Encoded metadata URI string
 */
export async function getFactoryConstructMetadata(
  params: GetFactoryConstructMetadataParams,
): Promise<string> {
  const { client, factoryAddress, panopticPoolAddress, symbol0, symbol1, fee } = params

  return client.readContract({
    address: factoryAddress,
    abi: panopticFactoryAbi,
    functionName: 'constructMetadata',
    args: [panopticPoolAddress, symbol0, symbol1, fee],
  })
}

/**
 * Parameters for simulateDeployNewPool.
 */
export interface SimulateDeployNewPoolParams {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** Account address (deployer) */
  account: Address
  /** V4 pool key */
  poolKey: PoolKey
  /** Risk engine address */
  riskEngine: Address
  /** Salt (uint96) */
  salt: bigint
}

/**
 * Simulate a pool deployment to get the predicted pool address.
 *
 * Uses `simulateContract` on `deployNewPool` — the return value is the new pool address
 * without actually executing the transaction. Replaces off-chain deterministic
 * address prediction with no external library dependency.
 *
 * @param params - Simulation parameters
 * @returns The predicted PanopticPool address
 */
export async function simulateDeployNewPool(params: SimulateDeployNewPoolParams): Promise<Address> {
  const { client, factoryAddress, account, poolKey, riskEngine, salt } = params

  const { result } = await client.simulateContract({
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
    account,
  })

  return result
}
