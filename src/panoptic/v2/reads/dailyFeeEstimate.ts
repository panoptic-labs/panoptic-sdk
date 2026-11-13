import type { PublicClient } from 'viem'

import { resolveBlockNumbers } from '../clients'
import { getCoveredCallAdvance } from '../tokenId/coveredCall'
import type { PoolVersionConfig } from '../types/poolConfig'
import type { StreamiaLeg } from '../types/streamia'
import { fetchUniswapFeeData } from './uniswapFeeHistory'

/** Current in-range LP fee rate per leg, using trailing global fee growth in native quote units. */
export async function getDailyFeeEstimate({
  client,
  poolConfig,
  legs,
  quoteIsToken0,
}: {
  client: PublicClient
  poolConfig: PoolVersionConfig
  legs: readonly StreamiaLeg[]
  quoteIsToken0: boolean
}) {
  const latest = await client.getBlock()
  const [startBlock] = await resolveBlockNumbers({
    client,
    timestamps: [Number(latest.timestamp) - 86400],
  })
  // Hypothetical strike ticks may not be initialized; only global fee growth is required.
  const [start, snapshots] = await Promise.all([
    client.getBlock({ blockNumber: startBlock }),
    fetchUniswapFeeData(client, [startBlock, latest.number], [], poolConfig),
  ])
  const before = snapshots[0]
  const after = snapshots[1]
  const elapsed = latest.timestamp - start.timestamp
  if (!before || !after || elapsed <= 0n) throw new Error('Insufficient on-chain fee history')
  const growth0 = BigInt.asUintN(256, after.feeGrowthGlobal0 - before.feeGrowthGlobal0)
  const growth1 = BigInt.asUintN(256, after.feeGrowthGlobal1 - before.feeGrowthGlobal1)
  const perLeg = legs.map((leg) => {
    if (
      leg.liquidity <= 0n ||
      after.currentTick < leg.lowerTick ||
      after.currentTick >= leg.upperTick
    )
      return 0n
    const token0 = (growth0 * leg.liquidity) / (1n << 128n)
    const token1 = (growth1 * leg.liquidity) / (1n << 128n)
    const quote = quoteIsToken0
      ? token0 + getCoveredCallAdvance(token1, BigInt(after.currentTick), 1n)
      : token1 + getCoveredCallAdvance(token0, BigInt(after.currentTick), 0n)
    return ((quote * 86400n) / elapsed) * (leg.isLong ? -1n : 1n)
  })
  return { perLeg, fromBlock: startBlock, toBlock: latest.number, timestamp: latest.timestamp }
}
