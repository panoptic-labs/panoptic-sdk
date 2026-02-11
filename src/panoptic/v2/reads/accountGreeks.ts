/**
 * Account greeks calculation using stored position data.
 *
 * This module provides functions to calculate account-level greeks
 * using position data stored by syncPositions(). Only the current tick
 * is fetched via RPC - all other data comes from storage.
 *
 * @module v2/reads/accountGreeks
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import { PanopticError, StorageDataNotFoundError } from '../errors'
import { tickToSqrtPriceX96 } from '../formatters'
import {
  type PositionGreeksResult,
  calculatePositionDelta,
  calculatePositionGamma,
  calculatePositionValue,
} from '../greeks'
import type { StorageAdapter } from '../storage'
import { getPoolMetaKey, getPositionMetaKey, getPositionsKey, jsonSerializer } from '../storage'
import type { BlockMeta, StoredPoolMeta, StoredPositionData } from '../types'
import { type CollateralAddresses, getAccountCollateral } from './account'

const Q192 = 1n << 192n

/**
 * Parameters for getAccountGreeks.
 */
export interface GetAccountGreeksParams {
  /** viem PublicClient (only used to fetch current tick) */
  client: PublicClient
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Storage adapter containing synced position data */
  storage: StorageAdapter
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /**
   * When true, include collateral token balance as linear delta.
   * Requires `assetIndex` to specify which token is the asset.
   */
  includeCollateral?: boolean
  /**
   * Which token is the "asset" (the directional exposure token).
   * 0n = token0 is asset, 1n = token1 is asset.
   * Required when `includeCollateral` is true.
   */
  assetIndex?: 0n | 1n
  /** Optional pre-fetched collateral addresses (used when includeCollateral is true) */
  collateralAddresses?: CollateralAddresses
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Result of getAccountGreeks.
 *
 * Returns both granular breakdown (positions vs collateral) and computed totals.
 * - `positionsDelta` / `positionsValue`: Options exposure only
 * - `collateralDelta` / `collateralValue`: Collateral in the pool
 * - `totalDelta` / `totalValue`: Sum of both (use for net portfolio greeks)
 *
 * All values are in natural token smallest units (no WAD scaling).
 * - Value/gamma: numeraire token smallest units
 * - Delta: asset token smallest units
 */
export interface AccountGreeksResult {
  // --- Position greeks (options only) ---
  /** Sum of position values (numeraire smallest units, options only) */
  positionsValue: bigint
  /** Sum of position deltas (asset smallest units, options only) */
  positionsDelta: bigint
  /** Sum of position gammas (numeraire smallest units) */
  positionsGamma: bigint

  // --- Collateral greeks ---
  /**
   * Value of collateral holdings: asset balance × price + numeraire balance.
   * In numeraire smallest units. 0n when includeCollateral is not set.
   */
  collateralValue: bigint
  /**
   * Linear delta from the asset token's collateral balance (asset smallest units).
   * 0n when includeCollateral is not set.
   */
  collateralDelta: bigint

  // --- Computed totals ---
  /** Total portfolio value = positionsValue + collateralValue */
  totalValue: bigint
  /** Total portfolio delta = positionsDelta + collateralDelta */
  totalDelta: bigint

  // --- Metadata ---
  /** Number of positions included */
  positionCount: bigint
  /** Per-position greeks breakdown */
  positions: Array<{
    tokenId: bigint
    greeks: PositionGreeksResult
  }>
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Calculate account-level greeks using stored position data.
 *
 * This function reads position data from storage (populated by syncPositions)
 * and calculates greeks client-side. Only the current tick is fetched via RPC.
 *
 * @param params - The parameters
 * @returns Account greeks with per-position breakdown
 * @throws StorageDataNotFoundError if required data is not in storage
 * @throws PanopticError if includeCollateral is true but assetIndex is not provided
 *
 * @example
 * ```typescript
 * // First sync positions to populate storage
 * await syncPositions({ client, chainId, poolAddress, account, storage })
 *
 * // Then calculate greeks from stored data
 * const greeks = await getAccountGreeks({
 *   client,
 *   chainId,
 *   poolAddress,
 *   account,
 *   storage,
 * })
 *
 * console.log('Positions delta:', greeks.positionsDelta)
 * ```
 */
export async function getAccountGreeks(
  params: GetAccountGreeksParams,
): Promise<AccountGreeksResult> {
  const {
    client,
    chainId,
    poolAddress,
    account,
    storage,
    blockNumber,
    includeCollateral,
    assetIndex,
    collateralAddresses,
  } = params

  // 0. Validate: includeCollateral requires assetIndex
  if (includeCollateral && assetIndex === undefined) {
    throw new PanopticError('assetIndex is required when includeCollateral is true')
  }

  // 1. Read pool metadata from storage
  const poolMetaKey = getPoolMetaKey(chainId, poolAddress)
  const poolMetaRaw = await storage.get(poolMetaKey)
  if (!poolMetaRaw) {
    throw new StorageDataNotFoundError('poolMeta', poolMetaKey)
  }
  const poolMeta = jsonSerializer.parse(poolMetaRaw) as StoredPoolMeta

  // 2. Read position IDs from storage
  const positionsKey = getPositionsKey(chainId, poolAddress, account)
  const positionsRaw = await storage.get(positionsKey)
  if (!positionsRaw) {
    throw new StorageDataNotFoundError('positions', positionsKey)
  }
  const positionIds = jsonSerializer.parse(positionsRaw) as bigint[]

  // 3. If no positions and no collateral requested, return zeros
  if (positionIds.length === 0 && !includeCollateral) {
    const targetBlock = blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())
    const _meta = params._meta ?? (await getBlockMeta({ client, blockNumber: targetBlock }))

    return {
      positionsValue: 0n,
      positionsDelta: 0n,
      positionsGamma: 0n,
      collateralValue: 0n,
      collateralDelta: 0n,
      totalValue: 0n,
      totalDelta: 0n,
      positionCount: 0n,
      positions: [],
      _meta,
    }
  }

