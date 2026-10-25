import Decimal from 'decimal.js'
import { decodeAbiParameters } from 'viem'

import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'
import { getPositions } from '../../panoptic/v2/reads/position'
import { requireChainDeployment } from '../chainDeployments'
import { getHypoVaultConfigForVault } from '../hypoVaultManagerConfigs/vaultToConfig'
import { fetchVaultSharePriceSnapshot } from '../sharePrice/snapshot'
import { valueDonationInUnderlying } from './donations'
import { fetchVaultPositionActivity } from './positionActivity'

const Precision = Decimal.clone({ precision: 60 })

/** Gross long-option reference notional, excluding width-zero hedge legs, in the NAV asset frame. */
export function calculateLongOptionNotionalPct({
  navRaw,
  underlyingToken,
  pools,
}: {
  navRaw: bigint
  underlyingToken: string
  pools: readonly {
    token0: string
    token1: string
    token0Price: number
    token1Price: number
    positions: readonly {
      positionSize: bigint
      legs: readonly { width: bigint; isLong: boolean; asset: bigint; optionRatio: bigint }[]
    }[]
  }[]
}) {
  if (navRaw <= 0n) return '0'
  let notional = 0n
  for (const pool of pools) {
    const underlyingIndex =
      pool.token0.toLowerCase() === underlyingToken.toLowerCase()
        ? 0
        : pool.token1.toLowerCase() === underlyingToken.toLowerCase()
          ? 1
          : null
    if (underlyingIndex === null) throw new Error('Unsupported exposure denomination')
    for (const position of pool.positions) {
      for (const leg of position.legs) {
        if (!leg.isLong || leg.width === 0n) continue
        if (leg.asset !== 0n && leg.asset !== 1n) throw new Error('Invalid option asset')
        const tokenIndex = leg.asset === 0n ? 0 : 1
        notional += valueDonationInUnderlying({
          assetsRaw: position.positionSize * leg.optionRatio,
          tokenIndex,
          underlyingIndex,
          tick: tokenIndex === 0 ? pool.token0Price : pool.token1Price,
        })
      }
    }
  }
  return new Precision(notional.toString()).mul(100).div(navRaw.toString()).toString()
}

/** Revalues exposure after each position change; persisted checkpoints keep historical RPC off the read path. */
export async function fetchVaultPositionExposureHistory(
  params: Parameters<typeof fetchVaultPositionActivity>[0],
) {
  const { client, chainId, vaultAddress } = params
  const activity = await fetchVaultPositionActivity(params)
  const config = getHypoVaultConfigForVault(vaultAddress, chainId)
  const underlyingToken = config?.addresses?.underlyingToken
  if (underlyingToken === undefined) throw new Error('Missing exposure configuration')
  const vault = {
    id: vaultAddress,
    accountant: requireChainDeployment(chainId).hypovault.core.accountant,
    createdAt: '0',
    underlyingToken: { id: underlyingToken },
  }
  const changes: {
    timestampSec: number
    hasOpenPositions: boolean
    longOptionNotionalPct: string
  }[] = []
  const snapshots = [
    ...new Map(activity.positionSnapshots.map((point) => [point.blockNumber, point])).values(),
  ]
  for (let offset = 0; offset < snapshots.length; offset += 8) {
    const batch = await Promise.all(
      snapshots.slice(offset, offset + 8).map(async (point) => {
        const positionsByPool = point.positionsByPool.map((pool) => ({
          ...pool,
          tokenIds: pool.tokenIds.map(BigInt),
        }))
        const hasOpenPositions = positionsByPool.some((pool) => pool.tokenIds.length > 0)
        if (!hasOpenPositions)
          return { timestampSec: point.timestampSec, hasOpenPositions, longOptionNotionalPct: '0' }
        const snapshot = await fetchVaultSharePriceSnapshot({
          client,
          chainId,
          vault,
          blockNumber: point.blockNumber,
          windowLabel: 'series',
          positionsByPool,
          readContractFn: (_client, read) => client.readContract(read),
        })
        const [prices, pools, tokenIds] = decodeAbiParameters(
          PanopticVaultAccountantManagerInputAbi,
          snapshot.managerInputBytes,
        )
        const frames = await Promise.all(
          pools.map(async (pool, index) => {
            const price = prices[index]
            if (price === undefined) throw new Error('Missing exposure price')
            const positions = await getPositions({
              client,
              poolAddress: pool.pool,
              owner: vaultAddress,
              tokenIds: [...(tokenIds[index] ?? [])],
              blockNumber: point.blockNumber,
            })
            return { ...pool, ...price, positions: positions.positions }
          }),
        )
        return {
          timestampSec: point.timestampSec,
          hasOpenPositions,
          longOptionNotionalPct: calculateLongOptionNotionalPct({
            navRaw:
              snapshot.nav + 1n - snapshot.assetsDeposited - snapshot.reservedWithdrawalAssets,
            underlyingToken,
            pools: frames,
          }),
        }
      }),
    )
    changes.push(...batch)
  }
  return {
    fromTimestampSec: activity.fromTimestampSec,
    throughTimestampSec: activity.throughTimestampSec,
    changes,
    positionsByPool: activity.positionsByPool,
  }
}
