/**
 * Pool swaps pushed by the candle-indexer relay over Server-Sent Events, with HTTP
 * catch-up on every (re)sync and HTTP polling while the stream is unavailable.
 * @module v2/events/poolSwapStream
 */

import type { Hash } from 'viem'

import {
  type PoolSwap,
  type PoolSwapKey,
  type PoolSwapTransport,
  type PoolSwapWatcher,
  type WatchPoolSwapsParams,
  DEFAULT_MAX_BLOCK_RANGE,
  fetchPoolSwaps,
  watchPoolSwaps,
} from './poolSwaps'

/** The subset of the browser `EventSource` the stream relies on. */
export interface SwapStreamEventSource {
  readonly readyState: number
  addEventListener(type: string, listener: (event: { data?: string }) => void): void
  close(): void
}

export type SwapStreamEventSourceFactory = (url: string) => SwapStreamEventSource

export interface StreamPoolSwapsParams extends WatchPoolSwapsParams {
  streamUrl: string
  onRemoved?: (key: PoolSwapKey) => void
  onTransport?: (transport: PoolSwapTransport) => void
  /** Defaults to `globalThis.EventSource`; without one the stream only polls */
  eventSource?: SwapStreamEventSourceFactory
}

export interface PoolSwapStream extends PoolSwapWatcher {
  transport(): PoolSwapTransport
}

const DEFAULT_POLL_INTERVAL_MS = 3000
const FAILURE_WINDOW_MS = 30_000
const FAILURES_BEFORE_POLL = 3
const STREAM_RETRY_MIN_MS = 15_000
const STREAM_RETRY_MAX_MS = 300_000
const RESYNC_JITTER_MS = 2000
const EVENT_SOURCE_CLOSED = 2

type JsonRecord = Record<string, unknown>

function parseRecord(data: string): JsonRecord {
  const value: unknown = JSON.parse(data)
  if (typeof value !== 'object' || value === null) throw new Error('Malformed stream frame')
  return value as JsonRecord
}

function bigintField(record: JsonRecord, field: string): bigint {
  const value = record[field]
  if (typeof value !== 'string') throw new Error(`Stream frame is missing ${field}`)
  return BigInt(value)
}

function numberField(record: JsonRecord, field: string): number {
  const value = record[field]
  if (typeof value !== 'number') throw new Error(`Stream frame is missing ${field}`)
  return value
}

export function parseStreamedKey(data: string): PoolSwapKey {
  const record = parseRecord(data)
  return {
    blockNumber: bigintField(record, 'blockNumber'),
    logIndex: numberField(record, 'logIndex'),
  }
}

export function parseStreamedSwap(data: string): PoolSwap {
  const record = parseRecord(data)
  const transactionHash = record.transactionHash
  if (typeof transactionHash !== 'string')
    throw new Error('Stream frame is missing transactionHash')
  return {
    ...parseStreamedKey(data),
    timestamp: bigintField(record, 'timestamp'),
    transactionHash: transactionHash as Hash,
    tick: numberField(record, 'tick'),
    amount0: bigintField(record, 'amount0'),
    amount1: bigintField(record, 'amount1'),
    sqrtPriceX96: bigintField(record, 'sqrtPriceX96'),
    liquidity: bigintField(record, 'liquidity'),
  }
}

function parseHead(data: string | undefined): bigint {
  return bigintField(parseRecord(data ?? ''), 'head')
}

