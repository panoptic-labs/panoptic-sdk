import { createPublicClient, custom, zeroHash } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBlockMeta } from '../clients'
import { buildEarnCoveredCallTokenId } from '../tokenId/coveredCall'
import {
  type CoveredCallWithdrawal,
  getCoveredCallPayments,
  matchCoveredCallPayments,
} from './coveredCallPayments'
import { type AccountTrade, getAccountHistory } from './history'
import { getPoolMetadata } from './pool'

vi.mock('./history', () => ({ getAccountHistory: vi.fn() }))
vi.mock('./pool', () => ({ getPoolMetadata: vi.fn() }))
vi.mock('../clients', () => ({ getBlockMeta: vi.fn() }))
const owner = '0x0000000000000000000000000000000000000001'
const other = '0x0000000000000000000000000000000000000002'
const trackers = [
  '0x0000000000000000000000000000000000000003',
  '0x0000000000000000000000000000000000000004',
] as const
const id = (strike: bigint, assetIdx: 0n | 1n = 0n) =>
  buildEarnCoveredCallTokenId({ poolId: 1n, assetIdx, strike, width: 10n, loanStrike: 0n })
const trade = (
  tokenId: bigint,
  blockNumber: bigint,
  overrides: Partial<AccountTrade> = {},
): AccountTrade => ({
  tokenId,
  blockNumber,
  action: 'mint',
  positionSize: 100n,
  logIndex: 1n,
  transactionHash: zeroHash,
  ...overrides,
})
const withdrawal = (
  blockNumber: bigint,
  overrides: Partial<CoveredCallWithdrawal> = {},
): CoveredCallWithdrawal => ({
  blockNumber,
  logIndex: 2n,
  transactionHash: zeroHash,
  tokenIndex: 1n,
  assets: 100n,
  ...overrides,
})
// Log indexes are block-global; distinct hashes keep synthetic blocks distinct.
const hash = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}` as const
const mint = (tokenId: bigint, blockNumber: bigint, overrides: Partial<AccountTrade> = {}) =>
  trade(tokenId, blockNumber, { transactionHash: hash(blockNumber), ...overrides })
const paid = (blockNumber: bigint, overrides: Partial<CoveredCallWithdrawal> = {}) =>
  withdrawal(blockNumber, { transactionHash: hash(blockNumber), ...overrides })
describe('exact upfront payment matching', () => {
  it.each([0n, 1n] as const)(
    'uses FIFO for duplicate amounts without consuming a withdrawal twice (base %s)',
    (assetIdx) => {
      const trades = [mint(id(20n, assetIdx), 20n), mint(id(10n, assetIdx), 10n)]
      const payment = paid(30n, { tokenIndex: assetIdx === 0n ? 1n : 0n })
      const matched = matchCoveredCallPayments({ trades, withdrawals: [payment, payment] })
      expect(matched.map((entry) => [entry.tokenId, entry.withdrawal?.blockNumber])).toEqual([
        [id(10n, assetIdx), 30n],
        [id(20n, assetIdx), undefined],
      ])
      const both = matchCoveredCallPayments({
        trades,
        withdrawals: [paid(40n, { tokenIndex: payment.tokenIndex }), payment],
      })
      expect(both.map((entry) => entry.withdrawal?.blockNumber)).toEqual([30n, 40n])
    },
  )
  it('requires exact raw units, the matching quote token and strict event ordering', () => {
    const opening = mint(id(10n), 20n, { logIndex: 5n })
    const before = paid(20n, { logIndex: 4n })
    const wrongToken = paid(21n, { tokenIndex: 0n })
    const partial = paid(22n, { assets: 99n })
    const larger = paid(23n, { assets: 101n })
    expect(
      matchCoveredCallPayments({
        trades: [opening],
        withdrawals: [before, wrongToken, partial, larger],
      })[0]?.withdrawal,
    ).toBeUndefined()
    expect(
      matchCoveredCallPayments({ trades: [opening], withdrawals: [paid(20n, { logIndex: 6n })] })[0]
        ?.withdrawal?.logIndex,
    ).toBe(6n)
  })
  it('keeps closed lifecycle matches consumed and does not reuse them for a reopened token ID', () => {
    const tokenId = id(10n)
    const trades = [mint(tokenId, 10n), mint(tokenId, 30n), mint(tokenId, 20n, { action: 'burn' })]
    const payments = matchCoveredCallPayments({ trades, withdrawals: [paid(15n)] })
    expect(payments[0]).toMatchObject({
      remainingPositionSize: 0n,
      withdrawal: { blockNumber: 15n },
    })
    expect(payments[1]?.remainingPositionSize).toBe(100n)
    expect(payments[1]?.withdrawal).toBeUndefined()
    expect(
      matchCoveredCallPayments({ trades, withdrawals: [paid(35n)] })[1]?.withdrawal?.blockNumber,
    ).toBe(35n)
  })
  it('marks top-ups and partial burns as resized instead of offering a guessed principal', () => {
    const tokenId = id(10n)
    const payments = matchCoveredCallPayments({
      trades: [mint(tokenId, 10n), mint(tokenId, 20n, { action: 'burn', positionSize: 1n })],
      withdrawals: [],
    })
    expect(payments[0]).toMatchObject({ remainingPositionSize: 99n, resized: true })
    const topups = matchCoveredCallPayments({
      trades: [mint(tokenId, 10n), mint(tokenId, 20n)],
      withdrawals: [],
    })
    expect(topups.every((entry) => entry.resized)).toBe(true)
  })
  it('ignores temporary credit legs and deduplicates replayed opening logs', () => {
    const opening = mint(id(10n), 10n)
    expect(
      matchCoveredCallPayments({ trades: [mint(1n, 5n), opening, opening], withdrawals: [] }),
    ).toHaveLength(1)
  })
})

describe('payment history RPC reads', () => {
  const client = createPublicClient({ transport: custom({ request: vi.fn() }) })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBlockMeta).mockResolvedValue({
      blockNumber: 30n,
      blockHash: zeroHash,
      blockTimestamp: 50n,
    })
    vi.mocked(getPoolMetadata).mockResolvedValue({
      collateralToken0Address: trackers[0],
      collateralToken1Address: trackers[1],
    } as unknown as Awaited<ReturnType<typeof getPoolMetadata>>)
    vi.mocked(getAccountHistory).mockResolvedValue({
      trades: [mint(id(10n), 10n)],
      _meta: { blockNumber: 30n, blockHash: zeroHash, blockTimestamp: 50n },
    })
  })
  it('scopes events to the owner, wallet receiver, pool trackers and one pinned range', async () => {
    vi.mocked(getBlockMeta).mockImplementation(async ({ blockNumber = 30n }) => ({
      blockNumber,
      blockHash: zeroHash,
      blockTimestamp: blockNumber * 2n,
    }))
    const getEvents = vi.spyOn(client, 'getContractEvents').mockImplementation(async (params) =>
      params.address === trackers[1]
        ? ([
            {
              args: { owner, receiver: owner, assets: 100n },
              blockNumber: 20n,
              logIndex: 2,
              transactionHash: hash(20n),
              removed: false,
            },
            {
              args: { owner, receiver: other, assets: 100n },
              blockNumber: 15n,
              logIndex: 1,
              transactionHash: hash(15n),
              removed: false,
            },
            {
              args: { owner, receiver: owner, assets: 100n },
              blockNumber: 12n,
              logIndex: 1,
              transactionHash: hash(12n),
              removed: true,
            },
          ] as unknown as Awaited<ReturnType<typeof client.getContractEvents>>)
        : [],
    )
    const result = await getCoveredCallPayments({
      client,
      poolAddress: other,
      account: owner,
      fromBlock: 5n,
      toBlock: 30n,
    })
    expect(result.payments[0]?.withdrawal?.blockNumber).toBe(20n)
    expect(result.payments[0]?.withdrawal?.timestamp).toBe(40n)
    expect(result.payments[0]?.timestamp).toBe(20n)
    expect(getBlockMeta).toHaveBeenCalledWith({ client, blockNumber: 10n })
    expect(getBlockMeta).toHaveBeenCalledWith({ client, blockNumber: 20n })
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        address: trackers[1],
        args: { owner, receiver: owner },
        fromBlock: 5n,
        toBlock: 30n,
        strict: true,
      }),
    )
    expect(getAccountHistory).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: other, account: owner, fromBlock: 5n, toBlock: 30n }),
    )
  })
  it('propagates unavailable RPC history rather than returning an unpaid result', async () => {
    vi.spyOn(client, 'getContractEvents').mockRejectedValue(new Error('RPC unavailable'))
    await expect(
      getCoveredCallPayments({ client, poolAddress: other, account: owner, toBlock: 30n }),
    ).rejects.toThrow('RPC unavailable')
  })
  it('splits provider-limited ranges without overlapping or skipping blocks', async () => {
    const reads: Parameters<typeof client.getContractEvents>[0][] = []
    vi.spyOn(client, 'getContractEvents').mockImplementation(async (params) => {
      reads.push(params)
      if (
        typeof params.fromBlock === 'bigint' &&
        typeof params.toBlock === 'bigint' &&
        params.toBlock - params.fromBlock > 4n
      )
        throw new Error('block range too large')
      return []
    })
    await getCoveredCallPayments({
      client,
      poolAddress: other,
      account: owner,
      fromBlock: 10n,
      toBlock: 19n,
    })
    expect(reads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromBlock: 10n, toBlock: 14n }),
        expect.objectContaining({ fromBlock: 15n, toBlock: 19n }),
      ]),
    )
  })
})
