/**
 * Pool read functions for the Panoptic v2 SDK.
 *
 * ## Same-Block Guarantee
 *
 * All dynamic data is fetched in a SINGLE multicall to ensure block consistency.
 * Per PLAN.md §6, immutable "static prefetch" data (addresses, decimals, symbols)
 * can be fetched separately and cached - it's not subject to same-block consistency.
 *
 * Functions accept an optional `poolMetadata` parameter containing pre-fetched
 * immutable addresses. If not provided, it will be fetched first (static prefetch).
 * Then ONE multicall fetches all dynamic data at the target block.
 *
 * @module v2/reads/pool
 */

import type { Address, PublicClient } from 'viem'

import { collateralTrackerAbi, panopticPoolAbi, riskEngineAbi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import type {
  BlockMeta,
  CollateralTracker,
  OracleState,
  Pool,
  PoolKey,
  RiskEngine,
  RiskParameters,
  Utilization,
} from '../types'

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
 * Immutable pool metadata that can be cached.
 * These values never change for a given pool, so they're exempt from
 * same-block consistency requirements (per PLAN.md "Static Prefetches" exception).
 */
export interface PoolMetadata {
  /** Pool key bytes */
  poolKeyBytes: `0x${string}`
  /** Pool ID */
  poolId: bigint
  /** Collateral tracker 0 address */
  collateralToken0Address: Address
  /** Collateral tracker 1 address */
  collateralToken1Address: Address
  /** Risk engine address */
  riskEngineAddress: Address
  /** Token 0 underlying asset address */
  token0Asset: Address
  /** Token 1 underlying asset address */
  token1Asset: Address
  /** Token 0 symbol */
  token0Symbol: string
  /** Token 1 symbol */
  token1Symbol: string
  /** Token 0 decimals */
  token0Decimals: bigint
  /** Token 1 decimals */
  token1Decimals: bigint
}

/**
 * Parameters for getPoolMetadata.
 */
export interface GetPoolMetadataParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
}

/**
 * Fetch immutable pool metadata (addresses, symbols, decimals).
 * This data never changes for a given pool and can be cached indefinitely.
 *
 * This is the "static prefetch" per PLAN.md §6 - exempt from same-block consistency.
 *
 * @param params - The parameters
 * @returns Immutable pool metadata
 */
export async function getPoolMetadata(params: GetPoolMetadataParams): Promise<PoolMetadata> {
  const { client, poolAddress } = params

  // First call: get basic immutable pool data
  const basicResults = await client.multicall({
    contracts: [
      {
        address: poolAddress,
        abi: panopticPoolAbi,
        functionName: 'poolKey',
      },
      {
        address: poolAddress,
        abi: panopticPoolAbi,
        functionName: 'poolId',
      },
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
      {
        address: poolAddress,
        abi: panopticPoolAbi,
        functionName: 'riskEngine',
      },
    ],
    allowFailure: false,
  })

  const [
    poolKeyBytes,
    poolId,
    collateralToken0Address,
    collateralToken1Address,
    riskEngineAddress,
  ] = basicResults

  // Second call: get underlying asset addresses from collateral trackers
  const assetResults = await client.multicall({
    contracts: [
      {
        address: collateralToken0Address,
        abi: collateralTrackerAbi,
        functionName: 'asset',
      },
      {
        address: collateralToken1Address,
        abi: collateralTrackerAbi,
        functionName: 'asset',
      },
    ],
    allowFailure: false,
  })

  const [token0Asset, token1Asset] = assetResults

  // Third call: get token metadata (symbols, decimals)
  const metadataResults = await client.multicall({
    contracts: [
      {
        address: token0Asset,
        abi: erc20Abi,
        functionName: 'symbol',
      },
      {
        address: token0Asset,
        abi: erc20Abi,
        functionName: 'decimals',
      },
      {
        address: token1Asset,
        abi: erc20Abi,
        functionName: 'symbol',
      },
      {
        address: token1Asset,
        abi: erc20Abi,
        functionName: 'decimals',
      },
    ],
    allowFailure: false,
  })

  const [token0Symbol, token0Decimals, token1Symbol, token1Decimals] = metadataResults

  return {
    poolKeyBytes,
    poolId,
    collateralToken0Address,
    collateralToken1Address,
    riskEngineAddress,
    token0Asset,
    token1Asset,
    token0Symbol,
    token1Symbol,
    token0Decimals: BigInt(token0Decimals),
    token1Decimals: BigInt(token1Decimals),
  }
}

