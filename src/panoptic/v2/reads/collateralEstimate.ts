/**
 * Collateral estimation functions for the Panoptic v2 SDK.
 *
 * These functions require the PanopticQuery contract which provides
 * on-chain calculation capabilities for collateral requirements.
 *
 * @module v2/reads/collateralEstimate
 */

import type { Address, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients/blockMeta'
import { PanopticError, PanopticHelperNotDeployedError } from '../errors'
import { type TokenFlow, simulateWithTokenFlow } from '../simulations/tokenFlow'
import type { StorageAdapter } from '../storage'
import { getTrackedPositionIds } from '../sync/getTrackedPositionIds'
import type { BlockMeta } from '../types'
import { MAX_TICK, MIN_TICK } from '../utils/constants'

/**
 * Collateral estimate result.
 */
export interface CollateralEstimate {
  /** Required collateral for token 0 */
  required0: bigint
  /** Required collateral for token 1 */
  required1: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for estimateCollateralRequired.
 */
export interface EstimateCollateralRequiredParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenId to estimate collateral for */
  tokenId: bigint
  /** Position size (number of contracts) */
  positionSize: bigint
  /** Optional: Tick to calculate collateral at (defaults to current tick) */
  atTick?: bigint
  /** PanopticQuery address (required for collateral estimates) */
  queryAddress?: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Estimate the collateral required to open a position.
 *
 * Note: This function uses PanopticQuery.getRequiredBase for estimation.
 * Returns collateral requirement in terms of token0.
 *
 * @param params - The parameters
 * @returns Estimated collateral requirements with block metadata
 * @throws PanopticHelperNotDeployedError - PanopticQuery contract is required
 */
export async function estimateCollateralRequired(
  params: EstimateCollateralRequiredParams,
): Promise<CollateralEstimate> {
  const { client, poolAddress, tokenId, atTick, queryAddress, blockNumber } = params

  if (!queryAddress) {
    throw new PanopticHelperNotDeployedError()
  }

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Get current tick if not provided
  let effectiveTick: bigint
  if (atTick !== undefined) {
    effectiveTick = atTick
  } else {
    const currentTickResult = await client.readContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'getCurrentTick',
      blockNumber: targetBlockNumber,
    })
    // Bridge type from panopticPoolAbi (number | bigint) to bigint
    effectiveTick = BigInt(currentTickResult)
  }

  const [required0, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getRequiredBase',
      args: [poolAddress, tokenId, Number(effectiveTick)],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // PanopticQuery.getRequiredBase returns collateral requirement in terms of token0
  // For token1 requirement, would need additional conversion or separate call
  return {
    required0,
    required1: 0n, // Not available from getRequiredBase (token0-denominated only)
    _meta,
  }
}

/**
 * Max position size result.
 */
export interface MaxPositionSize {
  /** Refined maximum position size at current market conditions */
  maxSize: bigint
  /** Maximum position size at 0% utilization (best case / upper bound) */
  maxSizeAtMinUtil: bigint
  /** Maximum position size at 100% utilization (worst case / lower bound) */
  maxSizeAtMaxUtil: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for getMaxPositionSize.
 */
export interface GetMaxPositionSizeParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenId to check max size for */
  tokenId: bigint
  /** PanopticQuery address (required for this function) */
  queryAddress: Address
  /**
   * Existing position IDs held by the account.
   * - If provided, uses these directly
   * - If not provided but storage + chainId given, fetches from getTrackedPositionIds()
   * - If neither provided, assumes empty array (new account with no positions)
   */
  existingPositionIds?: bigint[]
  /** Storage adapter for auto-fetching positions (requires chainId) */
  storage?: StorageAdapter
  /** Chain ID (required if using storage) */
  chainId?: bigint
  /** Whether to refine with dispatch simulation (default: true) */
  refine?: boolean
  /** Precision for binary search as percentage (default: 1 = 1%) */
  precisionPct?: number
  /** Whether to swap tokens at mint (affects collateral requirements, default: false) */
  swapAtMint?: boolean
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get the maximum position size an account can open given their current collateral.
 *
 * Uses PanopticQuery.getMaxPositionSizeBounds to get bounds at 0% and 100% utilization,
 * then refines with dispatch simulations to find the exact max at current conditions.
 *
 * @param params - The parameters
 * @returns Maximum position size with bounds and block metadata
 * @throws PanopticHelperNotDeployedError - PanopticQuery contract is required but not provided
 */
export async function getMaxPositionSize(
  params: GetMaxPositionSizeParams,
): Promise<MaxPositionSize> {
  const {
    client,
    poolAddress,
    account,
    tokenId,
    queryAddress,
    existingPositionIds,
    storage,
    chainId,
    refine = true,
    precisionPct = 1,
    swapAtMint = false,
    blockNumber,
  } = params

  if (!queryAddress) {
    throw new PanopticHelperNotDeployedError()
  }

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Get existing position IDs
  let positionIds: bigint[]
  if (existingPositionIds !== undefined) {
    // Use explicitly provided position IDs
    positionIds = existingPositionIds
  } else if (storage && chainId !== undefined) {
    // Fetch from local cache via getTrackedPositionIds
    positionIds = await getTrackedPositionIds({
      chainId,
      poolAddress,
      account,
      storage,
    })
  } else {
    // Assume new account with no existing positions
    positionIds = []
  }
  // Get bounds and block meta in parallel
  const [boundsResult, _meta] = await Promise.all([
    client.readContract({
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getMaxPositionSizeBounds',
      args: [poolAddress, positionIds, account, tokenId],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [maxSizeAtMinUtil, maxSizeAtMaxUtil] = boundsResult

  // If bounds are equal or very close, or refinement disabled, return conservative estimate
  const precisionDivisor = BigInt(Math.floor(100 / precisionPct))
  if (
    !refine ||
    maxSizeAtMinUtil === maxSizeAtMaxUtil ||
    maxSizeAtMinUtil - maxSizeAtMaxUtil <= maxSizeAtMaxUtil / precisionDivisor
  ) {
    return {
      maxSize: maxSizeAtMaxUtil,
      maxSizeAtMinUtil,
      maxSizeAtMaxUtil,
      _meta,
    }
  }

  // Binary search between widened bounds using dispatch simulation
  // Widen by 100x in each direction to capture swapAtMint differences
  const maxSize = await binarySearchMaxSize({
    client,
    poolAddress,
    account,
    tokenId,
    existingPositionIds: positionIds,
    low: maxSizeAtMaxUtil / 100n,
    high: maxSizeAtMinUtil * 100n,
    precisionDivisor,
    swapAtMint,
  })

  return {
    maxSize,
    maxSizeAtMinUtil,
    maxSizeAtMaxUtil,
    _meta,
  }
}

/**
 * Binary search to find exact max position size using dispatch simulation.
 */
async function binarySearchMaxSize(params: {
  client: PublicClient
  poolAddress: Address
  account: Address
  tokenId: bigint
  existingPositionIds: bigint[]
  low: bigint
  high: bigint
  precisionDivisor: bigint
  swapAtMint: boolean
}): Promise<bigint> {
  const {
    client,
    poolAddress,
    account,
    tokenId,
    existingPositionIds,
    precisionDivisor,
    swapAtMint,
  } = params
  let { low, high } = params

  // Binary search with relative precision (e.g., 20n = 5%, 10n = 10%)
  while (high - low > 1n && high - low > low / precisionDivisor) {
    const mid = low + (high - low) / 2n

    const success = await tryDispatchSimulation({
      client,
      poolAddress,
      account,
      tokenId,
      existingPositionIds,
      positionSize: mid,
      swapAtMint,
    })

    if (success) {
      low = mid
    } else {
      high = mid
    }
  }

  return low
}

/**
 * Try to simulate opening a position with the given size.
 */
async function tryDispatchSimulation(params: {
  client: PublicClient
  poolAddress: Address
  account: Address
  tokenId: bigint
  existingPositionIds: bigint[]
  positionSize: bigint
  swapAtMint: boolean
}): Promise<boolean> {
  const { client, poolAddress, account, tokenId, existingPositionIds, positionSize, swapAtMint } =
    params

  try {
    // Build final position list (existing + new position)
    const finalPositionIdList = [...existingPositionIds, tokenId]

    // Build tick limits based on swapAtMint flag:
    // - swapAtMint=true: descending order (high, low) triggers SFPM swap
    // - swapAtMint=false: ascending order (low, high) no swap
    const tickLimits: readonly [number, number, number] = swapAtMint
      ? [887272, -887272, 0]
      : [-887272, 887272, 0]

    // Encode dispatch call
    const callData = encodeFunctionData({
      abi: panopticPoolAbi,
      functionName: 'dispatch',
      args: [
        [tokenId],
        finalPositionIdList,
        [positionSize as unknown as bigint & { readonly __uint128: true }],
        [tickLimits],
        true, // usePremiaAsCollateral
        0n, // builderCode
      ],
    })

    // Use PanopticPool.multicall to simulate
    await client.simulateContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'multicall',
      args: [[callData]],
      account,
    })

    return true
  } catch {
    return false
  }
}

/**
 * Parameters for getRequiredCreditForITM.
 */
export interface GetRequiredCreditForITMParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenId to check */
  tokenId: bigint
  /** Position size (number of contracts) */
  positionSize: bigint
  /** Existing position IDs held by the account (defaults to empty) */
  existingPositionIds?: bigint[]
  /** Optional block number for simulation */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Result for getRequiredCreditForITM.
 */
export interface RequiredCreditForITM {
  /**
   * Required credit in token0 to neutralize ITM exposure.
   * Positive = credit needed (deposit), negative = loan proceeds (receive).
   */
  creditAmount0: bigint
  /**
   * Required credit in token1 to neutralize ITM exposure.
   * Positive = credit needed (deposit), negative = loan proceeds (receive).
   */
  creditAmount1: bigint
  /** The raw token flow from simulation */
  tokenFlow: TokenFlow
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Get the required credit (or loan) amount for an ITM position.
 *
 * Simulates opening the position with swapAtMint=true (descending tickLimits)
 * to get single-sided token flow. The token flow represents the ITM amount
 * that would need to be neutralized with a credit (or loan if negative).
 *
 * @param params - The parameters
 * @returns Required credit amounts with token flow and block metadata
 * @throws PanopticError - If simulation fails
 *
 * @example
 * ```typescript
 * const result = await getRequiredCreditForITM({
 *   client,
 *   poolAddress,
 *   account,
 *   tokenId,
 *   positionSize: 1n,
 * })
 *
 * if (result.creditAmount0 > 0n) {
 *   console.log('Need credit of', result.creditAmount0, 'token0')
 * } else if (result.creditAmount0 < 0n) {
 *   console.log('Position yields loan of', -result.creditAmount0, 'token0')
 * }
 * ```
 */
export async function getRequiredCreditForITM(
  params: GetRequiredCreditForITMParams,
): Promise<RequiredCreditForITM> {
  const {
    client,
    poolAddress,
    account,
    tokenId,
    positionSize,
    existingPositionIds = [],
    blockNumber,
  } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Build final position list (existing + new position)
  const finalPositionIdList = [...existingPositionIds, tokenId]

  // Encode dispatch call with swapAtMint=true (descending tickLimits)
  // Descending order (MAX_TICK > MIN_TICK) triggers SFPM swap, giving single-sided token flow
  const callData = encodeFunctionData({
    abi: panopticPoolAbi,
    functionName: 'dispatch',
    args: [
      [tokenId], // positionIdList: positions being minted
      finalPositionIdList,
      [positionSize as unknown as bigint & { readonly __uint128: true }],
      [[Number(MAX_TICK), Number(MIN_TICK), 0] as readonly [number, number, number]], // Descending = swapAtMint
      false, // usePremiaAsCollateral
      0n, // builderCode
    ],
  })

  // Simulate with token flow measurement and get block meta in parallel
  const [result, _meta] = await Promise.all([
    simulateWithTokenFlow({
      client,
      poolAddress,
      user: account,
      callData,
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  if (!result.success || !result.tokenFlow) {
    throw new PanopticError(result.error ?? 'Token flow simulation failed')
  }

  // The token flow deltas represent the ITM amount:
  // - Negative delta = user deposits (credit needed)
  // - Positive delta = user receives (loan proceeds)
  // We invert the sign so positive = credit needed, negative = loan
  return {
    creditAmount0: -result.tokenFlow.delta0,
    creditAmount1: -result.tokenFlow.delta1,
    tokenFlow: result.tokenFlow,
    _meta,
  }
}
