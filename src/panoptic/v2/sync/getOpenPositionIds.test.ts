/**
 * Tests for getOpenPositionIds fast-path validation + event-scan fallback.
 * @module v2/sync/getOpenPositionIds.test
 */

import type { Address, Hash, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { getOpenPositionIds } from './getTrackedPositionIds'

const POOL = '0x00000000563b70d704f4c6675a5f6ac989fbae13' as Address
const ACCOUNT = '0x236d0558f06cd60780b232d4Ec4c92d2cb7e4D18' as Address
const STALE_HASH = `0x${'9'.repeat(64)}` as Hash
const EVENT_TX_HASH = `0x${'1'.repeat(64)}` as Hash
const BLOCK_HASH = `0x${'2'.repeat(64)}` as Hash

function dispatchInput(positionIds: bigint[]) {
  return encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [[], positionIds, [], [], false, 0n],
  })
}

const STALE_LIST = [11n, 22n, 33n]
const LIVE_LIST = [11n, 22n]

/**
 * Build a mock client. `readContractLive` controls whether the fast-path
 * validation call (getFullPositionsData) succeeds or reverts.
 */
function createClient(readContractLive: boolean) {
  const getTransaction = vi.fn(async ({ hash }: { hash: Hash }) => {
    // Fast path: the stored (possibly stale) dispatch tx.
    if (hash === STALE_HASH) {
      return { blockNumber: 19_000n, from: ACCOUNT, to: POOL, input: dispatchInput(STALE_LIST) }
    }
    // Event-scan path: the authoritative most-recent dispatch.
    return { blockNumber: 19_500n, from: ACCOUNT, to: POOL, input: dispatchInput(LIVE_LIST) }
  })

  return {
    getBlockNumber: vi.fn(async () => 30_000n),
    getBlock: vi.fn(async () => ({ hash: BLOCK_HASH })),
    getTransaction,
    readContract: vi.fn(async () => {
      if (!readContractLive) throw new Error('execution reverted')
      return [0n, 0n, [], [], []]
    }),
    getLogs: vi.fn(async ({ event }: { event: { name: string } }) => {
      if (event.name === 'OptionMinted') {
        return [{ transactionHash: EVENT_TX_HASH, blockNumber: 19_500n, logIndex: 0 }]
      }
      return []
    }),
  } as unknown as PublicClient & {
    getTransaction: ReturnType<typeof vi.fn>
    readContract: ReturnType<typeof vi.fn>
    getLogs: ReturnType<typeof vi.fn>
  }
}

describe('getOpenPositionIds', () => {
  it('accepts the fast-path list when it is still live on-chain', async () => {
    const client = createClient(true)

    const ids = await getOpenPositionIds({
      client,
      chainId: 1n,
      poolAddress: POOL,
      account: ACCOUNT,
      lastDispatchTxHash: STALE_HASH,
      toBlock: 30_000n,
    })

    expect(ids).toEqual(STALE_LIST)
    // Validated the fast-path list, never fell back to an event scan.
    expect(
      (client as unknown as { readContract: ReturnType<typeof vi.fn> }).readContract,
    ).toHaveBeenCalledTimes(1)
    expect(
      (client as unknown as { getLogs: ReturnType<typeof vi.fn> }).getLogs,
    ).not.toHaveBeenCalled()
  })

  it('falls back to the event scan when the fast-path list is stale (reverts)', async () => {
    const client = createClient(false)

    const ids = await getOpenPositionIds({
      client,
      chainId: 1n,
      poolAddress: POOL,
      account: ACCOUNT,
      lastDispatchTxHash: STALE_HASH,
      toBlock: 30_000n,
    })

    // Stale list discarded; authoritative on-chain list returned instead.
    expect(ids).toEqual(LIVE_LIST)
    expect((client as unknown as { getLogs: ReturnType<typeof vi.fn> }).getLogs).toHaveBeenCalled()
  })
})
