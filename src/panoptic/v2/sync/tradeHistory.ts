/**
 * Trade history tracking for closed positions.
 * @module v2/sync/tradeHistory
 */

import type { Address } from 'viem'

import type { StorageAdapter } from '../storage'
import { getClosedPositionsKey, jsonSerializer } from '../storage'
import type { ClosedPosition, RealizedPnL } from '../types'

/**
 * Parameters for saving a closed position.
 */
export interface SaveClosedPositionParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account that owned the position */
  account: Address
  /** Storage adapter */
  storage: StorageAdapter
  /** The closed position data */
  closedPosition: ClosedPosition
}

/**
 * Save a closed position to trade history.
 *
 * @param params - Save parameters
 */
export async function saveClosedPosition(params: SaveClosedPositionParams): Promise<void> {
  const { chainId, poolAddress, account, storage, closedPosition } = params

  const key = getClosedPositionsKey(chainId, poolAddress, account)
  const existingData = await storage.get(key)

  let history: ClosedPosition[]
  if (existingData) {
    try {
      history = jsonSerializer.parse(existingData) as ClosedPosition[]
    } catch {
      history = []
    }
  } else {
    history = []
  }

  // Add new closed position
  history.push(closedPosition)

  // Sort by close block (most recent first)
  history.sort((a, b) => Number(b.closeBlock - a.closeBlock))

  await storage.set(key, jsonSerializer.stringify(history))
}

/**
 * Parameters for getting trade history.
 */
export interface GetTradeHistoryParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account to get history for */
  account: Address
  /** Storage adapter */
  storage: StorageAdapter
  /** Maximum number of positions to return (default: 100) */
  limit?: bigint
  /** Offset for pagination */
  offset?: bigint
  /** Filter by closure reason */
  closureReason?: 'closed' | 'liquidated' | 'force_exercised'
  /** Filter by block range (from) */
  fromBlock?: bigint
  /** Filter by block range (to) */
  toBlock?: bigint
}

/**
 * Get trade history (closed positions) for an account.
 *
 * This function reads from local storage, no RPC calls.
 * Positions are returned in reverse chronological order (most recent first).
 *
 * @param params - Query parameters
 * @returns Array of closed positions
 */
export async function getTradeHistory(params: GetTradeHistoryParams): Promise<ClosedPosition[]> {
  const {
    chainId,
    poolAddress,
    account,
    storage,
    limit = 100n,
    offset = 0n,
    closureReason,
    fromBlock,
    toBlock,
  } = params

  const key = getClosedPositionsKey(chainId, poolAddress, account)
  const data = await storage.get(key)

  if (!data) {
    return []
  }

  let history: ClosedPosition[]
  try {
    history = jsonSerializer.parse(data) as ClosedPosition[]
  } catch {
    return []
  }

  // Apply filters
  if (closureReason) {
    history = history.filter((p) => p.closureReason === closureReason)
  }

  if (fromBlock !== undefined) {
    history = history.filter((p) => p.closeBlock >= fromBlock)
  }

  if (toBlock !== undefined) {
    history = history.filter((p) => p.closeBlock <= toBlock)
  }

  // Apply pagination
  const start = Number(offset)
  const end = start + Number(limit)
  return history.slice(start, end)
}

/**
 * Get closed positions (alias for getTradeHistory with specific closure reason).
 *
 * @param params - Query parameters
 * @returns Array of closed positions
 */
export async function getClosedPositions(params: GetTradeHistoryParams): Promise<ClosedPosition[]> {
  return getTradeHistory(params)
}

/**
 * Parameters for getting realized PnL.
 */
export interface GetRealizedPnLParams {
  /** Chain ID */
  chainId: bigint
  /** Pool address */
  poolAddress: Address
  /** Account to get PnL for */
  account: Address
  /** Storage adapter */
  storage: StorageAdapter
  /** Filter by block range (from) */
  fromBlock?: bigint
  /** Filter by block range (to) */
  toBlock?: bigint
}

/**
 * Get realized PnL summary for an account.
 *
 * Calculates totals from all closed positions in storage.
 *
 * @param params - Query parameters
 * @returns Realized PnL summary
 */
export async function getRealizedPnL(params: GetRealizedPnLParams): Promise<RealizedPnL> {
  const { chainId, poolAddress, account, storage, fromBlock, toBlock } = params

  const history = await getTradeHistory({
    chainId,
    poolAddress,
    account,
    storage,
    limit: BigInt(Number.MAX_SAFE_INTEGER), // Get all
    fromBlock,
    toBlock,
  })

  let total0 = 0n
  let total1 = 0n
  let winCount = 0n
  let lossCount = 0n

  for (const position of history) {
    total0 += position.realizedPnL0
    total1 += position.realizedPnL1

    // Consider it a win if either token had positive PnL
    // (in practice, one will usually dominate)
    const isWin = position.realizedPnL0 > 0n || position.realizedPnL1 > 0n
    const isLoss = position.realizedPnL0 < 0n || position.realizedPnL1 < 0n

    if (isWin && !isLoss) {
      winCount++
    } else if (isLoss && !isWin) {
      lossCount++
    }
    // Mixed results (win on one, loss on other) don't count as either
  }

  return {
    total0,
    total1,
    positionCount: BigInt(history.length),
    winCount,
    lossCount,
  }
}

/**
 * Clear all trade history for an account.
 *
 * @param params - Query parameters
 */
export async function clearTradeHistory(
  params: Omit<
    GetTradeHistoryParams,
    'limit' | 'offset' | 'closureReason' | 'fromBlock' | 'toBlock'
  >,
): Promise<void> {
  const { chainId, poolAddress, account, storage } = params

  const key = getClosedPositionsKey(chainId, poolAddress, account)
  await storage.delete(key)
}
