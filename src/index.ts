// ABIs
export { CollateralTrackerAbi } from './abis/CollateralTracker'
export { CollateralTrackerV1_1Abi } from './abis/CollateralTrackerV1_1'
export { Erc20Abi } from './abis/erc20ABI'
export { Erc1155Abi } from './abis/erc1155ABI'
export { HypoVaultAbi } from './abis/HypoVault'
export { HypoVaultManagerWithMerkleVerificationAbi } from './abis/HypoVaultManagerWithMerkleVerification'
export { Multicall3Abi } from './abis/multicall3'
export { NonFungiblePositionManagerAbi } from './abis/NonFungiblePositionManager'
export { PanopticFactoryV3Abi } from './abis/PanopticFactoryV3'
export { PanopticFactoryV4Abi } from './abis/PanopticFactoryV4'
export { PanopticHelperAbi } from './abis/PanopticHelper'
export { PanopticPoolAbi } from './abis/PanopticPool'
export { PanopticPoolV1_1Abi } from './abis/PanopticPoolV1_1'
export { PanopticQueryV1_1Abi } from './abis/PanopticQueryV1_1'
export { PanopticVaultAccountantAbi } from './abis/PanopticVaultAccountant'
export { PanopticVaultAccountantManagerInputAbi } from './abis/PanopticVaultAccountantManagerInput'
export { PoolManagerAbi } from './abis/PoolManager'
export { RescueDistributorAbi } from './abis/RescueDistributor'
export { SemiFungiblePositionManagerAbi } from './abis/SemiFungiblePositionManager'
export { SemiFungiblePositionManagerV1_1Abi } from './abis/SemiFungiblePositionManagerV1_1'
export { Simple7702AccountAbi } from './abis/Simple7702Account'
export { StateViewAbi } from './abis/StateView'
export { UniswapHelperAbi } from './abis/UniswapHelper'
export { UniswapHelperV1_1Abi } from './abis/UniswapHelperV1_1'
export { UniswapMigratorAbi } from './abis/UniswapMigrator'
export { UniswapV3FactoryAbi } from './abis/UniswapV3Factory'
export { UniswapV3PoolAbi } from './abis/UniswapV3Pool'
export { WETHAbi } from './abis/WETH'
// Panoptic V2 Abis (from wagmi-generated)
export {
  collateralTrackerV2Abi,
  panopticFactoryV3Abi,
  panopticFactoryV4Abi,
  panopticPoolV2Abi,
  panopticQueryAbi,
  riskEngineAbi,
  semiFungiblePositionManagerV3Abi,
  semiFungiblePositionManagerV4Abi,
} from './generated'
// Additional V2 ABIs from panoptic_v2_abis
export { builderFactoryAbi, builderWalletAbi } from './abis/panoptic_v2_abis'
// Backward-compatible aliases
export { panopticPoolV2Abi as panopticPoolAbi } from './generated'
export { panopticFactoryV4Abi as panopticFactoryAbi } from './generated'
export { semiFungiblePositionManagerV4Abi as semiFungiblePositionManagerAbi } from './generated'
export { collateralTrackerV2Abi as collateralTrackerAbi } from './generated'

