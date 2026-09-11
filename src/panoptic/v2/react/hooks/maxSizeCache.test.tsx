// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { PublicClient } from 'viem'
import { expect, it, vi } from 'vitest'

import type * as Reads from '../../reads'
import { getMaxPositionSize } from '../../reads'
import { PanopticProvider } from '../provider'
import { useMaxPositionSize } from './reads'

vi.mock('../../reads', async (original) => ({
  ...(await original<typeof Reads>()),
  getMaxPositionSize: vi.fn(),
}))

it('cancels obsolete mode refinement and reuses its mode-independent bounds', async () => {
  const pool = '0x1111111111111111111111111111111111111111'
  const bounds = {
    maxSize: 100n,
    maxSizeAtMinUtil: 200n,
    maxSizeAtMaxUtil: 100n,
    _meta: { blockNumber: 1n, blockHash: '0x01' as const, blockTimestamp: 1n },
  }
  let aborted = false
  vi.mocked(getMaxPositionSize).mockImplementation(async (params) => {
    if (params.refine === false || params.swapAtMint) return bounds
    return new Promise((_, reject) => {
      params.signal?.addEventListener(
        'abort',
        () => {
          aborted = true
          reject(params.signal?.reason)
        },
        { once: true },
      )
    })
  })
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const client = {} as PublicClient
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={cache}>
        <PanopticProvider publicClient={client} chainId={1n}>
          {children}
        </PanopticProvider>
      </QueryClientProvider>
    )
  }
  const hook = renderHook(
    ({ swapAtMint }) =>
      useMaxPositionSize(pool, 1n, pool, pool, { swapAtMint, existingPositionIds: [] }),
    { wrapper, initialProps: { swapAtMint: false } },
  )
  await waitFor(() => expect(getMaxPositionSize).toHaveBeenCalledTimes(2))
  hook.rerender({ swapAtMint: true })
  await waitFor(() => expect(hook.result.current.data?.maxSize).toBe(100n))
  expect(aborted).toBe(true)
  expect(
    vi.mocked(getMaxPositionSize).mock.calls.filter(([params]) => params.refine === false),
  ).toHaveLength(1)
  hook.unmount()
  cache.clear()
})