  // 4. Read position metadata for each position from storage
  const storedPositions = await Promise.all(
    positionIds.map(async (tokenId) => {
      const posMetaKey = getPositionMetaKey(chainId, poolAddress, tokenId)
      const posMetaRaw = await storage.get(posMetaKey)
      if (!posMetaRaw) {
        throw new StorageDataNotFoundError('positionMeta', posMetaKey)
      }
      return jsonSerializer.parse(posMetaRaw) as StoredPositionData
    }),
  )

  // 5. Fetch current tick (+ collateral if requested) from RPC
  const targetBlock = blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  const [currentTick, _meta, collateral] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'getCurrentTick',
      blockNumber: targetBlock,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlock }),
    includeCollateral
      ? getAccountCollateral({
          client,
          poolAddress,
          account,
          blockNumber: targetBlock,
          collateralAddresses,
          _meta: params._meta,
        })
      : undefined,
  ])

  // 6. Calculate greeks for each position
  let positionsValue = 0n
  let positionsDelta = 0n
  let positionsGamma = 0n
  const positions: AccountGreeksResult['positions'] = []

  for (const pos of storedPositions) {
    const input = {
      legs: pos.legs,
      currentTick: BigInt(currentTick),
      mintTick: pos.tickAtMint,
      positionSize: pos.positionSize,
      poolTickSpacing: poolMeta.tickSpacing,
      assetIndex,
    }

    const value = calculatePositionValue(input)
    const delta = calculatePositionDelta(input)
    const gamma = calculatePositionGamma(input)

    positionsValue += value
    positionsDelta += delta
    positionsGamma += gamma

    positions.push({
      tokenId: pos.tokenId,
      greeks: { value, delta, gamma },
    })
  }

  // 7. Collateral value and delta
  let collateralValue = 0n
  let collateralDelta = 0n

  if (collateral) {
    const isAssetToken0 = assetIndex === 0n
    const assetBal = isAssetToken0 ? collateral.token0.assets : collateral.token1.assets
    const otherBal = isAssetToken0 ? collateral.token1.assets : collateral.token0.assets
    const sqrtPriceX96 = tickToSqrtPriceX96(BigInt(currentTick))

    // assetBal * price converts asset smallest units to numeraire smallest units
    // otherBal is already in numeraire smallest units
    if (isAssetToken0) {
      // price = token1/token0 = sqrtPriceX96² / 2¹⁹²
      collateralValue = (assetBal * sqrtPriceX96 * sqrtPriceX96) / Q192 + otherBal
    } else {
      // price = token0/token1 = 2¹⁹² / sqrtPriceX96²
      collateralValue = (assetBal * Q192) / (sqrtPriceX96 * sqrtPriceX96) + otherBal
    }
    collateralDelta = assetBal
  }

  return {
    positionsValue,
    positionsDelta,
    positionsGamma,
    collateralValue,
    collateralDelta,
    totalValue: positionsValue + collateralValue,
    totalDelta: positionsDelta + collateralDelta,
    positionCount: BigInt(positionIds.length),
    positions,
    _meta,
  }
}

/**
 * Parameters for calculateAccountGreeksPure.
 */
export interface CalculateAccountGreeksPureParams {
  /** Stored position data */
  positions: StoredPositionData[]
  /** Pool tick spacing */
  tickSpacing: bigint
  /** Ticks at which to evaluate greeks (one or more) */
  atTicks: bigint[]
  /**
   * Collateral balances [token0Assets, token1Assets] in token smallest units.
   * When provided, both tokens are included in totalValue and the
   * asset token's balance is added to totalDelta.
   */
  collateralAssets?: [bigint, bigint]
  /** Override for leg.asset on all legs (0n = token0 is asset, 1n = token1). Defaults to 0n. */
  assetIndex?: bigint
}

