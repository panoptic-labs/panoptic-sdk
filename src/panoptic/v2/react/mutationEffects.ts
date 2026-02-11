/**
 * Mutation effects for cache invalidation with TanStack Query / SWR.
 * @module v2/react/mutationEffects
 */

import type { Address } from 'viem'

import { queryKeys } from './queryKeys'

/**
 * Mutation type identifiers.
 */
export type MutationType =
  | 'openPosition'
  | 'closePosition'
  | 'forceExercise'
  | 'liquidate'
  | 'settleAccumulatedPremia'
  | 'deposit'
  | 'withdraw'
  | 'mint'
  | 'redeem'
  | 'approve'
  | 'pokeOracle'

/**
 * Parameters for determining which queries to invalidate.
 */
export interface MutationEffectParams {
  chainId: bigint
  poolAddress: Address
  account: Address
  tokenId?: bigint
}

/**
 * Returns query keys that should be invalidated after a mutation.
 *
 * Use with TanStack Query's `queryClient.invalidateQueries()` or SWR's `mutate()`.
 *
 * @example
 * ```typescript
 * import { useMutation, useQueryClient } from '@tanstack/react-query'
 * import { mutationEffects, openPosition } from 'panoptic-v2-sdk'
 *
 * function useOpenPosition(config: WriteConfig) {
 *   const queryClient = useQueryClient()
 *
 *   return useMutation({
 *     mutationFn: (params) => openPosition(config, params),
 *     onSuccess: () => {
 *       const keysToInvalidate = mutationEffects.openPosition({
 *         chainId: config.chainId,
 *         poolAddress: config.poolAddress,
 *         account: config.walletClient.account.address,
 *       })
 *
 *       for (const key of keysToInvalidate) {
 *         queryClient.invalidateQueries({ queryKey: key })
 *       }
 *     },
 *   })
 * }
 * ```
 */
