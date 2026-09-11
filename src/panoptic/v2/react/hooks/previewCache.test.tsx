// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Address, PublicClient } from 'viem'
import { expect, it, vi } from 'vitest'

import { PanopticError } from '../../errors'
import { getAccountBuyingPower, getPoolCollateralAddresses } from '../../reads/buyingPower'
import { simulateOpenPosition } from '../../simulations/simulateOpenPosition'
import { PanopticProvider } from '../provider'
import { useOpenPositionPreview } from './reads'

vi.mock('../../reads/buyingPower', () => ({
  getAccountBuyingPower: vi.fn(),
  getPoolCollateralAddresses: vi.fn(),
}))
vi.mock('../../simulations/simulateOpenPosition', () => ({ simulateOpenPosition: vi.fn() }))

it('shares account snapshots across strikes and isolates account, client scope, and block', async () => {
  const pool = '0x1111111111111111111111111111111111111111'
  const other = '0x2222222222222222222222222222222222222222'
  const metadata = { blockNumber: 100n, blockHash: '0x01' as const, blockTimestamp: 1n }
  vi.mocked(getPoolCollateralAddresses).mockResolvedValue({
    collateralToken0: pool,
    collateralToken1: other,
  })
  vi.mocked(getAccountBuyingPower).mockImplementation(async ({ blockNumber }) => ({
    collateralBalance0: 100n,
    collateralBalance1: 100n,
    requiredCollateral0: 0n,
    requiredCollateral1: 0n,
    _meta: { ...metadata, blockNumber: blockNumber ?? 100n },
  }))
  vi.mocked(simulateOpenPosition).mockResolvedValue({
    success: false,
    error: new PanopticError('test revert'),
    _meta: metadata,
  })
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const client = {} as PublicClient
  const mount = (tokenId: bigint, account: Address, scope: string, blockNumber = 100n) => {
    function wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={cache}>
          <PanopticProvider publicClient={client} chainId={1n} clientScope={scope}>
            {children}
          </PanopticProvider>
        </QueryClientProvider>
      )
    }
    return renderHook(
      () =>
        useOpenPositionPreview(pool, account, [], tokenId, 10n, pool, -1000n, 1000n, {
          blockNumber,
          estimateGas: false,
        }),
      { wrapper },
    )
  }
  for (const [token, account, scope, block] of [
    [1n, pool, 'a', 100n],
    [2n, pool, 'a', 100n],
    [3n, other, 'a', 100n],
    [4n, pool, 'b', 100n],
    [5n, pool, 'a', 101n],
  ] as const) {
    const hook = mount(token, account, scope, block)
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))
    hook.unmount()
  }
  expect(getAccountBuyingPower).toHaveBeenCalledTimes(4)
  expect(getPoolCollateralAddresses).toHaveBeenCalledTimes(2)
  expect(simulateOpenPosition).toHaveBeenLastCalledWith(
    expect.objectContaining({ blockNumber: 101n, estimateGas: false }),
  )
  cache.clear()
})
