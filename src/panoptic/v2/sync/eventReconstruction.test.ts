import type { PublicClient } from 'viem'
import { getAbiItem } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { reconstructFromEvents } from './eventReconstruction'

const POOL = '0x0000000000000000000000000000000000000001' as const
const ACCOUNT = '0x0000000000000000000000000000000000000002' as const
const BLOCK_HASH = `0x${'1'.repeat(64)}` as const
const TX_HASH = `0x${'2'.repeat(64)}` as const

function positionBalance(size: bigint): bigint {
  return (0xdeadbeefn << 128n) | size
}

type MockEventClient = Pick<PublicClient, 'getBlock' | 'getLogs'>

describe('reconstructFromEvents', () => {
  it('reconstructs positions when a manager transaction has no decodable dispatch calldata', async () => {
    const getLogs = vi
      .fn()
      .mockImplementation(
        async (request: { event: { name: string; inputs: readonly unknown[] } }) => {
          if (request.event.name === 'OptionMinted') {
            return [
              {
                args: { recipient: ACCOUNT, tokenId: 11n, balanceData: positionBalance(100n) },
                blockNumber: 101n,
                blockHash: BLOCK_HASH,
                transactionHash: TX_HASH,
                logIndex: 1,
              },
              {
                args: { recipient: ACCOUNT, tokenId: 22n, balanceData: positionBalance(50n) },
                blockNumber: 103n,
                blockHash: BLOCK_HASH,
                transactionHash: TX_HASH,
                logIndex: 1,
              },
            ]
          }

          return [
            {
              args: { recipient: ACCOUNT, positionSize: 100n, tokenId: 11n, premiaByLeg: [] },
              blockNumber: 102n,
              blockHash: BLOCK_HASH,
              transactionHash: TX_HASH,
              logIndex: 1,
            },
          ]
        },
      )
    const client: MockEventClient = {
      getLogs,
      getBlock: vi.fn().mockResolvedValue({ hash: BLOCK_HASH }),
    }

    const result = await reconstructFromEvents({
      client,
      poolAddress: POOL,
      account: ACCOUNT,
      fromBlock: 100n,
      toBlock: 200n,
    })

    expect(result.openPositions).toEqual([22n])
    expect(result.closedPositions).toEqual([11n])
    expect(getLogs).toHaveBeenCalledTimes(2)

    const burnRequest = getLogs.mock.calls.find(
      ([request]) => request.event.name === 'OptionBurnt',
    )?.[0]
    expect(burnRequest?.event).toEqual(getAbiItem({ abi: panopticPoolV2Abi, name: 'OptionBurnt' }))
  })

  it('falls back to bounded ranges only when the provider rejects a wide scan', async () => {
    let wideRequests = 0
    const getLogs = vi
      .fn()
      .mockImplementation(async (request: { fromBlock: bigint; toBlock: bigint }) => {
        if (request.fromBlock === 0n && request.toBlock === 19n) {
          wideRequests += 1
          throw new Error('block range is too large')
        }
        return []
      })
    const client: MockEventClient = {
      getLogs,
      getBlock: vi.fn().mockResolvedValue({ hash: BLOCK_HASH }),
    }

    const result = await reconstructFromEvents({
      client,
      poolAddress: POOL,
      account: ACCOUNT,
      fromBlock: 0n,
      toBlock: 19n,
      batchSize: 10n,
    })

    expect(result.openPositions).toEqual([])
    expect(wideRequests).toBe(2)
    expect(getLogs).toHaveBeenCalledTimes(6)
  })

  it.each([0n, -1n])(
    'uses the safe batch default for an invalid batch size of %s',
    async (batchSize) => {
      const getLogs = vi
        .fn()
        .mockImplementation(async (request: { fromBlock: bigint; toBlock: bigint }) => {
          if (request.fromBlock === 0n && request.toBlock === 10000n) {
            throw new Error('block range is too large')
          }
          return []
        })
      const client: MockEventClient = {
        getLogs,
        getBlock: vi.fn().mockResolvedValue({ hash: BLOCK_HASH }),
      }

      await reconstructFromEvents({
        client,
        poolAddress: POOL,
        account: ACCOUNT,
        fromBlock: 0n,
        toBlock: 10000n,
        batchSize,
      })

      expect(getLogs).toHaveBeenCalledTimes(6)
    },
  )

  it('reports inclusive progress capped at 100', async () => {
    const onProgress = vi.fn()
    const client: MockEventClient = {
      getLogs: vi.fn().mockResolvedValue([]),
      getBlock: vi.fn().mockResolvedValue({ hash: BLOCK_HASH }),
    }

    const result = await reconstructFromEvents({
      client,
      poolAddress: POOL,
      account: ACCOUNT,
      fromBlock: 100n,
      toBlock: 200n,
      onProgress,
    })

    expect(result.blocksScanned).toBe(101n)
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 100n }))
  })

  it('rethrows non-range-limit errors', async () => {
    const originalError = new Error('connection reset')
    const client: MockEventClient = {
      getLogs: vi.fn().mockRejectedValue(originalError),
      getBlock: vi.fn().mockResolvedValue({ hash: BLOCK_HASH }),
    }

    await expect(
      reconstructFromEvents({
        client,
        poolAddress: POOL,
        account: ACCOUNT,
        fromBlock: 0n,
        toBlock: 10n,
      }),
    ).rejects.toBe(originalError)
  })
})
