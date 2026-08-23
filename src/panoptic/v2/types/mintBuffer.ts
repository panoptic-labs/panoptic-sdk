/**
 * Shared mint-time margin buffer types.
 * @module v2/types/mintBuffer
 */

/**
 * A mint buffer as an explicit ratio, matching the live RiskEngine constants.
 */
export interface MintBufferRatio {
  /** `RiskEngine.BP_DECREASE_BUFFER`. */
  numerator: bigint
  /** `RiskEngine.DECIMALS`. */
  denominator: bigint
}