/**
 * Parameters for getPool.
 */
export interface GetPoolParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Chain ID */
  chainId: bigint
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched pool metadata (for caching/optimization) */
  poolMetadata?: PoolMetadata
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get full pool data including both collateral trackers and oracle state.
 *
 * ## Same-Block Guarantee
 * All dynamic data is fetched in ONE multicall at the target block.
 * Static metadata (addresses, symbols, decimals) is either provided via
 * poolMetadata or fetched separately (static prefetch exception).
 *
 * @param params - The parameters
 * @returns Pool data with block metadata
 */
export async function getPool(params: GetPoolParams): Promise<Pool> {
  const { client, poolAddress, chainId, blockNumber, poolMetadata } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Get static metadata (either from cache or fetch it)
  const metadata = poolMetadata ?? (await getPoolMetadata({ client, poolAddress }))

  // SINGLE multicall for ALL dynamic data - ensures same-block consistency
  const [dynamicResults, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        // Pool dynamic state
        {
          address: poolAddress,
          abi: panopticPoolAbi,
          functionName: 'getCurrentTick',
        },
        {
          address: poolAddress,
          abi: panopticPoolAbi,
          functionName: 'isSafeMode',
        },
        // Token 0 collateral tracker dynamic data
        {
          address: metadata.collateralToken0Address,
          abi: collateralTrackerAbi,
          functionName: 'getPoolData',
        },
        {
          address: metadata.collateralToken0Address,
          abi: collateralTrackerAbi,
          functionName: 'totalSupply',
        },
        {
          address: metadata.collateralToken0Address,
          abi: collateralTrackerAbi,
          functionName: 'interestRate',
        },
        // Token 1 collateral tracker dynamic data
        {
          address: metadata.collateralToken1Address,
          abi: collateralTrackerAbi,
          functionName: 'getPoolData',
        },
        {
          address: metadata.collateralToken1Address,
          abi: collateralTrackerAbi,
          functionName: 'totalSupply',
        },
        {
          address: metadata.collateralToken1Address,
          abi: collateralTrackerAbi,
          functionName: 'interestRate',
        },
        // Risk engine parameters (technically immutable but included for completeness)
        {
          address: metadata.riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'SELLER_COLLATERAL_RATIO',
        },
        {
          address: metadata.riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'MAINT_MARGIN_RATE',
        },
        {
          address: metadata.riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'NOTIONAL_FEE',
        },
      ],
      blockNumber: targetBlockNumber,
      allowFailure: false,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [
    currentTick,
    safeModeRaw,
    token0PoolData,
    token0TotalSupply,
    token0InterestRate,
    token1PoolData,
    token1TotalSupply,
    token1InterestRate,
    sellerCollateralRatio,
    maintMarginRate,
    notionalFee,
  ] = dynamicResults

  // Parse pool key
  const poolKey = parsePoolKey(metadata.poolKeyBytes)

  // Calculate rates (simplified - borrow rate from interestRate, supply rate derived)
  const borrowRate0 = BigInt(token0InterestRate)
  const borrowRate1 = BigInt(token1InterestRate)
  const utilization0 = token0PoolData[3]
  const utilization1 = token1PoolData[3]
  // Supply rate = borrow rate * utilization (simplified)
  const supplyRate0 = (borrowRate0 * utilization0) / 10000n
  const supplyRate1 = (borrowRate1 * utilization1) / 10000n

  // Build collateral trackers
  const collateralTracker0: CollateralTracker = {
    address: metadata.collateralToken0Address,
    token: metadata.token0Asset,
    symbol: metadata.token0Symbol,
    decimals: metadata.token0Decimals,
    totalAssets: token0PoolData[0], // depositedAssets
    insideAMM: token0PoolData[1],
    creditedShares: token0PoolData[2],
    totalShares: token0TotalSupply,
    utilization: utilization0,
    borrowRate: borrowRate0,
    supplyRate: supplyRate0,
  }

  const collateralTracker1: CollateralTracker = {
    address: metadata.collateralToken1Address,
    token: metadata.token1Asset,
    symbol: metadata.token1Symbol,
    decimals: metadata.token1Decimals,
    totalAssets: token1PoolData[0], // depositedAssets
    insideAMM: token1PoolData[1],
    creditedShares: token1PoolData[2],
    totalShares: token1TotalSupply,
    utilization: utilization1,
    borrowRate: borrowRate1,
    supplyRate: supplyRate1,
  }

  // Build risk engine
  const riskEngine: RiskEngine = {
    address: metadata.riskEngineAddress,
    collateralRequirement: sellerCollateralRatio,
    maintenanceMargin: maintMarginRate,
    commissionRate: BigInt(notionalFee),
  }

  // Determine health status based on safe mode
  const healthStatus = safeModeRaw === 0 ? 'active' : safeModeRaw === 1 ? 'low_liquidity' : 'paused'

  // sqrtPriceX96 from tick
  const sqrtPriceX96 = tickToSqrtPriceX96(BigInt(currentTick))

  return {
    address: poolAddress,
    chainId,
    poolId: metadata.poolId,
    poolKey,
    collateralTracker0,
    collateralTracker1,
    riskEngine,
    currentTick: BigInt(currentTick),
    sqrtPriceX96,
    healthStatus,
    _meta,
  }
}

