import { type Client, decodeAbiParameters } from 'viem'
import { readContract } from 'viem/actions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'
import { buildManagerInput } from './buildManagerInput'

vi.mock('viem/actions', () => ({
  readContract: vi.fn(),
}))

describe('buildManagerInput', () => {
  beforeEach(() => {
    vi.mocked(readContract).mockReset()
  })

  it('treats native token aliases as underlying when vault underlying is WETH', async () => {
    vi.mocked(readContract).mockResolvedValue(-199564)

    const managerInput = await buildManagerInput({
      viemClient: {} as Client,
      poolInfos: [
        {
          maxPriceDeviation: 100,
          pool: '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78',
          token0: '0x0000000000000000000000000000000000000000',
          token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        },
      ],
      tokenIds: [[]],
      underlyingToken: '0x4200000000000000000000000000000000000006',
      wethAddress: '0x4200000000000000000000000000000000000006',
    })

    const [managerPrices] = decodeAbiParameters(
      PanopticVaultAccountantManagerInputAbi,
      managerInput,
    )
    expect(managerPrices[0]).toEqual({
      poolPrice: -199564,
      token0Price: 0,
      token1Price: -199564,
    })
  })

  it('throws when tokenIds length does not align with poolInfos length', async () => {
    await expect(
      buildManagerInput({
        viemClient: {} as Client,
        poolInfos: [
          {
            maxPriceDeviation: 100,
            pool: '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78',
            token0: '0x0000000000000000000000000000000000000000',
            token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          },
        ],
        tokenIds: [],
        underlyingToken: '0x4200000000000000000000000000000000000006',
      }),
    ).rejects.toThrow('Invalid managerInput tokenIds length')
  })

  it('throws when a pool tokenIds list contains duplicates', async () => {
    await expect(
      buildManagerInput({
        viemClient: {} as Client,
        poolInfos: [
          {
            maxPriceDeviation: 100,
            pool: '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78',
            token0: '0x0000000000000000000000000000000000000000',
            token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          },
        ],
        tokenIds: [[1n, 1n]],
        underlyingToken: '0x4200000000000000000000000000000000000006',
      }),
    ).rejects.toThrow('Invalid managerInput tokenIds: duplicate tokenId 1 in pool index 0')

    expect(vi.mocked(readContract)).not.toHaveBeenCalled()
  })

  it('allows the same tokenId value in different pool lists', async () => {
    vi.mocked(readContract).mockResolvedValue(123)

    const managerInput = await buildManagerInput({
      viemClient: {} as Client,
      poolInfos: [
        {
          maxPriceDeviation: 100,
          pool: '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78',
          token0: '0x0000000000000000000000000000000000000000',
          token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        },
        {
          maxPriceDeviation: 100,
          pool: '0x0000000000000000000000000000000000000002',
          token0: '0x0000000000000000000000000000000000000000',
          token1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        },
      ],
      tokenIds: [[1n], [1n]],
      underlyingToken: '0x4200000000000000000000000000000000000006',
    })

    const [, , tokenIds] = decodeAbiParameters(PanopticVaultAccountantManagerInputAbi, managerInput)
    expect(tokenIds).toEqual([[1n], [1n]])
  })
})
