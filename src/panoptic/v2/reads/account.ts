/**
 * Account read functions for the Panoptic v2 SDK.
 *
 * ## Same-Block Guarantee
 *
 * All dynamic data is fetched in a SINGLE multicall to ensure block consistency.
 * Per PLAN.md §6, immutable "static prefetch" data (addresses) can be fetched
 * separately and cached - it's not subject to same-block consistency.
 *
 * @module v2/reads/account
 */

import type { Address, PublicClient } from 'viem'

import { collateralTrackerAbi, panopticPoolAbi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients/blockMeta'
import type {
  AccountCollateral,
  AccountSummaryBasic,
  AccountSummaryRisk,
  BlockMeta,
  LiquidationPrices,
  NetLiquidationValue,
  TokenCollateral,
} from '../types'
import { isLiquidatable } from './checks'
import { type PoolMetadata, getPool } from './pool'
import { getPositions } from './position'

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
 * Extract collateral tracker addresses from a Pool object.
 *
 * Convenience helper that avoids re-fetching immutable addresses
 * when you already have a Pool from a prior `getPool()` call.
 *
 * @param pool - Pool object from getPool()
 * @returns Collateral tracker addresses
 */
export function getCollateralAddresses(pool: {
  collateralTracker0: { address: Address }
  collateralTracker1: { address: Address }
}): CollateralAddresses {
  return {
    collateralToken0: pool.collateralTracker0.address,
    collateralToken1: pool.collateralTracker1.address,
  }
}

/**
 * Parameters for getAccountCollateral.
 */
export interface GetAccountCollateralParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched collateral addresses (for caching/optimization) */
  collateralAddresses?: CollateralAddresses
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get collateral data for an account.
 *
 * ## Same-Block Guarantee
 * All dynamic data is fetched in ONE multicall at the target block.
 * Collateral tracker addresses are either provided or fetched separately (static prefetch).
 *
 * @param params - The parameters
 * @returns Account collateral data with block metadata
 */
export async function getAccountCollateral(
  params: GetAccountCollateralParams,
): Promise<AccountCollateral> {
  const { client, poolAddress, account, blockNumber, collateralAddresses } = params

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
  const [dynamicResults, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        // Token 0 collateral data
        {
          address: collateralToken0,
          abi: collateralTrackerAbi,
          functionName: 'balanceOf',
          args: [account],
        },
        {
          address: collateralToken0,
          abi: collateralTrackerAbi,
          functionName: 'assetsOf',
          args: [account],
        },
        {
          address: collateralToken0,
          abi: collateralTrackerAbi,
          functionName: 'maxWithdraw',
          args: [account],
        },
        // Token 1 collateral data
        {
          address: collateralToken1,
          abi: collateralTrackerAbi,
          functionName: 'balanceOf',
          args: [account],
        },
        {
          address: collateralToken1,
          abi: collateralTrackerAbi,
          functionName: 'assetsOf',
          args: [account],
        },
        {
          address: collateralToken1,
          abi: collateralTrackerAbi,
          functionName: 'maxWithdraw',
          args: [account],
        },
        // Leg count from pool
        {
          address: poolAddress,
          abi: panopticPoolAbi,
          functionName: 'numberOfLegs',
          args: [account],
        },
      ],
      blockNumber: targetBlockNumber,
      allowFailure: false,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [shares0, assets0, maxWithdraw0, shares1, assets1, maxWithdraw1, legCount] = dynamicResults

  // Calculate locked assets as total - available (maxWithdraw)
  const locked0 = assets0 > maxWithdraw0 ? assets0 - maxWithdraw0 : 0n
  const locked1 = assets1 > maxWithdraw1 ? assets1 - maxWithdraw1 : 0n

  const token0: TokenCollateral = {
    assets: assets0,
    shares: shares0,
    availableAssets: maxWithdraw0,
    lockedAssets: locked0,
  }

  const token1: TokenCollateral = {
    assets: assets1,
    shares: shares1,
    availableAssets: maxWithdraw1,
    lockedAssets: locked1,
  }

  return {
    account,
    poolAddress,
    token0,
    token1,
    legCount,
    _meta,
  }
}

/**
 * Parameters for getAccountSummaryBasic.
 */
export interface GetAccountSummaryBasicParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Chain ID */
  chainId: bigint
  /** TokenIds of open positions */
  tokenIds: bigint[]
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched pool metadata (for caching/optimization) */
  poolMetadata?: PoolMetadata
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Parameters for getAccountSummaryRisk.
 */
export interface GetAccountSummaryRiskParams extends GetAccountSummaryBasicParams {
  /** PanopticQuery address (required for risk fields) */
  queryAddress: Address
  /** Optional: Tick to calculate risk metrics at (defaults to current tick) */
  atTick?: bigint
  /** Optional: Whether to include pending premium in NLV */
  includePendingPremium?: boolean
}

interface AccountSummaryCoreData {
  pool: Awaited<ReturnType<typeof getPool>>
  collateral: AccountCollateral
  positions: Awaited<ReturnType<typeof getPositions>>['positions']
  _meta: BlockMeta
}

async function getAccountSummaryCore(
  params: GetAccountSummaryBasicParams,
): Promise<AccountSummaryCoreData> {
  const { client, poolAddress, account, chainId, tokenIds, blockNumber, poolMetadata } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())
  const sharedMeta =
    params._meta ?? (await getBlockMeta({ client, blockNumber: targetBlockNumber }))

  const collateralAddresses = poolMetadata
    ? {
        collateralToken0: poolMetadata.collateralToken0Address,
        collateralToken1: poolMetadata.collateralToken1Address,
      }
    : undefined

  const [pool, collateral, { positions }] = await Promise.all([
    getPool({
      client,
      poolAddress,
      chainId,
      blockNumber: targetBlockNumber,
      poolMetadata,
      _meta: sharedMeta,
    }),
    getAccountCollateral({
      client,
      poolAddress,
      account,
      blockNumber: targetBlockNumber,
      collateralAddresses,
      _meta: sharedMeta,
    }),
    getPositions({
      client,
      poolAddress,
      owner: account,
      tokenIds,
      blockNumber: targetBlockNumber,
      _meta: sharedMeta,
    }),
  ])

  return {
    pool,
    collateral,
    positions,
    _meta: sharedMeta,
  }
}

