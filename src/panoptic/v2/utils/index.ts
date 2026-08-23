/**
 * Utility functions for the Panoptic v2 SDK.
 * @module v2/utils
 */

export {
  BPS_DENOMINATOR,
  MAX_TICK,
  MAX_TRACKED_CHUNKS,
  MIN_TICK,
  ORACLE_EPOCH_SECONDS,
  REORG_DEPTH,
  SCHEMA_VERSION,
  STORAGE_PREFIX,
  UTILIZATION_DENOMINATOR,
  WAD,
  ZERO_COLLATERAL,
  ZERO_VALUATION,
} from './constants'

// Factory utilities
export { type PanopticNFTMetadata, decodePanopticTokenURI } from './factory'

// Block interpolation
export { interpolateBlocks } from './interpolateBlocks'

// OraclePack state
export {
  type DecodedOraclePack,
  type OracleTiming,
  decodeOraclePack,
  decodeOracleTiming,
  oracleEpochAt,
} from './oraclePack'

// SafeMode oracle diagnosis
export {
  type OracleEmaPeriods,
  type OracleRiskParameters,
  type OracleSafeModeCause,
  type OracleSafeModeDiagnosis,
  decodeOracleRiskParameters,
  diagnoseOracleSafeMode,
} from './oracleSafeMode'
