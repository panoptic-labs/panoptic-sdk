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

// Factory reads
export {
  type GetFactoryConstructMetadataParams,
  type GetFactoryOwnerOfParams,
  type GetFactoryTokenURIParams,
  type GetPanopticPoolAddressParams,
  type GetPanopticPoolAddressV3Params,
  type GetPanopticPoolAddressV4Params,
  type GetPanopticPoolFromPoolIdParams,
  type MinePoolAddressParams,
  type MinePoolAddressResult,
  type MinePoolAddressV3Params,
  type MinePoolAddressV4Params,
  type ResolvePanopticPoolFromPoolIdParams,
  type ResolvePanopticPoolFromPoolIdResult,
  type SimulateDeployNewPoolParams,
  type SimulateDeployNewPoolV3Params,
  type SimulateDeployNewPoolV4Params,
  getFactoryConstructMetadata,
  getFactoryOwnerOf,
  getFactoryTokenURI,
  getPanopticPoolAddress,
  getPanopticPoolFromPoolId,
  minePoolAddress,
  resolvePanopticPoolFromPoolId,
  simulateDeployNewPool,
} from './factory'

// Local (off-chain) factory mining
export {
  type MinePoolAddressLocalParams,
  type MinePoolAddressLocalV3Params,
  type MinePoolAddressLocalV4Params,
  computePoolIdV4,
  minePoolAddressLocal,
  minePoolAddressLocalAsync,
  numberOfLeadingHexZeros,
} from './minePoolAddressLocal'

// Pool reads
export {
  type FetchPoolIdParams,
  type FetchPoolIdResult,
  type GetOracleStateParams,
  type GetPoolMetadataParams,
  type GetPoolParams,
  type GetRiskParametersParams,
  type GetUtilizationParams,
  type PoolMetadata,
  fetchPoolId,
  getOracleState,
  getPool,
  getPoolMetadata,
  getRiskParameters,
  getUtilization,
  tickToSqrtPriceX96,
  validateBuilderCode,
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
  type GetNetLiquidationValuesParams,
  getAccountCollateral,
  getAccountSummaryBasic,
  getAccountSummaryRisk,
  getCollateralAddresses,
  getLiquidationPrices,
  getNetLiquidationValue,
  getNetLiquidationValues,
} from './account'

// Collateral reads
export {
  type CollateralAddresses as CollateralTrackerAddresses,
  type CollateralTrackerMetadata,
  type GetCollateralDataParams,
  type GetCurrentRatesParams,
  type GetInterestStateParams,
  type InterestState,
  type TokenInterestState,
  getCollateralData,
  getCurrentRates,
  getInterestState,
} from './collateral'

// IRM reads
export {
  type IrmCurrent,
  type IrmMarketStateInputs,
  type IrmPoint,
  BORROW_INDEX_BITS,
  BPS_SCALE,
  deriveSupplyRatePerSecWad,
  getIrmCurrent,
  getIrmCurve,
  MARKET_EPOCH_BITS,
  MARKET_EPOCH_SHIFT,
  packMarketState,
  RATE_AT_TARGET_BITS,
  ratePerSecWadToAprPct,
  SECONDS_PER_YEAR,
  UNREALIZED_INTEREST_BITS,
  utilizationBpsToWad,
  utilizationPctToWad,
  WAD,
} from './irm'

// Collateral estimation (requires PanopticQuery / CollateralTracker)
export {
  type CollateralEstimate,
  type CreateFlowNeutralTokenIdParams,
  type EstimateCollateralRequiredParams,
  type FlowNeutralTokenId,
  type GetMaxPositionSizeParams,
  type GetMaxWithdrawableParams,
  type GetRequiredCreditForITMParams,
  type MaxPositionSize,
  type RequiredCreditForITM,
  createFlowNeutralTokenId,
  estimateCollateralRequired,
  getMaxPositionSize,
  getMaxWithdrawable,
  getRequiredCreditForITM,
  REQUIRED_BASE_ERROR_SENTINEL,
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
  type GetGuardianUnlockStateParams,
  type GuardianUnlockState,
  getGuardianUnlockState,
} from './guardian'
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

