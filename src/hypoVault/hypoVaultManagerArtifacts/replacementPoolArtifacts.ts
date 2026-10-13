import { type Address, getAddress } from 'viem'

import { MAINNET_CHAIN_ID, requireChainDeployment, ROBINHOOD_CHAIN_ID } from '../chainDeployments'
import type { StrategistLeavesArtifact } from '../utils/buildManageArgs'
import type { PoolInfo } from '../utils/buildManagerInput'
import { createStrategistLeavesArtifact } from './createStrategistLeavesArtifact'
import { MainnetUSDCPLPStrategistLeaves } from './MainnetUSDCPLPStrategistLeaves'
import { MainnetUSDCPLPVaultPoolInfos } from './MainnetUSDCPLPVaultPoolInfos'
import { MainnetWETHPLPStrategistLeaves } from './MainnetWETHPLPStrategistLeaves'
import { MainnetWETHPLPVaultPoolInfos } from './MainnetWETHPLPVaultPoolInfos'
import { RobinhoodUSDGPLP5bpsStrategistLeaves } from './RobinhoodUSDGPLPStrategistLeaves'
import { RobinhoodUSDGPLP5bpsVaultPoolInfos } from './RobinhoodUSDGPLPVaultPoolInfos'

function replacementArtifacts(
  chainId: number,
  deploymentKey: string,
  oldArtifact: StrategistLeavesArtifact,
  oldPoolInfos: readonly PoolInfo[],
) {
  const deployment = requireChainDeployment(chainId)
  const replacement = deployment.panoptic.additionalPools?.[deploymentKey]
  const oldPoolInfo = oldPoolInfos[0]
  if (
    replacement?.deploymentBlock === undefined ||
    oldPoolInfo === undefined ||
    oldPoolInfos.length !== 1
  ) {
    throw new Error(`Missing replacement deployment or single-pool policy for ${deploymentKey}`)
  }
  const previous = [
    deployment.panoptic.pool,
    ...Object.values(deployment.panoptic.additionalPools ?? {}),
  ].find((pool) => pool?.panopticPool.toLowerCase() === oldPoolInfo.pool.toLowerCase())
  if (previous === undefined) throw new Error(`Missing previous deployment for ${oldPoolInfo.pool}`)
  const addresses = new Map([
    [previous.panopticPool.toLowerCase(), replacement.panopticPool],
    [previous.collateralTracker0.toLowerCase(), replacement.collateralTracker0],
    [previous.collateralTracker1.toLowerCase(), replacement.collateralTracker1],
  ])
  const remap = (address: Address) => addresses.get(address.toLowerCase()) ?? address
  const definitions = oldArtifact.leafs
    .filter((leaf) => leaf.Description !== '')
    .map((leaf) => ({
      description: leaf.Description,
      target: remap(getAddress(leaf.TargetAddress)),
      functionSignature: leaf.FunctionSignature,
      addressArguments: leaf.AddressArguments.map((address) => remap(getAddress(address))),
      canSendValue: leaf.CanSendValue,
    }))
  const strategistLeaves = createStrategistLeavesArtifact(
    {
      accountantAddress: getAddress(oldArtifact.metadata.AccountantAddress),
      boringVaultAddress: getAddress(oldArtifact.metadata.BoringVaultAddress),
      decoderAndSanitizerAddress: getAddress(oldArtifact.metadata.DecoderAndSanitizerAddress),
      managerAddress: getAddress(oldArtifact.metadata.ManagerAddress),
    },
    definitions,
  )
  const vaultPoolInfos = {
    vaultAddress: getAddress(oldArtifact.metadata.BoringVaultAddress),
    poolInfos: [
      {
        ...oldPoolInfo,
        pool: replacement.panopticPool,
        positionScanFromBlock: BigInt(replacement.deploymentBlock),
      },
    ],
  }
  return { deployment: replacement, strategistLeaves, vaultPoolInfos }
}

export const MAINNET_WETH_REPLACEMENT_ARTIFACTS = replacementArtifacts(
  MAINNET_CHAIN_ID,
  'ethUsdc5bpsV3Replacement',
  MainnetWETHPLPStrategistLeaves,
  MainnetWETHPLPVaultPoolInfos.poolInfos,
)
export const MAINNET_USDC_REPLACEMENT_ARTIFACTS = replacementArtifacts(
  MAINNET_CHAIN_ID,
  'ethUsdc5bpsV3Replacement',
  MainnetUSDCPLPStrategistLeaves,
  MainnetUSDCPLPVaultPoolInfos.poolInfos,
)
export const ROBINHOOD_USDG_REPLACEMENT_ARTIFACTS = replacementArtifacts(
  ROBINHOOD_CHAIN_ID,
  'spyUsdg5bpsV4Replacement',
  RobinhoodUSDGPLP5bpsStrategistLeaves,
  RobinhoodUSDGPLP5bpsVaultPoolInfos.poolInfos,
)
