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
        // 5% supply / 10% variable borrow APR, in ray.
        if (functionName === 'getReserveData')
          return [0n, 0n, 0n, 0n, 0n, 5n * 10n ** 25n, 10n ** 26n, 0n, 0n, 0n, 0n, 0]
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
    expect(result.holdings[0].supplyApyPct).toBeCloseTo(5.127, 2)
    // 3 stable at a 0% stable rate, 4 variable at 10%.
    expect(result.holdings[0].borrowApyPct).toBeCloseTo((10.517 * 4) / 7, 2)
  })
  it('weights legacy stable debt at the user stable rate', async () => {
    const readContract = vi
      .fn()
      .mockImplementation(async ({ functionName }: { functionName: string }) => {
        if (functionName === 'getAllReservesTokens')
          return [{ symbol: 'USDC', tokenAddress: account }]
        if (functionName === 'getAllATokens') return []
        if (functionName === 'BASE_CURRENCY_UNIT') return 100000000n
        if (functionName === 'getAssetPrice') return 100000000n
        if (functionName === 'decimals') return 6
        // 0% variable borrow APR.
        if (functionName === 'getReserveData')
          return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0]
        throw new Error('Unexpected read')
      })
    const multicall = vi
      .fn()
      .mockResolvedValueOnce([account, account])
      // 1 stable at a 10% APR, 3 variable.
      .mockResolvedValueOnce([[0n, 1n, 3n, 0n, 0n, 10n ** 26n, 0n, 0n, true]])
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(123n),
      readContract,
      multicall,
    } as unknown as PublicClient
    const result = await getAaveHoldings({ client, provider: account, account })
    expect(result.holdings[0].borrowApyPct).toBeCloseTo(10.517 / 4, 2)
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
