import Decimal from 'decimal.js'
import { type Address, type PublicClient, zeroHash } from 'viem'

import { panopticPoolV2Abi } from '../../abis/panoptic_v2_abis'
import { updatePositionSnapshot } from '../../panoptic/v2/sync/positionSnapshot'
import { getMainnetVaultPoolConfigurationHistory } from '../mainnetVaultPoolHistory'

/** Reconstructs time with open positions across every historical pool, including migration gaps. */
export async function fetchVaultPositionActivity({
  client,
  chainId,
  vaultAddress,
  fromBlock,
  toBlock,
  positionsByPool = [],
}: {
  client: PublicClient
  chainId: number
  vaultAddress: Address
  fromBlock: bigint
  toBlock: bigint
  positionsByPool?: readonly { poolAddress: Address; tokenIds: readonly string[] }[]
}) {
  const history = getMainnetVaultPoolConfigurationHistory({ chainId, vaultAddress })
  if (history === null) throw new Error('Missing vault pool history')
  const pools = [
    ...new Set(
      history.flatMap((configuration) => configuration.poolInfos.map((pool) => pool.pool)),
    ),
  ]
  const batches = await Promise.all(
    pools.map(async (address) => {
      const [mints, burns] = await Promise.all([
        client.getContractEvents({
          address,
          abi: panopticPoolV2Abi,
          eventName: 'OptionMinted',
          strict: true,
          args: { recipient: vaultAddress },
          fromBlock,
          toBlock,
        }),
        client.getContractEvents({
          address,
          abi: panopticPoolV2Abi,
          eventName: 'OptionBurnt',
          strict: true,
          args: { recipient: vaultAddress },
          fromBlock,
          toBlock,
        }),
      ])
      return [
        ...mints.map((event) => ({
          ...event,
          change: { type: 'mint' as const, tokenId: event.args.tokenId },
        })),
        ...burns.map((event) => ({
          ...event,
          change: { type: 'burn' as const, tokenId: event.args.tokenId },
        })),
      ]
    }),
  )
  const events = batches
    .flat()
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    )
  const transactions = new Map<`0x${string}`, Awaited<ReturnType<PublicClient['getTransaction']>>>()
  const hashes = [...new Set(events.map((event) => event.transactionHash))]
  for (let offset = 0; offset < hashes.length; offset += 32) {
    const batch = await Promise.all(
      hashes.slice(offset, offset + 32).map((hash) => client.getTransaction({ hash })),
    )
    for (const transaction of batch) transactions.set(transaction.hash, transaction)
  }
  const blockNumbers = [
    ...new Set([fromBlock, toBlock, ...events.map((event) => event.blockNumber)]),
  ]
  const timestamps = new Map<bigint, number>()
  for (let offset = 0; offset < blockNumbers.length; offset += 32) {
    const blocks = await Promise.all(
      blockNumbers
        .slice(offset, offset + 32)
        .map((blockNumber) => client.getBlock({ blockNumber })),
    )
    for (const block of blocks) timestamps.set(block.number, Number(block.timestamp))
  }
  const states = new Map<string, ReturnType<typeof updatePositionSnapshot>>(
    positionsByPool.map((pool) => [
      pool.poolAddress.toLowerCase(),
      { positionIds: pool.tokenIds.map(BigInt), transactionHash: zeroHash, fromDispatch: false },
    ]),
  )
  for (const poolAddress of pools) {
    if (!states.has(poolAddress.toLowerCase()))
      states.set(poolAddress.toLowerCase(), {
        positionIds: [],
        transactionHash: zeroHash,
        fromDispatch: false,
      })
  }
  const hasPositions = () => [...states.values()].some((state) => state.positionIds.length > 0)
  const fromTimestampSec = timestamps.get(fromBlock)
  const throughTimestampSec = timestamps.get(toBlock)
  if (fromTimestampSec === undefined || throughTimestampSec === undefined)
    throw new Error('Incomplete position activity coverage')
  const snapshotPositions = () =>
    [...states].map(([poolAddress, state]) => ({
      poolAddress: poolAddress as Address,
      tokenIds: state.positionIds.map((id) => id.toString()),
    }))
  const positionSnapshots = [
    {
      blockNumber: fromBlock,
      timestampSec: fromTimestampSec,
      positionsByPool: snapshotPositions(),
    },
  ]
  const changes = [{ timestampSec: fromTimestampSec, hasOpenPositions: hasPositions() }]
  for (let i = 0; i < events.length; ) {
    const blockNumber = events[i]?.blockNumber
    if (blockNumber === undefined) break
    while (i < events.length && events[i]?.blockNumber === blockNumber) {
      const event = events[i]
      if (event === undefined) break
      const transaction = transactions.get(event.transactionHash)
      if (transaction === undefined) throw new Error('Missing position transaction')
      const key = event.address.toLowerCase()
      states.set(
        key,
        updatePositionSnapshot({
          previous: states.get(key),
          poolAddress: event.address,
          account: vaultAddress,
          transaction,
          change: event.change,
        }),
      )
      i++
    }
    const timestampSec = timestamps.get(blockNumber)
    if (timestampSec === undefined) throw new Error('Missing position timestamp')
    positionSnapshots.push({ blockNumber, timestampSec, positionsByPool: snapshotPositions() })
    if (changes[changes.length - 1]?.hasOpenPositions !== hasPositions())
      changes.push({ timestampSec, hasOpenPositions: hasPositions() })
  }
  positionSnapshots.push({
    blockNumber: toBlock,
    timestampSec: throughTimestampSec,
    positionsByPool: snapshotPositions(),
  })
  return {
    fromTimestampSec,
    throughTimestampSec,
    changes,
    positionSnapshots,
    positionsByPool: [...states].map(([poolAddress, state]) => ({
      poolAddress: poolAddress as Address,
      tokenIds: state.positionIds.map((id) => id.toString()),
    })),
  }
}

