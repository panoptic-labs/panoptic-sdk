/**
 * Item-based wrapper around simulateDispatch for batched mint/burn ops.
 * @module v2/simulations/simulateBatchDispatch
 */

import type { Address, PublicClient } from 'viem'

import { buildBatchDispatchArgs } from '../batch/build'
import type { BatchDiagnostic, BatchOp } from '../batch/types'
import { getBlockMeta } from '../clients'
import type { BlockMeta, DispatchSimulation, SimulationResult } from '../types'
import { simulateDispatch } from './simulateDispatch'

/**
 * Parameters for `simulateBatchDispatch`.
 *
 * - `client`: viem PublicClient used for read calls.
 * - `poolAddress`: PanopticPool address the batch targets.
 * - `account`: account whose collateral and positions are simulated against.
 * - `items`: ordered batch ops (mints + burns) — order matters because dispatch
 *   applies them sequentially.
 * - `existingPositionIds`: account's current on-chain `positionIdList`. Must
 *   reflect FRESH on-chain state (not a cached/optimistic snapshot) — stale
 *   data here yields incorrect pre-dispatch margin excess and false
 *   burn-not-found diagnostics.
 * - `usePremiaAsCollateral`: applied across the whole dispatch. Defaults to
 *   `false`.
 * - `builderCode`: applied across the whole dispatch. Defaults to `0n`.
 * - `blockNumber`: optional pinned block; defaults to the client's latest.
 */
export interface SimulateBatchDispatchParams {
  client: PublicClient
  poolAddress: Address
  account: Address
  /** Batch ops in operation order. */
  items: BatchOp[]
  /** Current on-chain positionIdList for the account (fresh). */
  existingPositionIds: bigint[]
  /** Apply across the whole dispatch. Defaults to false. */
  usePremiaAsCollateral?: boolean
  /** Apply across the whole dispatch. Defaults to 0n. */
  builderCode?: bigint
  /** Optional pinned block. */
  blockNumber?: bigint
}

/**
 * Result returned by `simulateBatchDispatch`.
 *
 * Either delegates to `simulateDispatch` (and therefore matches its
 * `SimulationResult<DispatchSimulation>` shape), or short-circuits with
 * batch-level diagnostics when the items fail validation. In either case the
 * shape includes a `diagnostics` field so callers can render conflicts before
 * deciding what to do — UIs typically gray out the Execute button when
 * `diagnostics.length > 0`.
 */
export type SimulateBatchDispatchResult =
  | (SimulationResult<DispatchSimulation> & { diagnostics: BatchDiagnostic[] })
  | { success: false; diagnostics: BatchDiagnostic[]; _meta: BlockMeta }

/**
 * Simulate a batch dispatch built from `items` + the current on-chain
 * positionIdList. Returns batch diagnostics OR a real simulation result.
 */
export async function simulateBatchDispatch(
  params: SimulateBatchDispatchParams,
): Promise<SimulateBatchDispatchResult> {
  const {
    client,
    poolAddress,
    account,
    items,
    existingPositionIds,
    usePremiaAsCollateral = false,
    builderCode = 0n,
    blockNumber,
  } = params

  const { args, diagnostics } = buildBatchDispatchArgs({
    items,
    existingPositionIds,
    usePremiaAsCollateral,
    builderCode,
  })

  if (args === null) {
    const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
    const meta = await getBlockMeta({ client, blockNumber: targetBlockNumber })
    return { success: false, diagnostics, _meta: meta }
  }

  const sim = await simulateDispatch({
    client,
    poolAddress,
    account,
    positionIdList: args.positionIdList,
    finalPositionIdList: args.finalPositionIdList,
    existingPositionIdList: existingPositionIds,
    positionSizes: args.positionSizes,
    tickAndSpreadLimits: args.tickAndSpreadLimits,
    usePremiaAsCollateral: args.usePremiaAsCollateral,
    builderCode: args.builderCode,
    blockNumber,
  })

  return { ...sim, diagnostics: [] }
}