/**
 * Get base account summary data for UI dashboards.
 *
 * ## Same-Block Guarantee
 * Uses the same blockNumber for pool, collateral, and position reads.
 *
 * @param params - The parameters
 * @returns Base account summary with block metadata
 */
export async function getAccountSummaryBasic(
  params: GetAccountSummaryBasicParams,
): Promise<AccountSummaryBasic> {
  const { account } = params
  const { pool, collateral, positions, _meta } = await getAccountSummaryCore(params)

  return {
    account,
    pool,
    collateral,
    positions,
    healthStatus: pool.healthStatus,
    networkMismatch: false, // Requires wallet context, not available in read functions
    _meta,
  }
}

/**
 * Get risk-focused account summary including helper-dependent fields.
 *
 * ## Same-Block Guarantee
 * Uses one block target for all pool/collateral/position/risk reads.
 *
 * @param params - The parameters
 * @returns Risk-focused account summary with block metadata
 */
export async function getAccountSummaryRisk(
  params: GetAccountSummaryRiskParams,
): Promise<AccountSummaryRisk> {
  const {
    client,
    poolAddress,
    account,
    tokenIds,
    queryAddress,
    atTick,
    includePendingPremium = true,
    blockNumber,
  } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())
  const sharedMeta =
    params._meta ?? (await getBlockMeta({ client, blockNumber: targetBlockNumber }))

  const [{ pool, collateral, positions }, nlv, liquidationCheck, liquidationPrices] =
    await Promise.all([
      getAccountSummaryCore({
        ...params,
        blockNumber: targetBlockNumber,
        _meta: sharedMeta,
      }),
      getNetLiquidationValue({
        client,
        poolAddress,
        account,
        tokenIds,
        atTick,
        includePendingPremium,
        queryAddress,
        blockNumber: targetBlockNumber,
        _meta: sharedMeta,
      }),
      isLiquidatable({
        client,
        poolAddress,
        account,
        tokenIds,
        atTick,
        queryAddress,
        blockNumber: targetBlockNumber,
        _meta: sharedMeta,
      }),
      getLiquidationPrices({
        client,
        poolAddress,
        account,
        tokenIds,
        queryAddress,
        blockNumber: targetBlockNumber,
        _meta: sharedMeta,
      }),
    ])

  const totalGreeks = {
    value: 0n,
    delta: 0n,
    gamma: 0n,
  }

  const maintenanceMargin0 = liquidationCheck.requiredMargin0
  const maintenanceMargin1 = liquidationCheck.requiredMargin1
  const marginExcess0 = liquidationCheck.currentMargin0 - liquidationCheck.requiredMargin0
  const marginExcess1 = liquidationCheck.currentMargin1 - liquidationCheck.requiredMargin1

  return {
    account,
    pool,
    collateral,
    positions,
    totalGreeks,
    netLiquidationValue0: nlv.value0,
    netLiquidationValue1: nlv.value1,
    maintenanceMargin0,
    maintenanceMargin1,
    marginExcess0,
    marginExcess1,
    marginShortfall0: liquidationCheck.marginShortfall0,
    marginShortfall1: liquidationCheck.marginShortfall1,
    currentMargin0: liquidationCheck.currentMargin0,
    currentMargin1: liquidationCheck.currentMargin1,
    isLiquidatable: liquidationCheck.isLiquidatable,
    liquidationPrices,
    healthStatus: pool.healthStatus,
    networkMismatch: false, // Requires wallet context, not available in read functions
    _meta: sharedMeta,
  }
}

