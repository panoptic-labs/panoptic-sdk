import { createPublicClient, http } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getMainnetVaultPoolConfigurationHistory } from '../mainnetVaultPoolHistory'
import { fetchVaultPositionActivity, filterActiveVaultWeeks } from './positionActivity'
const WEEK = 604800
const weeks = [0, 1, 2].map((index) => ({
  startTimestampSec: index * WEEK,
  endTimestampSec: (index + 1) * WEEK,
}))
describe('active vault observations', () => {
  it('excludes mostly idle weeks without shifting week boundaries', () => {
    const result = filterActiveVaultWeeks(weeks, {
      fromTimestampSec: 0,
      throughTimestampSec: 3 * WEEK,
      changes: [
        { timestampSec: 0, hasOpenPositions: true },
        { timestampSec: WEEK, hasOpenPositions: false },
        { timestampSec: WEEK * 1.75, hasOpenPositions: true },
      ],
    })
    expect(result).toEqual([weeks[0], weeks[2]])
  })
  it('adds multiple active intervals and includes exactly half an active week', () => {
    expect(
      filterActiveVaultWeeks([weeks[0]], {
        fromTimestampSec: 0,
        throughTimestampSec: WEEK,
        changes: [
          { timestampSec: 0, hasOpenPositions: false },
          { timestampSec: WEEK / 4, hasOpenPositions: true },
          { timestampSec: WEEK / 2, hasOpenPositions: false },
          { timestampSec: (WEEK * 3) / 4, hasOpenPositions: true },
        ],
      }),
    ).toEqual([weeks[0]])
  })
  it('rejects idle weeks and incomplete activity coverage', () => {
    expect(
      filterActiveVaultWeeks(weeks, {
        fromTimestampSec: 1,
        throughTimestampSec: WEEK * 2,
        changes: [{ timestampSec: 0, hasOpenPositions: true }],
      }),
    ).toEqual([weeks[1]])
    expect(
      filterActiveVaultWeeks(weeks, {
        fromTimestampSec: 0,
        throughTimestampSec: WEEK * 3,
        changes: [],
      }),
    ).toEqual([])
  })
})

it('tracks open time across pools without creating a gap during a same-block migration', async () => {
  const vaultAddress = '0x236d0558f06cd60780b232d4Ec4c92d2cb7e4D18'
  const pools = [
    ...new Set(
      getMainnetVaultPoolConfigurationHistory({ chainId: 1, vaultAddress })?.flatMap(
        (configuration) => configuration.poolInfos.map((pool) => pool.pool),
      ),
    ),
  ]
  const first = pools[0]
  const second = pools[1]
  if (first === undefined || second === undefined) throw new Error('Missing test pools')
  const client = createPublicClient({ transport: http('http://localhost:1') })
  const hash = (block: bigint) => `0x${block.toString(16).padStart(64, '0')}` as `0x${string}`
  const event = (address: `0x${string}`, blockNumber: bigint, logIndex: number) => ({
    address,
    blockNumber,
    logIndex,
    transactionHash: hash(blockNumber),
    args: { recipient: vaultAddress, tokenId: 1n, balanceData: 1n },
  })
  vi.spyOn(client, 'getContractEvents').mockImplementation(
    async (params) =>
      (params.address === first
        ? params.eventName === 'OptionMinted'
          ? [event(first, 1n, 0)]
          : [event(first, 3n, 0)]
        : params.address === second
          ? params.eventName === 'OptionMinted'
            ? [event(second, 3n, 1)]
            : [event(second, 5n, 0)]
          : []) as never,
  )
  vi.spyOn(client, 'getTransaction').mockImplementation(
    async (params) => ({ hash: params.hash, from: vaultAddress, to: null, input: '0x' }) as never,
  )
  vi.spyOn(client, 'getBlock').mockImplementation(
    async (params) =>
      ({ number: params?.blockNumber, timestamp: (params?.blockNumber ?? 0n) * 100n }) as never,
  )
  const result = await fetchVaultPositionActivity({
    client,
    chainId: 1,
    vaultAddress,
    fromBlock: 0n,
    toBlock: 6n,
  })
  expect(result.changes).toEqual([
    { timestampSec: 0, hasOpenPositions: false },
    { timestampSec: 100, hasOpenPositions: true },
    { timestampSec: 500, hasOpenPositions: false },
  ])
  expect(result.positionsByPool.every((pool) => pool.tokenIds.length === 0)).toBe(true)
})
