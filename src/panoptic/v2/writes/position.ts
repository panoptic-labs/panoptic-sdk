/**
 * Position operations for the Panoptic v2 SDK.
 * @module v2/writes/position
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { InvalidTickLimitsError } from '../errors'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { submitWrite } from './utils'

/**
 * Tick and spread limits for position operations.
 * [tickLimitLow, tickLimitHigh, spreadLimitTick]
 *
 * SDK uses bigint for all numerics. Converted to number at viem boundary.
 *
 * @deprecated Use individual tickLimitLow, tickLimitHigh, spreadLimit params with swapAtMint flag
 */
export type TickAndSpreadLimits = readonly [bigint, bigint, bigint]

/**
 * Parameters for opening a position.
 */
export interface OpenPositionParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Existing position IDs held by the account (before this mint) */
  existingPositionIds: bigint[]
  /** TokenId of the position to open */
  tokenId: bigint
  /** Position size (number of contracts) */
  positionSize: bigint
  /**
   * Lower tick limit (always <= tickLimitHigh).
   * Use MIN_TICK (-887272n) to allow any downward price movement.
   */
  tickLimitLow: bigint
  /**
   * Upper tick limit (always >= tickLimitLow).
   * Use MAX_TICK (887272n) to allow any upward price movement.
   */
  tickLimitHigh: bigint
  /** Spread limit tick (use 0n for no spread limit) */
  spreadLimit?: bigint
  /**
   * Whether to swap tokens at mint to achieve single-sided exposure.
   * When true, tickLimits are passed to dispatch in descending order (high, low).
   * When false (default), tickLimits are passed in ascending order (low, high).
   */
  swapAtMint?: boolean
  /** Whether to use premia as collateral */
  usePremiaAsCollateral?: boolean
  /** Builder code (defaults to 0) */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Open a new position using dispatch.
 *
 * @param params - Position parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * import { MIN_TICK, MAX_TICK } from '@panoptic/sdk'
 *
 * const result = await openPosition({
 *   client,
 *   walletClient,
 *   account,
 *   poolAddress,
 *   existingPositionIds: [], // Existing positions held before this mint
 *   tokenId,
 *   positionSize: 1n,
 *   tickLimitLow: MIN_TICK,
 *   tickLimitHigh: MAX_TICK,
 *   swapAtMint: false, // true for covered/single-sided exposure
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function openPosition(params: OpenPositionParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    existingPositionIds,
    tokenId,
    positionSize,
    tickLimitLow,
    tickLimitHigh,
    spreadLimit = 0n,
    swapAtMint = false,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    txOverrides,
  } = params

  // Validate tick limits
  if (tickLimitLow > tickLimitHigh) {
    throw new InvalidTickLimitsError(tickLimitLow, tickLimitHigh)
  }

  // Prepare position lists for dispatch:
  // - positionIdList: positions being minted in this call (just the new tokenId)
  // - finalPositionIdList: all positions the user will have after the mint
  const positionIdList = [tokenId]
  const finalPositionIdList = [...existingPositionIds, tokenId]

  // Position sizes array contains the size for the new position
  const positionSizes = [positionSize]

  // Build tick limits based on swapAtMint flag:
  // - swapAtMint=true: descending order (high, low) triggers SFPM swap
  // - swapAtMint=false: ascending order (low, high) no swap
  const tickLimits: readonly [number, number, number] = swapAtMint
    ? [Number(tickLimitHigh), Number(tickLimitLow), Number(spreadLimit)]
    : [Number(tickLimitLow), Number(tickLimitHigh), Number(spreadLimit)]

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'dispatch',
    args: [
      positionIdList,
      finalPositionIdList,
      positionSizes,
      [tickLimits],
      usePremiaAsCollateral,
      builderCode,
    ],
    txOverrides,
  })
}

/**
 * Open position and wait for confirmation.
 */
export async function openPositionAndWait(params: OpenPositionParams): Promise<TxReceipt> {
  const result = await openPosition(params)
  return result.wait()
}

/**
 * Parameters for closing a position.
 */
export interface ClosePositionParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Current position ID list */
  positionIdList: bigint[]
  /** TokenId of the position to close */
  tokenId: bigint
  /** Position size to close (use full size for complete close) */
  positionSize: bigint
  /**
   * Lower tick limit (always <= tickLimitHigh).
   * Use MIN_TICK (-887272n) to allow any downward price movement.
   */
  tickLimitLow: bigint
  /**
   * Upper tick limit (always >= tickLimitLow).
   * Use MAX_TICK (887272n) to allow any upward price movement.
   */
  tickLimitHigh: bigint
  /** Spread limit tick (use 0n for no spread limit) */
  spreadLimit?: bigint
  /**
   * Whether to swap tokens at burn to achieve single-sided exposure.
   * When true, tickLimits are passed to dispatch in descending order (high, low).
   * When false (default), tickLimits are passed in ascending order (low, high).
   */
  swapAtMint?: boolean
  /** Whether to use premia as collateral */
  usePremiaAsCollateral?: boolean
  /** Builder code (defaults to 0) */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Close an existing position using dispatch.
 *
 * @param params - Close parameters
 * @returns TxResult
 */
