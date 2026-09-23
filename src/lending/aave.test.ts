import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getAaveHoldings } from './aave'

const account = '0x0000000000000000000000000000000000000001'
const receipt = '0x0000000000000000000000000000000000000002'

describe('Aave holdings', () => {
  it('reads accrued balances at one block and returns receipt tokens for deduplication', async () => {
    const readContract = vi
      .fn()
      .mockImplementation(async ({ functionName }: { functionName: string }) => {
        if (functionName === 'getAllReservesTokens')
          return [{ symbol: 'USDC', tokenAddress: account }]
        if (functionName === 'getAllATokens') return [{ symbol: 'aUSDC', tokenAddress: receipt }]
        if (functionName === 'BASE_CURRENCY_UNIT') return '100000000'
        if (functionName === 'getAssetPrice') return 100000000
        if (functionName === 'decimals') return '6'
        throw new Error('Unexpected read')
      })
    const multicall = vi
      .fn()
      .mockResolvedValueOnce([account, account])
      .mockResolvedValueOnce([[9007199254740993n, 3n, 4n, 0n, 0n, 0n, 0n, 0n, true]])
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(123n),
      readContract,
      multicall,
    } as unknown as PublicClient
    const result = await getAaveHoldings({ client, provider: account, account })
    expect(result.holdings[0]).toMatchObject({ supplied: 9007199254740993n, debt: 7n, decimals: 6 })
    expect(result.receiptTokens).toEqual([receipt])
    expect(result.holdings[0].price).toBe(100000000n)
    expect(result.holdings[0].priceUnit).toBe(100000000n)
    expect(result.blockNumber).toBe(123n)
    for (const [args] of [...readContract.mock.calls, ...multicall.mock.calls])
      expect(args.blockNumber).toBe(123n)
  })
  it('propagates failed reserves rather than returning an empty account', async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(123n),
      multicall: vi.fn().mockRejectedValue(new Error('RPC failed')),
    } as unknown as PublicClient
    await expect(getAaveHoldings({ client, provider: account, account })).rejects.toThrow(
      'RPC failed',
    )
  })
  it('rejects unsafe numeric RPC values', async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(Number.MAX_SAFE_INTEGER + 1),
    } as unknown as PublicClient
    await expect(getAaveHoldings({ client, provider: account, account })).rejects.toThrow(
      'Expected an unsigned bigint-compatible value',
    )
  })
})
