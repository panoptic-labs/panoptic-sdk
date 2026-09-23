import type { Address, PublicClient } from 'viem'
import { multicall } from 'viem/actions'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { decodeTokenId } from '../tokenId/decode'

/** Native-token margin inputs, independent of the tick used to display the curve. */
export async function getCollateralCurveInputs({
  client,
  poolAddress,
  account,
  tokenIds,
  collateral0,
  collateral1,
  blockNumber,
}: {
  client: PublicClient
  poolAddress: Address
  account: Address
  tokenIds: bigint[]
  collateral0?: Address
  collateral1?: Address
  blockNumber: bigint
}): Promise<bigint[]> {
  const ids = [...tokenIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const [tracker0, tracker1] = await Promise.all([
    collateral0 ??
      client.readContract({
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'collateralToken0',
        blockNumber,
      }),
    collateral1 ??
      client.readContract({
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'collateralToken1',
        blockNumber,
      }),
  ])
  const [positions, balances0, balances1] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      functionName: 'getFullPositionsData',
      args: [account, false, ids],
      blockNumber,
    }),
    client.readContract({
      address: tracker0,
      abi: collateralTrackerV2Abi,
      functionName: 'assetsAndInterest',
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: tracker1,
      abi: collateralTrackerV2Abi,
      functionName: 'assetsAndInterest',
      args: [account],
      blockNumber,
    }),
  ])
  return [positions[0], positions[1], ...positions[2], ...balances0, ...balances1]
}

/** A spot-independent sampling grid, including exact liquidation boundaries and their neighbours. */
export function collateralCurveTicks(
  tokenIds: readonly bigint[],
  liquidationTicks: readonly bigint[],
) {
  const strikes = tokenIds.flatMap((id) => decodeTokenId(id).legs.map((leg) => leg.strike))
  const center =
    strikes.length === 0 ? 0n : strikes.reduce((a, b) => a + b, 0n) / BigInt(strikes.length)
  const ticks = new Set<bigint>([-887272n, 887272n])
  for (let i = 0n; i < 250n; i++) {
    ticks.add(center - 25000n + (50000n * i) / 249n)
    ticks.add(-887272n + (1774544n * i) / 249n)
  }
  for (const tick of liquidationTicks) {
    ticks.add(tick - 1n)
    ticks.add(tick)
    ticks.add(tick + 1n)
  }
  return [...ticks]
    .filter((tick) => tick >= -887272n && tick <= 887272n)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Collateral requirements and liquidation boundaries evaluated at one block. */
export async function getCollateralCurve({
  client,
  poolAddress,
  account,
  queryAddress,
  tokenIds,
  blockNumber: requestedBlockNumber,
}: {
  client: PublicClient
  poolAddress: Address
  account: Address
  queryAddress: Address
  tokenIds: bigint[]
  blockNumber?: bigint
}): Promise<{
  blockNumber: bigint
  liquidationTicks: bigint[]
  points: {
    tick: bigint
    collateral0: bigint
    required0: bigint
    collateral1: bigint
    required1: bigint
  }[]
}> {
  const blockNumber = requestedBlockNumber ?? (await client.getBlockNumber())
  const boundaries = await client.readContract({
    address: queryAddress,
    abi: panopticQueryAbi,
    functionName: 'getLiquidationPrices',
    args: [poolAddress, account, tokenIds],
    blockNumber,
  })
  const liquidationTicks = boundaries
    .map(BigInt)
    .filter((tick) => tick >= -887272n && tick <= 887272n)
  const ticks = collateralCurveTicks(tokenIds, liquidationTicks)
  const contracts = ticks.map((tick) => ({
    address: queryAddress,
    abi: panopticQueryAbi,
    functionName: 'checkCollateral' as const,
    args: [poolAddress, account, tokenIds, Number(tick)] as const,
  }))
  const chunks: (typeof contracts)[] = []
  for (let i = 0; i < contracts.length; i += 100) chunks.push(contracts.slice(i, i + 100))
  const results = (
    await Promise.all(
      chunks.map((batch) =>
        multicall(client, { contracts: batch, blockNumber, allowFailure: false }),
      ),
    )
  ).flat()
  return {
    blockNumber,
    liquidationTicks,
    points: results.map(([collateral0, required0, collateral1, required1], i) => ({
      tick: ticks[i],
      collateral0,
      required0,
      collateral1,
      required1,
    })),
  }
}
