/**
 * Types for batched mint/burn dispatch operations.
 * @module v2/batch/types
 */

import type { Address } from 'viem'

import type { TickAndSpreadLimits } from '../writes/position'

export type BatchOpKind = 'mint' | 'burn'

interface BatchOpBase {
  kind: BatchOpKind
  /** PanopticPool the op targets. All ops in a batch must share the same pool. */
  poolAddress: Address
  /** Position tokenId being minted (new) or burned (existing). */
  tokenId: bigint
  /** Lower tick limit (always <= tickLimitHigh). */
  tickLimitLow: bigint
  /** Upper tick limit (always >= tickLimitLow). */
  tickLimitHigh: bigint
  /**
   * Whether to swap tokens at mint/burn for single-sided exposure.
   * When true, the (low, high) pair is passed to dispatch in descending order.
   * Mirrors `swapAtMint` on `openPosition` / `closePosition`.
   */
  swapAtMint: boolean
}

export interface BatchOpMint extends BatchOpBase {
  kind: 'mint'
  /** Number of contracts to mint. Must be > 0n. */
  positionSize: bigint
  /** Spread limit tick. 0n disables. */
  spreadLimit: bigint
}

export interface BatchOpBurn extends BatchOpBase {
  kind: 'burn'
}

export type BatchOp = BatchOpMint | BatchOpBurn

/**
 * Pre-encoded args ready to pass to `dispatch()` / `simulateDispatch()`.
 */
export interface BatchDispatchArgs {
  positionIdList: bigint[]
  finalPositionIdList: bigint[]
  positionSizes: bigint[]
  tickAndSpreadLimits: TickAndSpreadLimits[]
  usePremiaAsCollateral: boolean
  builderCode: bigint
}

export type BatchDiagnosticCode =
  | 'empty-batch'
  | 'cross-pool'
  | 'mint-already-onchain'
  | 'burn-not-found'
  | 'duplicate-tokenid-in-batch'
  | 'invalid-tick-limits'
  | 'invalid-position-size'

export interface BatchDiagnostic {
  /** Index into the input items array; -1n for batch-level diagnostics (empty, etc.). */
  itemIndex: bigint
  /** TokenId associated with the diagnostic, or 0n for batch-level. */
  tokenId: bigint
  code: BatchDiagnosticCode
  message: string
}