// HypoVault
export {
  type LendingAllocationResult,
  type LendingAllocationRow,
  getLendingAllocationRows,
} from './hypoVault/analytics/lendingAllocation'
export {
  cancelDeposit,
  encodeCancelDepositFunctionData,
  getCancelDepositContractConfig,
  simulateCancelDeposit,
} from './hypoVault/cancelDeposit/cancelDeposit'
export { useCancelDeposit } from './hypoVault/cancelDeposit/hooks/use-cancel-deposit'
export {
  type ChainDeployment,
  type HypoVaultManagerTurnkeySigners,
  BASE_CHAIN_ID,
  BASE_DEPLOYMENT,
  BASE_ETH_USDC_5BPS_MARKET,
  BASE_HYPOVAULT_ADDRESSES,
  BASE_HYPOVAULT_CORE_ADDRESSES,
  BASE_HYPOVAULT_MANAGER_ADDRESSES,
  BASE_HYPOVAULT_MANAGER_TURNKEY_SIGNERS,
  BASE_PANOPTIC_POOL_ADDRESSES,
  BASE_PANOPTIC_V2_ADDRESSES,
  CHAIN_DEPLOYMENTS,
  getChainDeployment,
  getEthUsdcMarket,
  isSupportedChain,
  MAINNET_CHAIN_ID,
  MAINNET_DEPLOYMENT,
  MAINNET_PANOPTIC_V2_ADDRESSES,
  requireChainDeployment,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_DEPLOYMENT,
  SEPOLIA_ETH_USDC_5BPS_MARKET,
  SEPOLIA_HYPOVAULT_ADDRESSES,
  SEPOLIA_HYPOVAULT_CORE_ADDRESSES,
  SEPOLIA_HYPOVAULT_MANAGER_ADDRESSES,
  SEPOLIA_HYPOVAULT_MANAGER_TURNKEY_SIGNERS,
  SEPOLIA_PANOPTIC_POOL_ADDRESSES,
  SEPOLIA_PANOPTIC_V2_ADDRESSES,
} from './hypoVault/chainDeployments'
export {
  buildExecuteWithdrawalCalldatas,
  encodeExecuteWithdrawalFunctionData,
  encodeExecuteWithdrawalMulticallFunctionData,
  executeWithdrawal,
  executeWithdrawalMulticall,
  getExecuteWithdrawalContractConfig,
  getExecuteWithdrawalMulticallContractConfig,
  simulateExecuteWithdrawal,
  simulateExecuteWithdrawalMulticall,
} from './hypoVault/executeWithdrawal/executeWithdrawal'
export { useExecuteWithdrawal } from './hypoVault/executeWithdrawal/hooks/use-execute-withdrawal'
export {
  type QueuedWithdrawalSnapshot,
  type WithdrawalEpochStateSnapshot,
  calculateClaimableAssetsFromQueuedWithdrawals,
} from './hypoVault/executeWithdrawal/utils'
export { BaseUSDCPLPStrategistLeaves } from './hypoVault/hypoVaultManagerArtifacts/BaseUSDCPLPStrategistLeaves'
export { BaseUSDCPLPVaultPoolInfos } from './hypoVault/hypoVaultManagerArtifacts/BaseUSDCPLPVaultPoolInfos'
export { BaseWETHPLPStrategistLeaves } from './hypoVault/hypoVaultManagerArtifacts/BaseWETHPLPStrategistLeaves'
export { BaseWETHPLPVaultPoolInfos } from './hypoVault/hypoVaultManagerArtifacts/BaseWETHPLPVaultPoolInfos'
export { MainnetLegacyUSDCPLPStrategistLeaves } from './hypoVault/hypoVaultManagerArtifacts/MainnetLegacyUSDCPLPStrategistLeaves'
export { MainnetLegacyWETHPLPStrategistLeaves } from './hypoVault/hypoVaultManagerArtifacts/MainnetLegacyWETHPLPStrategistLeaves'
export { MainnetUSDCPLPStrategistLeaves } from './hypoVault/hypoVaultManagerArtifacts/MainnetUSDCPLPStrategistLeaves'
export {
  MainnetUSDCPLPLegacyVaultPoolInfos,
  MainnetUSDCPLPVaultPoolInfos,
} from './hypoVault/hypoVaultManagerArtifacts/MainnetUSDCPLPVaultPoolInfos'
export { MainnetWETHPLPStrategistLeaves } from './hypoVault/hypoVaultManagerArtifacts/MainnetWETHPLPStrategistLeaves'
export {
  MainnetWETHPLPLegacyVaultPoolInfos,
  MainnetWETHPLPVaultPoolInfos,
} from './hypoVault/hypoVaultManagerArtifacts/MainnetWETHPLPVaultPoolInfos'
export { SepoliaUSDCPLPStrategistLeaves } from './hypoVault/hypoVaultManagerArtifacts/SepoliaUSDCPLPStrategistLeaves'
export { SepoliaUSDCPLPVaultPoolInfos } from './hypoVault/hypoVaultManagerArtifacts/SepoliaUSDCPLPVaultPoolInfos'
export { SepoliaWETHPLPStrategistLeaves } from './hypoVault/hypoVaultManagerArtifacts/SepoliaWETHPLPStrategistLeaves'
export { SepoliaWETHPLPVaultPoolInfos } from './hypoVault/hypoVaultManagerArtifacts/SepoliaWETHPLPVaultPoolInfos'
export {
  type HypoVaultManagerConfig,
  HypoVaultManagerConfigSchema,
  UsdcPlpVaultBaseProdConfig,
  UsdcPlpVaultMainnetLegacyConfig,
  UsdcPlpVaultMainnetProdConfig,
  UsdcPlpVaultSepoliaDevConfig,
  UsdcPlpVaultSepoliaProdConfig,
  WethPlpVaultBaseProdConfig,
  WethPlpVaultMainnetLegacyConfig,
  WethPlpVaultMainnetProdConfig,
  WethPlpVaultSepoliaDevConfig,
  WethPlpVaultSepoliaProdConfig,
} from './hypoVault/hypoVaultManagerConfigs'
export { getHypoVaultConfigForVault } from './hypoVault/hypoVaultManagerConfigs/vaultToConfig'
export { encodeFulfillDepositsFunctionData } from './hypoVault/hypoVaultManagerWithMerkleVerification/fulfillDeposits'
export { encodeFulfillWithdrawalsFunctionData } from './hypoVault/hypoVaultManagerWithMerkleVerification/fulfillWithdrawals'
export { useRequestDeposit } from './hypoVault/requestDeposit/hooks/use-request-deposit'
export {
  encodeRequestDepositFunctionData,
  getRequestDepositContractConfig,
  requestDeposit,
  simulateRequestDeposit,
} from './hypoVault/requestDeposit/requestDeposit'
export { useRequestWithdrawal } from './hypoVault/requestWithdrawal/hooks/use-request-withdrawal'
export {
  buildExecuteDepositCalldatas,
  buildRequestWithdrawalCalldatas,
  encodeExecuteDepositFunctionData,
  encodeRequestWithdrawalFunctionData,
  encodeRequestWithdrawalMulticallFunctionData,
  getRequestWithdrawalContractConfig,
  getRequestWithdrawalMulticallContractConfig,
  requestWithdrawal,
  requestWithdrawalMulticall,
  simulateRequestWithdrawal,
  simulateRequestWithdrawalMulticall,
} from './hypoVault/requestWithdrawal/requestWithdrawal'
export {
  type DepositEpochStateSnapshot,
  type QueuedDepositSnapshot,
  type SharePrice,
  calculateAssetsFromShares,
  calculateAvailableShares,
  calculateClaimableSharesFromQueuedDeposits,
  calculateSharesFromAssets,
  getMinQueuedDepositEpoch,
} from './hypoVault/requestWithdrawal/utils'
export {
  getStaleOracleOverrideBytecodeForAccountant,
  getStaleOracleStateOverrideForAccountant,
} from './hypoVault/staleOracleOverride'
export {
  type InferLeaf,
  type LeafDescription,
  type ManageAction,
  type ManageVaultArgs,
  type StrategistLeaf,
  type StrategistLeavesArtifact,
  buildManageArgs,
  findLeaf,
} from './hypoVault/utils/buildManageArgs'
export {
  type BuildManagerInputParams,
  type PoolInfo,
  buildManagerInput,
} from './hypoVault/utils/buildManagerInput'
export {
  type BuildManagerInputAtBlockParams,
  buildManagerInputAtBlock,
} from './hypoVault/utils/buildManagerInputAtBlock'
export {
  type ManageLeaf,
  convertJsonTreeToArray,
  generateProof,
  getProofsFromDigests,
  getProofsUsingTree,
} from './hypoVault/utils/merkleTreeHelper'
export {
  buildVaultManagerInput,
  buildVaultManagerInputAtBlock,
  getVaultPoolInfos,
  resolveVaultTokenIdsByPool,
} from './hypoVault/utils/vaultManagerInput'
export {
  type VaultDisplayNameResolver,
  type VaultDisplayNameResolverInput,
  resolveVaultDisplayName,
  VAULT_DISPLAY_NAME_RESOLVERS_PER_CHAIN,
  VAULT_DISPLAY_NAMES_PER_CHAIN,
} from './hypoVault/vaultDisplayNames'

