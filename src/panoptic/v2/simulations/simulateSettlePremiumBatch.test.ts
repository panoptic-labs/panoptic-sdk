import { describe, expect, it, vi } from 'vitest'

import { simulateSettlePremiumBatch, simulateSettleSequence } from './simulateSettlePremiumBatch'

vi.mock('../clients', () => ({
  getBlockMeta: vi
    .fn()
    .mockResolvedValue({ blockNumber: 1n, blockTimestamp: 0n, blockHash: '0x0' }),
}))

const simulateSettlePremiumFrom = vi.hoisted(() => vi.fn())
vi.mock('./simulateSettlePremiumFrom', () => ({ simulateSettlePremiumFrom }))

const simulateWithTokenFlow = vi.hoisted(() => vi.fn())
vi.mock('./tokenFlow', () => ({ simulateWithTokenFlow }))

const account = '0x0000000000000000000000000000000000000001' as `0x${string}`
const poolAddress = '0x0000000000000000000000000000000000000002' as `0x${string}`
const USER_A = '0x0000000000000000000000000000000000000003' as `0x${string}`
const USER_B = '0x0000000000000000000000000000000000000004' as `0x${string}`

const client = { getBlockNumber: vi.fn().mockResolvedValue(1n) } as never

const meta = { blockNumber: 1n, blockTimestamp: 0n, blockHash: '0x0' }

describe('simulateSettlePremiumBatch', () => {
  it('partitions settleable and unsettleable targets and sums premium', async () => {
    simulateSettlePremiumFrom
      .mockResolvedValueOnce({
        success: true,
        data: { premium0: 10n, premium1: 20n, canSettle: true },
        gasEstimate: 0n,
        _meta: meta,
      })
      .mockResolvedValueOnce({
        success: true,
        data: { premium0: 0n, premium1: 0n, canSettle: false, reason: 'insolvent' },
        gasEstimate: 0n,
        _meta: meta,
      })

    const targetA = { user: USER_A, positionIdList: [1n], tokenId: 1n }
    const targetB = { user: USER_B, positionIdList: [2n], tokenId: 2n }
    const result = await simulateSettlePremiumBatch({
      client,
      poolAddress,
      account,
      positionIdListFrom: [9n],
      targets: [targetA, targetB],
    })

    expect(result.settleable).toEqual([targetA])
    expect(result.unsettleableCount).toBe(1)
    expect(result.premium0).toBe(10n)
    expect(result.premium1).toBe(20n)
    expect(result.results).toHaveLength(2)
    expect(result.results[1].simulation.reason).toBe('insolvent')

    // All targets simulated at the same block
    for (const call of simulateSettlePremiumFrom.mock.calls) {
      expect(call[0].blockNumber).toBe(1n)
    }
  })

  it('treats a hard-failed target simulation as unsettleable', async () => {
    simulateSettlePremiumFrom.mockResolvedValueOnce({
      success: false,
      error: new Error('boom'),
      _meta: meta,
    })

    const result = await simulateSettlePremiumBatch({
      client,
      poolAddress,
      account,
      positionIdListFrom: [],
      targets: [{ user: USER_A, positionIdList: [1n], tokenId: 1n }],
    })

    expect(result.settleable).toEqual([])
    expect(result.unsettleableCount).toBe(1)
    expect(result.results[0].simulation.canSettle).toBe(false)
  })
})

describe('simulateSettleSequence', () => {
  it("returns the caller's net flow for the whole multicall", async () => {
    simulateWithTokenFlow.mockResolvedValueOnce({
      success: true,
      tokenFlow: {
        delta0: 100n,
        delta1: -5n,
        balanceBefore0: 0n,
        balanceBefore1: 0n,
        balanceAfter0: 100n,
        balanceAfter1: 0n,
        tickBefore: null,
        tickAfter: null,
      },
      gasEstimate: 500000n,
    })

    const result = await simulateSettleSequence({
      client,
      poolAddress,
      account,
      positionIdListFrom: [9n],
      targets: [{ user: USER_A, positionIdList: [1n], tokenId: 1n }],
      close: {
        tokenId: 9n,
        finalPositionIdList: [],
        tickLimitLow: -100n,
        tickLimitHigh: 100n,
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toEqual({ delta0: 100n, delta1: -5n })
    expect(result.gasEstimate).toBe(500000n)
    expect(simulateWithTokenFlow.mock.calls[0][0].user).toBe(account)
  })

  it('returns a failed result when the sequence reverts', async () => {
    simulateWithTokenFlow.mockResolvedValueOnce({ success: false, error: 'revert' })

    const result = await simulateSettleSequence({
      client,
      poolAddress,
      account,
      positionIdListFrom: [],
      targets: [{ user: USER_A, positionIdList: [1n], tokenId: 1n }],
    })

    expect(result.success).toBe(false)
  })
})
