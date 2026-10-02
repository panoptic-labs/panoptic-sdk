import type { Address } from 'viem'

import { requireChainDeployment, ROBINHOOD_CHAIN_ID } from '../chainDeployments'
import { type VaultPoolPolicyEntry, compileVaultPoolPolicy } from './compileVaultPoolPolicy'
import {
  type StrategistLeafDefinition,
  createStrategistLeavesArtifact,
} from './createStrategistLeavesArtifact'
import {
  ROBINHOOD_SPY_USDG_5BPS_POOL_INFO,
  ROBINHOOD_SPY_USDG_30BPS_POOL_INFO,
} from './poolInfosConfig'

const deployment = requireChainDeployment(ROBINHOOD_CHAIN_ID)
const vault = deployment.hypovault.vaults.usdgPlpVault
const manager = deployment.hypovault.managers.usdgPlpVaultManager
const oldPool = deployment.panoptic.additionalPools?.spyUsdg30bpsV4
const newPool = deployment.panoptic.additionalPools?.spyUsdg5bpsV4

if (
  vault === undefined ||
  manager === undefined ||
  oldPool === undefined ||
  newPool === undefined
) {
  throw new Error('Missing Robinhood USDG PLP dual-generation deployment addresses')
}
const vaultAddress = vault
const managerAddress = manager
const oldPoolAddresses = oldPool
const newPoolAddresses = newPool

const dispatchSignature = 'dispatch(uint256[],uint256[],uint128[],int24[3][],bool,uint256)'

function createPolicy({
  id,
  poolInfo,
  collateralTracker0,
  collateralTracker1,
}: {
  id: string
  poolInfo: typeof ROBINHOOD_SPY_USDG_30BPS_POOL_INFO | typeof ROBINHOOD_SPY_USDG_5BPS_POOL_INFO
  collateralTracker0: Address
  collateralTracker1: Address
}) {
  const trackerLeaves = [
    {
      description: 'Approve poSPY to spend SPY',
      target: poolInfo.token0,
      functionSignature: 'approve(address,uint256)',
      addressArguments: [collateralTracker0],
      canSendValue: false,
    },
    {
      description: 'Deposit SPY for poSPY',
      target: collateralTracker0,
      functionSignature: 'deposit(uint256,address)',
      addressArguments: [vaultAddress],
      canSendValue: false,
    },
    {
      description: 'Withdraw SPY from poSPY',
      target: collateralTracker0,
      functionSignature: 'withdraw(uint256,address,address)',
      addressArguments: [vaultAddress, vaultAddress],
      canSendValue: false,
    },
    {
      description: 'Withdraw SPY from poSPY (with open positions)',
      target: collateralTracker0,
      functionSignature: 'withdraw(uint256,address,address,uint256[],bool)',
      addressArguments: [vaultAddress, vaultAddress],
      canSendValue: false,
    },
    {
      description: 'Mint poSPY using SPY',
      target: collateralTracker0,
      functionSignature: 'mint(uint256,address)',
      addressArguments: [vaultAddress],
      canSendValue: false,
    },
    {
      description: 'Redeem poSPY for SPY',
      target: collateralTracker0,
      functionSignature: 'redeem(uint256,address,address)',
      addressArguments: [vaultAddress, vaultAddress],
      canSendValue: false,
    },
    {
      description: 'Approve poUSDG to spend USDG',
      target: poolInfo.token1,
      functionSignature: 'approve(address,uint256)',
      addressArguments: [collateralTracker1],
      canSendValue: false,
    },
    {
      description: 'Deposit USDG for poUSDG',
      target: collateralTracker1,
      functionSignature: 'deposit(uint256,address)',
      addressArguments: [vaultAddress],
      canSendValue: false,
    },
    {
      description: 'Withdraw USDG from poUSDG',
      target: collateralTracker1,
      functionSignature: 'withdraw(uint256,address,address)',
      addressArguments: [vaultAddress, vaultAddress],
      canSendValue: false,
    },
    {
      description: 'Withdraw USDG from poUSDG (with open positions)',
      target: collateralTracker1,
      functionSignature: 'withdraw(uint256,address,address,uint256[],bool)',
      addressArguments: [vaultAddress, vaultAddress],
      canSendValue: false,
    },
    {
      description: 'Mint poUSDG using USDG',
      target: collateralTracker1,
      functionSignature: 'mint(uint256,address)',
      addressArguments: [vaultAddress],
      canSendValue: false,
    },
    {
      description: 'Redeem poUSDG for USDG',
      target: collateralTracker1,
      functionSignature: 'redeem(uint256,address,address)',
      addressArguments: [vaultAddress, vaultAddress],
      canSendValue: false,
    },
  ] as const satisfies readonly StrategistLeafDefinition[]
  const dispatchLeaf = {
    description: 'Dispatch mint/burn options on PanopticPool',
    target: poolInfo.pool,
    functionSignature: dispatchSignature,
    addressArguments: [],
    canSendValue: false,
  } as const satisfies StrategistLeafDefinition
  const windDownLeaves = trackerLeaves.filter(
    ({ functionSignature }) =>
      functionSignature.startsWith('withdraw(') || functionSignature.startsWith('redeem('),
  )
  return [
    {
      id,
      mode: 'primary',
      poolInfo,
      fullLeafDefinitions: [...trackerLeaves, dispatchLeaf],
      windDownLeafDefinitions: [...windDownLeaves, dispatchLeaf],
    },
  ] as const satisfies readonly VaultPoolPolicyEntry[]
}

