/**
 * SFPM read functions — poolId resolution, enforced tick limits, chunk liquidity.
 *
 * @module v2/reads/sfpm
 */

import type { Address, PublicClient } from 'viem'

import {
  semiFungiblePositionManagerV3Abi,
  semiFungiblePositionManagerV4Abi,
} from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import { ChunkLimitError } from '../errors'
import type { BlockMeta, PoolKey } from '../types'
import { MAX_TRACKED_CHUNKS } from '../utils/constants'

// ---------------------------------------------------------------------------
// getUniswapV3PoolFromId
// ---------------------------------------------------------------------------

/**
 * Parameters for {@link getUniswapV3PoolFromId}.
 */
export interface GetUniswapV3PoolFromIdParams {
  /** Public client */
  client: PublicClient
  /** SemiFungiblePositionManagerV3 address */
  sfpmAddress: Address
  /** The SFPM pool identifier (uint64) */
  poolId: bigint
}

/**
 * Resolve an SFPM poolId to its corresponding Uniswap V3 pool address.
 *
 * Calls `SemiFungiblePositionManagerV3.getUniswapV3PoolFromId(poolId)`.
 */
export async function getUniswapV3PoolFromId(
  params: GetUniswapV3PoolFromIdParams,
): Promise<Address> {
  const { client, sfpmAddress, poolId } = params
  return client.readContract({
    address: sfpmAddress,
    abi: semiFungiblePositionManagerV3Abi,
    functionName: 'getUniswapV3PoolFromId',
    args: [poolId],
  })
}

// ---------------------------------------------------------------------------
// getUniswapV4PoolKeyFromId
// ---------------------------------------------------------------------------

/**
 * Parameters for {@link getUniswapV4PoolKeyFromId}.
 */
export interface GetUniswapV4PoolKeyFromIdParams {
  /** Public client */
  client: PublicClient
  /** SemiFungiblePositionManagerV4 address */
  sfpmAddress: Address
  /** The SFPM pool identifier (uint64) */
  poolId: bigint
}

/**
 * Resolve an SFPM poolId to its corresponding Uniswap V4 pool key.
 *
 * Calls `SemiFungiblePositionManagerV4.getUniswapV4PoolKeyFromId(poolId)`.
 */
export async function getUniswapV4PoolKeyFromId(
  params: GetUniswapV4PoolKeyFromIdParams,
): Promise<PoolKey> {
  const { client, sfpmAddress, poolId } = params
  const raw = await client.readContract({
    address: sfpmAddress,
    abi: semiFungiblePositionManagerV4Abi,
    functionName: 'getUniswapV4PoolKeyFromId',
    args: [poolId],
  })
  return {
    currency0: raw.currency0,
    currency1: raw.currency1,
    fee: BigInt(raw.fee),
    tickSpacing: BigInt(raw.tickSpacing),
    hooks: raw.hooks,
  }
}

// ---------------------------------------------------------------------------
// getEnforcedTickLimits
// ---------------------------------------------------------------------------

/**
 * Parameters for getEnforcedTickLimits.
 */
export interface GetEnforcedTickLimitsParams {
  /** viem PublicClient */
  client: PublicClient
  /** SFPM address (from getPool().metadata.sfpmAddress) */
  sfpmAddress: Address
  /** Encoded pool ID (from getPool().poolId) */
  poolId: bigint
}

/**
 * Result from getEnforcedTickLimits.
 */
export interface EnforcedTickLimits {
  minEnforcedTick: number
  maxEnforcedTick: number
}

/**
 * Get the enforced tick limits for a pool from the SFPM.
 *
 * @param params - The parameters
 * @returns The min and max enforced ticks
 */
export async function getEnforcedTickLimits(
  params: GetEnforcedTickLimitsParams,
): Promise<EnforcedTickLimits> {
  const { client, sfpmAddress, poolId } = params

  const [minTick, maxTick] = await client.readContract({
    address: sfpmAddress,
    abi: semiFungiblePositionManagerV4Abi,
    functionName: 'getEnforcedTickLimits',
    args: [poolId],
  })

  return {
    minEnforcedTick: minTick,
    maxEnforcedTick: maxTick,
  }
}

// ---------------------------------------------------------------------------
// getChunkLiquidities
// ---------------------------------------------------------------------------

export interface ChunkInput {
  /** Owner address (panopticPool address for Panoptic chunks) */
  owner: Address
  /** 0 or 1 */
  tokenType: bigint
  tickLower: bigint
  tickUpper: bigint
}

export interface ChunkLiquidityResult {
  /** Liquidity currently deployed in Uniswap */
  netLiquidity: bigint
  /** Liquidity removed by long holders */
  removedLiquidity: bigint
  /** Total liquidity deposited by shorts (net + removed) */
  totalLiquidity: bigint
  /** Alias for totalLiquidity (shorts deposited all of it) */
  shortLiquidity: bigint
  /** Alias for removedLiquidity (longs removed this much) */
  longLiquidity: bigint
}

export interface GetChunkLiquiditiesParams {
  client: PublicClient
  /** SFPM address */
  sfpmAddress: Address
  /** Pool key bytes (from getPool().metadata.poolKeyBytes) */
  poolKeyBytes: `0x${string}`
  /** Chunks to query */
  chunks: ChunkInput[]
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

export interface GetChunkLiquiditiesResult {
  /** One result per input chunk */
  results: ChunkLiquidityResult[]
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Fetch liquidity breakdown for a batch of chunks via SFPM.getAccountLiquidity().
 *
 * Uses multicall for efficiency. Returns one result per input chunk,
 * along with block metadata for freshness tracking.
 */
export async function getChunkLiquidities(
  params: GetChunkLiquiditiesParams,
): Promise<GetChunkLiquiditiesResult> {
  const { client, sfpmAddress, poolKeyBytes, chunks } = params

  if (chunks.length > MAX_TRACKED_CHUNKS) {
    throw new ChunkLimitError(BigInt(chunks.length), 0n)
  }

  const _meta = params._meta ?? (await getBlockMeta({ client }))

  if (chunks.length === 0) return { results: [], _meta }

  // Batch all getAccountLiquidity calls
  const multicallResults = await client.multicall({
    contracts: chunks.map((chunk) => ({
      address: sfpmAddress,
      abi: semiFungiblePositionManagerV4Abi,
      functionName: 'getAccountLiquidity' as const,
      args: [
        poolKeyBytes,
        chunk.owner,
        chunk.tokenType,
        Number(chunk.tickLower),
        Number(chunk.tickUpper),
      ],
    })),
    allowFailure: true,
  })

  const results = multicallResults.map((result) => {
    if (result.status === 'failure') {
      return {
        netLiquidity: 0n,
        removedLiquidity: 0n,
        totalLiquidity: 0n,
        shortLiquidity: 0n,
        longLiquidity: 0n,
      }
    }

    const packed = result.result as bigint
    // LeftRightUnsigned: right 128 bits = netLiquidity, left 128 bits = removedLiquidity
    const netLiquidity = packed & ((1n << 128n) - 1n)
    const removedLiquidity = packed >> 128n
    const totalLiquidity = netLiquidity + removedLiquidity

    return {
      netLiquidity,
      removedLiquidity,
      totalLiquidity,
      shortLiquidity: totalLiquidity,
      longLiquidity: removedLiquidity,
    }
  })

  return { results, _meta }
}
