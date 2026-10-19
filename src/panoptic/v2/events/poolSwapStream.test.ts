import type { Hash, PublicClient } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type SwapStreamEventSource,
  parseStreamedKey,
  parseStreamedSwap,
  streamPoolSwaps,
} from './poolSwapStream'
import type { DecodedLog } from './watchEvents'

const POOL = { version: 'v3', poolAddress: '0x1111111111111111111111111111111111111111' } as const
const TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash
const STREAM_URL = 'https://relay.example/live/swaps/0x1111111111111111111111111111111111111111'

class FakeEventSource implements SwapStreamEventSource {
  readyState = 0
  closed = false
  private listeners = new Map<string, ((event: { data?: string }) => void)[]>()

  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.closed = true
    this.readyState = 2
  }

  emit(type: string, data?: unknown) {
    const event = { data: data === undefined ? undefined : JSON.stringify(data) }
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  open() {
    this.readyState = 1
    this.emit('open')
  }

  fail({ closed }: { closed: boolean }) {
    this.readyState = closed ? 2 : 0
    this.emit('error')
  }
}

function swapFrame(blockNumber: bigint, logIndex: number) {
  return {
    blockNumber: blockNumber.toString(),
    logIndex,
    timestamp: '1700',
    transactionHash: TX_HASH,
    tick: -12,
    amount0: '-5',
    amount1: '7',
    sqrtPriceX96: (2n ** 96n).toString(),
    liquidity: '1000',
  }
}

function swapLog(blockNumber: bigint, logIndex: number): DecodedLog {
  return {
    blockNumber,
    logIndex,
    transactionHash: TX_HASH,
    args: { amount0: 1n, amount1: 2n, sqrtPriceX96: 3n, liquidity: 4n, tick: 5 },
  } as unknown as DecodedLog
}

function setup(options: { head?: bigint; logs?: DecodedLog[]; noFactory?: boolean } = {}) {
  const sources: FakeEventSource[] = []
  const client = {
    getBlockNumber: vi.fn().mockResolvedValue(options.head ?? 200n),
    getContractEvents: vi.fn().mockResolvedValue(options.logs ?? []),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 1n }),
  }
  const onSwaps = vi.fn()
  const onRemoved = vi.fn()
  const onTransport = vi.fn()
  const stream = streamPoolSwaps({
    client: client as unknown as PublicClient,
    pool: POOL,
    fromBlock: 100n,
    pollIntervalMs: 1000,
    streamUrl: STREAM_URL,
    onSwaps,
    onRemoved,
    onTransport,
    eventSource: options.noFactory
      ? undefined
      : () => {
          const source = new FakeEventSource()
          sources.push(source)
          return source
        },
  })
  const ranges = () =>
    client.getContractEvents.mock.calls.map((c) => [c[0].fromBlock, c[0].toBlock])
  return { client, stream, sources, onSwaps, onRemoved, onTransport, ranges }
}

describe('stream frame parsing', () => {
  it('parses decimal-string bigints', () => {
    expect(parseStreamedSwap(JSON.stringify(swapFrame(5n, 1)))).toEqual({
      blockNumber: 5n,
      logIndex: 1,
      timestamp: 1700n,
      transactionHash: TX_HASH,
      tick: -12,
      amount0: -5n,
      amount1: 7n,
      sqrtPriceX96: 2n ** 96n,
      liquidity: 1000n,
    })
    expect(parseStreamedKey('{"blockNumber":"9","logIndex":3}')).toEqual({
      blockNumber: 9n,
      logIndex: 3,
    })
  })

  it('rejects frames with missing fields', () => {
    expect(() => parseStreamedSwap('{"blockNumber":"1"}')).toThrow()
  })
})

