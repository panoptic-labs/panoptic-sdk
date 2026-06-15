/**
 * Pure builder converting batched mint/burn ops into PanopticPool.dispatch() args.
 * @module v2/batch/build
 */

import type { TickAndSpreadLimits } from '../writes/position'
import type { BatchDiagnostic, BatchDispatchArgs, BatchOp } from './types'
import { validateBatch } from './validate'

export interface BuildBatchDispatchArgsParams {
  items: BatchOp[]
  /** Current on-chain positionIdList for the account. */
  existingPositionIds: bigint[]
  /** Apply across the whole dispatch. Defaults to false. */
  usePremiaAsCollateral?: boolean
  /** Apply across the whole dispatch. Defaults to 0n. */
  builderCode?: bigint
}

export interface BuildBatchDispatchArgsResult {
  /** Null when diagnostics are non-empty. */
  args: BatchDispatchArgs | null
  diagnostics: BatchDiagnostic[]
}

/**
 * Build dispatch() args from a list of batch ops + the account's current
 * on-chain positionIdList. Returns diagnostics instead of throwing so callers
 * (UIs, bots) can render conflicts before deciding what to do.
 *
 * The order in `items` is preserved as the operation order in `positionIdList`,
 * `positionSizes`, and `tickAndSpreadLimits`. `finalPositionIdList` is the
 * post-execution state: existing minus burns, plus mints.
 */
export function buildBatchDispatchArgs(
  params: BuildBatchDispatchArgsParams,
): BuildBatchDispatchArgsResult {
  const { items, existingPositionIds, usePremiaAsCollateral = false, builderCode = 0n } = params

  const diagnostics = validateBatch({ items, existingPositionIds })
  if (diagnostics.length > 0) {
    return { args: null, diagnostics }
  }

  const positionIdList = items.map((i) => i.tokenId)
  const positionSizes = items.map((i) => (i.kind === 'mint' ? i.positionSize : 0n))

  const tickAndSpreadLimits: TickAndSpreadLimits[] = items.map((i) => {
    const low = i.tickLimitLow <= i.tickLimitHigh ? i.tickLimitLow : i.tickLimitHigh
    const high = i.tickLimitLow <= i.tickLimitHigh ? i.tickLimitHigh : i.tickLimitLow
    const spread = i.kind === 'mint' ? i.spreadLimit : 0n
    return i.swapAtMint ? ([high, low, spread] as const) : ([low, high, spread] as const)
  })

  const mintIds = items.filter((i) => i.kind === 'mint').map((i) => i.tokenId)
  const burnIds = new Set(items.filter((i) => i.kind === 'burn').map((i) => i.tokenId))
  const mintIdSet = new Set(mintIds)
  const finalPositionIdList = [
    ...existingPositionIds.filter((id) => !burnIds.has(id) && !mintIdSet.has(id)),
    ...mintIds,
  ]

  return {
    args: {
      positionIdList,
      finalPositionIdList,
      positionSizes,
      tickAndSpreadLimits,
      usePremiaAsCollateral,
      builderCode,
    },
    diagnostics: [],
  }
}
