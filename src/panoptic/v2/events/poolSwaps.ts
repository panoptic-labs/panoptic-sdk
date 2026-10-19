/**
 * Pool-filtered Uniswap v3/v4 `Swap` logs: HTTP polling, one-shot fetches and a
 * shared subscription that prefers a relay stream when one is available.
 * @module v2/events/poolSwaps
 */

import type { Address, Hash, PublicClient } from 'viem'

import { UniswapV3PoolAbi } from '../../../abis/UniswapV3Pool'
import { poolManagerAbi } from '../abis/poolManager'
import { streamPoolSwaps } from './poolSwapStream'
import type { DecodedLog } from './watchEvents'

export type SwapPoolRef =
  | { version: 'v3'; poolAddress: Address }
  | { version: 'v4'; poolManager: Address; poolId: Hash }

export interface PoolSwap {
  blockNumber: bigint
  logIndex: number
  /** Block timestamp in unix seconds */
  timestamp: bigint
  transactionHash: Hash
  tick: number
  amount0: bigint
  amount1: bigint
  sqrtPriceX96: bigint
  liquidity: bigint
}

export interface WatchPoolSwapsParams {
  client: PublicClient
  pool: SwapPoolRef
  /** Inclusive first block to scan; omit to start at the current head */
  fromBlock?: bigint
  /** Default 3000 */
  pollIntervalMs?: number
  /** Default 2000n */
  maxBlockRange?: bigint
  /** Called once per scanned chunk that contains swaps, in chain order */
  onSwaps: (swaps: PoolSwap[], range: { fromBlock: bigint; toBlock: bigint }) => void
  onError?: (error: Error) => void
}

export type PoolSwapKey = { blockNumber: bigint; logIndex: number }

export type PoolSwapTransport = 'stream' | 'poll' | 'off'

export interface PoolSwapWatcher {
  stop(): void
  lastScannedBlock(): bigint | undefined
}

const DEFAULT_POLL_INTERVAL_MS = 3000
export const DEFAULT_MAX_BLOCK_RANGE = 2000n
const SHARED_BUFFER_LIMIT = 4096

interface SwapArgs {
  amount0: bigint
  amount1: bigint
  sqrtPriceX96: bigint
  liquidity: bigint
  tick: number
}

/**
 * Parse a decoded v3 `UniswapV3Pool.Swap` or v4 `PoolManager.Swap` log.
 */
