import { type Client, decodeAbiParameters } from 'viem'
import { readContract } from 'viem/actions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'
import { buildManagerInputAtBlock } from './buildManagerInputAtBlock'

vi.mock('viem/actions', () => ({
  readContract: vi.fn(),
}))

describe('buildManagerInputAtBlock', () => {
  beforeEach(() => {
    vi.mocked(readContract).mockReset()
  })

  it('encodes manager input and reads TWAP at the requested block', async () => {
    vi.mocked(readContract).mockResolvedValue(123)

    const managerInput = await buildManagerInputAtBlock({
      viemClient: {} as Client,
      poolInfos: [
        {
          maxPriceDeviation: 100,
          pool: '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78',
          token0: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
          token1: '0xFFFeD8254566B7F800f6D8CDb843ec75AE49B07A',
        },
      ],
      tokenIds: [[]],
      underlyingToken: '0xFFFeD8254566B7F800f6D8CDb843ec75AE49B07A',
      blockNumber: 42n,
    })

    expect(vi.mocked(readContract)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(readContract)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        functionName: 'getTWAP',
        blockNumber: 42n,
      }),
    )

    const [managerPrices, poolInfos, tokenIds] = decodeAbiParameters(
      PanopticVaultAccountantManagerInputAbi,
      managerInput,
    )

    expect(managerPrices[0]).toEqual({
      poolPrice: 123,
      token0Price: 123,
      token1Price: 0,
    })
    expect(poolInfos[0].pool.toLowerCase()).toBe('0x2aafc1d2af4deb9fd8b02cde5a8c0922ca4d6c78')
    expect(tokenIds).toEqual([[]])
  })
})
