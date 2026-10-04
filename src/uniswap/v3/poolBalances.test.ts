import type { Address, PublicClient } from 'viem'
import { expect, it, vi } from 'vitest'

import { getUniswapV3PoolBalances } from './poolBalances'

const address = (digit: string) => `0x${digit.repeat(40)}` as Address

it('reads both pool token balances at one block, preserves zeros, and omits partial failures', async () => {
  const pools = ['1', '2', '3'].map((digit) => ({
    id: address(digit),
    token0: address('a'),
    token1: address('b'),
  }))
  const multicall = vi.fn().mockResolvedValue([
    { status: 'success', result: 1000000n },
    { status: 'success', result: 10n ** 18n },
    { status: 'success', result: 0n },
    { status: 'success', result: 0n },
    { status: 'success', result: 1n },
    { status: 'failure', error: new Error('unavailable') },
  ])
  const client = {
    getBlockNumber: vi.fn().mockResolvedValue(123n),
    multicall,
  } as unknown as PublicClient
  const result = await getUniswapV3PoolBalances({ client, pools })
  expect(result.get(pools[0].id)).toEqual({ amount0: 1000000n, amount1: 10n ** 18n })
  expect(result.get(pools[1].id)).toEqual({ amount0: 0n, amount1: 0n })
  expect(result.has(pools[2].id)).toBe(false)
  expect(multicall).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 123n }))
  expect(multicall.mock.calls[0]?.[0].contracts).toHaveLength(6)
})
