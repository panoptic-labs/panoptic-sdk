/**
 * Collateral read functions for the Panoptic v2 SDK.
 *
 * ## Same-Block Guarantee
 *
 * All dynamic data is fetched in a SINGLE multicall to ensure block consistency.
 * Per PLAN.md §6, immutable "static prefetch" data (addresses, symbols, decimals)
 * can be fetched separately and cached - it's not subject to same-block consistency.
 *
 * @module v2/reads/collateral
 */

import type { Address, PublicClient } from 'viem'

import { collateralTrackerAbi, panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta, CollateralTracker, CurrentRates } from '../types'

// ERC20 minimal ABI for token metadata
const erc20Abi = [
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
] as const

/**
 * Pre-fetched collateral tracker metadata (immutable, can be cached).
 */
export interface CollateralTrackerMetadata {
  /** Collateral tracker address */
  address: Address
  /** Underlying asset address */
  assetAddress: Address
  /** Token symbol */
  symbol: string
  /** Token decimals */
  decimals: bigint
}

/**
 * Parameters for getCollateralData.
 */
export interface GetCollateralDataParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Which token's collateral tracker to query (0 or 1) */
  tokenIndex: 0 | 1
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched collateral tracker metadata (for caching/optimization) */
  trackerMetadata?: CollateralTrackerMetadata
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get collateral tracker data for a specific token.
 *
 * ## Same-Block Guarantee
 * All dynamic data is fetched in ONE multicall at the target block.
 * Static metadata (address, symbol, decimals) is either provided or fetched separately.
 *
 * @param params - The parameters
 * @returns Collateral tracker data with block metadata
 */
export async function getCollateralData(
  params: GetCollateralDataParams,
): Promise<CollateralTracker & { _meta: BlockMeta }> {
  const { client, poolAddress, tokenIndex, blockNumber, trackerMetadata } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // If metadata is provided, we only need ONE multicall for dynamic data
  if (trackerMetadata) {
    const [dynamicResults, _meta] = await Promise.all([
      client.multicall({
        contracts: [
          {
            address: trackerMetadata.address,
            abi: collateralTrackerAbi,
            functionName: 'getPoolData',
          },
          {
            address: trackerMetadata.address,
            abi: collateralTrackerAbi,
            functionName: 'totalSupply',
          },
          {
            address: trackerMetadata.address,
            abi: collateralTrackerAbi,
            functionName: 'interestRate',
          },
        ],
        blockNumber: targetBlockNumber,
        allowFailure: false,
      }),
      params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
    ])

    const [poolData, totalShares, interestRate] = dynamicResults
    const [depositedAssets, insideAMM, creditedShares, utilization] = poolData

    const borrowRate = BigInt(interestRate)
    const supplyRate = (borrowRate * utilization) / 10000n

    return {
      address: trackerMetadata.address,
      token: trackerMetadata.assetAddress,
      symbol: trackerMetadata.symbol,
      decimals: trackerMetadata.decimals,
      totalAssets: depositedAssets,
      insideAMM,
      creditedShares,
      totalShares,
      utilization,
      borrowRate,
      supplyRate,
      _meta,
    }
  }

  // Without metadata, fetch everything (original structure for backwards compatibility)
  // 1. Get tracker address (static)
  const collateralTrackerAddress = await client.readContract({
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: tokenIndex === 0 ? 'collateralToken0' : 'collateralToken1',
  })

  // 2. Get asset + dynamic data in one multicall (same-block guarantee for dynamic data)
  const [trackerData, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        {
          address: collateralTrackerAddress,
          abi: collateralTrackerAbi,
          functionName: 'asset',
        },
        {
          address: collateralTrackerAddress,
          abi: collateralTrackerAbi,
          functionName: 'getPoolData',
        },
        {
          address: collateralTrackerAddress,
          abi: collateralTrackerAbi,
          functionName: 'totalSupply',
        },
        {
          address: collateralTrackerAddress,
          abi: collateralTrackerAbi,
          functionName: 'interestRate',
        },
      ],
      blockNumber: targetBlockNumber,
      allowFailure: false,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [assetAddress, poolData, totalShares, interestRate] = trackerData

  // 3. Get token metadata (static - can be cached)
  const [symbol, decimals] = await client.multicall({
    contracts: [
      {
        address: assetAddress,
        abi: erc20Abi,
        functionName: 'symbol',
      },
      {
        address: assetAddress,
        abi: erc20Abi,
        functionName: 'decimals',
      },
    ],
    allowFailure: false,
  })

  // poolData returns: (depositedAssets, insideAMM, creditedShares, currentPoolUtilization)
  const [depositedAssets, insideAMM, creditedShares, utilization] = poolData

  // Calculate rates
  const borrowRate = BigInt(interestRate)
  const supplyRate = (borrowRate * utilization) / 10000n

  return {
    address: collateralTrackerAddress,
    token: assetAddress,
    symbol,
    decimals: BigInt(decimals),
    totalAssets: depositedAssets,
    insideAMM,
    creditedShares,
    totalShares,
    utilization,
    borrowRate,
    supplyRate,
    _meta,
  }
}