// Panoptic V1
export { encodeDepositFunctionData } from './panoptic/v1/CollateralTracker/deposit'
export { encodeWithdrawFunctionData } from './panoptic/v1/CollateralTracker/withdraw'

// Token
export { encodeApproveFunctionData } from './token/erc20/approve'

// RPC
export { getAlchemyRpcUrl, getAlchemyWsRpcUrl } from './rpc'

// GraphQL
export type * from './graphql/hypoVault-sdk.generated'
export type * from './graphql/hypoVault-types.generated'
export {
  type HypoVaultGraphQLClient,
  chainToHypoVaultGraphQlAPI,
  getHypoVaultGraphQLClient,
} from './graphqlClient'

// Errors
export { type DecodedError, parseCustomError } from './errors/ethereum'

// Types
export { type BaseContractWriteHookOutput } from './types/baseContractWriteHookOutput'

// Panoptic V2 rate helpers
export {
  annualizePerSecondRateWad,
  formatPerSecondRateWadAsAprPct,
  formatPerSecondRateWadAsApyPct,
} from './panoptic/v2/formatters/rates'

// Panoptic V2 IRM helpers
export {
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
} from './panoptic/v2/reads/irm'
export type { IrmCurrent, IrmMarketStateInputs, IrmPoint } from './panoptic/v2/types/irm'
