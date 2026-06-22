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
import { decodeAbiParameters, keccak256, zeroAddress } from 'viem'

import { collateralTrackerV2Abi, panopticPoolV2Abi, riskEngineAbi } from '../../../generated'
import { stateViewAbi } from '../abis/stateView'
import { uniswapV3PoolAbi } from '../abis/uniswapV3Pool'
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
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ type: 'string' }],
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
  /** Token 0 name */
  token0Name: string
  /** Token 1 name */
  token1Name: string
  /** Underlying pool ID (V3: pool address, V4: keccak256(poolKeyBytes)) */
  underlyingPoolId: string
  /** Whether this is a V4 pool (poolManager is non-zero) */
  isV4: boolean
  /** Tick spacing */
  tickSpacing: bigint
  /** Fee tier (V4: from poolKey, V3: from Uniswap pool fee()) */
  fee: bigint
  /** SemiFungiblePositionManager address */
  sfpmAddress: Address
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
        abi: panopticPoolV2Abi,
        functionName: 'poolKey',
      },
      {
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'poolId',
      },
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
      {
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'riskEngine',
      },
      {
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'poolManager',
      },
      {
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'SFPM',
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
    poolManager,
    sfpmAddress,
  ] = basicResults

  // Second call: get underlying asset addresses from collateral trackers
  const assetResults = await client.multicall({
    contracts: [
      {
        address: collateralToken0Address,
        abi: collateralTrackerV2Abi,
        functionName: 'asset',
      },
      {
        address: collateralToken1Address,
        abi: collateralTrackerV2Abi,
        functionName: 'asset',
      },
    ],
    allowFailure: false,
  })

  const [token0Asset, token1Asset] = assetResults

  // Native ETH (address zero) has no ERC20 contract — use hardcoded metadata
  const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000'
  const isToken0Native = token0Asset.toLowerCase() === NATIVE_ETH_ADDRESS
  const isToken1Native = token1Asset.toLowerCase() === NATIVE_ETH_ADDRESS

  // Third call: get token metadata (symbols, decimals, names) — skip native ETH tokens
  const erc20Contracts = [
    ...(isToken0Native
      ? []
      : [
          { address: token0Asset, abi: erc20Abi, functionName: 'symbol' as const },
          { address: token0Asset, abi: erc20Abi, functionName: 'decimals' as const },
          { address: token0Asset, abi: erc20Abi, functionName: 'name' as const },
        ]),
    ...(isToken1Native
      ? []
      : [
          { address: token1Asset, abi: erc20Abi, functionName: 'symbol' as const },
          { address: token1Asset, abi: erc20Abi, functionName: 'decimals' as const },
          { address: token1Asset, abi: erc20Abi, functionName: 'name' as const },
        ]),
  ]

  const erc20Results =
    erc20Contracts.length > 0
      ? await client.multicall({ contracts: erc20Contracts, allowFailure: false })
      : []

  // Reconstruct metadata, inserting native ETH defaults where needed
  let resultIdx = 0
  const token0Symbol = isToken0Native ? 'ETH' : (erc20Results[resultIdx++] as string)
  const token0Decimals = isToken0Native ? 18 : (erc20Results[resultIdx++] as number)
  const token0Name = isToken0Native ? 'Ether' : (erc20Results[resultIdx++] as string)
  const token1Symbol = isToken1Native ? 'ETH' : (erc20Results[resultIdx++] as string)
  const token1Decimals = isToken1Native ? 18 : (erc20Results[resultIdx++] as number)
  const token1Name = isToken1Native ? 'Ether' : (erc20Results[resultIdx++] as string)

  // Derive underlyingPoolId, tickSpacing, and fee
  const isV4 = poolManager !== zeroAddress
  const parsedPoolKey = parsePoolKey(poolKeyBytes)
  let underlyingPoolId: string
  let fee: bigint

  if (isV4) {
    underlyingPoolId = keccak256(poolKeyBytes)
    fee = parsedPoolKey.fee
  } else {
    const v3PoolAddress = decodeAbiParameters([{ type: 'address' }], poolKeyBytes)[0]
    underlyingPoolId = v3PoolAddress
    fee = await getV3PoolFee(client, v3PoolAddress)
  }

  return {
    poolKeyBytes,
    poolId,
    collateralToken0Address,
    collateralToken1Address,
    isV4,
    riskEngineAddress,
    token0Asset,
    token1Asset,
    token0Symbol,
    token1Symbol,
    token0Decimals: BigInt(token0Decimals),
    token1Decimals: BigInt(token1Decimals),
    token0Name,
    token1Name,
    underlyingPoolId,
    tickSpacing: tickSpacingFromPoolId(poolId),
    fee,
    sfpmAddress,
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
  /** Optional StateView address for V4 pools (needed to read Uniswap pool liquidity) */
  stateViewAddress?: Address
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

  // Build Uniswap pool liquidity read (V3 vs V4)
  const liquidityContract =
    metadata.isV4 && params.stateViewAddress
      ? {
          address: params.stateViewAddress,
          abi: stateViewAbi,
          functionName: 'getLiquidity' as const,
          args: [metadata.underlyingPoolId as `0x${string}`] as const,
        }
      : !metadata.isV4
        ? {
            address: metadata.underlyingPoolId as Address,
            abi: uniswapV3PoolAbi,
            functionName: 'liquidity' as const,
          }
        : null // V4 without stateViewAddress — skip

  // SINGLE multicall for ALL dynamic data - ensures same-block consistency
  const [dynamicResults, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        // Pool dynamic state
        {
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'getCurrentTick',
        },
        {
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'isSafeMode',
        },
        // Token 0 collateral tracker dynamic data
        {
          address: metadata.collateralToken0Address,
          abi: collateralTrackerV2Abi,
          functionName: 'getPoolData',
        },
        {
          address: metadata.collateralToken0Address,
          abi: collateralTrackerV2Abi,
          functionName: 'totalSupply',
        },
        {
          address: metadata.collateralToken0Address,
          abi: collateralTrackerV2Abi,
          functionName: 'interestRate',
        },
        // Token 1 collateral tracker dynamic data
        {
          address: metadata.collateralToken1Address,
          abi: collateralTrackerV2Abi,
          functionName: 'getPoolData',
        },
        {
          address: metadata.collateralToken1Address,
          abi: collateralTrackerV2Abi,
          functionName: 'totalSupply',
        },
        {
          address: metadata.collateralToken1Address,
          abi: collateralTrackerV2Abi,
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
        {
          address: metadata.riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'VEGOID',
        },
        {
          address: metadata.riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'MAX_SPREAD',
        },
        // Uniswap pool in-range liquidity (V3 or V4 via StateView)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(liquidityContract ? [liquidityContract as any] : []),
      ],
      blockNumber: targetBlockNumber,
      allowFailure: true,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // Extract results — first 13 are core (must succeed), last is liquidity (may fail)
  const coreResults = dynamicResults.slice(0, 13)
  if (coreResults.some((r) => r.status !== 'success')) {
    const failed = coreResults.find((r) => r.status !== 'success')
    throw new Error(`Core pool read failed: ${JSON.stringify(failed)}`)
  }
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
    vegoid,
    maxSpread,
  ] = coreResults.map((r) => r.result) as [
    bigint, // currentTick
    number, // safeModeRaw
    readonly [bigint, bigint, bigint, bigint], // token0PoolData (getPoolData)
    bigint, // token0TotalSupply
    bigint, // token0InterestRate
    readonly [bigint, bigint, bigint, bigint], // token1PoolData (getPoolData)
    bigint, // token1TotalSupply
    bigint, // token1InterestRate
    bigint, // sellerCollateralRatio
    bigint, // maintMarginRate
    bigint, // notionalFee
    bigint, // vegoid
    bigint, // maxSpread
  ]
  const liquidityResult = dynamicResults[13]
  const uniswapPoolLiquidity =
    liquidityResult?.status === 'success' ? BigInt(liquidityResult.result as bigint) : 0n

  // Parse pool key and extract tickSpacing from poolId (works for both V3 and V4)
  const poolKey = parsePoolKey(metadata.poolKeyBytes)
  const tickSpacing = tickSpacingFromPoolId(metadata.poolId)

  // Annualize rates: interestRate() returns WAD/s, multiply by seconds/year
  const SECONDS_PER_YEAR = 31_536_000n
  const borrowRate0 = BigInt(token0InterestRate) * SECONDS_PER_YEAR
  const borrowRate1 = BigInt(token1InterestRate) * SECONDS_PER_YEAR
  const utilization0 = token0PoolData[3]
  const utilization1 = token1PoolData[3]
  // Supply rate = borrow rate * utilization (utilization is in bps, so /10000)
  const supplyRate0 = (borrowRate0 * utilization0) / 10000n
  const supplyRate1 = (borrowRate1 * utilization1) / 10000n
  const totalAssets0 = token0PoolData[0] + token0PoolData[1]
  const totalAssets1 = token1PoolData[0] + token1PoolData[1]

  // Build collateral trackers
  const collateralTracker0: CollateralTracker = {
    address: metadata.collateralToken0Address,
    token: metadata.token0Asset,
    symbol: metadata.token0Symbol,
    decimals: metadata.token0Decimals,
    totalAssets: totalAssets0,
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
    totalAssets: totalAssets1,
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
    vegoid: BigInt(vegoid),
    maxSpread: BigInt(maxSpread),
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
    tickSpacing,
    collateralTracker0,
    collateralTracker1,
    riskEngine,
    currentTick: BigInt(currentTick),
    sqrtPriceX96,
    uniswapPoolLiquidity,
    healthStatus,
    metadata,
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
  const [poolDataResults, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        {
          address: collateralToken0,
          abi: collateralTrackerV2Abi,
          functionName: 'getPoolData',
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
      abi: panopticPoolV2Abi,
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
  // lockMode is the 2-bit guardian safe-mode override at bits 118-119 of the
  // OraclePack (see OraclePack.sol `lockMode()`). A non-zero value means the
  // Panoptic Guardian has explicitly locked the pool (close-only), as opposed
  // to safe mode being triggered algorithmically by price action.
  const lockMode = (oraclePack >> 118n) & 3n

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
      abi: panopticPoolV2Abi,
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
          abi: panopticPoolV2Abi,
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

// ---------------------------------------------------------------------------
// Builder code validation
// ---------------------------------------------------------------------------

/**
 * Validate whether a builder code maps to a deployed builder wallet.
 *
 * Calls `PanopticPool.getRiskParameters(builderCode)` — the contract reverts
 * with `InvalidBuilderCode` when the computed CREATE2 address has no bytecode.
 *
 * @returns `true` when valid, `false` when the contract reverts.
 */
export async function validateBuilderCode(params: {
  client: PublicClient
  poolAddress: Address
  builderCode: bigint
}): Promise<boolean> {
  const { client, poolAddress, builderCode } = params
  if (builderCode === 0n) return true
  try {
    await client.readContract({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      functionName: 'getRiskParameters',
      args: [builderCode],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Read the fee tier from a Uniswap V3 pool contract.
 */
async function getV3PoolFee(client: PublicClient, poolAddress: Address): Promise<bigint> {
  const fee = await client.readContract({
    address: poolAddress,
    abi: uniswapV3PoolAbi,
    functionName: 'fee',
  })
  return BigInt(fee)
}

/**
 * Extract tickSpacing from the encoded 64-bit poolId.
 * Layout: poolAddress (5 bytes) + vegoid (1 byte) + tickSpacing (2 bytes).
 * tickSpacing occupies bits 48–63.
 */
function tickSpacingFromPoolId(poolId: bigint): bigint {
  return (poolId >> 48n) & 0xffffn
}

/**
 * Parse pool key from ABI-encoded bytes.
 *
 * V4 pools: PoolKey struct is ABI-encoded as 5 consecutive 32-byte slots
 *   (currency0, currency1, fee, tickSpacing, hooks).
 *
 * V3 pools: poolKey() returns abi.encode(uniswapV3PoolAddress) — a single
 *   32-byte slot. The struct fields are not available, so currency0/currency1
 *   are zeroed and tickSpacing/fee are set to 0 (callers should use
 *   tickSpacingFromPoolId and getV3PoolFee respectively).
 */
function parsePoolKey(poolKeyBytes: `0x${string}`): PoolKey {
  const hex = poolKeyBytes.slice(2)

  // V3: single ABI-encoded address (64 hex chars = 32 bytes)
  if (hex.length <= 64) {
    return {
      currency0: zeroAddress,
      currency1: zeroAddress,
      fee: 0n,
      tickSpacing: 0n,
      hooks: zeroAddress,
    }
  }

  if (hex.length < 320) {
    throw new Error(`Malformed V4 pool key: expected 320 hex chars (160 bytes), got ${hex.length}`)
  }

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
    abi: panopticPoolV2Abi,
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
