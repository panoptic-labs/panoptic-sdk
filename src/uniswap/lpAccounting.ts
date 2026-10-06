import Decimal from 'decimal.js'
import type { Address, PublicClient } from 'viem'
import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, parseAbi } from 'viem'

import { getBlockMeta } from '../panoptic/v2/clients/blockMeta'
import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import { getPriceHistory } from '../panoptic/v2/reads/priceHistory'
import { getUniswapV3LpPositionState } from '../panoptic/v2/reads/uniswapLpPosition'
import { getAmountsForLiquidity } from './lpGreeks'
import type { getLpPositionHistory, LpPositionHistoryEvent } from './lpHistory'

const Precision = Decimal.clone({ precision: 80 })
const Q192 = (1n << 192n).toString()

function reconcileV3LpFees(
  events: readonly LpPositionHistoryEvent[],
  claimable: { amount0: bigint; amount1: bigint },
  endBlock: bigint,
) {
  let collected0 = 0n
  let collected1 = 0n
  let removed0 = 0n
  let removed1 = 0n
  for (const event of events) {
    if (event.amountSource !== 'ExactEvent' || event.blockNumber > endBlock)
      throw new Error('Complete exact v3 history is required')
    if (event.eventType === 'Collect') {
      collected0 += event.amount0
      collected1 += event.amount1
    } else if (event.eventType === 'Burn') {
      removed0 += event.amount0
      removed1 += event.amount1
    }
  }
  const fees0 = collected0 + claimable.amount0 - removed0
  const fees1 = collected1 + claimable.amount1 - removed1
  if (fees0 < 0n || fees1 < 0n) throw new Error('LP fee accounting does not reconcile')
  return { fees0, fees1 }
}

/** V3 NFT cash-flow returns, including withdrawn principal still awaiting collection. */
export function calculateV3LpAccounting({
  events,
  inventory,
  claimable,
  prices,
  endBlock,
  token0Decimals,
  token1Decimals,
}: {
  events: readonly LpPositionHistoryEvent[]
  inventory: { amount0: bigint; amount1: bigint }
  claimable: { amount0: bigint; amount1: bigint }
  prices: readonly { blockNumber: bigint; sqrtPriceX96: bigint }[]
  endBlock: bigint
  token0Decimals: number
  token1Decimals: number
}) {
  for (const decimals of [token0Decimals, token1Decimals]) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
      throw new RangeError('Invalid token decimals')
  }
  const priceByBlock = new Map(
    prices.map((point) => {
      if (point.sqrtPriceX96 <= 0n) throw new RangeError('Invalid historical price')
      return [
        point.blockNumber,
        new Precision(point.sqrtPriceX96.toString()).pow(2).div(Q192),
      ] as const
    }),
  )
  const priceAt = (block: bigint) => {
    const price = priceByBlock.get(block)
    if (!price) throw new Error('Historical price unavailable')
    return price
  }
  const { fees0, fees1 } = reconcileV3LpFees(events, claimable, endBlock)
  const frame = (quoteIsToken0: boolean, decimals: number) => {
    const scale = new Precision(10).pow(decimals)
    const value = (amount0: bigint, amount1: bigint, block: bigint) => {
      const price = priceAt(block)
      return (
        quoteIsToken0
          ? new Precision(amount0.toString()).plus(new Precision(amount1.toString()).div(price))
          : new Precision(amount1.toString()).plus(new Precision(amount0.toString()).mul(price))
      ).div(scale)
    }
    let deposited = new Precision(0)
    let collected = new Precision(0)
    for (const event of events) {
      if (event.eventType === 'Mint')
        deposited = deposited.plus(value(event.amount0, event.amount1, event.blockNumber))
      if (event.eventType === 'Collect')
        collected = collected.plus(value(event.amount0, event.amount1, event.blockNumber))
    }
    const endingValue = value(
      inventory.amount0 + claimable.amount0,
      inventory.amount1 + claimable.amount1,
      endBlock,
    )
    const pnl = endingValue.plus(collected).minus(deposited)
    return {
      pnl: pnl.toString(),
      deposited: deposited.toString(),
      pnlPercent: deposited.gt(0) ? pnl.div(deposited).mul(100).toString() : null,
    }
  }
  return {
    fees0,
    fees1,
    claimable,
    quote0: frame(true, token0Decimals),
    quote1: frame(false, token1Decimals),
  }
}

