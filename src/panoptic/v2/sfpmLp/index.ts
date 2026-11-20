/**
 * Direct LP management on the SemiFungiblePositionManager (Uniswap **v3**).
 *
 * An account holds Uniswap liquidity through the SFPM as an ERC-1155 token ID
 * whose legs are all liquidity-adding ranges. Fees are paid out to the account
 * whenever one of its ranges is minted into or burned from.
 *
 * v3 only: the v4 SFPM settles in PoolManager ERC-6909 claims and is not
 * supported here.
 *
 * @module v2/sfpmLp
 */
export {
  type CloseSfpmLpPositionParams,
  type CollectSfpmLpFeesParams,
  type CreateSfpmLpPositionParams,
  type PrepareSfpmLpCallParams,
  type ResizeSfpmLpPositionParams,
  type SfpmLpAction,
  type SfpmLpBurnTxResult,
  type SfpmLpCall,
  type SfpmLpSimulation,
  type SfpmLpStep,
  type SfpmLpTarget,
  type SimulateSfpmLpParams,
  closeSfpmLpPosition,
  collectSfpmLpFees,
  createSfpmLpPosition,
  decreaseSfpmLpPosition,
  increaseSfpmLpPosition,
  prepareSfpmLpCall,
  simulateSfpmLp,
} from './actions'
export {
  type BuildSfpmLpTokenIdParams,
  type SfpmLpBurnPlan,
  type SfpmLpLeg,
  type SfpmLpRange,
  buildSfpmLpTokenId,
  decodeSfpmLpLegs,
  minSfpmLpPositionSize,
  planSfpmLpBurn,
  sfpmLpLegLiquidity,
} from './position'
export {
  type GetSfpmLpPositionParams,
  type SfpmLpChunk,
  type SfpmLpPosition,
  type SfpmLpPositionLeg,
  type SfpmLpSizeChange,
  type SfpmLpSizeChangeAtTick,
  getSfpmLpPosition,
} from './reads'
