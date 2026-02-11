/**
 * Position synchronization module for the Panoptic v2 SDK.
 * @module v2/sync
 */

// Main sync functions
export { type GetSyncStatusParams, type SyncStatusResult, getSyncStatus } from './getSyncStatus'
export {
  type SyncPositionsParams,
  type SyncPositionsResult,
  type SyncProgressEvent,
  syncPositions,
} from './syncPositions'

// Position tracking
export {
  type GetTrackedPositionIdsParams,
  clearTrackedPositions,
  getTrackedPositionIds,
  isPositionTracked,
} from './getTrackedPositionIds'

// Trade history
export {
  type GetRealizedPnLParams,
  type GetTradeHistoryParams,
  type SaveClosedPositionParams,
  clearTradeHistory,
  getClosedPositions,
  getRealizedPnL,
  getTradeHistory,
  saveClosedPosition,
} from './tradeHistory'

// Chunk tracking (manual)
export {
  type AddTrackedChunksParams,
  type GetChunkSpreadsParams,
  type GetTrackedChunksParams,
  type LiquidityChunkKey,
  type LiquidityChunkSpread,
  type RemoveTrackedChunksParams,
  addTrackedChunks,
  calculateSpreadWad,
  clearTrackedChunks,
  getChunkSpreads,
  getTrackedChunks,
  removeTrackedChunks,
} from './chunkTracking'

// Chunk tracking (PanopticQuery-based)
export {
  type GetPositionChunkDataParams,
  type GetPositionChunkDataResult,
  type LegChunkData,
  type PositionChunkData,
  type ScanChunksParams,
  type ScanChunksResult,
  type ScannedChunk,
  getPositionChunkData,
  scanChunks,
} from './chunkTracking'

// Pending positions (optimistic updates)
export {
  type AddPendingPositionParams,
  type ConfirmPendingPositionParams,
  type FailPendingPositionParams,
  type GetPendingPositionsParams,
  type PendingPosition,
  addPendingPosition,
  cleanupStalePendingPositions,
  clearPendingPositions,
  confirmPendingPosition,
  failPendingPosition,
  getPendingPositions,
} from './pendingPositions'

// Internal utilities (for advanced use)
export {
  type EventReconstructionParams,
  type EventReconstructionResult,
  getPoolDeploymentBlock,
  reconstructFromEvents,
} from './eventReconstruction'
export {
  type DetectReorgParams,
  type SaveCheckpointParams,
  calculateResyncBlock,
  clearCheckpoint,
  detectReorg,
  loadCheckpoint,
  saveCheckpoint,
  verifyBlockContinuity,
} from './reorgHandling'
export {
  type DispatchCalldata,
  type RecoverSnapshotParams,
  type SnapshotRecoveryResult,
  decodeDispatchCalldata,
  recoverSnapshot,
} from './snapshotRecovery'
