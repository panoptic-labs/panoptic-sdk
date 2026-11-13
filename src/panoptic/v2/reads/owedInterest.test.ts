import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getOwedInterest } from './collateral'

const account = '0x0000000000000000000000000000000000000001'
const collateralTracker = '0x0000000000000000000000000000000000000002'

describe('getOwedInterest', () => {
  it.each([0n, 123456n])(
    'reads the exact currently unpaid amount %s at the requested block',
    async (owed) => {
      const readContract = vi.fn().mockResolvedValue(owed)
      const client = { readContract } as unknown as PublicClient
      expect(await getOwedInterest({ client, collateralTracker, account, blockNumber: 42n })).toBe(
        owed,
      )
      expect(readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: collateralTracker,
          functionName: 'previewOwedInterest',
          args: [account],
          blockNumber: 42n,
        }),
      )
    },
  )

  it('does not replace an unavailable interest read with zero', async () => {
    const client = {
      readContract: vi.fn().mockRejectedValue(new Error('RPC unavailable')),
    } as unknown as PublicClient
    await expect(getOwedInterest({ client, collateralTracker, account })).rejects.toThrow(
      'RPC unavailable',
    )
  })
})
