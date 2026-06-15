/**
 * Shared loan utilities for swap and lending modules.
 * @module v2/writes/loanUtils
 */

import type { Address } from 'viem'

import {
  InputListFailError,
  LoanSlotExhaustedError,
  MissingPositionIdsError,
  parsePanopticError,
  SwapTokenMismatchError,
} from '../errors'
import type { StorageAdapter } from '../storage'
import { getTrackedPositionIds } from '../sync/getTrackedPositionIds'
import { createTokenIdBuilder } from '../tokenId/builder'

/** Maximum retry attempts on InputListFail */
export const MAX_RETRIES = 3

/**
 * Resolve token index (0 or 1) for the given token address against the pool.
 * Throws SwapTokenMismatchError if the token isn't in the pool.
 */
export function resolveTokenIndex(tokenAddress: Address, token0: Address, token1: Address): bigint {
  const lower = tokenAddress.toLowerCase()
  if (lower === token0.toLowerCase()) return 0n
  if (lower === token1.toLowerCase()) return 1n
  throw new SwapTokenMismatchError(tokenAddress, token0, token1)
}

/**
 * Resolve existing position IDs from explicit param or storage.
 */
export async function resolvePositionIds(
  explicit: bigint[] | undefined,
  storage: StorageAdapter | undefined,
  chainId: bigint,
  poolAddress: Address,
  account: Address,
): Promise<bigint[]> {
  if (explicit !== undefined) return explicit
  if (storage) {
    return getTrackedPositionIds({ chainId, poolAddress, account, storage })
  }
  throw new MissingPositionIdsError()
}

/**
 * Check if a caught error is an InputListFail contract revert.
 * Works with both raw viem errors and parsed PanopticError instances.
 */
export function isInputListFailError(error: unknown): boolean {
  if (error instanceof InputListFailError) return true
  const parsed = parsePanopticError(error)
  return parsed?.errorName === 'InputListFail'
}

/**
 * Build a unique loan tokenId that doesn't collide with existing positions.
 * Bumps optionRatio (1-127) and returns adjusted size to maintain equivalent exposure.
 *
 * @param asset - Which token denominates the positionSize (0 or 1).
 */
export function buildUniqueLoan(
  poolId: bigint,
  asset: bigint,
  tokenType: bigint,
  currentTick: bigint,
  tickSpacing: bigint,
  existingPositionIds: bigint[],
  positionSize: bigint,
): { tokenId: bigint; adjustedSize: bigint } {
  // Floor-align to tick spacing (bigint % preserves sign, so handle negatives)
  const mod = currentTick % tickSpacing
  let strike = currentTick - ((mod + tickSpacing) % tickSpacing)

  for (let ratio = 1n; ratio <= 127n; ratio++) {
    const tokenId = createTokenIdBuilder(poolId)
      .addLoan({ asset, tokenType, strike, optionRatio: ratio })
      .build()

    if (!existingPositionIds.includes(tokenId)) {
      const adjustedSize = positionSize / ratio
      if (adjustedSize === 0n || positionSize % ratio !== 0n) {
        continue
      }
      return { tokenId, adjustedSize }
    }
  }

  // Fallback: try different strikes at ratio=1
  const mod2 = currentTick % tickSpacing
  strike = currentTick - ((mod2 + tickSpacing) % tickSpacing) + tickSpacing
  for (let i = 0; i < 100; i++) {
    const tokenId = createTokenIdBuilder(poolId).addLoan({ asset, tokenType, strike }).build()

    if (!existingPositionIds.includes(tokenId)) {
      return { tokenId, adjustedSize: positionSize }
    }
    strike += tickSpacing
  }

  throw new LoanSlotExhaustedError()
}