function createArtifact(policy: readonly VaultPoolPolicyEntry[]) {
  const compiled = compileVaultPoolPolicy({ pools: policy })
  return {
    compiled,
    artifact: createStrategistLeavesArtifact(
      {
        accountantAddress: deployment.hypovault.core.accountant,
        boringVaultAddress: vaultAddress,
        decoderAndSanitizerAddress: deployment.hypovault.core.collateralTrackerDecoderAndSanitizer,
        managerAddress,
      },
      compiled.strategistLeafDefinitions,
    ),
  }
}

export const ROBINHOOD_USDG_PLP_30BPS_POOL_POLICY = createPolicy({
  id: 'spy-usdg-30bps-v4',
  poolInfo: ROBINHOOD_SPY_USDG_30BPS_POOL_INFO,
  collateralTracker0: oldPoolAddresses.collateralTracker0,
  collateralTracker1: oldPoolAddresses.collateralTracker1,
})
export const ROBINHOOD_USDG_PLP_5BPS_POOL_POLICY = createPolicy({
  id: 'spy-usdg-5bps-v4',
  poolInfo: ROBINHOOD_SPY_USDG_5BPS_POOL_INFO,
  collateralTracker0: newPoolAddresses.collateralTracker0,
  collateralTracker1: newPoolAddresses.collateralTracker1,
})

const previous = createArtifact(ROBINHOOD_USDG_PLP_30BPS_POOL_POLICY)
const next = createArtifact(ROBINHOOD_USDG_PLP_5BPS_POOL_POLICY)

export const ROBINHOOD_USDG_PLP_30BPS_COMPILED_POOL_POLICY = previous.compiled
export const ROBINHOOD_USDG_PLP_5BPS_COMPILED_POOL_POLICY = next.compiled
export const RobinhoodUSDGPLP30bpsStrategistLeaves = previous.artifact
export const RobinhoodUSDGPLP5bpsStrategistLeaves = next.artifact

export const ROBINHOOD_USDG_PLP_POOL_POLICY = ROBINHOOD_USDG_PLP_5BPS_POOL_POLICY
export const ROBINHOOD_USDG_PLP_COMPILED_POOL_POLICY = ROBINHOOD_USDG_PLP_5BPS_COMPILED_POOL_POLICY
export const RobinhoodUSDGPLPStrategistLeaves = RobinhoodUSDGPLP5bpsStrategistLeaves
