import Decimal from 'decimal.js'
import type { PublicClient } from 'viem'
import { afterEach, expect, it, vi } from 'vitest'

import { getDailyFeeEstimate } from './dailyFeeEstimate'

const reads = vi.hoisted(() => ({ history: vi.fn() }))
vi.mock('../clients', () => ({ resolveBlockNumbers: async () => [100n] }))
vi.mock('./uniswapFeeHistory', () => ({ fetchUniswapFeeData: reads.history }))
afterEach(() => vi.clearAllMocks())
const client = {
  getBlock: async (args?: { blockNumber?: bigint }) =>
    args?.blockNumber === 100n
      ? { number: 100n, timestamp: 100n }
      : { number: 200n, timestamp: 86500n },
} as unknown as PublicClient
it.each([false, true])(
  'values mixed-token fee growth in the requested quote frame (token0 quote=%s)',
  async (quoteIsToken0) => {
    const tick = quoteIsToken0 ? 200000 : -200000
    const fee0 = quoteIsToken0 ? 2000000n : 10n ** 18n
    const fee1 = quoteIsToken0 ? 10n ** 18n : 2000000n
    reads.history.mockResolvedValue([
      { feeGrowthGlobal0: 0n, feeGrowthGlobal1: 0n },
      { currentTick: tick, feeGrowthGlobal0: fee0 << 128n, feeGrowthGlobal1: fee1 << 128n },
    ])
    const result = await getDailyFeeEstimate({
      client,
      poolConfig: { version: 'v3', poolAddress: '0x0000000000000000000000000000000000000001' },
      quoteIsToken0,
      legs: [
        { lowerTick: tick - 10, upperTick: tick + 10, liquidity: 2n, isLong: false },
        { lowerTick: tick - 20, upperTick: tick + 20, liquidity: 3n, isLong: true },
        { lowerTick: tick + 20, upperTick: tick + 30, liquidity: 3n, isLong: false },
      ],
    })
    const expected = new Decimal('1.0001').pow(-200000).mul('1000000000000000000').plus(2000000)
    expect(Number(result.perLeg[0]) / expected.mul(2).toNumber()).toBeCloseTo(1, 8)
    expect(Number(result.perLeg[1]) / expected.mul(-3).toNumber()).toBeCloseTo(1, 8)
    expect(result.perLeg[2]).toBe(0n)
    expect(reads.history).toHaveBeenCalledWith(
      client,
      [100n, 200n],
      [],
      expect.objectContaining({ version: 'v3' }),
    )
  },
)
it('handles v4 fee-growth rollover and normalizes a shorter window', async () => {
  const max = (1n << 256n) - 1n
  reads.history.mockResolvedValue([
    { feeGrowthGlobal0: 0n, feeGrowthGlobal1: max - (2n << 128n) + 1n },
    { currentTick: 0, feeGrowthGlobal0: 0n, feeGrowthGlobal1: 3n << 128n },
  ])
  const halfDayClient = {
    getBlock: async (args?: { blockNumber?: bigint }) =>
      args?.blockNumber === 100n
        ? { number: 100n, timestamp: 43300n }
        : { number: 200n, timestamp: 86500n },
  } as unknown as PublicClient
  const result = await getDailyFeeEstimate({
    client: halfDayClient,
    poolConfig: {
      version: 'v4',
      stateViewAddress: '0x0000000000000000000000000000000000000001',
      poolId: `0x${'00'.repeat(32)}`,
    },
    quoteIsToken0: false,
    legs: [{ lowerTick: -10, upperTick: 10, liquidity: 1n, isLong: false }],
  })
  expect(result.perLeg).toEqual([10n])
})
it('rejects missing history instead of inventing zero fees', async () => {
  reads.history.mockResolvedValue([])
  await expect(
    getDailyFeeEstimate({
      client,
      poolConfig: { version: 'v3', poolAddress: '0x0000000000000000000000000000000000000001' },
      quoteIsToken0: false,
      legs: [],
    }),
  ).rejects.toThrow('Insufficient on-chain fee history')
})
