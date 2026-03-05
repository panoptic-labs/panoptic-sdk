import type { Address, PublicClient } from 'viem'

import { getAccountCollateral } from '../../panoptic/v2/reads/account'
import { getCollateralData } from '../../panoptic/v2/reads/collateral'
import { getPoolMetadata } from '../../panoptic/v2/reads/pool'
import { ProductionUSDCPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/ProductionUSDCPLPVaultPoolInfos'
import { ProductionWETHPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/ProductionWETHPLPVaultPoolInfos'
import { getHypoVaultConfigForVault } from '../hypoVaultManagerConfigs/vaultToConfig'

const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export type LendingAllocationRow = {
  market: string
  supplyRateWad: bigint | null
  utilizationBps: bigint | null
  allocationUnderlying: bigint
  allocationPctBps: bigint
  isIdle: boolean
  poolAddress: Address | null
}

export type LendingAllocationResult = {
  rows: LendingAllocationRow[]
  totalUnderlying: bigint
}

function toLowerAddress(address: string): string {
  return address.toLowerCase()
}

function discoverPoolAddresses({
  chainId,
  vaultAddress,
}: {
  chainId: number
  vaultAddress: Address
}): Address[] {
  const discoveredAddresses: Address[] = []
  const seen = new Set<string>()

  const config = getHypoVaultConfigForVault(vaultAddress, chainId)
  const poolFromConfig = config?.addresses?.ethUsdc500bpsV4PanopticPool
  if (poolFromConfig !== undefined) {
    const key = toLowerAddress(poolFromConfig)
    if (!seen.has(key)) {
      seen.add(key)
      discoveredAddresses.push(poolFromConfig)
    }
  }

  const vaultLower = toLowerAddress(vaultAddress)
  const artifactPoolInfos = [
    ...(toLowerAddress(ProductionUSDCPLPVaultPoolInfos.vaultAddress) === vaultLower
      ? ProductionUSDCPLPVaultPoolInfos.poolInfos
      : []),
    ...(toLowerAddress(ProductionWETHPLPVaultPoolInfos.vaultAddress) === vaultLower
      ? ProductionWETHPLPVaultPoolInfos.poolInfos
      : []),
  ]

  for (const poolInfo of artifactPoolInfos) {
    const key = toLowerAddress(poolInfo.pool)
    if (!seen.has(key)) {
      seen.add(key)
      discoveredAddresses.push(poolInfo.pool as Address)
    }
  }

  return discoveredAddresses
}

function getUnderlyingIndex({
  underlyingTokenAddress,
  token0Asset,
  token1Asset,
}: {
  underlyingTokenAddress: Address
  token0Asset: Address
  token1Asset: Address
}): 0 | 1 | null {
  const underlyingLower = toLowerAddress(underlyingTokenAddress)
  if (toLowerAddress(token0Asset) === underlyingLower) {
    return 0
  }
  if (toLowerAddress(token1Asset) === underlyingLower) {
    return 1
  }
  return null
}

export async function getLendingAllocationRows({
  client,
  chainId,
  vaultAddress,
  underlyingTokenAddress,
  blockNumber,
}: {
  client: PublicClient
  chainId: number
  vaultAddress: Address
  underlyingTokenAddress: Address
  blockNumber?: bigint
}): Promise<LendingAllocationResult> {
  const poolAddresses = discoverPoolAddresses({
    chainId,
    vaultAddress,
  })

  const poolRows = await Promise.all(
    poolAddresses.map(async (poolAddress): Promise<LendingAllocationRow | null> => {
      const metadata = await getPoolMetadata({
        client,
        poolAddress,
      })

      const underlyingIndex = getUnderlyingIndex({
        underlyingTokenAddress,
        token0Asset: metadata.token0Asset,
        token1Asset: metadata.token1Asset,
      })

      if (underlyingIndex === null) {
        return null
      }

      const [collateralData, accountCollateral] = await Promise.all([
        getCollateralData({
          client,
          poolAddress,
          tokenIndex: underlyingIndex,
          blockNumber,
        }),
        getAccountCollateral({
          client,
          poolAddress,
          account: vaultAddress,
          blockNumber,
        }),
      ])

      const allocationUnderlying =
        underlyingIndex === 0 ? accountCollateral.token0.assets : accountCollateral.token1.assets

      return {
        market: `${metadata.token0Symbol}/${metadata.token1Symbol}`,
        supplyRateWad: collateralData.supplyRate,
        utilizationBps: collateralData.utilization,
        allocationUnderlying,
        allocationPctBps: 0n,
        isIdle: false,
        poolAddress,
      }
    }),
  )

  const nonNullPoolRows = poolRows.filter(
    (row): row is Exclude<LendingAllocationRow, null> => row !== null,
  )

  const idleBalance = await client.readContract({
    address: underlyingTokenAddress,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf',
    args: [vaultAddress],
    blockNumber,
  })

  const idleRow: LendingAllocationRow = {
    market: 'Idle Funds',
    supplyRateWad: null,
    utilizationBps: null,
    allocationUnderlying: idleBalance,
    allocationPctBps: 0n,
    isIdle: true,
    poolAddress: null,
  }

  const rowsBeforePct = [...nonNullPoolRows, idleRow]
  const totalUnderlying = rowsBeforePct.reduce((sum, row) => sum + row.allocationUnderlying, 0n)

  if (totalUnderlying === 0n) {
    return {
      rows: rowsBeforePct,
      totalUnderlying,
    }
  }

  return {
    rows: rowsBeforePct.map((row) => ({
      ...row,
      allocationPctBps: (row.allocationUnderlying * 10_000n) / totalUnderlying,
    })),
    totalUnderlying,
  }
}
