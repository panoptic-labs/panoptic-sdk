import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getStkAaveHoldings } from './stkAave'

const account = '0x0000000000000000000000000000000000000001'
const receipt = '0x4da27a545c0c5B758a6BA100e3a049001de870f5'
const aave = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'

function mockClient(shares: bigint, rewards: bigint, staked = shares) {
  const multicall = vi
    .fn()
    .mockResolvedValueOnce([shares, rewards])
    .mockResolvedValueOnce([staked, account])
    .mockResolvedValueOnce([16700000000n, 100000000n])
  const client = {
    getBlockNumber: vi.fn().mockResolvedValue(123n),
    multicall,
  } as unknown as PublicClient
  return { client, multicall }
}

describe('stkAAVE holdings', () => {
  it('uses redeemable underlying after slashing, preserves precision, and pins reads to one block', async () => {
    const shares = 612514395480000000000n
    const staked = 600000000000000000001n
    const rewards = 9761581395635018680n
    const { client, multicall } = mockClient(shares, rewards, staked)
    const result = await getStkAaveHoldings({ client, account })
    expect(result).toEqual({
      address: aave,
      symbol: 'AAVE',
      decimals: 18,
      shares,
      staked,
      rewards,
      price: 16700000000n,
      priceUnit: 100000000n,
      receiptTokens: [receipt],
      blockNumber: 123n,
    })
    expect(multicall.mock.calls[1][0].contracts[0]).toMatchObject({
      functionName: 'previewRedeem',
      args: [shares],
    })
    for (const [args] of multicall.mock.calls) {
      expect(args.blockNumber).toBe(123n)
      expect(args.allowFailure).toBe(false)
    }
  })

  it('retains claimable rewards after all shares have been redeemed', async () => {
    const { client } = mockClient(0n, 1000000000000000000n)
    expect(await getStkAaveHoldings({ client, account })).toMatchObject({
      shares: 0n,
      staked: 0n,
      rewards: 1000000000000000000n,
      price: 16700000000n,
    })
  })

  it('skips valuation reads for an empty account', async () => {
    const { client, multicall } = mockClient(0n, 0n)
    expect(await getStkAaveHoldings({ client, account })).toMatchObject({ staked: 0n, rewards: 0n })
    expect(multicall).toHaveBeenCalledTimes(1)
  })

  it('propagates failed reads instead of reporting an empty holding', async () => {
    const { client, multicall } = mockClient(1n, 0n)
    multicall.mockReset().mockRejectedValue(new Error('RPC unavailable'))
    await expect(getStkAaveHoldings({ client, account })).rejects.toThrow('RPC unavailable')
  })
})
