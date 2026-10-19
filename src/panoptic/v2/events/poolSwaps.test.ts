import type { Hash, PublicClient } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchPoolSwaps, parseSwapLog, subscribePoolSwaps, watchPoolSwaps } from './poolSwaps'
import type { DecodedLog } from './watchEvents'

const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const POOL_MANAGER = '0x7777777777777777777777777777777777777777' as const
const POOL_ID = '0xaabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344' as Hash
const TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash

function swapLog(blockNumber: bigint, logIndex: number, tick = 100): DecodedLog {
  return {
    address: POOL_ADDRESS,
    topics: [],
    data: '0x',
    blockNumber,
    blockHash: TX_HASH,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    logIndex,
    removed: false,
    args: {
      amount0: -5n,
      amount1: 7n,
      sqrtPriceX96: 2n ** 96n,
      liquidity: 1000n,
      tick,
    },
  } as DecodedLog
}

function mockClient(overrides: Record<string, unknown> = {}) {
  const client = {
    getBlockNumber: vi.fn().mockResolvedValue(100n),
    getContractEvents: vi.fn().mockResolvedValue([]),
    getBlock: vi
      .fn()
      .mockImplementation(({ blockNumber }: { blockNumber: bigint }) =>
        Promise.resolve({ timestamp: 1_000n + blockNumber }),
      ),
    ...overrides,
  }
  return { client, publicClient: client as unknown as PublicClient }
}

describe('parseSwapLog', () => {
  it('parses v3 and v4 Swap args into a PoolSwap', () => {
    const v3 = parseSwapLog(swapLog(5n, 2, -30), 42n)
    expect(v3).toEqual({
      blockNumber: 5n,
      logIndex: 2,
      timestamp: 42n,
      transactionHash: TX_HASH,
      tick: -30,
      amount0: -5n,
      amount1: 7n,
      sqrtPriceX96: 2n ** 96n,
      liquidity: 1000n,
    })
    const v4Log = {
      ...swapLog(6n, 0),
      args: { ...(swapLog(6n, 0).args as object), id: POOL_ID, fee: 500 },
    } as DecodedLog
    expect(parseSwapLog(v4Log, 1n).tick).toBe(100)
  })

  it('rejects pending logs', () => {
    expect(() => parseSwapLog({ ...swapLog(1n, 0), blockNumber: null } as DecodedLog, 0n)).toThrow()
  })
})

describe('watchPoolSwaps', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('filters v4 swaps by pool id on the PoolManager', async () => {
    const { client, publicClient } = mockClient()
    const watcher = watchPoolSwaps({
      client: publicClient,
      pool: { version: 'v4', poolManager: POOL_MANAGER, poolId: POOL_ID },
      fromBlock: 100n,
      onSwaps: vi.fn(),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getContractEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        address: POOL_MANAGER,
        eventName: 'Swap',
        args: { id: POOL_ID },
        fromBlock: 100n,
        toBlock: 100n,
      }),
    )
    watcher.stop()
  })

  it('queries the v3 pool address without args', async () => {
    const { client, publicClient } = mockClient()
    const watcher = watchPoolSwaps({
      client: publicClient,
      pool: { version: 'v3', poolAddress: POOL_ADDRESS },
      onSwaps: vi.fn(),
    })
    await vi.advanceTimersByTimeAsync(0)
    const call = client.getContractEvents.mock.calls[0][0]
    expect(call.address).toBe(POOL_ADDRESS)
    expect(call.args).toBeUndefined()
    expect(call.fromBlock).toBe(100n)
    watcher.stop()
  })

  it('backfills in chunks and emits swaps in chain order with block timestamps', async () => {
    const { client, publicClient } = mockClient({
      getContractEvents: vi
        .fn()
        .mockImplementation(({ fromBlock }: { fromBlock: bigint }) =>
          Promise.resolve(
            fromBlock === 90n
              ? [swapLog(93n, 4), swapLog(91n, 1), swapLog(93n, 0)]
              : [swapLog(98n, 0)],
          ),
        ),
    })
    const onSwaps = vi.fn()
    const watcher = watchPoolSwaps({
      client: publicClient,
      pool: { version: 'v3', poolAddress: POOL_ADDRESS },
      fromBlock: 90n,
      maxBlockRange: 5n,
      onSwaps,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getContractEvents.mock.calls.map((c) => [c[0].fromBlock, c[0].toBlock])).toEqual([
      [90n, 94n],
      [95n, 99n],
      [100n, 100n],
    ])
    const [first, range] = onSwaps.mock.calls[0]
    expect(range).toEqual({ fromBlock: 90n, toBlock: 94n })
    expect(
      first.map((s: { blockNumber: bigint; logIndex: number }) => [s.blockNumber, s.logIndex]),
    ).toEqual([
      [91n, 1],
      [93n, 0],
      [93n, 4],
    ])
    expect(first[0].timestamp).toBe(1_091n)
    expect(client.getBlock).toHaveBeenCalledTimes(4)
    expect(watcher.lastScannedBlock()).toBe(100n)
    watcher.stop()
  })

  it('does not advance past a failing chunk and retries on the next tick', async () => {
    const getContractEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValue([swapLog(100n, 0)])
    const { publicClient } = mockClient({ getContractEvents })
    const onSwaps = vi.fn()
    const onError = vi.fn()
    const watcher = watchPoolSwaps({
      client: publicClient,
      pool: { version: 'v3', poolAddress: POOL_ADDRESS },
      fromBlock: 100n,
      pollIntervalMs: 1000,
      onSwaps,
      onError,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledWith(new Error('rpc down'))
    expect(watcher.lastScannedBlock()).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1000)
    expect(getContractEvents.mock.calls[1][0].fromBlock).toBe(100n)
    expect(onSwaps).toHaveBeenCalledTimes(1)
    expect(watcher.lastScannedBlock()).toBe(100n)
    watcher.stop()
  })
})

