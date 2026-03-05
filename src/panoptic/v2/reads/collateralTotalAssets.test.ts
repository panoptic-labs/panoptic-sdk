/**
 * Tests for getCollateralTotalAssetsBatch.
 * @module v2/reads/collateralTotalAssets.test
 */

import type { Client } from 'viem'
import { multicall } from 'viem/actions'
import { describe, expect, it, vi } from 'vitest'

import { getCollateralTotalAssetsBatch } from './collateralTotalAssets'

vi.mock('viem/actions', () => ({
  multicall: vi.fn(),
}))

const CT0 = '0x3333333333333333333333333333333333333333' as const
const CT1 = '0x4444444444444444444444444444444444444444' as const
const client = {} as Client

describe('getCollateralTotalAssetsBatch', () => {
  it('should return empty array for empty input', async () => {
    const result = await getCollateralTotalAssetsBatch(client, [], 1)
    expect(result).toEqual([])
  })

  it('should return totalAssets for multiple trackers', async () => {
    vi.mocked(multicall).mockResolvedValue([5_000_000n, 3_000_000n])

    const result = await getCollateralTotalAssetsBatch(client, [CT0, CT1], 1)

    expect(result).toEqual([5_000_000n, 3_000_000n])
  })

  it('should pass blockNumber to multicall when provided', async () => {
    vi.mocked(multicall).mockResolvedValue([1n])

    await getCollateralTotalAssetsBatch(client, [CT0], 1, 999n)

    expect(multicall).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        blockNumber: 999n,
        allowFailure: false,
      }),
    )
  })

  it('should return zeros on error', async () => {
    vi.mocked(multicall).mockRejectedValue(new Error('rpc error'))

    const result = await getCollateralTotalAssetsBatch(client, [CT0, CT1], 1)

    expect(result).toEqual([0n, 0n])
  })
})
