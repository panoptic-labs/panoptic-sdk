/**
 * Pure validator for batched mint/burn dispatch operations.
 * @module v2/batch/validate
 */

import type { BatchDiagnostic, BatchOp } from './types'

export interface ValidateBatchParams {
  items: BatchOp[]
  /** Current on-chain positionIdList for the account. */
  existingPositionIds: bigint[]
}

/**
 * Run all batch-level and item-level validations.
 * Pure function; never throws. Empty array means "ready to build".
 */
export function validateBatch(params: ValidateBatchParams): BatchDiagnostic[] {
  const { items, existingPositionIds } = params
  const diagnostics: BatchDiagnostic[] = []

  if (items.length === 0) {
    diagnostics.push({
      itemIndex: -1n,
      tokenId: 0n,
      code: 'empty-batch',
      message: 'Batch is empty.',
    })
    return diagnostics
  }

  const head = items[0]
  if (!head) return diagnostics
  const firstPool = head.poolAddress.toLowerCase()
  const existing = new Set(existingPositionIds)
  const seen = new Map<bigint, bigint>()

  items.forEach((item, idx) => {
    const itemIndex = BigInt(idx)
    if (item.poolAddress.toLowerCase() !== firstPool) {
      diagnostics.push({
        itemIndex,
        tokenId: item.tokenId,
        code: 'cross-pool',
        message: `Item ${idx} targets pool ${item.poolAddress}, expected ${head.poolAddress}.`,
      })
    }

    if (item.tickLimitLow > item.tickLimitHigh) {
      diagnostics.push({
        itemIndex,
        tokenId: item.tokenId,
        code: 'invalid-tick-limits',
        message: `Item ${idx} tickLimitLow (${item.tickLimitLow}) > tickLimitHigh (${item.tickLimitHigh}).`,
      })
    }

    if (item.kind === 'mint') {
      if (item.positionSize <= 0n) {
        diagnostics.push({
          itemIndex,
          tokenId: item.tokenId,
          code: 'invalid-position-size',
          message: `Mint at index ${idx} must have positionSize > 0.`,
        })
      }
      if (existing.has(item.tokenId)) {
        diagnostics.push({
          itemIndex,
          tokenId: item.tokenId,
          code: 'mint-already-onchain',
          message: `Mint at index ${idx} targets tokenId ${item.tokenId} which is already open on-chain.`,
        })
      }
    } else if (!existing.has(item.tokenId)) {
      diagnostics.push({
        itemIndex,
        tokenId: item.tokenId,
        code: 'burn-not-found',
        message: `Burn at index ${idx} targets tokenId ${item.tokenId} which is not in the account's positions.`,
      })
    }

    const prior = seen.get(item.tokenId)
    if (prior !== undefined) {
      diagnostics.push({
        itemIndex,
        tokenId: item.tokenId,
        code: 'duplicate-tokenid-in-batch',
        message: `Item ${idx} duplicates tokenId ${item.tokenId} also at index ${prior}.`,
      })
    } else {
      seen.set(item.tokenId, itemIndex)
    }
  })

  return diagnostics
}
