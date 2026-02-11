/**
 * Position read functions for the Panoptic v2 SDK.
 * @module v2/reads/position
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import { calculatePositionGreeks } from '../greeks'
import type { BlockMeta, Position, PositionGreeks, TokenIdLeg } from '../types'
import { decodePosition, decodeTickSpacing } from '../utils/option-encoding-v2'

/**
 * Parameters for getPosition.
 */
export interface GetPositionParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Owner address */
  owner: Address
  /** TokenId to query */
  tokenId: bigint
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get a single position by tokenId.
 *
 * @param params - The parameters
 * @returns Position data with block metadata
 */
export async function getPosition(params: GetPositionParams): Promise<Position> {
  const { client, poolAddress, owner, tokenId, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  const [positionData, _meta] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'positionData',
      args: [owner, tokenId],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  // positionData returns: (bool, uint256, uint256, int24, int256, int256, uint128)
  // These are: swapAtMint, blockAtMint, timestampAtMint, tickAtMint, utilization0AtMint, utilization1AtMint, positionSize
  const [
    swapAtMint,
    blockAtMint,
    timestampAtMint,
    tickAtMint,
    utilization0AtMint,
    utilization1AtMint,
    positionSize,
  ] = positionData

  // Decode the tokenId to get legs
  const decoded = decodePosition(tokenId)
  const tickSpacing = decodeTickSpacing(tokenId)

  // Convert decoded legs to TokenIdLeg format
  const legs: TokenIdLeg[] = decoded.legs.map((leg) => {
    const width = leg.width
    const strike = leg.strike
    // Calculate tick bounds based on strike and width
    const tickLower = strike - (width * tickSpacing) / 2n
    const tickUpper = strike + (width * tickSpacing) / 2n

    return {
      index: BigInt(leg.index),
      asset: leg.asset,
      optionRatio: leg.optionRatio,
      isLong: leg.isLong === 1n,
      tokenType: leg.tokenType,
      riskPartner: leg.riskPartner,
      strike,
      width,
      tickLower,
      tickUpper,
    }
  })

  return {
    tokenId,
    positionSize,
    owner,
    poolAddress,
    legs,
    poolUtilization0AtMint: utilization0AtMint,
    poolUtilization1AtMint: utilization1AtMint,
    tickAtMint: BigInt(tickAtMint),
    timestampAtMint,
    blockNumberAtMint: blockAtMint,
    swapAtMint,
    premiaOwed0: 0n, // Premia now tracked separately, not returned from positionData
    premiaOwed1: 0n,
    assetIndex: legs.length > 0 ? legs[0].asset : 0n,
    _meta,
  }
}

/**
 * Parameters for getPositions.
 */
export interface GetPositionsParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Owner address */
  owner: Address
  /** TokenIds to query */
  tokenIds: bigint[]
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get multiple positions for an account.
 *
 * @param params - The parameters
 * @returns Array of positions with block metadata
 */
export async function getPositions(
  params: GetPositionsParams,
): Promise<{ positions: Position[]; _meta: BlockMeta }> {
  const { client, poolAddress, owner, tokenIds, blockNumber } = params

  if (tokenIds.length === 0) {
    const _meta =
      params._meta ??
      (await getBlockMeta({
        client,
        blockNumber: blockNumber ?? (await client.getBlockNumber()),
      }))
    return { positions: [], _meta }
  }

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Use multicall to get all position data in a single RPC call
  const [multicallResults, _meta] = await Promise.all([
    client.multicall({
      contracts: tokenIds.map((tokenId) => ({
        address: poolAddress,
        abi: panopticPoolAbi,
        functionName: 'positionData' as const,
        args: [owner, tokenId] as const,
      })),
      blockNumber: targetBlockNumber,
      allowFailure: true,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const positions: Position[] = []

  for (let i = 0; i < tokenIds.length; i++) {
    const result = multicallResults[i]
    if (result.status !== 'success') {
      continue // Skip failed calls
    }

    const tokenId = tokenIds[i]
    const [
      swapAtMint,
      blockAtMint,
      timestampAtMint,
      tickAtMint,
      utilization0AtMint,
      utilization1AtMint,
      positionSize,
    ] = result.result

    // Skip positions with zero size
    if (positionSize === 0n) {
      continue
    }

    // Decode the tokenId to get legs
    const decoded = decodePosition(tokenId)
    const tickSpacing = decodeTickSpacing(tokenId)

    // Convert decoded legs to TokenIdLeg format
    const legs: TokenIdLeg[] = decoded.legs.map((leg) => {
      const width = leg.width
      const strike = leg.strike
      const tickLower = strike - (width * tickSpacing) / 2n
      const tickUpper = strike + (width * tickSpacing) / 2n

      return {
        index: BigInt(leg.index),
        asset: leg.asset,
        optionRatio: leg.optionRatio,
        isLong: leg.isLong === 1n,
        tokenType: leg.tokenType,
        riskPartner: leg.riskPartner,
        strike,
        width,
        tickLower,
        tickUpper,
      }
    })

    positions.push({
      tokenId,
      positionSize,
      owner,
      poolAddress,
      legs,
      poolUtilization0AtMint: utilization0AtMint,
      poolUtilization1AtMint: utilization1AtMint,
      tickAtMint: BigInt(tickAtMint),
      timestampAtMint,
      blockNumberAtMint: blockAtMint,
      swapAtMint,
      premiaOwed0: 0n, // Premia now tracked separately
      premiaOwed1: 0n,
      assetIndex: legs.length > 0 ? legs[0].asset : 0n,
      _meta,
    })
  }

  return { positions, _meta }
}

/**
 * Parameters for getPositionGreeks.
 */
export interface GetPositionGreeksParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Owner address */
  owner: Address
  /** TokenId to calculate greeks for */
  tokenId: bigint
  /** Optional: Current tick override (defaults to pool's current tick) */
  atTick?: bigint
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Get Greeks for a position.
 *
 * Uses client-side calculation based on the position's legs, current tick,
 * and mint tick. Returns WAD-scaled (1e18) bigint values.
 *
 * @param params - The parameters
 * @returns Position greeks with block metadata
 */
export async function getPositionGreeks(
  params: GetPositionGreeksParams,
): Promise<PositionGreeks & { _meta: BlockMeta }> {
  const { client, poolAddress, owner, tokenId, atTick, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Get position data and current tick in parallel
  const [positionData, currentTickResult, _meta] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'positionData',
      args: [owner, tokenId],
      blockNumber: targetBlockNumber,
    }),
    atTick === undefined
      ? client.readContract({
          address: poolAddress,
          abi: panopticPoolAbi,
          functionName: 'getCurrentTick',
          blockNumber: targetBlockNumber,
        })
      : Promise.resolve(atTick),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [, , , tickAtMint, , , positionSize] = positionData

  // Decode the tokenId to get legs
  const decoded = decodePosition(tokenId)
  const tickSpacing = decodeTickSpacing(tokenId)

  // Convert decoded legs to TokenIdLeg format
  const legs: TokenIdLeg[] = decoded.legs.map((leg) => {
    const width = leg.width
    const strike = leg.strike
    const tickLower = strike - (width * tickSpacing) / 2n
    const tickUpper = strike + (width * tickSpacing) / 2n

    return {
      index: BigInt(leg.index),
      asset: leg.asset,
      optionRatio: leg.optionRatio,
      isLong: leg.isLong === 1n,
      tokenType: leg.tokenType,
      riskPartner: leg.riskPartner,
      strike,
      width,
      tickLower,
      tickUpper,
    }
  })

  const currentTick =
    typeof currentTickResult === 'bigint' ? currentTickResult : BigInt(currentTickResult)

  // Calculate greeks using client-side implementation
  const greeks = calculatePositionGreeks({
    legs,
    currentTick,
    mintTick: BigInt(tickAtMint),
    positionSize,
    poolTickSpacing: tickSpacing,
  })

  return {
    ...greeks,
    _meta,
  }
}
