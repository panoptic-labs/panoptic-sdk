import type { Address, PublicClient } from 'viem'
import { zeroAddress } from 'viem'

import { getAccountCollateral } from '../../panoptic/v2/reads/account'
import { getCollateralData } from '../../panoptic/v2/reads/collateral'
import { getPoolMetadata } from '../../panoptic/v2/reads/pool'
import { getChainDeployment } from '../chainDeployments'
import { resolveVaultPoolInfosAtBlock } from '../utils/vaultManagerInput'

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
  borrowRateWad: bigint | null
  supplyRateWad: bigint | null
  utilizationBps: bigint | null
  allocationUnderlying: bigint
  allocationPctBps: bigint
  isIdle: boolean
  poolAddress: Address | null
  collateralTrackerAddress: Address | null
}

export type LendingAllocationResult = {
  rows: LendingAllocationRow[]
  totalUnderlying: bigint
}

function toLowerAddress(address: string): string {
  return address.toLowerCase()
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
  blockNumber ??= await client.getBlockNumber()
  const poolInfos = await resolveVaultPoolInfosAtBlock({
    viemClient: client,
    chainId,
    vaultAddress,
    blockNumber,
  })
  const poolAddresses = [...new Set(poolInfos.map(({ pool }) => pool))]

  const wrappedNativeToken = getChainDeployment(chainId)?.sfpmSwap?.weth
  const underlyingIsWrappedNative =
    wrappedNativeToken !== undefined &&
    toLowerAddress(underlyingTokenAddress) === toLowerAddress(wrappedNativeToken)
  const poolRows = await Promise.all(
    poolAddresses.map(async (poolAddress): Promise<LendingAllocationRow | null> => {
      const metadata = await getPoolMetadata({
        client,
        poolAddress,
      })

      const underlyingIndex = getUnderlyingIndex({
        underlyingTokenAddress:
          underlyingIsWrappedNative &&
          (metadata.token0Asset === zeroAddress || metadata.token1Asset === zeroAddress)
            ? zeroAddress
            : underlyingTokenAddress,
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
        borrowRateWad: collateralData.borrowRate,
        supplyRateWad: collateralData.supplyRate,
        utilizationBps: collateralData.utilization,
        allocationUnderlying,
        allocationPctBps: 0n,
        isIdle: false,
        poolAddress,
        collateralTrackerAddress:
          underlyingIndex === 0
            ? metadata.collateralToken0Address
            : metadata.collateralToken1Address,
      }
    }),
  )

  const nonNullPoolRows = poolRows.filter(
    (row): row is Exclude<LendingAllocationRow, null> => row !== null,
  )

  const wrappedIdleBalance = await client.readContract({
    address: underlyingTokenAddress,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf',
    args: [vaultAddress],
    blockNumber,
  })

  const nativeIdleBalance = underlyingIsWrappedNative
    ? await client.getBalance({ address: vaultAddress, blockNumber })
    : 0n
  const idleBalance = wrappedIdleBalance + nativeIdleBalance
  const idleRow: LendingAllocationRow = {
    market: 'Idle Funds',
    borrowRateWad: null,
    supplyRateWad: null,
    utilizationBps: null,
    allocationUnderlying: idleBalance,
    allocationPctBps: 0n,
    isIdle: true,
    poolAddress: null,
    collateralTrackerAddress: null,
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
