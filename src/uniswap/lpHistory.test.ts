import { GraphQLClient } from 'graphql-request'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getLpPositionHistory, summarizeLpPositionHistory } from './lpHistory'

const hash = `0x${'ab'.repeat(32)}`
const recipient = `0x${'12'.repeat(20)}`
const raw = (index: number) => ({
  id: String(index).padStart(6, '0'),
  hash,
  amount0: '10',
  amount1: '20',
  blockNumber: '100',
  timestamp: '1000',
  logIndex: String(index),
})
const change = (index: number) => ({
  ...raw(index),
  eventType: 'Mint',
  liquidity: '1',
  amountSource: 'ExactEvent',
})
const page = (
  changes: ReturnType<typeof change>[],
  collects: (ReturnType<typeof raw> & { recipient: string })[] = [],
  liquidity = String(changes.length),
) => ({
  _meta: { block: { number: 200, hash }, hasIndexingErrors: false },
  uniswapLpPosition: { version: 3, liquidity, liquidityChanges: changes, collects },
})
const input = { url: 'https://example.com/graphql', positionId: 'v3-1' }
afterEach(() => vi.restoreAllMocks())

describe('LP event history', () => {
  it('paginates both event streams at the first indexed block and sorts by log order', async () => {
    const request = vi
      .spyOn(GraphQLClient.prototype, 'request')
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 1000 }, (_, i) => change(i + 1)),
          [{ ...raw(0), recipient }],
          '1001',
        ),
      )
      .mockResolvedValueOnce(page([change(1001)], [], '1001'))
    const result = await getLpPositionHistory(input)
    expect(result.events).toHaveLength(1002)
    expect(result.events[0].eventType).toBe('Collect')
    expect(result.events.at(-1)?.logIndex).toBe(1001n)
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        block: { hash },
        changeCursor: '001000',
        collectCursor: '000000',
      }),
    )
    expect(result.blockNumber).toBe(200n)
  })

  it('loads a further page when only collections exceed the page size', async () => {
    const request = vi
      .spyOn(GraphQLClient.prototype, 'request')
      .mockResolvedValueOnce(
        page(
          [change(0)],
          Array.from({ length: 1000 }, (_, i) => ({ ...raw(i + 1), recipient })),
        ),
      )
      .mockResolvedValueOnce(page([], [{ ...raw(1001), recipient }], '1'))
    const result = await getLpPositionHistory(input)
    expect(result.events).toHaveLength(1002)
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        block: { hash },
        changeCursor: '000000',
        collectCursor: '001000',
      }),
    )
  })

  it('does not return partial results after a later page fails', async () => {
    vi.spyOn(GraphQLClient.prototype, 'request')
      .mockResolvedValueOnce(page(Array.from({ length: 1000 }, (_, i) => change(i))))
      .mockRejectedValueOnce(new Error('Unavailable'))
    await expect(getLpPositionHistory(input)).rejects.toThrow('Unavailable')
  })

  it('rejects indexing errors, missing liquidity events, and malformed amounts', async () => {
    const request = vi.spyOn(GraphQLClient.prototype, 'request')
    request.mockResolvedValueOnce({
      ...page([change(0)]),
      _meta: { block: { number: 200, hash }, hasIndexingErrors: true },
    })
    await expect(getLpPositionHistory(input)).rejects.toThrow('indexing is incomplete')
    request.mockResolvedValueOnce(page([change(0)], [], '2'))
    await expect(getLpPositionHistory(input)).rejects.toThrow('liquidity history is incomplete')
    request.mockResolvedValueOnce(page([{ ...change(0), amount0: '-1' }]))
    await expect(getLpPositionHistory(input)).rejects.toThrow()
  })

  it('retains v4 amount provenance and keeps unknown amounts out of totals', async () => {
    vi.spyOn(GraphQLClient.prototype, 'request').mockResolvedValue({
      ...page([]),
      uniswapLpPosition: {
        version: 4,
        liquidity: '3',
        collects: [],
        liquidityChanges: [
          { ...change(0), amountSource: 'ExactSameTxSwap' },
          { ...change(1), amountSource: 'ApproxExtsload' },
          { ...change(2), amountSource: 'Unavailable', amount0: '0', amount1: '0' },
        ],
      },
    })
    const result = await getLpPositionHistory({ ...input, positionId: 'v4-1' })
    expect(summarizeLpPositionHistory(result.events).added.amount0).toBeNull()
    expect(summarizeLpPositionHistory(result.events.slice(0, 2)).added).toEqual({
      amount0: 20n,
      amount1: 40n,
      estimated: true,
    })
  })
})
