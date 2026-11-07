import type { Address, PublicClient } from 'viem'
import { getBlock, getFeeHistory, readContract } from 'viem/actions'

import { uniswapV3PoolAbi } from '../panoptic/v2/abis/uniswapV3Pool'
import { getPoolMetadata } from '../panoptic/v2/reads/pool'
import type { VaultDeltaHedgeFeeQuote, VaultTransactionFeePolicy } from './transactionFees'

const SHOCK_LOOKBACK_SECONDS = 600n
const SHOCK_LATCH_SECONDS = 1_200n
export const VOLUSDC_INCIDENT_GAS_ENVELOPE = 1_250_000_000_000_000_000n
export const VOLUSDC_HEDGE_FEE_POLICY: VaultTransactionFeePolicy = Object.freeze({
  maxTransactionGasCost: (VOLUSDC_INCIDENT_GAS_ENVELOPE * 8n) / 9n,
  marketPriorityFees: true,
})

export function resolveHedgeShock({
  sqrtPriceX96,
  previousSqrtPriceX96,
  timestamp,
  activeUntil = 0n,
  priceAssetIndex,
}: {
  sqrtPriceX96: bigint
  previousSqrtPriceX96: bigint
  timestamp: bigint
  activeUntil?: bigint
  priceAssetIndex: 0n | 1n
}) {
  if (sqrtPriceX96 <= 0n || previousSqrtPriceX96 <= 0n) {
    throw new Error('Shock detection requires positive pool prices')
  }
  const previous = previousSqrtPriceX96 ** 2n
  const current = sqrtPriceX96 ** 2n
  const difference = current > previous ? current - previous : previous - current
  const denominator = priceAssetIndex === 0n ? previous : current
  const shocked = difference * 10_000n >= denominator * 200n
  const nextActiveUntil = shocked ? timestamp + SHOCK_LATCH_SECONDS : activeUntil
  return { shocked, activeUntil: nextActiveUntil, active: timestamp < nextActiveUntil }
}

export async function getHedgeShock({
  client,
  poolAddress,
  activeUntil,
  priceAssetIndex,
}: {
  client: PublicClient
  poolAddress: Address
  activeUntil?: bigint
  priceAssetIndex: 0n | 1n
}) {
  const blockTimeMs = client.chain?.blockTime
  if (blockTimeMs === undefined || !Number.isSafeInteger(blockTimeMs) || blockTimeMs <= 0)
    throw new Error('Shock detection requires a valid network block time')
  const averageBlockTimeMs = BigInt(blockTimeMs)
  const lookbackBlocks =
    (SHOCK_LOOKBACK_SECONDS * 1_000n + averageBlockTimeMs - 1n) / averageBlockTimeMs
  const block = await getBlock(client, { blockTag: 'latest' })
  const metadata = await getPoolMetadata({ client, poolAddress })
  if (metadata.isV4) throw new Error('Adaptive hedge fees require a Uniswap v3 market')
  const previousBlock = block.number > lookbackBlocks ? block.number - lookbackBlocks : 0n
  const address = metadata.underlyingPoolId as Address
  const [current, previous] = await Promise.all([
    readContract(client, {
      address,
      abi: uniswapV3PoolAbi,
      functionName: 'slot0',
      blockNumber: block.number,
    }),
    readContract(client, {
      address,
      abi: uniswapV3PoolAbi,
      functionName: 'slot0',
      blockNumber: previousBlock,
    }),
  ])
  return {
    ...resolveHedgeShock({
      sqrtPriceX96: current[0],
      previousSqrtPriceX96: previous[0],
      timestamp: block.timestamp,
      activeUntil,
      priceAssetIndex,
    }),
    blockNumber: block.number,
    blockHash: block.hash,
    timestamp: block.timestamp,
  }
}

export function resolveAdaptiveHedgeFeeQuote({
  baseFeePerGas,
  rewards,
  urgent,
}: {
  baseFeePerGas: bigint
  rewards: readonly bigint[]
  urgent: boolean
}): VaultDeltaHedgeFeeQuote {
  if (rewards.length === 0 || rewards.some((reward) => reward < 0n) || baseFeePerGas < 0n) {
    throw new Error('Incomplete adaptive hedge fee history')
  }
  const sorted = [...rewards].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const upper = sorted[Math.floor(sorted.length / 2)]
  if (upper === undefined) throw new Error('Missing adaptive hedge fee median')
  const lower = sorted[Math.max(0, Math.floor((sorted.length - 1) / 2))] ?? upper
  const rawPriorityFeePerGas = (lower + upper) / 2n
  const floor = urgent ? 3_000_000_000n : 100_000_000n
  const maxPriorityFeePerGas = rawPriorityFeePerGas > floor ? rawPriorityFeePerGas : floor
  const maxFeePerGas = baseFeePerGas * 2n + maxPriorityFeePerGas
  return {
    currentBaseFeePerGas: baseFeePerGas,
    rawPriorityFeePerGas,
    maxPriorityFeePerGas,
    maxFeePerGas,
    minimumMaxFeePerGas: baseFeePerGas + maxPriorityFeePerGas,
    minimumPriorityFeePerGas: maxPriorityFeePerGas,
    source: 'adaptive_hedge',
  }
}

export async function getAdaptiveHedgeFeeQuote(client: PublicClient, urgent: boolean) {
  const history = await getFeeHistory(client, {
    blockCount: 5,
    blockTag: 'latest',
    rewardPercentiles: urgent ? [75, 90] : [75],
  })
  const baseFeePerGas = history.baseFeePerGas.at(-2)
  const rewards = history.reward?.flatMap((row) => {
    const value = row[urgent ? 1 : 0]
    return value === undefined ? [] : [value]
  })
  if (
    baseFeePerGas === undefined ||
    history.baseFeePerGas.length !== 6 ||
    history.reward?.length !== 5 ||
    rewards === undefined ||
    rewards.length !== 5
  ) {
    throw new Error('Incomplete adaptive hedge fee history')
  }
  const quote = resolveAdaptiveHedgeFeeQuote({ baseFeePerGas, rewards, urgent })
  if (!urgent) return quote
  const competitiveRewards = history.reward?.flatMap((row) =>
    row[0] === undefined ? [] : [row[0]],
  )
  if (competitiveRewards === undefined || competitiveRewards.length !== 5)
    throw new Error('Incomplete competitive hedge fee history')
  const competitive = resolveAdaptiveHedgeFeeQuote({
    baseFeePerGas,
    rewards: competitiveRewards,
    urgent: true,
  })
  if (competitive.maxPriorityFeePerGas > quote.maxPriorityFeePerGas)
    throw new Error('Inconsistent competitive hedge fee history')
  return { ...quote, competitivePriorityFeePerGas: competitive.maxPriorityFeePerGas }
}
