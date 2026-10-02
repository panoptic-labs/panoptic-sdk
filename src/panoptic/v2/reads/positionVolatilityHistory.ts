import { type Address, type PublicClient, parseEventLogs } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import { preparePositionGamma } from '../greeks/positionVolatility'
import type { PoolVersionConfig } from '../types/poolConfig'
import { interpolateBlocks } from '../utils/interpolateBlocks'
import { decodePositionBalance } from '../writes/utils'
import { getPriceHistory } from './priceHistory'
import { type SettledEvent, getStreamiaHistory } from './streamiaHistory'
import { feeGrowthInsideX128, fetchUniswapFeeData } from './uniswapFeeHistory'
import { feesFromFeeGrowthDelta } from './uniswapLpPosition'

const signedSlot = (value: bigint) => BigInt.asIntN(128, value)
const unpack = (value: bigint) => ({ token0: signedSlot(value), token1: signedSlot(value >> 128n) })

/** RPC accounting for exactly one mint lifecycle; candle prices are supplied by the application. */
export async function getPositionVolatilityHistory({
  client,
  poolAddress,
  account,
  tokenId,
  mintBlock,
  endBlock,
  poolConfig,
  includeBaseFees = false,
}: {
  client: PublicClient
  poolAddress: Address
  account: Address
  tokenId: bigint
  mintBlock: bigint
  endBlock: bigint
  poolConfig: PoolVersionConfig
  includeBaseFees?: boolean
}) {
  if (mintBlock <= 0n || endBlock <= mintBlock)
    throw new RangeError('Insufficient lifecycle history')
  const [mints, burns] = await Promise.all([
    client.getContractEvents({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      eventName: 'OptionMinted',
      args: { recipient: account, tokenId },
      fromBlock: mintBlock,
      toBlock: mintBlock,
      strict: true,
    }),
    client.getContractEvents({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      eventName: 'OptionBurnt',
      args: { recipient: account, tokenId },
      fromBlock: mintBlock,
      toBlock: endBlock,
      strict: true,
    }),
  ])
  const mint = mints[0]
  if (mints.length !== 1 || !mint) throw new Error('Opening event is missing or ambiguous')
  const balance = decodePositionBalance(mint.args.balanceData)
  const close = burns
    .filter((burn) => burn.blockNumber > mintBlock || burn.logIndex > mint.logIndex)
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    )[0]
  const finalBlock = close?.blockNumber ?? endBlock
  if (finalBlock <= mintBlock) throw new Error('Intrablock lifecycle cannot be reconstructed')
  if (close && close.args.positionSize !== balance.positionSize)
    throw new Error('Position size changed')
  const [start, end, boundaryPrices] = await Promise.all([
    getBlockMeta({ client, blockNumber: mintBlock }),
    getBlockMeta({ client, blockNumber: finalBlock }),
    getPriceHistory({ client, poolConfig, blockNumbers: [mintBlock, finalBlock] }),
  ])
  const openingPrice = boundaryPrices.snapshots[0]
  const endingPrice = boundaryPrices.snapshots[1]
  if (!openingPrice || !endingPrice) throw new Error('Boundary prices unavailable')
  const pointCount = Math.min(
    200,
    Math.max(2, Number((end.blockTimestamp - start.blockTimestamp) / 900n) + 2),
  )
  const blockNumbers = [...new Set(interpolateBlocks(mintBlock, finalBlock, pointCount))]
  const metadata: Awaited<ReturnType<typeof getBlockMeta>>[] = []
  for (let i = 0; i < blockNumbers.length; i += 16) {
    metadata.push(
      ...(await Promise.all(
        blockNumbers.slice(i, i + 16).map((blockNumber) => getBlockMeta({ client, blockNumber })),
      )),
    )
  }
  const timestamps = new Map(metadata.map((meta) => [meta.blockNumber, meta.blockTimestamp]))
  const chunks = preparePositionGamma({
    tokenId,
    positionSize: balance.positionSize,
    quoteIsToken0: false,
    quoteDecimals: 0,
  }).chunks.filter((chunk) => chunk.liquidity > 0n)
  let premiumError: string | null = null
  let feeError: string | null = includeBaseFees ? null : 'Base fee history was not requested'
  let premium: { timestamp: bigint; token0: bigint; token1: bigint }[] | null = null
  let fees: { timestamp: bigint; token0: bigint; token1: bigint }[] | null = null

  try {
    const settlementLogs = await client.getContractEvents({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      eventName: 'PremiumSettled',
      args: { user: account, tokenId },
      fromBlock: mintBlock,
      toBlock: finalBlock,
      strict: true,
    })
    const settled: SettledEvent[] = []
    const seen = new Set<string>()
    for (const log of settlementLogs) {
      if (log.blockNumber === mintBlock && log.logIndex <= mint.logIndex) continue
      if (close && log.blockNumber === finalBlock && log.logIndex >= close.logIndex) continue
      const key = `${log.transactionHash}:${log.logIndex}`
      if (seen.has(key)) continue
      seen.add(key)
      const amounts = unpack(log.args.settledAmounts)
      settled.push({
        blockNumber: log.blockNumber,
        settled0: amounts.token0,
        settled1: amounts.token1,
      })
    }
    if (close) {
      const receipt = await client.getTransactionReceipt({ hash: close.transactionHash })
      const liquidations = parseEventLogs({
        abi: panopticPoolV2Abi,
        logs: receipt.logs.filter((log) => log.address.toLowerCase() === poolAddress.toLowerCase()),
        eventName: 'AccountLiquidated',
      })
      if (
        liquidations.some((event) => event.args.liquidatee.toLowerCase() === account.toLowerCase())
      ) {
        throw new Error('Liquidation premium requires haircut reconciliation')
      }
      for (const packed of close.args.premiaByLeg) {
        const amounts = unpack(packed)
        settled.push({
          blockNumber: finalBlock,
          settled0: amounts.token0,
          settled1: amounts.token1,
        })
      }
    }
    const readableBlocks = close ? blockNumbers.filter((block) => block < finalBlock) : blockNumbers
    premium = []
    for (let i = 0; i < readableBlocks.length; i += 16) {
      const history = await getStreamiaHistory({
        client,
        panopticPoolAddress: poolAddress,
        account,
        tokenId,
        blockNumbers: readableBlocks.slice(i, i + 16),
        legs: [],
        poolConfig,
        includeUniswapFees: false,
        settledEvents: settled,
        _meta: end,
      })
      for (const snapshot of history.snapshots) {
        const timestamp =
          snapshot.blockNumber === undefined ? undefined : timestamps.get(snapshot.blockNumber)
        if (timestamp === undefined) throw new Error('Accounting timestamp missing')
        premium.push({ timestamp, ...snapshot.cumulativePanopticPremia })
      }
    }
    if (close) {
      premium.push({
        timestamp: end.blockTimestamp,
        ...settled.reduce(
          (sum, event) => ({
            token0: sum.token0 + event.settled0,
            token1: sum.token1 + event.settled1,
          }),
          { token0: 0n, token1: 0n },
        ),
      })
    }
    const openingAccrual = premium[0]
    if (!openingAccrual || openingAccrual.timestamp !== start.blockTimestamp) {
      throw new Error('Opening premium snapshot missing')
    }
    // Both price exposure and accounting begin at the opening block's end state.
    premium = premium.map((snapshot) => ({
      timestamp: snapshot.timestamp,
      token0: snapshot.token0 - openingAccrual.token0,
      token1: snapshot.token1 - openingAccrual.token1,
    }))
  } catch (error) {
    premium = null
    premiumError = error instanceof Error ? error.message : 'Premium history unavailable'
  }

  if (includeBaseFees) {
    try {
      const feeBlocks = close ? blockNumbers.filter((block) => block < finalBlock) : blockNumbers
      const data = []
      for (let i = 0; i < feeBlocks.length; i += 16) {
        data.push(
          ...(await fetchUniswapFeeData(client, feeBlocks.slice(i, i + 16), chunks, poolConfig)),
        )
      }
      let total0 = 0n
      let total1 = 0n
      fees = []
      for (let i = 0; i < data.length; i++) {
        const current = data[i]
        for (const chunk of chunks) {
          if (
            (current.tickData.get(chunk.lowerTick)?.liquidityGross ?? 0n) === 0n ||
            (current.tickData.get(chunk.upperTick)?.liquidityGross ?? 0n) === 0n
          ) {
            throw new Error('LP range was uninitialized; complete base fee history is unavailable')
          }
          if (i === 0) continue
          const previous = feeGrowthInsideX128(data[i - 1], chunk.lowerTick, chunk.upperTick)
          const next = feeGrowthInsideX128(current, chunk.lowerTick, chunk.upperTick)
          if (!previous || !next) throw new Error('Range fee growth missing')
          if (
            BigInt.asUintN(256, next.feeGrowthInside0X128 - previous.feeGrowthInside0X128) >
              BigInt.asUintN(256, current.feeGrowthGlobal0 - data[i - 1].feeGrowthGlobal0) ||
            BigInt.asUintN(256, next.feeGrowthInside1X128 - previous.feeGrowthInside1X128) >
              BigInt.asUintN(256, current.feeGrowthGlobal1 - data[i - 1].feeGrowthGlobal1)
          ) {
            throw new Error('Range fee growth is inconsistent with pool fee growth')
          }
          const sign = chunk.isLong ? -1n : 1n
          total0 +=
            sign *
            feesFromFeeGrowthDelta(
              next.feeGrowthInside0X128,
              previous.feeGrowthInside0X128,
              chunk.liquidity,
            )
          total1 +=
            sign *
            feesFromFeeGrowthDelta(
              next.feeGrowthInside1X128,
              previous.feeGrowthInside1X128,
              chunk.liquidity,
            )
        }
        fees.push({ timestamp: metadata[i].blockTimestamp, token0: total0, token1: total1 })
      }
    } catch (error) {
      fees = null
      feeError = error instanceof Error ? error.message : 'Base fee history unavailable'
    }
  }
  return {
    start,
    end,
    positionSize: balance.positionSize,
    closed: close !== undefined,
    openingTick: BigInt(openingPrice.tick),
    endingTick: BigInt(endingPrice.tick),
    premium,
    fees,
    premiumError,
    feeError,
    accountingSamples: blockNumbers.length,
    maxAccountingIntervalSeconds: metadata.slice(1).reduce((maximum, meta, index) => {
      const interval = meta.blockTimestamp - metadata[index].blockTimestamp
      return interval > maximum ? interval : maximum
    }, 0n),
  }
}