function defaultEventSource(): SwapStreamEventSourceFactory | undefined {
  const EventSourceCtor = (
    globalThis as { EventSource?: new (url: string) => SwapStreamEventSource }
  ).EventSource
  return EventSourceCtor && ((url) => new EventSourceCtor(url))
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Stream a pool's swaps from the relay at `streamUrl`.
 *
 * Every `ready`/`resync` frame carries the relay's head; swaps from the cursor up
 * to that head are fetched over HTTP so nothing is lost across reconnects. A
 * stream that closes, or errors three times in 30 s, is replaced by HTTP polling
 * and retried with backoff; one that closes before ever opening is not retried.
 */
export function streamPoolSwaps(params: StreamPoolSwapsParams): PoolSwapStream {
  const {
    client,
    pool,
    fromBlock,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxBlockRange = DEFAULT_MAX_BLOCK_RANGE,
    streamUrl,
    onSwaps,
    onError,
    onRemoved,
    onTransport,
    eventSource = defaultEventSource(),
  } = params

  let running = true
  let cursor = fromBlock === undefined ? undefined : fromBlock - 1n
  let transport: PoolSwapTransport = 'off'
  let failures: number[] = []
  let source: SwapStreamEventSource | undefined
  let poller: PoolSwapWatcher | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelayMs = STREAM_RETRY_MIN_MS
  let catchUpTimer: ReturnType<typeof setTimeout> | undefined
  let catchUpTarget: bigint | undefined
  let catchingUp = false
  let everOpened = false

  const setTransport = (next: PoolSwapTransport) => {
    if (next === transport) return
    transport = next
    onTransport?.(next)
  }

  const advance = (block: bigint | undefined) => {
    if (block !== undefined && (cursor === undefined || block > cursor)) cursor = block
  }

  const report = (error: unknown) => {
    if (running) onError?.(toError(error))
  }

  const catchUpPending = () => catchingUp || catchUpTarget !== undefined

  const runCatchUp = async () => {
    catchingUp = true
    while (running && catchUpTarget !== undefined) {
      const head = catchUpTarget
      catchUpTarget = undefined
      if (cursor === undefined) {
        cursor = head
        continue
      }
      try {
        const { swaps } = await fetchPoolSwaps(client, pool, cursor + 1n, head, maxBlockRange)
        if (!running) break
        const first = swaps[0]
        const last = swaps[swaps.length - 1]
        if (first && last)
          onSwaps(swaps, { fromBlock: first.blockNumber, toBlock: last.blockNumber })
        advance(head)
      } catch (error) {
        report(error)
        if (catchUpTarget === undefined || catchUpTarget < head) catchUpTarget = head
        catchingUp = false
        catchUpTimer = setTimeout(() => void runCatchUp(), pollIntervalMs)
        return
      }
    }
    catchingUp = false
  }

  const catchUp = (head: bigint, delayMs = 0) => {
    if (catchUpTarget === undefined || head > catchUpTarget) catchUpTarget = head
    if (catchingUp) return
    if (catchUpTimer !== undefined) clearTimeout(catchUpTimer)
    catchUpTimer = setTimeout(() => {
      catchUpTimer = undefined
      void runCatchUp()
    }, delayMs)
  }

  const startPolling = () => {
    if (poller) return
    poller = watchPoolSwaps({
      client,
      pool,
      fromBlock: cursor === undefined ? undefined : cursor + 1n,
      pollIntervalMs,
      maxBlockRange,
      onSwaps,
      onError,
    })
    setTransport('poll')
  }

  const stopPolling = () => {
    if (!poller) return
    advance(poller.lastScannedBlock())
    poller.stop()
    poller = undefined
  }

  const closeStream = () => {
    source?.close()
    source = undefined
  }

  const scheduleStreamRetry = () => {
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      if (running) openStream()
    }, retryDelayMs)
    retryDelayMs = Math.min(retryDelayMs * 2, STREAM_RETRY_MAX_MS)
  }

  const openStream = () => {
    if (!eventSource) {
      startPolling()
      return
    }
    const es = eventSource(streamUrl)
    source = es
    failures = []
    let opened = false
    const listen = (type: string, handle: (data: string | undefined) => void) =>
      es.addEventListener(type, (event) => {
        if (!running || source !== es) return
        try {
          handle(event.data)
        } catch (error) {
          report(error)
        }
      })

    listen('open', () => {
      opened = true
      everOpened = true
      failures = []
      retryDelayMs = STREAM_RETRY_MIN_MS
    })
    listen('ready', (data) => {
      const head = parseHead(data)
      stopPolling()
      setTransport('stream')
      catchUp(head)
    })
    listen('resync', (data) => {
      catchUp(parseHead(data), Math.random() * RESYNC_JITTER_MS)
    })
    listen('swap', (data) => {
      const swap = parseStreamedSwap(data ?? '')
      onSwaps([swap], { fromBlock: swap.blockNumber, toBlock: swap.blockNumber })
      if (!catchUpPending()) advance(swap.blockNumber)
    })
    listen('removed', (data) => {
      onRemoved?.(parseStreamedKey(data ?? ''))
    })
    listen('error', () => {
      const now = Date.now()
      failures = failures.filter((at) => now - at < FAILURE_WINDOW_MS)
      failures.push(now)
      const closed = es.readyState === EVENT_SOURCE_CLOSED
      if (!closed && failures.length < FAILURES_BEFORE_POLL) return
      closeStream()
      startPolling()
      if (closed && !opened && !everOpened) return
      scheduleStreamRetry()
    })
  }

  openStream()

  return {
    stop() {
      running = false
      closeStream()
      stopPolling()
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      if (catchUpTimer !== undefined) clearTimeout(catchUpTimer)
      setTransport('off')
    },
    lastScannedBlock: () => cursor,
    transport: () => transport,
  }
}
