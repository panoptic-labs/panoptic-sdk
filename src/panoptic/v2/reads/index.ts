/**
 * Read functions for the Panoptic v2 SDK.
 *
 * ## Same-Block Guarantee
 *
 * All read functions maintain same-block consistency by fetching all dynamic data
 * in a SINGLE multicall. Static/immutable data (addresses, symbols, decimals) can
 * be pre-fetched and cached separately - see the optional metadata parameters.
 *
 * @module v2/reads
 */

// Pool reads
export {
  type GetOracleStateParams,
  type GetPoolMetadataParams,
  type GetPoolParams,
  type GetRiskParametersParams,
  type GetUtilizationParams,
  type PoolMetadata,
  getOracleState,
  getPool,
  getPoolMetadata,
  getRiskParameters,
  getUtilization,
  tickToSqrtPriceX96,
} from './pool'

// Position reads
export {
  type GetPositionGreeksParams,
  type GetPositionParams,
  type GetPositionsParams,
  getPosition,
  getPositionGreeks,
  getPositions,
} from './position'

// Premia reads
export {
  type AccountPremia,
  type GetAccountPremiaParams,
  type GetPositionsWithPremiaParams,
  type PositionsWithPremiaResult,
  type PositionWithPremia,
  getAccountPremia,
  getPositionsWithPremia,
} from './premia'

// Account reads
export {
  type CollateralAddresses,
  type GetAccountCollateralParams,
  type GetAccountSummaryBasicParams,
  type GetAccountSummaryRiskParams,
  type GetLiquidationPricesParams,
  type GetNetLiquidationValueParams,
  getAccountCollateral,
  getAccountSummaryBasic,
  getAccountSummaryRisk,
  getCollateralAddresses,
  getLiquidationPrices,
  getNetLiquidationValue,
} from './account'

// Collateral reads
export {
  type CollateralAddresses as CollateralTrackerAddresses,
  type CollateralTrackerMetadata,
  type GetCollateralDataParams,
  type GetCurrentRatesParams,
  getCollateralData,
  getCurrentRates,
} from './collateral'

// Collateral estimation (requires PanopticHelper)
export {
  type CollateralEstimate,
  type EstimateCollateralRequiredParams,
  type GetMaxPositionSizeParams,
  type GetRequiredCreditForITMParams,
  type MaxPositionSize,
  type RequiredCreditForITM,
  estimateCollateralRequired,
  getMaxPositionSize,
  getRequiredCreditForITM,
} from './collateralEstimate'

// Checks (liquidation)
export { type IsLiquidatableParams, type LiquidationCheck, isLiquidatable } from './checks'

// ERC4626 vault previews
export {
  type ERC4626PreviewParams,
  type ERC4626PreviewResult,
  convertToAssets,
  convertToShares,
  previewDeposit,
  previewMint,
  previewRedeem,
  previewWithdraw,
} from './erc4626'

// Safe mode
export {
  type GetSafeModeParams,
  type SafeModeState,
  type SafeModeStatusValue,
  getSafeMode,
  SafeModeStatus,
} from './safeMode'

// PanopticQuery utilities
export {
  type CheckCollateralAcrossTicksParams,
  type CollateralAcrossTicks,
  type CollateralDataPoint,
  type GetPortfolioValueParams,
  type OptimizeTokenIdRiskPartnersParams,
  type PortfolioValue,
  checkCollateralAcrossTicks,
  getPortfolioValue,
  optimizeTokenIdRiskPartners,
} from './queryUtils'

// Pool liquidity distribution (uses PanopticQuery)
export {
  type GetPoolLiquiditiesParams,
  type PoolLiquidities,
  getPoolLiquidities,
} from './liquidity'

// Account greeks (uses stored position data)
export {
  type AccountGreeksCurveResult,
  type AccountGreeksResult,
  type CalculateAccountGreeksPureParams,
  type GetAccountGreeksParams,
  calculateAccountGreeksPure,
  getAccountGreeks,
} from './accountGreeks'

// Margin buffer
export { type GetMarginBufferParams, type MarginBuffer, getMarginBuffer } from './margin'

// Delta hedging utilities
export { type DeltaHedgeResult, type GetDeltaHedgeParamsInput, getDeltaHedgeParams } from './hedge'

// Account trade history
export {
  type AccountHistory,
  type AccountTrade,
  type GetAccountHistoryParams,
  getAccountHistory,
} from './history'