describe('fetchPoolSwaps', () => {
  it('chunks the range and defaults toBlock to the head', async () => {
    const { client, publicClient } = mockClient({
      getContractEvents: vi
        .fn()
        .mockImplementation(({ fromBlock }: { fromBlock: bigint }) =>
          Promise.resolve(fromBlock === 95n ? [swapLog(96n, 0)] : []),
        ),
    })
    const result = await fetchPoolSwaps(
      publicClient,
      { version: 'v3', poolAddress: POOL_ADDRESS },
      90n,
      undefined,
      5n,
    )
    expect(client.getContractEvents.mock.calls.map((c) => [c[0].fromBlock, c[0].toBlock])).toEqual([
      [90n, 94n],
      [95n, 99n],
      [100n, 100n],
    ])
    expect(result.toBlock).toBe(100n)
    expect(result.swaps.map((s) => s.blockNumber)).toEqual([96n])
  })

  it('returns nothing when fromBlock is past toBlock', async () => {
    const { client, publicClient } = mockClient()
    const result = await fetchPoolSwaps(
      publicClient,
      { version: 'v3', poolAddress: POOL_ADDRESS },
      11n,
      10n,
    )
    expect(result).toEqual({ swaps: [], toBlock: 10n })
    expect(client.getContractEvents).not.toHaveBeenCalled()
  })
})

describe('subscribePoolSwaps', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shares one watcher, replays the buffer and stops on the last unsubscribe', async () => {
    const { client, publicClient } = mockClient({
      getContractEvents: vi.fn().mockResolvedValue([swapLog(100n, 0)]),
    })
    const params = {
      key: 'test:shared',
      client: publicClient,
      pool: { version: 'v3', poolAddress: POOL_ADDRESS } as const,
      fromBlock: 100n,
      pollIntervalMs: 1000,
    }
    const first = vi.fn()
    const unsubscribeFirst = subscribePoolSwaps({ ...params, onSwaps: first })
    await vi.advanceTimersByTimeAsync(0)
    expect(first).toHaveBeenCalledTimes(1)

    const second = vi.fn()
    const unsubscribeSecond = subscribePoolSwaps({ ...params, onSwaps: second })
    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0][0]).toHaveLength(1)
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1)

    unsubscribeFirst()
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.getBlockNumber).toHaveBeenCalledTimes(2)

    unsubscribeSecond()
    await vi.advanceTimersByTimeAsync(5000)
    expect(client.getBlockNumber).toHaveBeenCalledTimes(2)
  })

  it('dedupes streamed and caught-up swaps and drops removed ones from the replay', async () => {
    const listeners = new Map<string, (event: { data?: string }) => void>()
    vi.stubGlobal(
      'EventSource',
      class {
        readyState = 1
        addEventListener(type: string, listener: (event: { data?: string }) => void) {
          listeners.set(type, listener)
        }
        close() {}
      },
    )
    const { publicClient } = mockClient({
      getContractEvents: vi.fn().mockResolvedValue([swapLog(100n, 0), swapLog(100n, 1)]),
    })
    const params = {
      key: 'test:stream',
      client: publicClient,
      pool: { version: 'v3', poolAddress: POOL_ADDRESS } as const,
      fromBlock: 100n,
      streamUrl: 'https://relay.example/live/swaps/x',
    }
    const onSwaps = vi.fn()
    const onRemoved = vi.fn()
    const unsubscribe = subscribePoolSwaps({ ...params, onSwaps, onRemoved })
    listeners.get('ready')?.({ data: JSON.stringify({ head: '100' }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(onSwaps).toHaveBeenCalledTimes(1)

    const frame = {
      blockNumber: '100',
      logIndex: 1,
      timestamp: '1100',
      transactionHash: TX_HASH,
      tick: 100,
      amount0: '-5',
      amount1: '7',
      sqrtPriceX96: (2n ** 96n).toString(),
      liquidity: '1000',
    }
    listeners.get('swap')?.({ data: JSON.stringify(frame) })
    expect(onSwaps).toHaveBeenCalledTimes(1)

    listeners.get('removed')?.({ data: JSON.stringify({ blockNumber: '100', logIndex: 0 }) })
    expect(onRemoved).toHaveBeenCalledWith({ blockNumber: 100n, logIndex: 0 })

    const late = vi.fn()
    const onTransport = vi.fn()
    const unsubscribeLate = subscribePoolSwaps({ ...params, onSwaps: late, onTransport })
    expect(late.mock.calls[0][0].map((s: { logIndex: number }) => s.logIndex)).toEqual([1])
    expect(onTransport).toHaveBeenCalledWith('stream')

    unsubscribeLate()
    unsubscribe()
    vi.unstubAllGlobals()
  })
})