/**
 * Collateral tracker addresses (immutable, can be cached).
 */
export interface CollateralAddresses {
  /** Collateral tracker 0 address */
  collateralToken0: Address
  /** Collateral tracker 1 address */
  collateralToken1: Address
}

/**
 * Parameters for getCurrentRates.
 */
export interface GetCurrentRatesParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched collateral tracker addresses (for caching/optimization) */
  collateralAddresses?: CollateralAddresses
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get current interest rates for both tokens.
 *
 * ## Same-Block Guarantee
 * All dynamic data is fetched in ONE multicall at the target block.
 * Collateral tracker addresses are either provided or fetched separately (static prefetch).
 *
 * @param params - The parameters
 * @returns Current rates with block metadata
 */
export async function getCurrentRates(params: GetCurrentRatesParams): Promise<CurrentRates> {
  const { client, poolAddress, blockNumber, collateralAddresses } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Get collateral tracker addresses (static prefetch if not provided)
  let collateralToken0: Address
  let collateralToken1: Address

  if (collateralAddresses) {
    collateralToken0 = collateralAddresses.collateralToken0
    collateralToken1 = collateralAddresses.collateralToken1
  } else {
    // Static prefetch - addresses are immutable
    const addressResults = await client.multicall({
      contracts: [
        {
          address: poolAddress,
          abi: panopticPoolAbi,
          functionName: 'collateralToken0',
        },
        {
          address: poolAddress,
          abi: panopticPoolAbi,
          functionName: 'collateralToken1',
        },
      ],
      allowFailure: false,
    })
    collateralToken0 = addressResults[0]
    collateralToken1 = addressResults[1]
  }

  // SINGLE multicall for ALL dynamic data - ensures same-block consistency
  const [rateData, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        {
          address: collateralToken0,
          abi: collateralTrackerAbi,
          functionName: 'interestRate',
        },
        {
          address: collateralToken0,
          abi: collateralTrackerAbi,
          functionName: 'getPoolData',
        },
        {
          address: collateralToken1,
          abi: collateralTrackerAbi,
          functionName: 'interestRate',
        },
        {
          address: collateralToken1,
          abi: collateralTrackerAbi,
          functionName: 'getPoolData',
        },
      ],
      blockNumber: targetBlockNumber,
      allowFailure: false,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [interestRate0, poolData0, interestRate1, poolData1] = rateData

  // Extract utilization from pool data
  const utilization0 = poolData0[3]
  const utilization1 = poolData1[3]

  // Calculate rates
  const borrowRate0 = BigInt(interestRate0)
  const borrowRate1 = BigInt(interestRate1)

  // Supply rate = borrow rate * utilization (simplified)
  const supplyRate0 = (borrowRate0 * utilization0) / 10000n
  const supplyRate1 = (borrowRate1 * utilization1) / 10000n

  return {
    borrowRate0,
    supplyRate0,
    borrowRate1,
    supplyRate1,
    _meta,
  }
}