/** Reconcile v3 activity and historical prices at the subgraph's indexed block. */
export async function getV3LpHistoryAccounting({
  client,
  history,
  nfpmAddress,
  poolAddress,
  tickLower,
  tickUpper,
  token0Decimals,
  token1Decimals,
}: {
  client: PublicClient
  history: Awaited<ReturnType<typeof getLpPositionHistory>>
  nfpmAddress: Address
  poolAddress: Address
  tickLower: bigint
  tickUpper: bigint
  token0Decimals: number
  token1Decimals: number
}) {
  if (history.version !== 3) throw new Error('V4 fee collections are unavailable')
  const tokenId = BigInt(history.positionId.slice(3))
  const _meta = await getBlockMeta({ client, blockNumber: history.blockNumber })
  if (_meta.blockHash.toLowerCase() !== history.blockHash.toLowerCase())
    throw new Error('LP history checkpoint changed')
  let liquidity = 0n
  for (const event of history.events) {
    if (event.eventType !== 'Collect')
      liquidity += event.eventType === 'Mint' ? event.liquidity : -event.liquidity
  }
  let claimable = { amount0: 0n, amount1: 0n }
  let owner: Address | undefined
  try {
    owner = await client.readContract({
      address: nfpmAddress,
      abi: parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']),
      functionName: 'ownerOf',
      args: [tokenId],
      blockNumber: history.blockNumber,
    })
  } catch (error) {
    const reverted =
      error instanceof BaseError &&
      error.walk(
        (cause) =>
          cause instanceof ContractFunctionRevertedError || cause instanceof ExecutionRevertedError,
      )
    if (
      liquidity !== 0n ||
      !(
        reverted instanceof ContractFunctionRevertedError ||
        reverted instanceof ExecutionRevertedError
      )
    )
      throw error
  }
  if (owner) {
    const state = await getUniswapV3LpPositionState({
      client,
      nfpmAddress,
      tokenId,
      owner,
      blockNumber: history.blockNumber,
    })
    if (state.liquidity !== liquidity) throw new Error('LP liquidity history does not reconcile')
    claimable = { amount0: state.fees0, amount1: state.fees1 }
  }
  const blocks = [
    ...new Set([
      history.blockNumber,
      ...history.events
        .filter((event) => event.eventType !== 'Burn')
        .map((event) => event.blockNumber),
    ]),
  ]
  const feeTotals = reconcileV3LpFees(history.events, claimable, history.blockNumber)
  const prices: { blockNumber: bigint; sqrtPriceX96: bigint }[] = []
  for (let index = 0; index < blocks.length; index += 16) {
    const batch = blocks.slice(index, index + 16)
    const result = await getPriceHistory({
      client,
      blockNumbers: batch,
      poolConfig: { version: 'v3', poolAddress },
      _meta,
    }).catch(() => null)
    if (!result) {
      return {
        ...feeTotals,
        claimable,
        quote0: null,
        quote1: null,
        blockNumber: history.blockNumber,
        timestamp: _meta.blockTimestamp,
      }
    }
    result.snapshots.forEach((point, offset) =>
      prices.push({ blockNumber: batch[offset], sqrtPriceX96: point.sqrtPriceX96 }),
    )
  }
  const endingPrice = prices.find((price) => price.blockNumber === history.blockNumber)
  if (!endingPrice) throw new Error('Ending price unavailable')
  const inventory = getAmountsForLiquidity(
    endingPrice.sqrtPriceX96,
    tickToSqrtPriceX96(tickLower),
    tickToSqrtPriceX96(tickUpper),
    liquidity,
  )
  return {
    ...calculateV3LpAccounting({
      events: history.events,
      inventory,
      claimable,
      prices,
      endBlock: history.blockNumber,
      token0Decimals,
      token1Decimals,
    }),
    blockNumber: history.blockNumber,
    timestamp: _meta.blockTimestamp,
  }
}
