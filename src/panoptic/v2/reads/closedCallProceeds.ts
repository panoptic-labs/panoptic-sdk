import {
  type Address,
  type Hash,
  type PublicClient,
  erc20Abi,
  parseEventLogs,
  zeroAddress,
} from 'viem'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { isEarnCoveredCallTokenId } from '../tokenId/coveredCall'
import {
  allocateCoveredCallCollateral,
  getEarnCollateralFunding,
} from '../tokenId/coveredCallPortfolio'
import { decodeTokenId } from '../tokenId/decode'
import { getAccountCollateral, getAccountSummaryBasic } from './account'
import { readRange } from './coveredCallPayments'
import { convertToAssets, convertToShares } from './erc4626'
import { type AccountTrade, getAccountHistory } from './history'
import { getPoolMetadata } from './pool'

type Location = { transactionHash: Hash; blockNumber: bigint; logIndex: bigint }
export type ClosedCallProceeds = Location & {
  tokenIds: bigint[]
  timestamp: bigint
  shares0: bigint
  shares1: bigint
  remainingShares0: bigint
  remainingShares1: bigint
  remainingAssets0: bigint
  remainingAssets1: bigint
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const compare = (a: Location, b: Location) =>
  a.blockNumber === b.blockNumber
    ? a.logIndex < b.logIndex
      ? -1
      : a.logIndex > b.logIndex
        ? 1
        : 0
    : a.blockNumber < b.blockNumber
      ? -1
      : 1
const positive = (value: bigint) => (value > 0n ? value : 0n)

/** Consume earlier closed-call shares first; deposits never create a proceeds claim. */
export function spendClosedCallProceeds(
  lots: ClosedCallProceeds[],
  tokenIndex: 0 | 1,
  shares: bigint,
) {
  if (shares < 0n) throw new RangeError('Shares must not be negative')
  const key = tokenIndex === 0 ? 'remainingShares0' : 'remainingShares1'
  for (const lot of lots) {
    const used = shares < lot[key] ? shares : lot[key]
    lot[key] -= used
    shares -= used
    if (shares === 0n) return
  }
}

/**
 * Reconstruct Earn-only proceeds in collateral shares from confirmed closes and owner share flows.
 * Historical reads must agree with receipt transfers; ambiguous same-block activity is excluded.
 */
export async function getClosedCallProceeds({
  client,
  chainId,
  poolAddress,
  account,
  fromBlock = 0n,
  toBlock,
  confirmedTransactions = [],
}: {
  client: PublicClient
  chainId: bigint
  poolAddress: Address
  account: Address
  fromBlock?: bigint
  toBlock?: bigint
  confirmedTransactions?: readonly Hash[]
}) {
  const receipts = await Promise.all(
    [...new Set(confirmedTransactions)].map((hash) => client.getTransactionReceipt({ hash })),
  )
  if (receipts.some((receipt) => receipt.status !== 'success'))
    throw new Error('Withdrawal receipt not confirmed')
  const latest = toBlock ?? (await client.getBlockNumber({ cacheTime: 0 }))
  const confirmedBlock = receipts.reduce(
    (block, receipt) => (receipt.blockNumber > block ? receipt.blockNumber : block),
    0n,
  )
  if (toBlock !== undefined && toBlock < confirmedBlock)
    throw new Error('Proceeds snapshot predates confirmed withdrawal')
  const end = latest > confirmedBlock ? latest : confirmedBlock
  const metadata = await getPoolMetadata({ client, poolAddress })
  const trackers = [metadata.collateralToken0Address, metadata.collateralToken1Address] as const
  const readTransfers = async (tokenIndex: 0 | 1) => {
    const read = (args: { from: Address } | { to: Address }) =>
      readRange(
        (from, to) =>
          client.getContractEvents({
            address: trackers[tokenIndex],
            abi: erc20Abi,
            eventName: 'Transfer',
            args,
            fromBlock: from,
            toBlock: to,
            strict: true,
          }),
        fromBlock,
        end,
      )
    const confirmedLogs = receipts.flatMap((receipt) =>
      parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs })
        .filter(
          (log) =>
            same(log.address, trackers[tokenIndex]) &&
            (same(log.args.from, account) || same(log.args.to, account)),
        )
        .map((log) => ({
          ...log,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
        })),
    )
    const logs = [
      ...(await Promise.all([read({ from: account }), read({ to: account })])).flat(),
      ...confirmedLogs,
    ]
    const seen = new Set<string>()
    return logs
      .filter((log) => {
        const key = `${log.transactionHash}:${log.logIndex}`
        if (log.removed || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((log) => ({
        tokenIndex,
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: BigInt(log.logIndex),
        incoming: same(log.args.to, account) && !same(log.args.from, account) ? log.args.value : 0n,
        outgoing: same(log.args.from, account) && !same(log.args.to, account) ? log.args.value : 0n,
      }))
  }
  const [trades, transfers0, transfers1] = await Promise.all([
    readRange(
      async (from, to) =>
        (await getAccountHistory({ client, poolAddress, account, fromBlock: from, toBlock: to }))
          .trades,
      fromBlock,
      end,
    ),
    readTransfers(0),
    readTransfers(1),
  ])
  const groups = new Map<
    Hash,
    { location: Location; trades: AccountTrade[]; transfers: typeof transfers0 }
  >()
  const seenEvents = new Set<string>()
  for (const event of [...trades, ...transfers0, ...transfers1].sort(compare)) {
    const key = `${event.transactionHash.toLowerCase()}:${event.logIndex}`
    if (seenEvents.has(key)) continue
    seenEvents.add(key)
    let group = groups.get(event.transactionHash)
    if (!group) {
      group = { location: event, trades: [], transfers: [] }
      groups.set(event.transactionHash, group)
    }
    if ('action' in event) group.trades.push(event)
    else group.transfers.push(event)
  }
  const lots: ClosedCallProceeds[] = []
  const unverified: Location[] = []
  const sizes = new Map<bigint, bigint>()
  let previousBlock = -1n
  let blockStartIds: bigint[] = []
  const convert = async (
    tokenIndex: 0 | 1,
    amount: bigint,
    blockNumber: bigint,
    direction: 'assets' | 'shares',
  ) => {
    if (amount <= 0n) return 0n
    const fn = direction === 'assets' ? convertToAssets : convertToShares
    return (
      await fn({
        client,
        poolAddress,
        tokenIndex,
        collateralTrackerAddress: trackers[tokenIndex],
        amount,
        blockNumber,
      })
    ).result
  }
  for (const group of groups.values()) {
    const location = group.location
    if (location.blockNumber !== previousBlock) {
      blockStartIds = [...sizes].filter(([, size]) => size > 0n).map(([id]) => id)
      previousBlock = location.blockNumber
    }
    const finite = group.trades.filter((trade) =>
      decodeTokenId(trade.tokenId).legs.some((leg) => leg.width > 0n),
    )
    const closed = finite.filter(
      (trade) => trade.action === 'burn' && isEarnCoveredCallTokenId(trade.tokenId),
    )
    let attributed = false
    if (closed.length > 0 && finite.length === closed.length) {
      try {
        if (location.blockNumber === 0n) throw new Error('Missing parent block')
        const before = await getAccountSummaryBasic({
          client,
          chainId,
          poolAddress,
          account,
          poolMetadata: metadata,
          tokenIds: blockStartIds,
          blockNumber: location.blockNumber - 1n,
        })
        getEarnCollateralFunding({
          positions: before.positions,
          collateral0: before.collateral.token0.assets,
          collateral1: before.collateral.token1.assets,
          expectedLegCount: before.collateral.legCount,
          assetIdx: 0n,
          walletBalance: 0n,
          requestedAmount: 0n,
        })
        for (const trade of closed) {
          const position = before.positions.find((position) => position.tokenId === trade.tokenId)
          if (!position || position.positionSize !== trade.positionSize)
            throw new Error('Close is partial or not present in parent block')
        }
        const receipt = await client.getTransactionReceipt({ hash: location.transactionHash })
        if (receipt.status !== 'success' || receipt.blockNumber !== location.blockNumber)
          throw new Error('Close receipt not confirmed')
        const burns = parseEventLogs({
          abi: panopticPoolV2Abi,
          eventName: 'OptionBurnt',
          logs: receipt.logs,
        }).filter((log) => same(log.address, poolAddress) && same(log.args.recipient, account))
        if (
          !closed.every((trade) =>
            burns.some(
              (log) =>
                log.args.tokenId === trade.tokenId && log.args.positionSize === trade.positionSize,
            ),
          )
        )
          throw new Error('Close event mismatch')
        const shareTransfers = parseEventLogs({
          abi: erc20Abi,
          eventName: 'Transfer',
          logs: receipt.logs,
        })
        const deposits = parseEventLogs({
          abi: collateralTrackerV2Abi,
          eventName: 'Deposit',
          logs: receipt.logs,
        })
        const deltas = trackers.map((tracker) =>
          shareTransfers
            .filter((log) => same(log.address, tracker))
            .reduce(
              (sum, log) =>
                sum +
                (same(log.args.to, account) ? log.args.value : 0n) -
                (same(log.args.from, account) ? log.args.value : 0n),
              0n,
            ),
        )
        const depositsInClose = trackers.map((tracker) =>
          deposits
            .filter((log) => same(log.address, tracker) && same(log.args.owner, account))
            .reduce((sum, log) => sum + log.args.shares, 0n),
        )
        const externalIncoming = trackers.map((tracker) =>
          shareTransfers
            .filter(
              (log) =>
                same(log.address, tracker) &&
                same(log.args.to, account) &&
                !same(log.args.from, zeroAddress) &&
                !same(log.args.from, account),
            )
            .reduce((sum, log) => sum + log.args.value, 0n),
        )
        const after = await getAccountCollateral({
          client,
          poolAddress,
          account,
          blockNumber: location.blockNumber,
          collateralAddresses: { collateralToken0: trackers[0], collateralToken1: trackers[1] },
        })
        if (
          before.collateral.token0.shares + deltas[0] !== after.token0.shares ||
          before.collateral.token1.shares + deltas[1] !== after.token1.shares
        )
          throw new Error('Same-block collateral activity could not be isolated')
        const allocated = allocateCoveredCallCollateral({
          positions: before.positions,
          collateral0: before.collateral.token0.assets,
          collateral1: before.collateral.token1.assets,
        }).filter((call) => closed.some((trade) => trade.tokenId === call.tokenId))
        const assigned = [0, 1].map((index) =>
          allocated
            .filter((call) => call.assetIdx === BigInt(index))
            .reduce((sum, call) => sum + call.allocatedAsset, 0n),
        )
        const baseline = await Promise.all([
          convert(0, assigned[0], location.blockNumber - 1n, 'shares'),
          convert(1, assigned[1], location.blockNumber - 1n, 'shares'),
        ])
        const shares0 = baseline[0] + deltas[0] - depositsInClose[0] - externalIncoming[0]
        const shares1 = baseline[1] + deltas[1] - depositsInClose[1] - externalIncoming[1]
        spendClosedCallProceeds(lots, 0, positive(-shares0))
        spendClosedCallProceeds(lots, 1, positive(-shares1))
        lots.push({
          ...location,
          tokenIds: closed.map((trade) => trade.tokenId),
          timestamp: (await getBlockMeta({ client, blockNumber: location.blockNumber }))
            .blockTimestamp,
          shares0: positive(shares0),
          shares1: positive(shares1),
          remainingShares0: positive(shares0),
          remainingShares1: positive(shares1),
          remainingAssets0: 0n,
          remainingAssets1: 0n,
        })
        attributed = true
      } catch {
        unverified.push(location)
      }
    } else if (closed.length > 0) unverified.push(location)
    if (!attributed) {
      for (const transfer of group.transfers)
        spendClosedCallProceeds(lots, transfer.tokenIndex, transfer.outgoing)
      for (const trade of finite.filter((trade) => trade.action === 'mint')) {
        const legs = decodeTokenId(trade.tokenId).legs.filter(
          (leg) => leg.width > 0n && !leg.isLong,
        )
        for (const index of [0, 1] as const) {
          if (!lots.some((lot) => (index === 0 ? lot.remainingShares0 : lot.remainingShares1) > 0n))
            continue
          const notional = legs
            .filter((leg) => leg.asset === BigInt(index))
            .reduce((sum, leg) => sum + trade.positionSize * leg.optionRatio, 0n)
          spendClosedCallProceeds(
            lots,
            index,
            await convert(index, notional, location.blockNumber, 'shares'),
          )
        }
      }
    }
    for (const trade of group.trades)
      sizes.set(
        trade.tokenId,
        positive(
          (sizes.get(trade.tokenId) ?? 0n) +
            (trade.action === 'mint' ? trade.positionSize : -trade.positionSize),
        ),
      )
  }
  const summary = await getAccountSummaryBasic({
    client,
    chainId,
    poolAddress,
    account,
    poolMetadata: metadata,
    tokenIds: [...sizes].filter(([, size]) => size > 0n).map(([id]) => id),
    blockNumber: end,
  })
  if (
    lots.reduce((sum, lot) => sum + lot.remainingShares0, 0n) > summary.collateral.token0.shares ||
    lots.reduce((sum, lot) => sum + lot.remainingShares1, 0n) > summary.collateral.token1.shares
  )
    throw new Error('Tracked proceeds exceed the current share balance')
  for (const lot of lots)
    [lot.remainingAssets0, lot.remainingAssets1] = await Promise.all([
      convert(0, lot.remainingShares0, end, 'assets'),
      convert(1, lot.remainingShares1, end, 'assets'),
    ])
  const available = ([0n, 1n] as const).map((assetIdx) => {
    const free = getEarnCollateralFunding({
      positions: summary.positions,
      collateral0: summary.collateral.token0.assets,
      collateral1: summary.collateral.token1.assets,
      expectedLegCount: summary.collateral.legCount,
      assetIdx,
      walletBalance: 0n,
      requestedAmount: 0n,
    }).uncovered
    const tracked = lots.reduce(
      (sum, lot) => sum + (assetIdx === 0n ? lot.remainingAssets0 : lot.remainingAssets1),
      0n,
    )
    return tracked < free ? tracked : free
  })
  return {
    proceeds: lots,
    unverified,
    availableAssets0: available[0],
    availableAssets1: available[1],
    summary,
    _meta: summary._meta,
  }
}