/**
 * Parameters for getNetLiquidationValue.
 */
export interface GetNetLiquidationValueParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds of open positions */
  tokenIds: bigint[]
  /** Optional: Tick to calculate NLV at (defaults to current tick) */
  atTick?: bigint
  /** Optional: Whether to include pending premium */
  includePendingPremium?: boolean
  /** PanopticQuery address (required) */
  queryAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get net liquidation value for an account.
 *
 * ## Same-Block Guarantee
 * Tick and NLV are queried at the same target block.
 *
 * Requires PanopticQuery for accurate value and premium accounting.
 *
 * @param params - The parameters
 * @returns Net liquidation value with block metadata
 */
export async function getNetLiquidationValue(
  params: GetNetLiquidationValueParams,
): Promise<NetLiquidationValue> {
  const {
    client,
    poolAddress,
    account,
    tokenIds,
    atTick,
    includePendingPremium = true,
    queryAddress,
    blockNumber,
  } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Skip getCurrentTick RPC call when atTick is provided
  const [currentTickResult, _meta] = await Promise.all([
    atTick != null
      ? Promise.resolve(atTick)
      : client
          .readContract({
            address: poolAddress,
            abi: panopticPoolAbi,
            functionName: 'getCurrentTick',
            blockNumber: targetBlockNumber,
          })
          .then((r) => BigInt(r)),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const effectiveTick = currentTickResult

  const result = await client.readContract({
    address: queryAddress,
    abi: panopticQueryAbi,
    functionName: 'getNetLiquidationValue',
    args: [poolAddress, account, includePendingPremium, tokenIds, Number(effectiveTick)],
    blockNumber: targetBlockNumber,
  })

  const [value0, value1] = result

  return {
    value0,
    value1,
    atTick: effectiveTick,
    includedPendingPremium: includePendingPremium,
    _meta,
  }
}

/**
 * Parameters for getLiquidationPrices.
 */
export interface GetLiquidationPricesParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds of open positions */
  tokenIds: bigint[]
  /** PanopticQuery address (required) */
  queryAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get liquidation prices for an account.
 *
 * ## Same-Block Guarantee
 * Liquidation price query is made at a single block.
 *
 * @param params - The parameters
 * @returns Liquidation prices with block metadata
 */
export async function getLiquidationPrices(
  params: GetLiquidationPricesParams,
): Promise<LiquidationPrices> {
  const { client, poolAddress, account, tokenIds, queryAddress, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // MIN_TICK and MAX_TICK indicate no liquidation at that boundary
  const MIN_TICK = -887272n
  const MAX_TICK = 887272n

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getLiquidationPrices',
      args: [poolAddress, account, tokenIds],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // Convert from number (abitype default for int24) to bigint (viem runtime type)
  const liqPriceDown = BigInt(result[0])
  const liqPriceUp = BigInt(result[1])

  return {
    lowerTick: liqPriceDown === MIN_TICK ? null : liqPriceDown,
    upperTick: liqPriceUp === MAX_TICK ? null : liqPriceUp,
    isLiquidatable: liqPriceDown !== MIN_TICK || liqPriceUp !== MAX_TICK,
    _meta,
  }
}
