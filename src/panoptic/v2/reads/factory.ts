/**
 * Factory read functions for the Panoptic v2 SDK.
 *
 * Supports both PanopticFactoryV3 (Uniswap V3) and PanopticFactoryV4 (Uniswap V4).
 *
 * @module v2/reads/factory
 */

import type { Address, PublicClient } from 'viem'
import { zeroAddress } from 'viem'

import { panopticFactoryV3Abi, panopticFactoryV4Abi } from '../../../generated'
import type { PoolKey } from '../types'
import { getUniswapV3PoolFromId, getUniswapV4PoolKeyFromId } from './sfpm'

// ---------------------------------------------------------------------------
// Shared reads (identical signature on both V3 and V4)
// ---------------------------------------------------------------------------

/**
 * Parameters for getFactoryTokenURI.
 */
export interface GetFactoryTokenURIParams {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** Factory version */
  version: 'v3' | 'v4'
  /** Token ID (encoded pool address) */
  tokenId: bigint
}

/**
 * Get the token URI from a PanopticFactory NFT.
 */
export async function getFactoryTokenURI(params: GetFactoryTokenURIParams): Promise<string> {
  const { client, factoryAddress, version, tokenId } = params
  const abi = version === 'v3' ? panopticFactoryV3Abi : panopticFactoryV4Abi

  return client.readContract({
    address: factoryAddress,
    abi,
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
  /** Factory version */
  version: 'v3' | 'v4'
  /** Token ID (encoded pool address) */
  tokenId: bigint
}

/**
 * Get the owner of a PanopticFactory NFT.
 */
export async function getFactoryOwnerOf(params: GetFactoryOwnerOfParams): Promise<Address> {
  const { client, factoryAddress, version, tokenId } = params
  const abi = version === 'v3' ? panopticFactoryV3Abi : panopticFactoryV4Abi

  return client.readContract({
    address: factoryAddress,
    abi,
    functionName: 'ownerOf',
    args: [tokenId],
  })
}

/**
 * Parameters for getFactoryConstructMetadata.
 */
export interface GetFactoryConstructMetadataParams {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** Factory version */
  version: 'v3' | 'v4'
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
 */
export async function getFactoryConstructMetadata(
  params: GetFactoryConstructMetadataParams,
): Promise<string> {
  const { client, factoryAddress, version, panopticPoolAddress, symbol0, symbol1, fee } = params
  const abi = version === 'v3' ? panopticFactoryV3Abi : panopticFactoryV4Abi

  return client.readContract({
    address: factoryAddress,
    abi,
    functionName: 'constructMetadata',
    args: [panopticPoolAddress, symbol0, symbol1, fee],
  })
}

// ---------------------------------------------------------------------------
// V3-specific reads
// ---------------------------------------------------------------------------

/**
 * Parameters for getPanopticPoolAddress on a V3 factory.
 */
export interface GetPanopticPoolAddressV3Params {
  /** Public client */
  client: PublicClient
  /** PanopticFactoryV3 address */
  factoryAddress: Address
  /** Uniswap V3 pool address */
  univ3pool: Address
  /** Risk engine address */
  riskEngine: Address
}

/**
 * Parameters for getPanopticPoolAddress on a V4 factory.
 */
export interface GetPanopticPoolAddressV4Params {
  /** Public client */
  client: PublicClient
  /** PanopticFactoryV4 address */
  factoryAddress: Address
  /** V4 pool key */
  poolKey: PoolKey
  /** Risk engine address */
  riskEngine: Address
}

/** Versioned params for {@link getPanopticPoolAddress}. Use `version` to select V3 or V4. */
export type GetPanopticPoolAddressParams =
  | ({ version: 'v3' } & GetPanopticPoolAddressV3Params)
  | ({ version: 'v4' } & GetPanopticPoolAddressV4Params)

/**
 * Get the PanopticPool address for a given pool and risk engine.
 */
export async function getPanopticPoolAddress(
  params: GetPanopticPoolAddressParams,
): Promise<Address> {
  const { client, factoryAddress, riskEngine } = params

  if (params.version === 'v3') {
    return client.readContract({
      address: factoryAddress,
      abi: panopticFactoryV3Abi,
      functionName: 'getPanopticPool',
      args: [params.univ3pool, riskEngine],
    })
  }

  return client.readContract({
    address: factoryAddress,
    abi: panopticFactoryV4Abi,
    functionName: 'getPanopticPool',
    args: [
      {
        currency0: params.poolKey.currency0,
        currency1: params.poolKey.currency1,
        fee: Number(params.poolKey.fee),
        tickSpacing: Number(params.poolKey.tickSpacing),
        hooks: params.poolKey.hooks,
      },
      riskEngine,
    ],
  })
}

// ---------------------------------------------------------------------------
// minePoolAddress
// ---------------------------------------------------------------------------

/**
 * Common mining parameters shared between V3 and V4.
 */
interface MinePoolAddressCommon {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** Deployer address (msg.sender for deployment) */
  deployerAddress: Address
  /** Risk engine address */
  riskEngine: Address
  /** Starting salt (uint96) */
  salt: bigint
  /** Number of mining iterations */
  loops: bigint
  /** Minimum rarity target */
  minTargetRarity: bigint
}

export interface MinePoolAddressV3Params extends MinePoolAddressCommon {
  /** Uniswap V3 pool address */
  v3Pool: Address
}

export interface MinePoolAddressV4Params extends MinePoolAddressCommon {
  /** V4 pool key */
  poolKey: PoolKey
}

/** Versioned params for {@link minePoolAddress}. Use `version` to select V3 or V4. */
export type MinePoolAddressParams =
  | ({ version: 'v3' } & MinePoolAddressV3Params)
  | ({ version: 'v4' } & MinePoolAddressV4Params)

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
 */
export async function minePoolAddress(
  params: MinePoolAddressParams,
): Promise<MinePoolAddressResult> {
  const { client, factoryAddress, deployerAddress, riskEngine, salt, loops, minTargetRarity } =
    params

  let result: readonly [bigint, bigint]

  if (params.version === 'v3') {
    result = await client.readContract({
      address: factoryAddress,
      abi: panopticFactoryV3Abi,
      functionName: 'minePoolAddress',
      args: [deployerAddress, params.v3Pool, riskEngine, salt, loops, minTargetRarity],
    })
  } else {
    result = await client.readContract({
      address: factoryAddress,
      abi: panopticFactoryV4Abi,
      functionName: 'minePoolAddress',
      args: [
        deployerAddress,
        {
          currency0: params.poolKey.currency0,
          currency1: params.poolKey.currency1,
          fee: Number(params.poolKey.fee),
          tickSpacing: Number(params.poolKey.tickSpacing),
          hooks: params.poolKey.hooks,
        },
        riskEngine,
        salt,
        loops,
        minTargetRarity,
      ],
    })
  }

  return { bestSalt: BigInt(result[0]), highestRarity: result[1] }
}

// ---------------------------------------------------------------------------
// simulateDeployNewPool
// ---------------------------------------------------------------------------

interface SimulateDeployNewPoolCommon {
  /** Public client */
  client: PublicClient
  /** PanopticFactory address */
  factoryAddress: Address
  /** Account address (deployer) */
  account: Address
  /** Risk engine address */
  riskEngine: Address
  /** Salt (uint96) */
  salt: bigint
}

export interface SimulateDeployNewPoolV3Params extends SimulateDeployNewPoolCommon {
  /** Token 0 address */
  token0: Address
  /** Token 1 address */
  token1: Address
  /** Fee tier (uint24) */
  fee: bigint
}

export interface SimulateDeployNewPoolV4Params extends SimulateDeployNewPoolCommon {
  /** V4 pool key */
  poolKey: PoolKey
}

export type SimulateDeployNewPoolParams =
  | ({ version: 'v3' } & SimulateDeployNewPoolV3Params)
  | ({ version: 'v4' } & SimulateDeployNewPoolV4Params)

/**
 * Simulate a pool deployment to get the predicted pool address.
 *
 * Uses `simulateContract` on `deployNewPool` — the return value is the new pool address
 * without actually executing the transaction.
 */
export async function simulateDeployNewPool(params: SimulateDeployNewPoolParams): Promise<Address> {
  const { client, factoryAddress, account, riskEngine, salt } = params

  if (params.version === 'v3') {
    const { result } = await client.simulateContract({
      address: factoryAddress,
      abi: panopticFactoryV3Abi,
      functionName: 'deployNewPool',
      args: [params.token0, params.token1, Number(params.fee), riskEngine, salt],
      account,
    })
    return result
  }

  const { result } = await client.simulateContract({
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
    account,
  })
  return result
}

// ---------------------------------------------------------------------------
// getPanopticPoolFromPoolId
// ---------------------------------------------------------------------------

/**
 * Common parameters for {@link getPanopticPoolFromPoolId}.
 */
interface GetPanopticPoolFromPoolIdCommon {
  /** Public client */
  client: PublicClient
  /** SFPM address */
  sfpmAddress: Address
  /** PanopticFactory address */
  factoryAddress: Address
  /** Risk engine address */
  riskEngine: Address
  /** The SFPM pool identifier (uint64) */
  poolId: bigint
}

/** Versioned params for {@link getPanopticPoolFromPoolId}. */
export type GetPanopticPoolFromPoolIdParams =
  | ({ version: 'v3' } & GetPanopticPoolFromPoolIdCommon)
  | ({ version: 'v4' } & GetPanopticPoolFromPoolIdCommon)

/**
 * Resolve an SFPM poolId to its PanopticPool address.
 *
 * Chains two on-chain lookups:
 * 1. SFPM: poolId → Uniswap pool address (V3) or pool key (V4)
 * 2. Factory: Uniswap pool + riskEngine → PanopticPool address
 */
export async function getPanopticPoolFromPoolId(
  params: GetPanopticPoolFromPoolIdParams,
): Promise<Address> {
  const { client, sfpmAddress, factoryAddress, riskEngine, poolId, version } = params

  if (version === 'v3') {
    const univ3pool = await getUniswapV3PoolFromId({ client, sfpmAddress, poolId })
    return getPanopticPoolAddress({
      version: 'v3',
      client,
      factoryAddress,
      univ3pool,
      riskEngine,
    })
  }

  const poolKey = await getUniswapV4PoolKeyFromId({ client, sfpmAddress, poolId })
  return getPanopticPoolAddress({
    version: 'v4',
    client,
    factoryAddress,
    poolKey,
    riskEngine,
  })
}

// ---------------------------------------------------------------------------
// resolvePanopticPoolFromPoolId (version-agnostic)
// ---------------------------------------------------------------------------

/**
 * Parameters for {@link resolvePanopticPoolFromPoolId}.
 */
export interface ResolvePanopticPoolFromPoolIdParams {
  /** Public client */
  client: PublicClient
  /** The SFPM pool identifier (uint64) */
  poolId: bigint
  /** Risk engine address */
  riskEngine: Address
  /** V3 SFPM + Factory addresses (omit if V3 is not deployed) */
  v3?: {
    sfpmAddress: Address
    factoryAddress: Address
  }
  /** V4 SFPM + Factory addresses (omit if V4 is not deployed) */
  v4?: {
    sfpmAddress: Address
    factoryAddress: Address
  }
}

/**
 * Result of {@link resolvePanopticPoolFromPoolId}.
 */
export interface ResolvePanopticPoolFromPoolIdResult {
  /** The resolved PanopticPool address */
  panopticPoolAddress: Address
  /** Which version matched */
  version: 'v3' | 'v4'
}

/**
 * Resolve an SFPM poolId to its PanopticPool address without knowing the version.
 *
 * Tries both V3 and V4 lookups in parallel. The factory returns `address(0)` for
 * non-existent pools, so the non-zero result identifies the correct version.
 *
 * At least one of `v3` or `v4` must be provided.
 *
 * @throws {PanopticValidationError} If no version config is provided or neither resolves.
 */
export async function resolvePanopticPoolFromPoolId(
  params: ResolvePanopticPoolFromPoolIdParams,
): Promise<ResolvePanopticPoolFromPoolIdResult> {
  const { client, poolId, riskEngine, v3, v4 } = params

  if (!v3 && !v4) {
    throw new Error('At least one of v3 or v4 must be provided')
  }

  const isNotFoundError = (err: unknown): boolean => {
    // Contract reverts (e.g. pool not registered) are "not found".
    // RPC / ABI / network errors should propagate.
    if (typeof err === 'object' && err !== null && 'name' in err) {
      const name = (err as { name: string }).name
      return name === 'ContractFunctionExecutionError' || name === 'ContractFunctionRevertedError'
    }
    return false
  }

  const results = await Promise.all([
    v3
      ? getPanopticPoolFromPoolId({
          version: 'v3',
          client,
          sfpmAddress: v3.sfpmAddress,
          factoryAddress: v3.factoryAddress,
          riskEngine,
          poolId,
        }).catch((err) => {
          if (isNotFoundError(err)) return zeroAddress
          throw err
        })
      : Promise.resolve(zeroAddress),
    v4
      ? getPanopticPoolFromPoolId({
          version: 'v4',
          client,
          sfpmAddress: v4.sfpmAddress,
          factoryAddress: v4.factoryAddress,
          riskEngine,
          poolId,
        }).catch((err) => {
          if (isNotFoundError(err)) return zeroAddress
          throw err
        })
      : Promise.resolve(zeroAddress),
  ])

  const [v3Result, v4Result] = results

  if (v3Result !== zeroAddress) {
    return { panopticPoolAddress: v3Result, version: 'v3' }
  }
  if (v4Result !== zeroAddress) {
    return { panopticPoolAddress: v4Result, version: 'v4' }
  }

  throw new Error(`No PanopticPool found for poolId ${poolId}`)
}