/**
 * Result of calculateAccountGreeksPure.
 *
 * Arrays are parallel to the input `atTicks` — index i corresponds to `atTicks[i]`.
 * Totals include both position greeks and collateral contributions.
 * All values in natural token smallest units (no WAD scaling).
 */
export interface AccountGreeksCurveResult {
  /** Total value at each tick: positions + collateral (numeraire smallest units) */
  totalValue: bigint[]
  /** Total delta at each tick: positions + asset collateral (asset smallest units) */
  totalDelta: bigint[]
  /** Total gamma at each tick: positions only (numeraire smallest units, collateral has zero gamma) */
  totalGamma: bigint[]
  /** Number of positions included */
  positionCount: bigint
  /** Per-position greeks curves (arrays parallel to atTicks) */
  positions: Array<{
    tokenId: bigint
    greeks: {
      value: bigint[]
      delta: bigint[]
      gamma: bigint[]
    }
  }>
}

/**
 * Pure function to calculate portfolio greeks across a range of ticks.
 *
 * No RPC calls — useful for plotting value/delta/gamma curves on a chart.
 * All returned arrays are parallel to the input `atTicks`.
 *
 * When `collateralAssets` is provided, both token balances are included in
 * `totalValue` (asset balance × price + numeraire balance) and
 * the asset token's balance is added to `totalDelta`.
 *
 * @param params - The parameters
 * @returns Portfolio greeks curves and per-position breakdown
 */
export function calculateAccountGreeksPure(
  params: CalculateAccountGreeksPureParams,
): AccountGreeksCurveResult {
  const { positions, tickSpacing, atTicks, collateralAssets, assetIndex } = params
  const n = atTicks.length
  const isAssetToken0 = assetIndex === undefined || assetIndex === 0n

  // Collateral balances (already in token smallest units)
  const assetBal = collateralAssets ? collateralAssets[isAssetToken0 ? 0 : 1] : 0n
  const otherBal = collateralAssets ? collateralAssets[isAssetToken0 ? 1 : 0] : 0n

  if (positions.length === 0) {
    const totalValue: bigint[] = []
    const totalDelta: bigint[] = []
    for (let i = 0; i < n; i++) {
      const sqrtPriceX96 = tickToSqrtPriceX96(atTicks[i])
      const assetValueInNumeraire = isAssetToken0
        ? (assetBal * sqrtPriceX96 * sqrtPriceX96) / Q192
        : (assetBal * Q192) / (sqrtPriceX96 * sqrtPriceX96)
      totalValue.push(assetValueInNumeraire + otherBal)
      totalDelta.push(assetBal)
    }
    return {
      totalValue,
      totalDelta,
      totalGamma: new Array<bigint>(n).fill(0n),
      positionCount: 0n,
      positions: [],
    }
  }

  const totalValue = new Array<bigint>(n).fill(0n)
  const totalDelta = new Array<bigint>(n).fill(0n)
  const totalGamma = new Array<bigint>(n).fill(0n)
  const positionResults: AccountGreeksCurveResult['positions'] = []

  for (const pos of positions) {
    const posValues: bigint[] = []
    const posDeltas: bigint[] = []
    const posGammas: bigint[] = []

    for (let i = 0; i < n; i++) {
      const input = {
        legs: pos.legs,
        currentTick: atTicks[i],
        mintTick: pos.tickAtMint,
        positionSize: pos.positionSize,
        poolTickSpacing: tickSpacing,
        assetIndex,
      }

      const v = calculatePositionValue(input)
      const d = calculatePositionDelta(input)
      const g = calculatePositionGamma(input)

      posValues.push(v)
      posDeltas.push(d)
      posGammas.push(g)

      totalValue[i] += v
      totalDelta[i] += d
      totalGamma[i] += g
    }

    positionResults.push({
      tokenId: pos.tokenId,
      greeks: { value: posValues, delta: posDeltas, gamma: posGammas },
    })
  }

  // Add collateral contributions at each tick
  for (let i = 0; i < n; i++) {
    const sqrtPriceX96 = tickToSqrtPriceX96(atTicks[i])
    const assetValueInNumeraire = isAssetToken0
      ? (assetBal * sqrtPriceX96 * sqrtPriceX96) / Q192
      : (assetBal * Q192) / (sqrtPriceX96 * sqrtPriceX96)
    totalValue[i] += assetValueInNumeraire + otherBal
    totalDelta[i] += assetBal
  }

  return {
    totalValue,
    totalDelta,
    totalGamma,
    positionCount: BigInt(positions.length),
    positions: positionResults,
  }
}