/** Keeps complete weeks with open positions for at least half their elapsed time. */
export function filterActiveVaultWeeks<
  T extends { startTimestampSec: number; endTimestampSec: number },
>(
  weeks: readonly T[],
  activity: {
    fromTimestampSec: number
    throughTimestampSec: number
    changes: readonly { timestampSec: number; hasOpenPositions: boolean }[]
  },
) {
  const changes = [...activity.changes].sort((a, b) => a.timestampSec - b.timestampSec)
  return weeks.filter((week) => {
    if (
      week.startTimestampSec < activity.fromTimestampSec ||
      week.endTimestampSec > activity.throughTimestampSec
    )
      return false
    let cursor = week.startTimestampSec
    let active = false
    let activeSeconds = 0
    for (const change of changes) {
      if (change.timestampSec <= week.startTimestampSec) {
        active = change.hasOpenPositions
        continue
      }
      if (change.timestampSec >= week.endTimestampSec) break
      if (active) activeSeconds += change.timestampSec - cursor
      cursor = change.timestampSec
      active = change.hasOpenPositions
    }
    if (active) activeSeconds += week.endTimestampSec - cursor
    return activeSeconds > 0 && activeSeconds * 2 >= week.endTimestampSec - week.startTimestampSec
  })
}

/** Requires meaningful option exposure for at least half the week and retains eligible price intervals. */
export function qualifyVaultWeeks<T extends { startTimestampSec: number; endTimestampSec: number }>(
  weeks: readonly T[],
  activity: {
    fromTimestampSec: number
    throughTimestampSec: number
    changes: readonly {
      timestampSec: number
      hasOpenPositions: boolean
      longOptionNotionalPct: string
    }[]
  },
) {
  const changes = [...activity.changes].sort((a, b) => a.timestampSec - b.timestampSec)
  return weeks.flatMap((week) => {
    if (
      week.startTimestampSec < activity.fromTimestampSec ||
      week.endTimestampSec > activity.throughTimestampSec
    )
      return []
    const activeIntervals: { startTimestampSec: number; endTimestampSec: number }[] = []
    let cursor = week.startTimestampSec
    let active = false
    const append = (end: number) => {
      if (active && end > cursor) {
        const previous = activeIntervals[activeIntervals.length - 1]
        if (previous?.endTimestampSec === cursor) previous.endTimestampSec = end
        else activeIntervals.push({ startTimestampSec: cursor, endTimestampSec: end })
      }
      cursor = end
    }
    for (const change of changes) {
      if (change.timestampSec >= week.endTimestampSec) break
      if (change.timestampSec > week.startTimestampSec) append(change.timestampSec)
      const exposure = new Decimal(change.longOptionNotionalPct)
      active = change.hasOpenPositions && exposure.isFinite() && exposure.gte(5)
    }
    append(week.endTimestampSec)
    const seconds = activeIntervals.reduce(
      (total, interval) => total + interval.endTimestampSec - interval.startTimestampSec,
      0,
    )
    return seconds > 0 && seconds * 2 >= week.endTimestampSec - week.startTimestampSec
      ? [{ ...week, activeIntervals }]
      : []
  })
}