/**
 * Parameters for getUtilization.
 */
export interface GetUtilizationParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched collateral tracker addresses (for caching/optimization) */
  collateralAddresses?: {
    collateralToken0: Address
    collateralToken1: Address
  }
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get current pool utilization for both tokens.
 *
 * ## Same-Block Guarantee
 * All dynamic data is fetched in ONE multicall at the target block.
 * Collateral tracker addresses are either provided or fetched separately (static prefetch).
 *
 * @param params - The parameters
 * @returns Utilization data with block metadata
 */
export async function getUtilization(params: GetUtilizationParams): Promise<Utilization> {
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
  const [poolDataResults, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        {
          address: collateralToken0,
          abi: collateralTrackerAbi,
          functionName: 'getPoolData',
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

  const [poolData0, poolData1] = poolDataResults

  return {
    utilization0: poolData0[3], // currentPoolUtilization
    utilization1: poolData1[3],
    _meta,
  }
}

/**
 * Parameters for getOracleState.
 */
export interface GetOracleStateParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get current oracle state from the pool.
 *
 * ## Same-Block Guarantee
 * Single contract call + block meta fetch at the same block.
 *
 * @param params - The parameters
 * @returns Oracle state with block metadata
 */
export async function getOracleState(params: GetOracleStateParams): Promise<OracleState> {
  const { client, poolAddress, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Single call for oracle data - already same-block consistent
  const [oracleTicks, _meta] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'getOracleTicks',
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // oracleTicks returns: currentTick, spotTick, medianTick, latestTick, oraclePack
  const [currentTick, spotTick, medianTick, latestTick, oraclePack] = oracleTicks

  // Parse oracle pack to extract EMA values and other data
  // OraclePack structure is protocol-specific, extracting what we can
  const epoch = (oraclePack >> 208n) & ((1n << 32n) - 1n)
  const lastUpdateTimestamp = (oraclePack >> 176n) & ((1n << 32n) - 1n)
  const lockMode = (oraclePack >> 240n) & ((1n << 8n) - 1n)

  return {
    epoch,
    lastUpdateTimestamp,
    referenceTick: BigInt(currentTick),
    spotEMA: BigInt(spotTick),
    fastEMA: BigInt(latestTick), // Using latestTick as fast EMA approximation
    slowEMA: BigInt(medianTick), // Using medianTick as slow EMA approximation
    eonsEMA: 0n, // Not directly available from getOracleTicks
    lockMode,
    medianTick: BigInt(medianTick),
    _meta,
  }
}

/**
 * Parameters for getRiskParameters.
 */
export interface GetRiskParametersParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Builder code (default: 0) */
  builderCode?: bigint
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched risk engine address (for caching/optimization) */
  riskEngineAddress?: Address
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get risk parameters from the pool.
 *
 * ## Same-Block Guarantee
 * All dynamic data is fetched in ONE multicall at the target block.
 * Risk engine address is either provided or fetched separately (static prefetch).
 *
 * @param params - The parameters
 * @returns Risk parameters with block metadata
 */
export async function getRiskParameters(params: GetRiskParametersParams): Promise<RiskParameters> {
  const {
    client,
    poolAddress,
    builderCode = 0n,
    blockNumber,
    riskEngineAddress: providedAddress,
  } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Get risk engine address (static prefetch if not provided)
  const riskEngineAddress =
    providedAddress ??
    (await client.readContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'riskEngine',
    }))

  // SINGLE multicall for ALL risk parameters - ensures same-block consistency
  const [riskEngineResults, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        {
          address: riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'SELLER_COLLATERAL_RATIO',
        },
        {
          address: riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'BUYER_COLLATERAL_RATIO',
        },
        {
          address: riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'MAINT_MARGIN_RATE',
        },
        {
          address: riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'NOTIONAL_FEE',
        },
        {
          address: riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'TARGET_POOL_UTIL',
        },
        {
          address: riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'SATURATED_POOL_UTIL',
        },
        {
          address: poolAddress,
          abi: panopticPoolAbi,
          functionName: 'getRiskParameters',
          args: [builderCode],
        },
      ],
      blockNumber: targetBlockNumber,
      allowFailure: false,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [
    sellerCollateralRatio,
    buyerCollateralRatio,
    maintMarginRate,
    notionalFee,
    targetPoolUtil,
    saturatedPoolUtil,
    ,
  ] = riskEngineResults

  return {
    collateralRequirement: sellerCollateralRatio,
    maintenanceMargin: maintMarginRate,
    commissionRate: BigInt(notionalFee),
    targetUtilization: targetPoolUtil,
    saturatedUtilization: saturatedPoolUtil,
    itmSpreadMultiplier: buyerCollateralRatio, // Using buyer ratio as ITM multiplier
    _meta,
  }
}

/**
 * Parse pool key from ABI-encoded bytes.
 * PoolKey struct is ABI-encoded as 5 consecutive 32-byte slots:
 *   Slot 0: currency0 (address, right-padded)
 *   Slot 1: currency1 (address, right-padded)
 *   Slot 2: fee (uint24, right-padded)
 *   Slot 3: tickSpacing (int24, right-padded)
 *   Slot 4: hooks (address, right-padded)
 */
function parsePoolKey(poolKeyBytes: `0x${string}`): PoolKey {
  // Remove 0x prefix and decode
  const hex = poolKeyBytes.slice(2)

  // Each slot is 64 hex chars (32 bytes)
  // Addresses are in the last 40 hex chars (20 bytes) of their slot
  // Numeric values can be parsed from the full 64 hex chars of their slot
  const currency0 = `0x${hex.slice(24, 64)}` as Address // Slot 0: chars 0-64, address at 24-64
  const currency1 = `0x${hex.slice(88, 128)}` as Address // Slot 1: chars 64-128, address at 88-128
  const fee = BigInt(`0x${hex.slice(128, 192)}`) // Slot 2: chars 128-192 (full slot)
  const tickSpacing = BigInt(`0x${hex.slice(192, 256)}`) // Slot 3: chars 192-256 (full slot)
  const hooks = `0x${hex.slice(280, 320)}` as Address // Slot 4: chars 256-320, address at 280-320

  return {
    currency0,
    currency1,
    fee,
    tickSpacing,
    hooks,
  }
}

/**
 * Parameters for fetchPoolId.
 */
export interface FetchPoolIdParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
}

/**
 * Result of fetchPoolId, including block metadata for same-block consistency.
 */
export interface FetchPoolIdResult {
  /** The encoded 64-bit pool ID */
  poolId: bigint
  /** Block metadata from the pinned read */
  _meta: BlockMeta
}

/**
 * Fetch the encoded 64-bit pool ID from a PanopticPool contract.
 *
 * Use this when you need the poolId without fetching the full pool state.
 * The returned poolId can be passed directly to `createTokenIdBuilder()`.
 * The read is pinned to the latest block at call time.
 *
 * @param params - The parameters
 * @returns The pool ID and block metadata
 */
export async function fetchPoolId(params: FetchPoolIdParams): Promise<FetchPoolIdResult> {
  const { client, poolAddress } = params

  const block = await client.getBlock({ blockTag: 'latest' })

  const poolId = await client.readContract({
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'poolId',
    blockNumber: block.number,
  })

  return {
    poolId,
    _meta: {
      blockNumber: block.number,
      blockTimestamp: block.timestamp,
      blockHash: block.hash,
    },
  }
}

export { tickToSqrtPriceX96 }
