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

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta, CollateralTracker, CurrentRates } from '../types'

const SECONDS_PER_YEAR = 31_536_000n

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
            abi: collateralTrackerV2Abi,
            functionName: 'getPoolData',
          },
          {
            address: trackerMetadata.address,
            abi: collateralTrackerV2Abi,
            functionName: 'totalSupply',
          },
          {
            address: trackerMetadata.address,
            abi: collateralTrackerV2Abi,
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
    const totalAssets = depositedAssets + insideAMM

    const borrowRate = BigInt(interestRate) * SECONDS_PER_YEAR
    const supplyRate = (borrowRate * utilization) / 10000n

    return {
      address: trackerMetadata.address,
      token: trackerMetadata.assetAddress,
      symbol: trackerMetadata.symbol,
      decimals: trackerMetadata.decimals,
      totalAssets,
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
    abi: panopticPoolV2Abi,
    functionName: tokenIndex === 0 ? 'collateralToken0' : 'collateralToken1',
  })

  // 2. Get asset + dynamic data in one multicall (same-block guarantee for dynamic data)
  const [trackerData, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        {
          address: collateralTrackerAddress,
          abi: collateralTrackerV2Abi,
          functionName: 'asset',
        },
        {
          address: collateralTrackerAddress,
          abi: collateralTrackerV2Abi,
          functionName: 'getPoolData',
        },
        {
          address: collateralTrackerAddress,
          abi: collateralTrackerV2Abi,
          functionName: 'totalSupply',
        },
        {
          address: collateralTrackerAddress,
          abi: collateralTrackerV2Abi,
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
  const totalAssets = depositedAssets + insideAMM

  // Annualize rates: interestRate() returns WAD/s
  const borrowRate = BigInt(interestRate) * SECONDS_PER_YEAR
  const supplyRate = (borrowRate * utilization) / 10000n

  return {
    address: collateralTrackerAddress,
    token: assetAddress,
    symbol,
    decimals: BigInt(decimals),
    totalAssets,
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
          abi: panopticPoolV2Abi,
          functionName: 'collateralToken0',
        },
        {
          address: poolAddress,
          abi: panopticPoolV2Abi,
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
          abi: collateralTrackerV2Abi,
          functionName: 'interestRate',
        },
        {
          address: collateralToken0,
          abi: collateralTrackerV2Abi,
          functionName: 'getPoolData',
        },
        {
          address: collateralToken1,
          abi: collateralTrackerV2Abi,
          functionName: 'interestRate',
        },
        {
          address: collateralToken1,
          abi: collateralTrackerV2Abi,
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

  // Annualize rates: interestRate() returns WAD/s
  const borrowRate0 = BigInt(interestRate0) * SECONDS_PER_YEAR
  const borrowRate1 = BigInt(interestRate1) * SECONDS_PER_YEAR

  // Supply rate = borrow rate * utilization (utilization is in bps, so /10000)
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

// ─── Interest State (per-user borrows) ───────────────────────────────────────

/**
 * Per-user interest state for a single collateral tracker.
 */
export interface TokenInterestState {
  /** User's borrow index snapshot (int128) */
  userBorrowIndex: bigint
  /** User's net borrows: positive = borrowing, negative = net supplying (int128) */
  netBorrows: bigint
}

/**
 * Interest state for both tokens in a Panoptic pool.
 */
export interface InterestState {
  /** Token 0 interest state */
  token0: TokenInterestState
  /** Token 1 interest state */
  token1: TokenInterestState
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for getInterestState.
 */
export interface GetInterestStateParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address to query */
  account: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched collateral tracker addresses */
  collateralAddresses?: CollateralAddresses
  /** Optional pre-fetched block metadata */
  _meta?: BlockMeta
}

/**
 * Get per-user interest state (borrow index + net borrows) for both tokens.
 *
 * Calls `collateralTracker.interestState(user)` on both trackers in a single multicall.
 *
 * @param params - The parameters
 * @returns Interest state for both tokens with block metadata
 */
export async function getInterestState(params: GetInterestStateParams): Promise<InterestState> {
  const { client, poolAddress, account, blockNumber, collateralAddresses } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  let collateralToken0: Address
  let collateralToken1: Address

  if (collateralAddresses) {
    collateralToken0 = collateralAddresses.collateralToken0
    collateralToken1 = collateralAddresses.collateralToken1
  } else {
    const addressResults = await client.multicall({
      contracts: [
        {
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'collateralToken0',
        },
        {
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'collateralToken1',
        },
      ],
      allowFailure: false,
    })
    collateralToken0 = addressResults[0]
    collateralToken1 = addressResults[1]
  }

  const [results, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        {
          address: collateralToken0,
          abi: collateralTrackerV2Abi,
          functionName: 'interestState',
          args: [account],
        },
        {
          address: collateralToken1,
          abi: collateralTrackerV2Abi,
          functionName: 'interestState',
          args: [account],
        },
      ],
      blockNumber: targetBlockNumber,
      allowFailure: false,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [state0, state1] = results

  return {
    token0: { userBorrowIndex: state0[0], netBorrows: state0[1] },
    token1: { userBorrowIndex: state1[0], netBorrows: state1[1] },
    _meta,
  }
}
