/**
 * Query key factory for TanStack Query / SWR integration.
 * @module v2/react/queryKeys
 */

import type { Address } from 'viem'

/**
 * Query key factory for Panoptic v2 SDK data.
 *
 * Use with TanStack Query or SWR for cache key consistency.
 * All keys are arrays for proper cache matching and invalidation.
 *
 * @example
 * ```typescript
 * import { useQuery } from '@tanstack/react-query'
 * import { queryKeys, getPool } from 'panoptic-v2-sdk'
 *
 * function usePool(config: PanopticConfig) {
 *   return useQuery({
 *     queryKey: queryKeys.pool(config.chainId, config.poolAddress),
 *     queryFn: () => getPool(config),
 *   })
 * }
 * ```
 */
export const queryKeys = {
  /**
   * Base key for all Panoptic v2 queries.
   */
  all: ['panoptic-v2'] as const,

  /**
   * Key for pool data.
   */
  pool: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all, 'pool', chainId.toString(), poolAddress] as const,

  /**
   * Key for pool utilization.
   */
  utilization: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all, 'utilization', chainId.toString(), poolAddress] as const,

  /**
   * Key for oracle state.
   */
  oracle: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all, 'oracle', chainId.toString(), poolAddress] as const,

  /**
   * Key for safe mode state.
   */
  safeMode: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all, 'safeMode', chainId.toString(), poolAddress] as const,

  /**
   * Key for risk parameters.
   */
  riskParameters: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all, 'riskParameters', chainId.toString(), poolAddress] as const,

  /**
   * Key for current rates.
   */
  rates: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all, 'rates', chainId.toString(), poolAddress] as const,

  /**
   * Key for a single position.
   */
  position: (chainId: bigint, poolAddress: Address, tokenId: bigint) =>
    [...queryKeys.all, 'position', chainId.toString(), poolAddress, tokenId.toString()] as const,

  /**
   * Key for all positions of an account.
   */
  positions: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'positions', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for tracked position IDs.
   */
  trackedPositionIds: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'trackedPositionIds', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for sync status.
   */
  syncStatus: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'syncStatus', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for account collateral.
   */
  accountCollateral: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'accountCollateral', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for base account summary (aggregate dashboard data).
   */
  accountSummaryBasic: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'accountSummaryBasic', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for risk-focused account summary.
   */
  accountSummaryRisk: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'accountSummaryRisk', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for liquidation check.
   */
  isLiquidatable: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'isLiquidatable', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for liquidation prices.
   */
  liquidationPrices: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'liquidationPrices', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for net liquidation value.
   */
  netLiquidationValue: (chainId: bigint, poolAddress: Address, account: Address, atTick: bigint) =>
    [
      ...queryKeys.all,
      'netLiquidationValue',
      chainId.toString(),
      poolAddress,
      account,
      atTick.toString(),
    ] as const,

  /**
   * Key for chunk spreads.
   */
  chunkSpreads: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all, 'chunkSpreads', chainId.toString(), poolAddress] as const,

  /**
   * Key for closed positions.
   */
  closedPositions: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'closedPositions', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for trade history.
   */
  tradeHistory: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'tradeHistory', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for realized PnL.
   */
  realizedPnL: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'realizedPnL', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for position greeks.
   */
  positionGreeks: (chainId: bigint, poolAddress: Address, tokenId: bigint) =>
    [
      ...queryKeys.all,
      'positionGreeks',
      chainId.toString(),
      poolAddress,
      tokenId.toString(),
    ] as const,

  /**
   * Key for account greeks.
   */
  accountGreeks: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'accountGreeks', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for collateral estimate.
   */
  collateralEstimate: (chainId: bigint, poolAddress: Address, account: Address, tokenId: bigint) =>
    [
      ...queryKeys.all,
      'collateralEstimate',
      chainId.toString(),
      poolAddress,
      account,
      tokenId.toString(),
    ] as const,

  /**
   * Key for max position size.
   */
  maxPositionSize: (chainId: bigint, poolAddress: Address, account: Address, tokenId: bigint) =>
    [
      ...queryKeys.all,
      'maxPositionSize',
      chainId.toString(),
      poolAddress,
      account,
      tokenId.toString(),
    ] as const,

  /**
   * Key for approval check.
   */
  approval: (chainId: bigint, token: Address, owner: Address, spender: Address) =>
    [...queryKeys.all, 'approval', chainId.toString(), token, owner, spender] as const,

  /**
   * Key for ERC4626 preview operations.
   */
  erc4626Preview: (chainId: bigint, tracker: Address, operation: string, amount: bigint) =>
    [
      ...queryKeys.all,
      'erc4626Preview',
      chainId.toString(),
      tracker,
      operation,
      amount.toString(),
    ] as const,

  /**
   * Key for margin buffer.
   */
  marginBuffer: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'marginBuffer', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for account premia.
   */
  accountPremia: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'accountPremia', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for positions with premia.
   */
  positionsWithPremia: (chainId: bigint, poolAddress: Address, account: Address) =>
    [...queryKeys.all, 'positionsWithPremia', chainId.toString(), poolAddress, account] as const,

  /**
   * Key for collateral data.
   */
  collateralData: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all, 'collateralData', chainId.toString(), poolAddress] as const,

  /**
   * Key for pool liquidities.
   */
  poolLiquidities: (chainId: bigint, poolAddress: Address) =>
    [...queryKeys.all, 'poolLiquidities', chainId.toString(), poolAddress] as const,
} as const
