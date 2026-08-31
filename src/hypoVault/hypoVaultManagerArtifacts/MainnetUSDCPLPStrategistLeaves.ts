import { type VaultPoolPolicyEntry, compileVaultPoolPolicy } from './compileVaultPoolPolicy'
import { createStrategistLeavesArtifact } from './createStrategistLeavesArtifact'
import {
  MAINNET_ETH_USDC_V4_POOL_INFO,
  MAINNET_USDC_WETH_5BPS_V3_POOL_INFO,
  MAINNET_WSPCXX_USDC_POOL_INFO,
} from './poolInfosConfig'

/** Last mainnet block before the V3 authorization execute transaction. */
export const MAINNET_USDC_PLP_PRE_V3_AUTHORIZATION_BLOCK = 25_704_950n
export const MAINNET_USDC_PLP_PRE_V3_STRATEGIST =
  '0x3c1c79d0cfc316Ba959194c89696a8382d7d283b' as const
export const MAINNET_USDC_PLP_PRE_V3_MANAGE_ROOT =
  '0xed7d4ae055fd62c6edc93bd676456748f52fe4f4b78f60ab3ef6394bacc31b5d' as const

const VAULT = '0x236d0558f06cd60780b232d4Ec4c92d2cb7e4D18'
const DECODER = '0xC87c45d2dbE5acb56013e2591427ECC84Fa251E6'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const CURRENT_POOL = '0x00000000563b70d704f4c6675a5f6ac989fbae13'
const CURRENT_PO_ETH = '0x1e46b0289B7E0F710E2Db8Ab87800dd782D624f7'
const CURRENT_PO_USDC = '0x12bF31955522BAC337D93e1bC0a39F68D8BDa216'
const WSPCXX_PO_USDC = '0x141cc517a6276542B59732Fd85C1A2C536eF7aCA'
const NEW_POOL = '0x00000000009C7B687e833559e34503f64d7ed7c4'
const NEW_PO_USDC = '0x3CCdA7d5E841d6543D90BcEc20b36a724C184DE9'
const NEW_PO_WETH = '0x69E9f9e44E5F52237493b980dd7306198C64A4E4'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const DISPATCH_SIGNATURE = 'dispatch(uint256[],uint256[],uint128[],int24[3][],bool,uint256)'

