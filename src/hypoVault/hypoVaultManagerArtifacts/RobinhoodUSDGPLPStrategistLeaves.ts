import { requireChainDeployment, ROBINHOOD_CHAIN_ID } from '../chainDeployments'
import { type VaultPoolPolicyEntry, compileVaultPoolPolicy } from './compileVaultPoolPolicy'
import {
  type StrategistLeafDefinition,
  createStrategistLeavesArtifact,
} from './createStrategistLeavesArtifact'
import { ROBINHOOD_SPY_USDG_POOL_INFO } from './poolInfosConfig'

const deployment = requireChainDeployment(ROBINHOOD_CHAIN_ID)
const vault = deployment.hypovault.vaults.usdgPlpVault
const manager = deployment.hypovault.managers.usdgPlpVaultManager

if (vault === undefined || manager === undefined) {
  throw new Error('Missing Robinhood USDG PLP vault deployment addresses')
}

const pool = deployment.panoptic.pool.panopticPool
const poSpy = deployment.panoptic.pool.collateralTracker0
const poUsdg = deployment.panoptic.pool.collateralTracker1
const spy = ROBINHOOD_SPY_USDG_POOL_INFO.token0
const usdg = ROBINHOOD_SPY_USDG_POOL_INFO.token1
const dispatchSignature = 'dispatch(uint256[],uint256[],uint128[],int24[3][],bool,uint256)'

const trackerLeaves = [
  {
    description: 'Approve poSPY to spend SPY',
    target: spy,
    functionSignature: 'approve(address,uint256)',
    addressArguments: [poSpy],
    canSendValue: false,
  },
  {
    description: 'Deposit SPY for poSPY',
    target: poSpy,
    functionSignature: 'deposit(uint256,address)',
    addressArguments: [vault],
    canSendValue: false,
  },
  {
    description: 'Withdraw SPY from poSPY',
    target: poSpy,
    functionSignature: 'withdraw(uint256,address,address)',
    addressArguments: [vault, vault],
    canSendValue: false,
  },
  {
    description: 'Withdraw SPY from poSPY (with open positions)',
    target: poSpy,
    functionSignature: 'withdraw(uint256,address,address,uint256[],bool)',
    addressArguments: [vault, vault],
    canSendValue: false,
  },
  {
    description: 'Mint poSPY using SPY',
    target: poSpy,
    functionSignature: 'mint(uint256,address)',
    addressArguments: [vault],
    canSendValue: false,
  },
  {
    description: 'Redeem poSPY for SPY',
    target: poSpy,
    functionSignature: 'redeem(uint256,address,address)',
    addressArguments: [vault, vault],
    canSendValue: false,
  },
  {
    description: 'Approve poUSDG to spend USDG',
    target: usdg,
    functionSignature: 'approve(address,uint256)',
    addressArguments: [poUsdg],
    canSendValue: false,
  },
  {
    description: 'Deposit USDG for poUSDG',
    target: poUsdg,
    functionSignature: 'deposit(uint256,address)',
    addressArguments: [vault],
    canSendValue: false,
  },
  {
    description: 'Withdraw USDG from poUSDG',
    target: poUsdg,
    functionSignature: 'withdraw(uint256,address,address)',
    addressArguments: [vault, vault],
    canSendValue: false,
  },
  {
    description: 'Withdraw USDG from poUSDG (with open positions)',
    target: poUsdg,
    functionSignature: 'withdraw(uint256,address,address,uint256[],bool)',
    addressArguments: [vault, vault],
    canSendValue: false,
  },
  {
    description: 'Mint poUSDG using USDG',
    target: poUsdg,
    functionSignature: 'mint(uint256,address)',
    addressArguments: [vault],
    canSendValue: false,
  },
  {
    description: 'Redeem poUSDG for USDG',
    target: poUsdg,
    functionSignature: 'redeem(uint256,address,address)',
    addressArguments: [vault, vault],
    canSendValue: false,
  },
] as const satisfies readonly StrategistLeafDefinition[]

const dispatchLeaf = {
  description: 'Dispatch mint/burn options on PanopticPool',
  target: pool,
  functionSignature: dispatchSignature,
  addressArguments: [],
  canSendValue: false,
} as const satisfies StrategistLeafDefinition

const windDownLeaves = trackerLeaves.filter(
  ({ functionSignature }) =>
    functionSignature.startsWith('withdraw(') || functionSignature.startsWith('redeem('),
)

export const ROBINHOOD_USDG_PLP_POOL_POLICY = [
  {
    id: 'spy-usdg-v4',
    mode: 'primary',
    poolInfo: ROBINHOOD_SPY_USDG_POOL_INFO,
    fullLeafDefinitions: [...trackerLeaves, dispatchLeaf],
    windDownLeafDefinitions: [...windDownLeaves, dispatchLeaf],
  },
] as const satisfies readonly VaultPoolPolicyEntry[]

export const ROBINHOOD_USDG_PLP_COMPILED_POOL_POLICY = compileVaultPoolPolicy({
  pools: ROBINHOOD_USDG_PLP_POOL_POLICY,
})

export const RobinhoodUSDGPLPStrategistLeaves = createStrategistLeavesArtifact(
  {
    accountantAddress: deployment.hypovault.core.accountant,
    boringVaultAddress: vault,
    decoderAndSanitizerAddress: deployment.hypovault.core.collateralTrackerDecoderAndSanitizer,
    managerAddress: manager,
  },
  ROBINHOOD_USDG_PLP_COMPILED_POOL_POLICY.strategistLeafDefinitions,
)