export const mutationEffects = {
  /**
   * Queries to invalidate after opening a position.
   */
  openPosition: (params: MutationEffectParams): readonly (readonly string[])[] => {
    const { chainId, poolAddress, account } = params
    return [
      queryKeys.pool(chainId, poolAddress),
      queryKeys.utilization(chainId, poolAddress),
      queryKeys.positions(chainId, poolAddress, account),
      queryKeys.trackedPositionIds(chainId, poolAddress, account),
      queryKeys.accountCollateral(chainId, poolAddress, account),
      queryKeys.accountSummaryBasic(chainId, poolAddress, account),
      queryKeys.accountSummaryRisk(chainId, poolAddress, account),
      queryKeys.isLiquidatable(chainId, poolAddress, account),
      queryKeys.liquidationPrices(chainId, poolAddress, account),
      queryKeys.accountGreeks(chainId, poolAddress, account),
      queryKeys.chunkSpreads(chainId, poolAddress),
    ]
  },

  /**
   * Queries to invalidate after closing a position.
   */
  closePosition: (params: MutationEffectParams): readonly (readonly string[])[] => {
    const { chainId, poolAddress, account, tokenId } = params
    const keys: (readonly string[])[] = [
      queryKeys.pool(chainId, poolAddress),
      queryKeys.utilization(chainId, poolAddress),
      queryKeys.positions(chainId, poolAddress, account),
      queryKeys.trackedPositionIds(chainId, poolAddress, account),
      queryKeys.accountCollateral(chainId, poolAddress, account),
      queryKeys.accountSummaryBasic(chainId, poolAddress, account),
      queryKeys.accountSummaryRisk(chainId, poolAddress, account),
      queryKeys.isLiquidatable(chainId, poolAddress, account),
      queryKeys.liquidationPrices(chainId, poolAddress, account),
      queryKeys.accountGreeks(chainId, poolAddress, account),
      queryKeys.closedPositions(chainId, poolAddress, account),
      queryKeys.tradeHistory(chainId, poolAddress, account),
      queryKeys.realizedPnL(chainId, poolAddress, account),
      queryKeys.chunkSpreads(chainId, poolAddress),
    ]

    if (tokenId !== undefined) {
      keys.push(queryKeys.position(chainId, poolAddress, tokenId))
      keys.push(queryKeys.positionGreeks(chainId, poolAddress, tokenId))
    }

    return keys
  },

  /**
   * Queries to invalidate after force exercising a position.
   */
  forceExercise: (params: MutationEffectParams): readonly (readonly string[])[] => {
    const { chainId, poolAddress, account, tokenId } = params
    const keys: (readonly string[])[] = [
      queryKeys.pool(chainId, poolAddress),
      queryKeys.utilization(chainId, poolAddress),
      queryKeys.accountCollateral(chainId, poolAddress, account),
      queryKeys.accountSummaryBasic(chainId, poolAddress, account),
      queryKeys.accountSummaryRisk(chainId, poolAddress, account),
      queryKeys.chunkSpreads(chainId, poolAddress),
    ]

    if (tokenId !== undefined) {
      keys.push(queryKeys.position(chainId, poolAddress, tokenId))
    }

    return keys
  },

  /**
   * Queries to invalidate after liquidating an account.
   */
  liquidate: (params: MutationEffectParams): readonly (readonly string[])[] => {
    const { chainId, poolAddress, account } = params
    return [
      queryKeys.pool(chainId, poolAddress),
      queryKeys.utilization(chainId, poolAddress),
      queryKeys.positions(chainId, poolAddress, account),
      queryKeys.trackedPositionIds(chainId, poolAddress, account),
      queryKeys.accountCollateral(chainId, poolAddress, account),
      queryKeys.accountSummaryBasic(chainId, poolAddress, account),
      queryKeys.accountSummaryRisk(chainId, poolAddress, account),
      queryKeys.isLiquidatable(chainId, poolAddress, account),
      queryKeys.liquidationPrices(chainId, poolAddress, account),
      queryKeys.accountGreeks(chainId, poolAddress, account),
      queryKeys.closedPositions(chainId, poolAddress, account),
      queryKeys.chunkSpreads(chainId, poolAddress),
    ]
  },

  /**
   * Queries to invalidate after settling accumulated premia.
   */
  settleAccumulatedPremia: (params: MutationEffectParams): readonly (readonly string[])[] => {
    const { chainId, poolAddress, account, tokenId } = params
    const keys: (readonly string[])[] = [
      queryKeys.accountCollateral(chainId, poolAddress, account),
      queryKeys.accountSummaryBasic(chainId, poolAddress, account),
      queryKeys.accountSummaryRisk(chainId, poolAddress, account),
    ]

    if (tokenId !== undefined) {
      keys.push(queryKeys.position(chainId, poolAddress, tokenId))
    }

    return keys
  },

  /**
   * Queries to invalidate after depositing to collateral tracker.
   */
  deposit: (params: MutationEffectParams): readonly (readonly string[])[] => {
    const { chainId, poolAddress, account } = params
    return [
      queryKeys.accountCollateral(chainId, poolAddress, account),
      queryKeys.accountSummaryBasic(chainId, poolAddress, account),
      queryKeys.accountSummaryRisk(chainId, poolAddress, account),
      queryKeys.isLiquidatable(chainId, poolAddress, account),
      queryKeys.liquidationPrices(chainId, poolAddress, account),
    ]
  },

  /**
   * Queries to invalidate after withdrawing from collateral tracker.
   */
  withdraw: (params: MutationEffectParams): readonly (readonly string[])[] => {
    const { chainId, poolAddress, account } = params
    return [
      queryKeys.accountCollateral(chainId, poolAddress, account),
      queryKeys.accountSummaryBasic(chainId, poolAddress, account),
      queryKeys.accountSummaryRisk(chainId, poolAddress, account),
      queryKeys.isLiquidatable(chainId, poolAddress, account),
      queryKeys.liquidationPrices(chainId, poolAddress, account),
    ]
  },

  /**
   * Queries to invalidate after minting collateral shares.
   */
  mint: (params: MutationEffectParams): readonly (readonly string[])[] => {
    return mutationEffects.deposit(params)
  },

  /**
   * Queries to invalidate after redeeming collateral shares.
   */
  redeem: (params: MutationEffectParams): readonly (readonly string[])[] => {
    return mutationEffects.withdraw(params)
  },

  /**
   * Queries to invalidate after approving token spending.
   */
  approve: (
    chainId: bigint,
    token: Address,
    owner: Address,
    spender: Address,
  ): readonly (readonly string[])[] => {
    return [queryKeys.approval(chainId, token, owner, spender)]
  },

  /**
   * Queries to invalidate after poking the oracle.
   */
  pokeOracle: (
    params: Pick<MutationEffectParams, 'chainId' | 'poolAddress'>,
  ): readonly (readonly string[])[] => {
    const { chainId, poolAddress } = params
    return [queryKeys.oracle(chainId, poolAddress), queryKeys.safeMode(chainId, poolAddress)]
  },
} as const
