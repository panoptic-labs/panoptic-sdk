import type { Address, Hash, TransactionReceipt } from 'viem'
import { encodeAbiParameters, encodeEventTopics, TransactionReceiptNotFoundError } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { encodeLeg } from '../tokenId/encoding'
import {
  getPositionMintHistory,
  getPositionMintProof,
  mintedLegsEqualPosition,
  mintedShortsCoverPosition,
  mintedShortsOverlapPosition,
} from './mintProof'

const pool = '0x0000000000000000000000000000000000000001' as Address
const account = '0x0000000000000000000000000000000000000002' as Address
const hash = `0x${'ab'.repeat(32)}` as Hash
const blockHash = `0x${'cd'.repeat(32)}` as Hash
const poolId = 42n
function leg(index: bigint, isLong: bigint, asset = 0n, tokenType = 0n) {
  return encodeLeg({
    index,
    isLong,
    asset,
    tokenType,
    strike: index * 100n,
    width: 10n,
    optionRatio: 1n,
    riskPartner: index,
  })
}
const long = poolId | leg(0n, 1n)
const short = poolId | leg(0n, 0n)

function clientFor(tokenId = short, recipient = account, address = pool) {
  const receipt = {
    status: 'success',
    transactionHash: hash,
    blockHash,
    blockNumber: 100n,
    logs: [
      {
        address,
        topics: encodeEventTopics({
          abi: panopticPoolV2Abi,
          eventName: 'OptionMinted',
          args: { recipient, tokenId },
        }),
        data: encodeAbiParameters([{ type: 'uint256' }], [123n]),
        blockNumber: 100n,
        blockHash,
        transactionHash: hash,
        logIndex: 2,
        transactionIndex: 0,
        removed: false,
      },
    ],
  } as TransactionReceipt
  return {
    getTransactionReceipt: vi.fn(async () => receipt),
    getBlockNumber: vi.fn(async () => 101n),
    getBlock: vi.fn(async () => ({ timestamp: 1000n })) as unknown as Parameters<
      typeof getPositionMintProof
    >[0]['client']['getBlock'],
  }
}
const params = () => ({
  client: clientFor(),
  poolAddress: pool,
  recipient: account,
  transactionHash: hash,
  tokenId: long,
  match: 'shorts' as const,
})

describe('mint proofs', () => {
  it('bounds history requests without gaps and filters by pool and recipient', async () => {
    const getLogs = vi.fn(async () => [])
    await getPositionMintHistory({
      client: { getLogs },
      poolAddress: pool,
      recipient: account,
      fromBlock: 10n,
      toBlock: 10_010n,
    })
    expect(getLogs.mock.calls).toEqual([
      [
        expect.objectContaining({
          address: pool,
          args: { recipient: account },
          fromBlock: 10n,
          toBlock: 5009n,
        }),
      ],
      [expect.objectContaining({ fromBlock: 5010n, toBlock: 10009n })],
      [expect.objectContaining({ fromBlock: 10010n, toBlock: 10010n })],
    ])
  })
  it('retains receipt identity, amount and time for a verified mint', async () => {
    const result = await getPositionMintProof(params())
    expect(result.status).toBe('verified')
    if (result.status !== 'verified') throw new Error('Expected proof')
    expect(result.mints[0]).toMatchObject({
      positionSize: 123n,
      timestamp: 1000n,
      blockHash,
      logIndex: 2,
      tokenId: short,
    })
  })

  it('waits for confirmations and retries unavailable RPCs', async () => {
    const input = params()
    input.client.getBlockNumber.mockResolvedValueOnce(100n)
    expect(await getPositionMintProof(input)).toMatchObject({
      status: 'pending',
      reason: 'confirmations',
      mints: [{ transactionHash: hash, positionSize: 123n, timestamp: 1000n }],
    })
    input.client.getTransactionReceipt.mockRejectedValueOnce(new Error('offline'))
    await expect(getPositionMintProof(input)).rejects.toThrow('offline')
  })

  it('distinguishes a missing receipt from transport failures', async () => {
    const input = params()
    input.client.getTransactionReceipt.mockRejectedValueOnce(
      new TransactionReceiptNotFoundError({ hash }),
    )
    expect(await getPositionMintProof(input)).toEqual({
      status: 'pending',
      reason: 'receipt_not_found',
    })
    input.client.getTransactionReceipt.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { name: 'TransactionReceiptNotFoundError' }),
    )
    expect(await getPositionMintProof(input)).toEqual({
      status: 'pending',
      reason: 'receipt_not_found',
    })
  })

  it('rejects reverted, wrong-recipient, wrong-pool and same-side transactions', async () => {
    const input = params()
    const receipt = await input.client.getTransactionReceipt()
    input.client.getTransactionReceipt.mockResolvedValueOnce({ ...receipt, status: 'reverted' })
    expect(await getPositionMintProof(input)).toEqual({ status: 'rejected', reason: 'reverted' })
    for (const client of [
      clientFor(short, pool),
      clientFor(short, account, account),
      clientFor(long),
    ]) {
      client.getBlockNumber.mockResolvedValue(100n)
      expect((await getPositionMintProof({ ...params(), client })).status).toBe('rejected')
    }
  })

  it.each([0n, 1n])(
    'captures partial contributions to mixed-asset positions (first asset %s)',
    (asset) => {
      const position = poolId | leg(0n, 1n, asset, 0n) | leg(1n, 1n, 1n - asset, 1n)
      expect(mintedShortsOverlapPosition(poolId | leg(0n, 0n, asset, 0n), position)).toBe(true)
      expect(mintedShortsOverlapPosition(poolId | leg(0n, 0n, 1n - asset, 0n), position)).toBe(true)
      expect(mintedShortsCoverPosition(poolId | leg(0n, 0n, 1n - asset, 0n), position)).toBe(false)
      expect(
        mintedShortsCoverPosition(
          poolId | leg(0n, 0n, 1n - asset, 0n) | leg(1n, 0n, asset, 1n),
          position,
        ),
      ).toBe(true)
      expect(mintedShortsOverlapPosition(poolId | leg(0n, 0n, asset, 1n), position)).toBe(false)
      expect(
        mintedLegsEqualPosition(
          poolId | leg(0n, 1n, 1n - asset, 0n),
          poolId | leg(0n, 1n, asset, 0n),
        ),
      ).toBe(false)
      expect(mintedLegsEqualPosition(poolId | leg(0n, 1n, asset, 0n), position)).toBe(false)
    },
  )
})
