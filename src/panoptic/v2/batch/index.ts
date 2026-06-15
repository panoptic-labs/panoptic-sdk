/**
 * Batch dispatch module — builds and validates groups of mint/burn ops
 * for atomic execution via PanopticPoolV2.dispatch().
 * @module v2/batch
 */

export type { BuildBatchDispatchArgsParams, BuildBatchDispatchArgsResult } from './build'
export { buildBatchDispatchArgs } from './build'
export type {
  BatchDiagnostic,
  BatchDiagnosticCode,
  BatchDispatchArgs,
  BatchOp,
  BatchOpBurn,
  BatchOpKind,
  BatchOpMint,
} from './types'
export type { ValidateBatchParams } from './validate'
export { validateBatch } from './validate'
