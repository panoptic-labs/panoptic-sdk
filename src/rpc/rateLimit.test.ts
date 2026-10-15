import { afterEach, describe, expect, it, vi } from 'vitest'

import { rateLimitedRpcFetch } from './rateLimit'
import { rpcTransport } from './transport'

afterEach(() => vi.useRealTimers())

describe('RPC request budget', () => {
  it('paces concurrent callers and recovers after a failed fetch', async () => {
    vi.useFakeTimers()
    const starts: number[] = []
    const fetchFn = vi.fn(async () => {
      starts.push(Date.now())
      if (starts.length === 1) throw new Error('network failure')
      return new Response('{}')
    })
    const limited = rateLimitedRpcFetch(10, fetchFn)
    const completed = Promise.allSettled([
      limited('https://rpc.example'),
      limited('https://rpc.example'),
      limited('https://rpc.example'),
    ])
    await vi.runAllTimersAsync()
    const outcomes = await completed
    expect(outcomes.map((item) => item.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
    expect(starts.map((start) => start - (starts[0] ?? 0))).toEqual([0, 100, 200])
  })

  it('never sends a request cancelled while queued', async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn(async () => new Response('{}'))
    const limited = rateLimitedRpcFetch(10, fetchFn)
    const controller = new AbortController()
    const completed = Promise.allSettled([
      limited('https://rpc.example'),
      limited('https://rpc.example', { signal: controller.signal }),
      limited('https://rpc.example'),
    ])
    controller.abort()
    await vi.runAllTimersAsync()
    expect((await completed)[1]?.status).toBe('rejected')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('shares the budget across transport instances and their 429 retries', async () => {
    vi.useFakeTimers()
    const starts: number[] = []
    const fetchFn = vi.fn(async () => {
      starts.push(Date.now())
      return starts.length === 1
        ? new Response('throttled', { status: 429 })
        : Response.json({ jsonrpc: '2.0', id: 1, result: '0x1' })
    })
    const transport = rpcTransport([{ source: 'url', url: 'https://rpc.example', headers: {} }], {
      requestsPerSecond: 10,
      retryCount: 1,
      retryDelay: 0,
      fetchFn,
    })
    const first = transport({}).request({ method: 'eth_blockNumber' })
    const second = transport({}).request({ method: 'eth_chainId' })
    const completed = Promise.all([first, second])
    await vi.runAllTimersAsync()
    expect(await completed).toEqual(['0x1', '0x1'])
    expect(starts.map((start) => start - (starts[0] ?? 0))).toEqual([0, 100, 200])
  })

  it.each([0, -1, Infinity, NaN])('rejects an invalid request rate %s', (rate) => {
    expect(() => rateLimitedRpcFetch(rate)).toThrow('positive and finite')
  })
})
