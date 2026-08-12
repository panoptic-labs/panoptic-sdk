import { MAINNET_CHAIN_ID, requireChainDeployment } from '../chainDeployments'
import { createStrategistLeavesArtifact } from './createStrategistLeavesArtifact'

const MAINNET_DEPLOYMENT = requireChainDeployment(MAINNET_CHAIN_ID)
const NEW_POOL_DEPLOYMENT = MAINNET_DEPLOYMENT.panoptic.additionalPools?.ethUsdc5bpsV3
if (NEW_POOL_DEPLOYMENT === undefined) {
  throw new Error('Missing mainnet ETH/USDC 5bps v3 Panoptic pool deployment')
}

const VAULT = MAINNET_DEPLOYMENT.hypovault.vaults.wethPlpVault
const DECODER = MAINNET_DEPLOYMENT.hypovault.core.collateralTrackerDecoderAndSanitizer
const CURRENT_POOL = MAINNET_DEPLOYMENT.panoptic.pool.panopticPool
const CURRENT_PO_ETH = MAINNET_DEPLOYMENT.panoptic.pool.collateralTracker0
const CURRENT_PO_USDC = MAINNET_DEPLOYMENT.panoptic.pool.collateralTracker1
const NEW_POOL = NEW_POOL_DEPLOYMENT.panopticPool
const NEW_PO_USDC = NEW_POOL_DEPLOYMENT.collateralTracker0
const NEW_PO_WETH = NEW_POOL_DEPLOYMENT.collateralTracker1
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const DISPATCH_SIGNATURE = 'dispatch(uint256[],uint256[],uint128[],int24[3][],bool,uint256)'

export const MAINNET_WETH_PLP_STRATEGIST_LEAF_DEFINITIONS = [
  {
    description: 'Deposit ETH for poETH (payable)',
    target: CURRENT_PO_ETH,
    functionSignature: 'deposit(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: true,
  },
  {
    description: 'Withdraw ETH from poETH',
    target: CURRENT_PO_ETH,
    functionSignature: 'withdraw(uint256,address,address)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Withdraw ETH from poETH (with open positions)',
    target: CURRENT_PO_ETH,
    functionSignature: 'withdraw(uint256,address,address,uint256[],bool)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Mint poETH using ETH (payable)',
    target: CURRENT_PO_ETH,
    functionSignature: 'mint(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: true,
  },
  {
    description: 'Redeem poETH for ETH',
    target: CURRENT_PO_ETH,
    functionSignature: 'redeem(uint256,address,address)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Dispatch mint/burn options on PanopticPool',
    target: CURRENT_POOL,
    functionSignature: DISPATCH_SIGNATURE,
    addressArguments: [],
    canSendValue: false,
  },
  {
    description: 'Wrap ETH to WETH',
    target: WETH,
    functionSignature: 'deposit()',
    addressArguments: [],
    canSendValue: true,
  },
  {
    description: 'Unwrap WETH to ETH',
    target: WETH,
    functionSignature: 'withdraw(uint256)',
    addressArguments: [],
    canSendValue: false,
  },
  {
    description: 'Withdraw USDC from poUSDC',
    target: CURRENT_PO_USDC,
    functionSignature: 'withdraw(uint256,address,address)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Withdraw USDC from poUSDC (with open positions)',
    target: CURRENT_PO_USDC,
    functionSignature: 'withdraw(uint256,address,address,uint256[],bool)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Approve poUSDC to spend USDC',
    target: USDC,
    functionSignature: 'approve(address,uint256)',
    addressArguments: [CURRENT_PO_USDC],
    canSendValue: false,
  },
  {
    description: 'Deposit USDC for poUSDC',
    target: CURRENT_PO_USDC,
    functionSignature: 'deposit(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: false,
  },
  {
    description: 'Mint poUSDC using USDC',
    target: CURRENT_PO_USDC,
    functionSignature: 'mint(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: false,
  },
  {
    description: 'Redeem poUSDC for USDC',
    target: CURRENT_PO_USDC,
    functionSignature: 'redeem(uint256,address,address)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Approve poWETH v3 to spend WETH',
    target: WETH,
    functionSignature: 'approve(address,uint256)',
    addressArguments: [NEW_PO_WETH],
    canSendValue: false,
  },
  {
    description: 'Deposit WETH for poWETH v3',
    target: NEW_PO_WETH,
    functionSignature: 'deposit(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: false,
  },
  {
    description: 'Withdraw WETH from poWETH v3',
    target: NEW_PO_WETH,
    functionSignature: 'withdraw(uint256,address,address)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Withdraw WETH from poWETH v3 (with open positions)',
    target: NEW_PO_WETH,
    functionSignature: 'withdraw(uint256,address,address,uint256[],bool)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Mint poWETH v3 using WETH',
    target: NEW_PO_WETH,
    functionSignature: 'mint(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: false,
  },
  {
    description: 'Redeem poWETH v3 for WETH',
    target: NEW_PO_WETH,
    functionSignature: 'redeem(uint256,address,address)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Dispatch mint/burn options on PanopticPool',
    target: NEW_POOL,
    functionSignature: DISPATCH_SIGNATURE,
    addressArguments: [],
    canSendValue: false,
  },
  {
    description: 'Approve poUSDC v3 to spend USDC',
    target: USDC,
    functionSignature: 'approve(address,uint256)',
    addressArguments: [NEW_PO_USDC],
    canSendValue: false,
  },
  {
    description: 'Deposit USDC for poUSDC v3',
    target: NEW_PO_USDC,
    functionSignature: 'deposit(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: false,
  },
  {
    description: 'Withdraw USDC from poUSDC v3',
    target: NEW_PO_USDC,
    functionSignature: 'withdraw(uint256,address,address)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Withdraw USDC from poUSDC v3 (with open positions)',
    target: NEW_PO_USDC,
    functionSignature: 'withdraw(uint256,address,address,uint256[],bool)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Mint poUSDC v3 using USDC',
    target: NEW_PO_USDC,
    functionSignature: 'mint(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: false,
  },
  {
    description: 'Redeem poUSDC v3 for USDC',
    target: NEW_PO_USDC,
    functionSignature: 'redeem(uint256,address,address)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
] as const

const MAINNET_WETH_PLP_STRATEGIST_ARTIFACT_METADATA = {
  accountantAddress: MAINNET_DEPLOYMENT.hypovault.core.accountant,
  boringVaultAddress: VAULT,
  decoderAndSanitizerAddress: DECODER,
  managerAddress: MAINNET_DEPLOYMENT.hypovault.managers.wethPlpVaultManager,
} as const

/** Number of leaf definitions authorized before the V3 pool release. */
const PRE_V3_AUTHORIZATION_LEAF_COUNT = 10

/** Production permissions before the ETH/USDC 5bps v3 pool authorization executes. */
export const MainnetWETHPLPPreviousStrategistLeaves = createStrategistLeavesArtifact(
  MAINNET_WETH_PLP_STRATEGIST_ARTIFACT_METADATA,
  MAINNET_WETH_PLP_STRATEGIST_LEAF_DEFINITIONS.slice(0, PRE_V3_AUTHORIZATION_LEAF_COUNT),
)

/** Production permissions after the ETH/USDC 5bps v3 pool authorization executes. */
export const MainnetWETHPLPStrategistLeaves = createStrategistLeavesArtifact(
  MAINNET_WETH_PLP_STRATEGIST_ARTIFACT_METADATA,
  MAINNET_WETH_PLP_STRATEGIST_LEAF_DEFINITIONS,
)
