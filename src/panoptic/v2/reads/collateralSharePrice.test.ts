/**
 * Tests for getCollateralSharePrices.
 * @module v2/reads/collateralSharePrice.test
 */

import type { Client } from 'viem'
import { ContractFunctionExecutionError } from 'viem'
import { multicall } from 'viem/actions'
import { describe, expect, it, vi } from 'vitest'

import { getCollateralSharePrices } from './collateralSharePrice'

vi.mock('viem/actions', () => ({
  multicall: vi.fn(),
}))

const CT0 = '0x3333333333333333333333333333333333333333' as const
const CT1 = '0x4444444444444444444444444444444444444444' as const
const client = {} as Client

describe('getCollateralSharePrices', () => {
  it('should return totalAssets and totalSupply for both trackers', async () => {
    vi.mocked(multicall).mockResolvedValue([1_000_000n, 900_000n, 2_000_000n, 1_800_000n])

    const [data0, data1] = await getCollateralSharePrices([CT0, CT1], 100n, client)

    expect(data0.totalAssets).toBe(1_000_000n)
    expect(data0.totalSupply).toBe(900_000n)
    expect(data1.totalAssets).toBe(2_000_000n)
    expect(data1.totalSupply).toBe(1_800_000n)
  })

  it('should return zeros when contract reverts (uninitialized)', async () => {
    const error = Object.create(ContractFunctionExecutionError.prototype)
    vi.mocked(multicall).mockRejectedValue(error)

    const [data0, data1] = await getCollateralSharePrices([CT0, CT1], 100n, client)

    expect(data0.totalAssets).toBe(0n)
    expect(data0.totalSupply).toBe(0n)
    expect(data1.totalAssets).toBe(0n)
    expect(data1.totalSupply).toBe(0n)
  })

  it('should re-throw non-contract errors', async () => {
    vi.mocked(multicall).mockRejectedValue(new Error('network error'))

    await expect(getCollateralSharePrices([CT0, CT1], 100n, client)).rejects.toThrow(
      'network error',
    )
  })
})
