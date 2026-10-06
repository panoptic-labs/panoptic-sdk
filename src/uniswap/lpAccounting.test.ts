import { describe, expect, it } from 'vitest'

import { calculateV3LpAccounting } from './lpAccounting'

const hash = `0x${'ab'.repeat(32)}`
const mint = (blockNumber: bigint, amount0: bigint, amount1: bigint) => ({
  id: blockNumber.toString(),
  hash,
  blockNumber,
  logIndex: 0n,
  timestamp: blockNumber,
  eventType: 'Mint' as const,
  liquidity: 100n,
  amount0,
  amount1,
  amountSource: 'ExactEvent' as const,
})
const collect = (blockNumber: bigint, amount0: bigint, amount1: bigint) => ({
  id: blockNumber.toString(),
  hash,
  blockNumber,
  logIndex: 0n,
  timestamp: blockNumber,
  eventType: 'Collect' as const,
  recipient: `0x${'12'.repeat(20)}`,
  amount0,
  amount1,
  amountSource: 'ExactEvent' as const,
})
const q96 = 1n << 96n
const input = {
  events: [
    mint(1n, 100n, 100n),
    mint(2n, 10n, 40n),
    { ...mint(3n, 50n, 60n), eventType: 'Burn' as const },
    collect(4n, 30n, 40n),
  ],
  inventory: { amount0: 60n, amount1: 80n },
  claimable: { amount0: 25n, amount1: 30n },
  prices: [1n, 2n, 4n, 5n].map((blockNumber) => ({
    blockNumber,
    sqrtPriceX96: blockNumber === 1n ? q96 : q96 * 2n,
  })),
  endBlock: 5n,
  token0Decimals: 0,
  token1Decimals: 0,
}

describe('v3 historical accounting', () => {
  it('reconciles partial collects and pending withdrawn principal without counting removals twice', () => {
    const result = calculateV3LpAccounting(input)
    expect(result.fees0).toBe(5n)
    expect(result.fees1).toBe(10n)
    expect(result.quote1.pnl).toBe('330')
    expect(result.quote0.pnl).toBe('-67.5')
    expect(result.quote1.deposited).toBe('280')
    expect(result.quote0.deposited).toBe('220')
  })

  it('handles mixed decimals and computes each quote frame independently', () => {
    const result = calculateV3LpAccounting({ ...input, token0Decimals: 18, token1Decimals: 6 })
    expect(Number(result.quote0.pnl)).toBeCloseTo(-67.5e-18, 25)
    expect(Number(result.quote1.pnl)).toBeCloseTo(330e-6, 10)
    expect(Number(result.quote1.pnlPercent)).toBeCloseTo((330 / 280) * 100, 10)
  })

  it('reconciles a closed position after a full withdrawal and collect', () => {
    const result = calculateV3LpAccounting({
      ...input,
      events: [
        mint(1n, 100n, 100n),
        { ...mint(2n, 100n, 100n), eventType: 'Burn' },
        collect(4n, 105n, 110n),
      ],
      inventory: { amount0: 0n, amount1: 0n },
      claimable: { amount0: 0n, amount1: 0n },
    })
    expect(result.fees0).toBe(5n)
    expect(result.fees1).toBe(10n)
    expect(result.quote1.pnl).toBe('330')
  })

  it('rejects incomplete pricing, future events, and unreconciled principal', () => {
    expect(() => calculateV3LpAccounting({ ...input, prices: [] })).toThrow(
      'Historical price unavailable',
    )
    expect(() => calculateV3LpAccounting({ ...input, endBlock: 2n })).toThrow('exact v3 history')
    expect(() =>
      calculateV3LpAccounting({ ...input, claimable: { amount0: 0n, amount1: 0n } }),
    ).toThrow('does not reconcile')
  })
})