export async function closePosition(params: ClosePositionParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    positionIdList,
    tokenId,
    tickLimitLow,
    tickLimitHigh,
    spreadLimit = 0n,
    swapAtMint = false,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    txOverrides,
  } = params

  // Validate tick limits
  if (tickLimitLow > tickLimitHigh) {
    throw new InvalidTickLimitsError(tickLimitLow, tickLimitHigh)
  }

  // For closing, final list excludes the closed position
  const finalPositionIdList = positionIdList.filter((id) => id !== tokenId)

  // Build tick limits based on swapAtMint flag:
  // - swapAtMint=true: descending order (high, low) triggers SFPM swap
  // - swapAtMint=false: ascending order (low, high) no swap
  const tickLimits: readonly [number, number, number] = swapAtMint
    ? [Number(tickLimitHigh), Number(tickLimitLow), Number(spreadLimit)]
    : [Number(tickLimitLow), Number(tickLimitHigh), Number(spreadLimit)]

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'dispatch',
    args: [[tokenId], finalPositionIdList, [0n], [tickLimits], usePremiaAsCollateral, builderCode],
    txOverrides,
  })
}

/**
 * Close position and wait for confirmation.
 */
export async function closePositionAndWait(params: ClosePositionParams): Promise<TxReceipt> {
  const result = await closePosition(params)
  return result.wait()
}

/**
 * Parameters for rolling a position.
 */
export interface RollPositionParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Current position ID list */
  positionIdList: bigint[]
  /** TokenId of position to close */
  oldTokenId: bigint
  /** Size of position being closed */
  oldPositionSize: bigint
  /** TokenId of new position to open */
  newTokenId: bigint
  /** Size of new position */
  newPositionSize: bigint
  /** Lower tick limit for close (always <= closeTickLimitHigh) */
  closeTickLimitLow: bigint
  /** Upper tick limit for close (always >= closeTickLimitLow) */
  closeTickLimitHigh: bigint
  /** Spread limit for close (use 0n for no spread limit) */
  closeSpreadLimit?: bigint
  /** Whether to swap tokens when closing */
  closeSwapAtMint?: boolean
  /** Lower tick limit for open (always <= openTickLimitHigh) */
  openTickLimitLow: bigint
  /** Upper tick limit for open (always >= openTickLimitLow) */
  openTickLimitHigh: bigint
  /** Spread limit for open (use 0n for no spread limit) */
  openSpreadLimit?: bigint
  /** Whether to swap tokens when opening */
  openSwapAtMint?: boolean
  /** Whether to use premia as collateral */
  usePremiaAsCollateral?: boolean
  /** Builder code */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Roll a position (close one, open another) in a single transaction.
 *
 * @param params - Roll parameters
 * @returns TxResult
 */
export async function rollPosition(params: RollPositionParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    positionIdList,
    oldTokenId,
    oldPositionSize,
    newTokenId,
    newPositionSize,
    closeTickLimitLow,
    closeTickLimitHigh,
    closeSpreadLimit = 0n,
    closeSwapAtMint = false,
    openTickLimitLow,
    openTickLimitHigh,
    openSpreadLimit = 0n,
    openSwapAtMint = false,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    txOverrides,
  } = params

  // Validate tick limits
  if (closeTickLimitLow > closeTickLimitHigh) {
    throw new InvalidTickLimitsError(closeTickLimitLow, closeTickLimitHigh)
  }
  if (openTickLimitLow > openTickLimitHigh) {
    throw new InvalidTickLimitsError(openTickLimitLow, openTickLimitHigh)
  }

  // Final list: remove old, add new
  const finalPositionIdList = positionIdList.filter((id) => id !== oldTokenId).concat([newTokenId])

  // Position sizes for both operations
  const positionSizes = [oldPositionSize, newPositionSize]

  // Build tick limits based on swapAtMint flags
  const closeLimits: readonly [number, number, number] = closeSwapAtMint
    ? [Number(closeTickLimitHigh), Number(closeTickLimitLow), Number(closeSpreadLimit)]
    : [Number(closeTickLimitLow), Number(closeTickLimitHigh), Number(closeSpreadLimit)]

  const openLimits: readonly [number, number, number] = openSwapAtMint
    ? [Number(openTickLimitHigh), Number(openTickLimitLow), Number(openSpreadLimit)]
    : [Number(openTickLimitLow), Number(openTickLimitHigh), Number(openSpreadLimit)]

  return submitWrite({
    client,
    walletClient,
    account,
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'dispatch',
    args: [
      positionIdList,
      finalPositionIdList,
      positionSizes as bigint[],
      [closeLimits, openLimits],
      usePremiaAsCollateral,
      builderCode,
    ],
    txOverrides,
  })
}

/**
 * Roll position and wait for confirmation.
 */
export async function rollPositionAndWait(params: RollPositionParams): Promise<TxReceipt> {
  const result = await rollPosition(params)
  return result.wait()
}