export const MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS = [
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
    description: 'Dispatch mint/burn options on PanopticPool',
    target: CURRENT_POOL,
    functionSignature: DISPATCH_SIGNATURE,
    addressArguments: [],
    canSendValue: false,
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
    description: 'Approve wSPCXx poUSDC to spend USDC',
    target: USDC,
    functionSignature: 'approve(address,uint256)',
    addressArguments: [WSPCXX_PO_USDC],
    canSendValue: false,
  },
  {
    description: 'Deposit USDC for wSPCXx poUSDC',
    target: WSPCXX_PO_USDC,
    functionSignature: 'deposit(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: false,
  },
  {
    description: 'Withdraw USDC from wSPCXx poUSDC',
    target: WSPCXX_PO_USDC,
    functionSignature: 'withdraw(uint256,address,address)',
    addressArguments: [VAULT, VAULT],
    canSendValue: false,
  },
  {
    description: 'Deposit ETH for poETH (payable)',
    target: CURRENT_PO_ETH,
    functionSignature: 'deposit(uint256,address)',
    addressArguments: [VAULT],
    canSendValue: true,
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
  {
    description: 'Dispatch mint/burn options on PanopticPool',
    target: NEW_POOL,
    functionSignature: DISPATCH_SIGNATURE,
    addressArguments: [],
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
] as const

const V4_FULL_LEAF_DEFINITIONS = [
  ...MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS.slice(0, 9),
  ...MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS.slice(12, 15),
]
const V4_WIND_DOWN_LEAF_DEFINITIONS = [
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS[2],
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS[3],
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS[5],
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS[6],
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS[7],
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS[8],
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS[14],
]
const WSPCXX_FULL_LEAF_DEFINITIONS =
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS.slice(9, 12)
const WSPCXX_WIND_DOWN_LEAF_DEFINITIONS = [
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS[11],
]
const V3_FULL_LEAF_DEFINITIONS =
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS.slice(15)
const V3_WIND_DOWN_LEAF_DEFINITIONS = V3_FULL_LEAF_DEFINITIONS.filter(
  ({ functionSignature }) =>
    functionSignature === DISPATCH_SIGNATURE ||
    functionSignature === 'withdraw(uint256,address,address)' ||
    functionSignature === 'withdraw(uint256,address,address,uint256[],bool)' ||
    functionSignature === 'redeem(uint256,address,address)',
)

export const MAINNET_USDC_PLP_POOL_POLICY = [
  {
    id: 'weth-usdc-v3-5bps',
    mode: 'primary',
    poolInfo: MAINNET_USDC_WETH_5BPS_V3_POOL_INFO,
    fullLeafDefinitions: V3_FULL_LEAF_DEFINITIONS,
    windDownLeafDefinitions: V3_WIND_DOWN_LEAF_DEFINITIONS,
  },
  {
    id: 'eth-usdc-v4',
    mode: 'retired',
    poolInfo: MAINNET_ETH_USDC_V4_POOL_INFO,
    fullLeafDefinitions: V4_FULL_LEAF_DEFINITIONS,
    windDownLeafDefinitions: V4_WIND_DOWN_LEAF_DEFINITIONS,
  },
  {
    id: 'wspcxx-usdc',
    mode: 'retired',
    poolInfo: MAINNET_WSPCXX_USDC_POOL_INFO,
    fullLeafDefinitions: WSPCXX_FULL_LEAF_DEFINITIONS,
    windDownLeafDefinitions: WSPCXX_WIND_DOWN_LEAF_DEFINITIONS,
  },
] as const satisfies readonly VaultPoolPolicyEntry[]

export const MAINNET_USDC_PLP_COMPILED_POOL_POLICY = compileVaultPoolPolicy({
  pools: MAINNET_USDC_PLP_POOL_POLICY,
})

export const MAINNET_USDC_PLP_STRATEGIST_LEAF_DEFINITIONS =
  MAINNET_USDC_PLP_COMPILED_POOL_POLICY.strategistLeafDefinitions

const MAINNET_USDC_PLP_STRATEGIST_ARTIFACT_METADATA = {
  accountantAddress: '0x65aA902AE3135658587FFC36ED51B61c927114e1',
  boringVaultAddress: VAULT,
  decoderAndSanitizerAddress: DECODER,
  managerAddress: '0x2ce65016366ef7320078e0758D58Cf1038bc7C4e',
} as const

/** Number of leaf definitions authorized before the V3 pool release. */
const PRE_V3_AUTHORIZATION_LEAF_COUNT = 12

/** Production permissions before the ETH/USDC 5bps v3 pool authorization executes. */
export const MainnetUSDCPLPPreviousStrategistLeaves = createStrategistLeavesArtifact(
  MAINNET_USDC_PLP_STRATEGIST_ARTIFACT_METADATA,
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS.slice(
    0,
    PRE_V3_AUTHORIZATION_LEAF_COUNT,
  ),
)

/** Production permissions authorized by the original ETH/USDC 5bps v3 release. */
export const MainnetUSDCPLPV3AuthorizedStrategistLeaves = createStrategistLeavesArtifact(
  MAINNET_USDC_PLP_STRATEGIST_ARTIFACT_METADATA,
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS,
)

/** Current production permissions after retiring the migrated pools. */
export const MainnetUSDCPLPStrategistLeaves = createStrategistLeavesArtifact(
  MAINNET_USDC_PLP_STRATEGIST_ARTIFACT_METADATA,
  MAINNET_USDC_PLP_COMPILED_POOL_POLICY.strategistLeafDefinitions,
)
