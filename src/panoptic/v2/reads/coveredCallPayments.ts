import type { Address, Hash, PublicClient } from 'viem'

import { collateralTrackerV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { getCoveredCallAdvance, isEarnCoveredCallTokenId } from '../tokenId/coveredCall'
import { decodeTokenId } from '../tokenId/decode'
import { type AccountTrade, getAccountHistory } from './history'
import { getPoolMetadata } from './pool'

type EventLocation = {
  blockNumber: bigint
  logIndex: bigint
  transactionHash: Hash
  timestamp?: bigint
}
export type CoveredCallWithdrawal = EventLocation & {
  tokenIndex: 0n | 1n
  assets: bigint
}
export type CoveredCallPayment = EventLocation & {
  tokenId: bigint
  positionSize: bigint
  remainingPositionSize: bigint
  principal: bigint
  assetIdx: 0n | 1n
  resized: boolean
  withdrawal?: CoveredCallWithdrawal
}

const compareEvents = (a: EventLocation, b: EventLocation) =>
  a.blockNumber === b.blockNumber
    ? a.logIndex < b.logIndex
      ? -1
      : a.logIndex > b.logIndex
        ? 1
        : 0
    : a.blockNumber < b.blockNumber
      ? -1
      : 1
const eventKey = (event: EventLocation) =>
  `${event.transactionHash.toLowerCase()}:${event.logIndex}`

/** Attribute exact wallet withdrawals to earlier Earn openings, oldest first within each token and amount. */
export function matchCoveredCallPayments({
  trades,
  withdrawals,
}: {
  trades: readonly AccountTrade[]
  withdrawals: readonly CoveredCallWithdrawal[]
}) {
  const payments: CoveredCallPayment[] = []
  const seen = new Set<string>()
  const events = [
    ...trades.map((trade) => ({ ...trade, type: 'trade' as const })),
    ...withdrawals.map((withdrawal) => ({ ...withdrawal, type: 'withdrawal' as const })),
  ].sort(compareEvents)
  for (const event of events) {
    const key = eventKey(event)
    if (seen.has(key)) continue
    seen.add(key)
    if (event.type === 'withdrawal') {
      const payment = payments.find(
        (candidate) =>
          candidate.remainingPositionSize > 0n &&
          !candidate.withdrawal &&
          candidate.assetIdx !== event.tokenIndex &&
          candidate.principal === event.assets,
      )
      if (payment) payment.withdrawal = event
      continue
    }
    if (!isEarnCoveredCallTokenId(event.tokenId)) continue
    const existing = payments.filter(
      (candidate) => candidate.tokenId === event.tokenId && candidate.remainingPositionSize > 0n,
    )
    if (event.action === 'burn') {
      let remaining = event.positionSize
      for (const payment of existing) {
        const burned =
          remaining < payment.remainingPositionSize ? remaining : payment.remainingPositionSize
        payment.remainingPositionSize -= burned
        remaining -= burned
        if (burned > 0n && payment.remainingPositionSize > 0n) payment.resized = true
      }
      continue
    }
    if (event.positionSize <= 0n) continue
    const loan = decodeTokenId(event.tokenId).legs.find((leg) => leg.width === 0n)
    if (!loan) continue
    const assetIdx = loan.asset === 0n ? 0n : 1n
    const principal = getCoveredCallAdvance(event.positionSize, loan.strike, assetIdx)
    for (const payment of existing) payment.resized = true
    if (principal > 0n)
      payments.push({
        tokenId: event.tokenId,
        positionSize: event.positionSize,
        remainingPositionSize: event.positionSize,
        principal,
        assetIdx,
        resized: existing.length > 0,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
        transactionHash: event.transactionHash,
      })
  }
  return payments
}

export async function readRange<T>(
  read: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
): Promise<T[]> {
  try {
    return await read(from, to)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      from >= to ||
      !/block range|range (?:is )?too large|too many results|query returned more than|log response size/i.test(
        message,
      )
    )
      throw error
    const middle = (from + to) / 2n
    const before = await readRange(read, from, middle)
    return [...before, ...(await readRange(read, middle + 1n, to))]
  }
}

/** Reconstruct payment matches from confirmed pool and collateral-tracker events; no local state is required. */
export async function getCoveredCallPayments({
  client,
  poolAddress,
  account,
  fromBlock = 0n,
  toBlock,
}: {
  client: PublicClient
  poolAddress: Address
  account: Address
  fromBlock?: bigint
  toBlock?: bigint
}) {
  const end = toBlock ?? (await client.getBlockNumber())
  if (fromBlock < 0n || end < fromBlock) throw new RangeError('Invalid payment history range')
  const metadata = await getPoolMetadata({ client, poolAddress })
  const readWithdrawals = async (tokenIndex: 0n | 1n) => {
    const address =
      tokenIndex === 0n ? metadata.collateralToken0Address : metadata.collateralToken1Address
    const logs = await readRange(
      (from, to) =>
        client.getContractEvents({
          address,
          abi: collateralTrackerV2Abi,
          eventName: 'Withdraw',
          args: { owner: account, receiver: account },
          fromBlock: from,
          toBlock: to,
          strict: true,
        }),
      fromBlock,
      end,
    )
    return logs
      .filter(
        (log) =>
          !log.removed &&
          log.args.owner.toLowerCase() === account.toLowerCase() &&
          log.args.receiver.toLowerCase() === account.toLowerCase(),
      )
      .map((log) => ({
        tokenIndex,
        assets: log.args.assets,
        blockNumber: log.blockNumber,
        logIndex: BigInt(log.logIndex),
        transactionHash: log.transactionHash,
      }))
  }
  const [trades, withdrawals0, withdrawals1, _meta] = await Promise.all([
    readRange(
      async (from, to) =>
        (await getAccountHistory({ client, poolAddress, account, fromBlock: from, toBlock: to }))
          .trades,
      fromBlock,
      end,
    ),
    readWithdrawals(0n),
    readWithdrawals(1n),
    getBlockMeta({ client, blockNumber: end }),
  ])
  const payments = matchCoveredCallPayments({
    trades,
    withdrawals: [...withdrawals0, ...withdrawals1],
  })
  const blocks = [
    ...new Set(
      payments.flatMap((payment) => [
        payment.blockNumber,
        ...(payment.withdrawal ? [payment.withdrawal.blockNumber] : []),
      ]),
    ),
  ]
  const timestamps = new Map(
    await Promise.all(
      blocks.map(
        async (blockNumber) =>
          [blockNumber, (await getBlockMeta({ client, blockNumber })).blockTimestamp] as const,
      ),
    ),
  )
  return {
    payments: payments.map((payment) => ({
      ...payment,
      timestamp: timestamps.get(payment.blockNumber),
      ...(payment.withdrawal
        ? {
            withdrawal: {
              ...payment.withdrawal,
              timestamp: timestamps.get(payment.withdrawal.blockNumber),
            },
          }
        : {}),
    })),
    _meta,
  }
}
