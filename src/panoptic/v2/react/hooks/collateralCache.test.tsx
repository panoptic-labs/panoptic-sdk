// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { PublicClient } from 'viem'
import { expect, it, vi } from 'vitest'

import type * as Reads from '../../reads'
import { getCollateralRequiredBase } from '../../reads'
import { PanopticProvider } from '../provider'
import { useEstimateCollateralRequired } from './reads'

vi.mock('../../reads', async (original) => ({
  ...(await original<typeof Reads>()),
  getCollateralRequiredBase: vi.fn(),
}))

it('shares the raw requirement across accounts and sizes, but isolates ticks', async () => {
  const pool = '0x1111111111111111111111111111111111111111'
  const otherAccount = '0x2222222222222222222222222222222222222222'
  vi.mocked(getCollateralRequiredBase).mockResolvedValue({
    requiredBase: (1n << 64n) - 1n,
    effectiveTick: 0n,
    _meta: { blockNumber: 1n, blockHash: '0x01', blockTimestamp: 1n },
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
    ({ size, account, tick }) =>
      useEstimateCollateralRequired(pool, 1n, size, pool, account, {
        atTick: tick,
        staleTime: 2000,
      }),
    {
      wrapper,
      initialProps: { size: 10n, account: pool as `0x${string}`, tick: 0n },
    },
  )
  await waitFor(() => expect(hook.result.current.data?.required1).toBe(10n))
  hook.rerender({ size: 20n, account: otherAccount, tick: 0n })
  await waitFor(() => expect(hook.result.current.data?.required1).toBe(20n))
  expect(getCollateralRequiredBase).toHaveBeenCalledTimes(1)
  hook.rerender({ size: 20n, account: otherAccount, tick: 1n })
  await waitFor(() => expect(getCollateralRequiredBase).toHaveBeenCalledTimes(2))
  hook.unmount()
  cache.clear()
})
