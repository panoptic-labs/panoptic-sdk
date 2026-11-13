import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getMaxWithdrawable } from './collateralEstimate'

const tracker = '0x1111111111111111111111111111111111111111'
const account = '0x2222222222222222222222222222222222222222'
const block = { number: 100n, timestamp: 1000n, hash: `0x${'1'.repeat(64)}` }

function clientWithLimit(limit: bigint) {
  const estimateContractGas = vi.fn(async ({ args }: { args: [bigint, ...unknown[]] }) => {
    if (args[0] > limit) throw new Error('insufficient collateral')
    return 100000n
  })
  const client = {
    getBlockNumber: vi.fn().mockResolvedValue(block.number),
    getBlock: vi.fn().mockResolvedValue(block),
    estimateContractGas,
    readContract: vi.fn().mockResolvedValue(limit),
  } as unknown as PublicClient
  return { client, estimateContractGas }
}

describe('maximum withdrawal for an advance', () => {
  it('returns the full requested advance when its boundary simulation succeeds', async () => {
    const { client, estimateContractGas } = clientWithLimit(10000000n)
    const result = await getMaxWithdrawable({
      client,
      collateralTrackerAddress: tracker,
      account,
      totalAssets: 10000000n,
      positionIdList: [11n, 22n],
    })
    expect(result.maxWithdrawable).toBe(10000000n)
    expect(estimateContractGas).toHaveBeenCalledOnce()
    expect(estimateContractGas.mock.calls[0]?.[0].args).toEqual([
      10000000n,
      account,
      account,
      [11n, 22n],
      false,
    ])
  })
  it('falls back to a conservative solvency search when the full amount fails', async () => {
    const { client } = clientWithLimit(6500000n)
    const { maxWithdrawable } = await getMaxWithdrawable({
      client,
      collateralTrackerAddress: tracker,
      account,
      totalAssets: 10000000n,
      positionIdList: [11n, 22n],
    })
    expect(maxWithdrawable).toBeLessThanOrEqual(6500000n)
    expect(maxWithdrawable).toBeGreaterThan(6400000n)
  })
  it('keeps the normal maxWithdraw path when there are no positions', async () => {
    const { client, estimateContractGas } = clientWithLimit(500n)
    const result = await getMaxWithdrawable({
      client,
      collateralTrackerAddress: tracker,
      account,
      totalAssets: 1000n,
      positionIdList: [],
    })
    expect(result.maxWithdrawable).toBe(500n)
    expect(estimateContractGas).not.toHaveBeenCalled()
  })
})