describe('streamPoolSwaps', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('catches up to the ready head over HTTP and switches to stream', async () => {
    const { client, stream, sources, onSwaps, onTransport, ranges } = setup({
      logs: [swapLog(150n, 0)],
    })
    sources[0].open()
    expect(onTransport).not.toHaveBeenCalled()
    sources[0].emit('ready', { head: '180' })
    await vi.advanceTimersByTimeAsync(0)

    expect(onTransport).toHaveBeenCalledWith('stream')
    expect(ranges()).toEqual([[100n, 180n]])
    expect(client.getBlockNumber).not.toHaveBeenCalled()
    expect(onSwaps).toHaveBeenCalledTimes(1)
    expect(stream.lastScannedBlock()).toBe(180n)
    stream.stop()
  })

  it('emits each streamed swap once and forwards removals', async () => {
    const { stream, sources, onSwaps, onRemoved } = setup()
    sources[0].open()
    sources[0].emit('ready', { head: '100' })
    await vi.advanceTimersByTimeAsync(0)

    sources[0].emit('swap', swapFrame(101n, 2))
    expect(onSwaps).toHaveBeenCalledTimes(1)
    expect(onSwaps.mock.calls[0][1]).toEqual({ fromBlock: 101n, toBlock: 101n })
    expect(stream.lastScannedBlock()).toBe(101n)

    sources[0].emit('removed', { blockNumber: '101', logIndex: 2 })
    expect(onRemoved).toHaveBeenCalledWith({ blockNumber: 101n, logIndex: 2 })
    stream.stop()
  })

  it('catches up from the cursor after a jittered resync', async () => {
    const { stream, sources, ranges } = setup()
    sources[0].open()
    sources[0].emit('ready', { head: '120' })
    await vi.advanceTimersByTimeAsync(0)
    sources[0].emit('resync', { head: '140' })
    await vi.advanceTimersByTimeAsync(2000)

    expect(ranges()).toEqual([
      [100n, 120n],
      [121n, 140n],
    ])
    stream.stop()
  })

  it('polls immediately from the cursor when the stream closes, and retries it', async () => {
    const { client, stream, sources, onTransport } = setup()
    sources[0].open()
    sources[0].emit('ready', { head: '150' })
    await vi.advanceTimersByTimeAsync(0)

    sources[0].fail({ closed: true })
    expect(onTransport).toHaveBeenLastCalledWith('poll')
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getContractEvents.mock.calls[1][0].fromBlock).toBe(151n)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(sources).toHaveLength(2)
    stream.stop()
  })

  it('falls back after three errors in 30 s and returns to stream on ready', async () => {
    const { client, stream, sources, onTransport } = setup()
    sources[0].open()
    sources[0].fail({ closed: false })
    sources[0].fail({ closed: false })
    expect(onTransport).not.toHaveBeenCalled()
    sources[0].fail({ closed: false })
    expect(sources[0].closed).toBe(true)
    expect(onTransport).toHaveBeenLastCalledWith('poll')

    await vi.advanceTimersByTimeAsync(15_000)
    expect(sources).toHaveLength(2)
    const pollsBefore = client.getBlockNumber.mock.calls.length
    sources[1].open()
    sources[1].emit('ready', { head: '210' })
    await vi.advanceTimersByTimeAsync(0)
    expect(onTransport).toHaveBeenLastCalledWith('stream')

    await vi.advanceTimersByTimeAsync(5000)
    expect(client.getBlockNumber.mock.calls.length).toBe(pollsBefore)
    stream.stop()
  })

  it('polls without retrying when the stream closes before opening', async () => {
    const { stream, sources, onTransport } = setup()
    sources[0].fail({ closed: true })
    expect(onTransport).toHaveBeenLastCalledWith('poll')
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sources).toHaveLength(1)
    stream.stop()
  })

  it('keeps retrying when a retry closes before opening after an earlier open', async () => {
    const { stream, sources } = setup()
    sources[0].open()
    sources[0].emit('ready', { head: '150' })
    await vi.advanceTimersByTimeAsync(0)
    sources[0].fail({ closed: true })

    await vi.advanceTimersByTimeAsync(15_000)
    expect(sources).toHaveLength(2)
    sources[1].fail({ closed: true })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sources).toHaveLength(3)
    stream.stop()
  })

  it('reports off when stopped', () => {
    const { stream, sources, onTransport } = setup()
    sources[0].emit('ready', { head: '100' })
    stream.stop()
    expect(sources[0].closed).toBe(true)
    expect(stream.transport()).toBe('off')
    expect(onTransport).toHaveBeenLastCalledWith('off')
  })

  it('polls when no EventSource is available', async () => {
    const { client, stream, onTransport } = setup({ noFactory: true })
    expect(onTransport).toHaveBeenCalledWith('poll')
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getContractEvents.mock.calls[0][0].fromBlock).toBe(100n)
    stream.stop()
  })
})