// Collateral share price (for APY calculations)
export { type CollateralSharePriceData, getCollateralSharePrices } from './collateralSharePrice'

// Collateral total assets (batch read)
export { getCollateralTotalAssetsBatch } from './collateralTotalAssets'

// Account buying power
export {
  type AccountBuyingPower,
  type GetAccountBuyingPowerParams,
  getAccountBuyingPower,
} from './buyingPower'

// Open position preview
export {
  type GetOpenPositionPreviewParams,
  type OpenPositionPreview,
  getOpenPositionPreview,
} from './openPositionPreview'

// SFPM reads (poolId resolution, enforced tick limits, chunk liquidity)
export {
  type ChunkInput,
  type ChunkLiquidityResult,
  type EnforcedTickLimits,
  type GetChunkLiquiditiesParams,
  type GetChunkLiquiditiesResult,
  type GetEnforcedTickLimitsParams,
  type GetUniswapV3PoolFromIdParams,
  type GetUniswapV4PoolKeyFromIdParams,
  getChunkLiquidities,
  getEnforcedTickLimits,
  getUniswapV3PoolFromId,
  getUniswapV4PoolKeyFromId,
} from './sfpm'

// Native token price (on-chain via PanopticPool tick)
export { type GetNativeTokenPriceParams, getNativeTokenPrice } from './nativeTokenPrice'

// Account trade history
export {
  type AccountHistory,
  type AccountTrade,
  type GetAccountHistoryParams,
  getAccountHistory,
} from './history'

// Streamia history (historical premia + Uniswap fee tracking)
export {
  type GetStreamiaHistoryParams,
  type PoolVersionConfig,
  type SettledEvent,
  type StreamiaHistoryResult,
  type StreamiaLeg,
  type StreamiaSnapshot,
  type V3PoolConfig,
  type V4PoolConfig,
  getStreamiaHistory,
} from './streamiaHistory'

// Uniswap fee history (standalone, no Panoptic pool required)
export {
  type GetUniswapFeeHistoryParams,
  type UniswapFeeHistoryResult,
  type UniswapFeeSnapshot,
  getUniswapFeeHistory,
} from './uniswapFeeHistory'

// Direct Uniswap V3 pool reads (no Panoptic deployment required)
export {
  type GetUniswapV3PoolInfoParams,
  type GetUniswapV3PoolLiquiditiesParams,
  type GetUniswapV4PoolBasicStateParams,
  type GetUniswapV4PoolInfoParams,
  type GetUniswapV4PoolLiquiditiesParams,
  type ResolveUniswapV4PoolKeyParams,
  type UniswapV3Liquidities,
  type UniswapV3PoolInfo,
  type UniswapV3PoolToken,
  type UniswapV4PoolBasicState,
  type UniswapV4PoolInfo,
  type UniswapV4PoolKey,
  computeV4PoolId,
  getUniswapV3PoolInfo,
  getUniswapV3PoolLiquidities,
  getUniswapV4PoolBasicState,
  getUniswapV4PoolInfo,
  getUniswapV4PoolLiquidities,
  resolveUniswapV4PoolKey,
} from './uniswapPool'

// Price history (historical tick + sqrtPriceX96)
export {
  type GetPriceHistoryParams,
  type PriceHistoryResult,
  type PriceSnapshot,
  getPriceHistory,
} from './priceHistory'

// Position enrichment (batched reads for UI display)
export {
  type GetPositionEnrichmentDataParams,
  type GetPositionEnrichmentDataResult,
  type PositionEnrichmentResult,
  type PositionInput,
  EnrichmentCallError,
  getPositionEnrichmentData,
} from './enrichment'