export function parseSwapLog(log: DecodedLog, timestamp: bigint): PoolSwap {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) {
    throw new Error('Cannot parse a pending Swap log')
  }
  const args = log.args as SwapArgs
  return {
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    timestamp,
    transactionHash: log.transactionHash,
    tick: Number(args.tick),
    amount0: args.amount0,
    amount1: args.amount1,
    sqrtPriceX96: args.sqrtPriceX96,
    liquidity: args.liquidity,
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

async function fetchSwapLogs(
  client: PublicClient,
  pool: SwapPoolRef,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<DecodedLog[]> {
  if (pool.version === 'v3') {
    return client.getContractEvents({
      address: pool.poolAddress,
      abi: UniswapV3PoolAbi,
      eventName: 'Swap',
      fromBlock,
      toBlock,
    })
  }
  return client.getContractEvents({
    address: pool.poolManager,
    abi: poolManagerAbi,
    eventName: 'Swap',
    args: { id: pool.poolId },
    fromBlock,
    toBlock,
  })
}

async function fetchSwaps(
  client: PublicClient,
  pool: SwapPoolRef,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PoolSwap[]> {
  const logs = await fetchSwapLogs(client, pool, fromBlock, toBlock)
  if (logs.length === 0) return []

  const blockNumbers = [
    ...new Set(logs.flatMap((log) => (log.blockNumber === null ? [] : [log.blockNumber]))),
  ]
  const blocks = await Promise.all(
    blockNumbers.map((blockNumber) => client.getBlock({ blockNumber })),
  )
  const timestamps = new Map(blocks.map((block, i) => [blockNumbers[i], block.timestamp]))

  return logs
    .map((log) => parseSwapLog(log, timestamps.get(log.blockNumber ?? -1n) ?? 0n))
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    )
}

/**
 * Fetch a pool's swaps in `[fromBlock, toBlock]` (default: the current head), in
 * chain order. Returns no swaps when `fromBlock > toBlock`.
 */
export async function fetchPoolSwaps(
  client: PublicClient,
  pool: SwapPoolRef,
  fromBlock: bigint,
  toBlock?: bigint,
  maxBlockRange: bigint = DEFAULT_MAX_BLOCK_RANGE,
): Promise<{ swaps: PoolSwap[]; toBlock: bigint }> {
  const end = toBlock ?? (await client.getBlockNumber())
  const swaps: PoolSwap[] = []
  for (let from = fromBlock; from <= end; from += maxBlockRange) {
    const to = from + maxBlockRange - 1n < end ? from + maxBlockRange - 1n : end
    swaps.push(...(await fetchSwaps(client, pool, from, to)))
  }
  return { swaps, toBlock: end }
}

/**
 * Poll a single pool's `Swap` logs with `eth_getLogs`, timestamped by block.
 *
 * Works over plain HTTP (no filters or websockets). A chunk that fails is retried on
 * the next tick; errors never stop the loop.
 */
export function watchPoolSwaps(params: WatchPoolSwapsParams): PoolSwapWatcher {
  const {
    client,
    pool,
    fromBlock,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxBlockRange = DEFAULT_MAX_BLOCK_RANGE,
    onSwaps,
    onError,
  } = params

  let running = true
  let lastScanned: bigint | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const poll = async () => {
    try {
      const head = await client.getBlockNumber()
      let from = lastScanned !== undefined ? lastScanned + 1n : (fromBlock ?? head)
      while (running && from <= head) {
        const to = from + maxBlockRange - 1n < head ? from + maxBlockRange - 1n : head
        const swaps = await fetchSwaps(client, pool, from, to)
        if (!running) return
        if (swaps.length > 0) onSwaps(swaps, { fromBlock: from, toBlock: to })
        lastScanned = to
        from = to + 1n
      }
    } catch (error) {
      if (running) onError?.(toError(error))
    }
    if (running) timer = setTimeout(() => void poll(), pollIntervalMs)
  }

  void poll()

  return {
    stop() {
      running = false
      if (timer !== undefined) clearTimeout(timer)
    },
    lastScannedBlock: () => lastScanned,
  }
}

export interface SubscribePoolSwapsParams extends WatchPoolSwapsParams {
  key: string
  /** Relay SSE endpoint; when set the subscription streams and falls back to polling */
  streamUrl?: string
  onRemoved?: (key: PoolSwapKey) => void
  onTransport?: (transport: PoolSwapTransport) => void
}

interface SwapListener {
  onSwaps: WatchPoolSwapsParams['onSwaps']
  onError?: WatchPoolSwapsParams['onError']
  onRemoved?: SubscribePoolSwapsParams['onRemoved']
  onTransport?: SubscribePoolSwapsParams['onTransport']
}

interface SharedPoolSwapWatcher {
  watcher: PoolSwapWatcher
  listeners: Set<SwapListener>
  buffer: Map<string, PoolSwap>
  transport: PoolSwapTransport
}

const sharedWatchers = new Map<string, SharedPoolSwapWatcher>()

function swapKey(key: PoolSwapKey): string {
  return `${key.blockNumber}:${key.logIndex}`
}

/**
 * Ref-counted pool swap feed: subscribers with the same `key` share one watcher
 * (relay stream when `streamUrl` is set, else HTTP polling), duplicates are
 * dropped, late subscribers first receive the swaps already seen, and the watcher
 * stops when the last subscriber unsubscribes.
 */
export function subscribePoolSwaps(params: SubscribePoolSwapsParams): () => void {
  const { key, streamUrl, onSwaps, onError, onRemoved, onTransport, ...watchParams } = params
  const listener: SwapListener = { onSwaps, onError, onRemoved, onTransport }
  const existing = sharedWatchers.get(key)

  if (existing) {
    existing.listeners.add(listener)
    const buffered = [...existing.buffer.values()]
    const first = buffered[0]
    const last = buffered[buffered.length - 1]
    if (first && last) {
      onSwaps(buffered, { fromBlock: first.blockNumber, toBlock: last.blockNumber })
    }
    onTransport?.(existing.transport)
  } else {
    const listeners = new Set<SwapListener>([listener])
    const buffer = new Map<string, PoolSwap>()
    const entry: SharedPoolSwapWatcher = {
      watcher: { stop: () => undefined, lastScannedBlock: () => undefined },
      listeners,
      buffer,
      transport: 'off',
    }
    const setTransport = (transport: PoolSwapTransport) => {
      entry.transport = transport
      for (const l of listeners) l.onTransport?.(transport)
    }
    const callbacks = {
      onSwaps: (swaps: PoolSwap[], range: { fromBlock: bigint; toBlock: bigint }) => {
        const fresh = swaps.filter((swap) => !buffer.has(swapKey(swap)))
        if (fresh.length === 0) return
        for (const swap of fresh) buffer.set(swapKey(swap), swap)
        for (const k of buffer.keys()) {
          if (buffer.size <= SHARED_BUFFER_LIMIT) break
          buffer.delete(k)
        }
        for (const l of listeners) l.onSwaps(fresh, range)
      },
      onError: (error: Error) => {
        for (const l of listeners) l.onError?.(error)
      },
    }
    sharedWatchers.set(key, entry)
    if (streamUrl !== undefined) {
      entry.watcher = streamPoolSwaps({
        ...watchParams,
        ...callbacks,
        streamUrl,
        onRemoved: (removed) => {
          buffer.delete(swapKey(removed))
          for (const l of listeners) l.onRemoved?.(removed)
        },
        onTransport: setTransport,
      })
    } else {
      entry.watcher = watchPoolSwaps({ ...watchParams, ...callbacks })
      setTransport('poll')
    }
  }

  return () => {
    const entry = sharedWatchers.get(key)
    if (!entry) return
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0) {
      entry.watcher.stop()
      sharedWatchers.delete(key)
    }
  }
}
