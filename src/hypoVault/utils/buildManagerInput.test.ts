import { type Client, decodeAbiParameters } from 'viem'
import { readContract } from 'viem/actions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'
import { buildManagerInput, resolvePositionScanFromBlock } from './buildManagerInput'

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

  it('prices WETH as underlying across native-first and WETH-second pool orderings', async () => {
    vi.mocked(readContract).mockResolvedValue(-200_000)
    const weth = '0x4200000000000000000000000000000000000006'
    const usdc = '0x0000000000000000000000000000000000000001'

    const managerInput = await buildManagerInput({
      viemClient: {} as Client,
      poolInfos: [
        {
          maxPriceDeviation: 100,
          pool: '0x0000000000000000000000000000000000000010',
          token0: '0x0000000000000000000000000000000000000000',
          token1: usdc,
        },
        {
          maxPriceDeviation: 100,
          pool: '0x0000000000000000000000000000000000000020',
          token0: usdc,
          token1: weth,
        },
      ],
      tokenIds: [[], []],
      underlyingToken: weth,
      wethAddress: weth,
    })

    const [managerPrices] = decodeAbiParameters(
      PanopticVaultAccountantManagerInputAbi,
      managerInput,
    )
    expect(managerPrices).toEqual([
      { poolPrice: -200_000, token0Price: 0, token1Price: -200_000 },
      { poolPrice: -200_000, token0Price: -200_000, token1Price: 0 },
    ])
  })

  it('prices USDC as underlying across token1 and token0 pool orderings', async () => {
    vi.mocked(readContract).mockResolvedValue(-200_000)
    const weth = '0x4200000000000000000000000000000000000006'
    const usdc = '0x0000000000000000000000000000000000000001'

    const managerInput = await buildManagerInput({
      viemClient: {} as Client,
      poolInfos: [
        {
          maxPriceDeviation: 100,
          pool: '0x0000000000000000000000000000000000000010',
          token0: weth,
          token1: usdc,
        },
        {
          maxPriceDeviation: 100,
          pool: '0x0000000000000000000000000000000000000020',
          token0: usdc,
          token1: weth,
        },
      ],
      tokenIds: [[], []],
      underlyingToken: usdc,
    })

    const [managerPrices] = decodeAbiParameters(
      PanopticVaultAccountantManagerInputAbi,
      managerInput,
    )
    expect(managerPrices).toEqual([
      { poolPrice: -200_000, token0Price: -200_000, token1Price: 0 },
      { poolPrice: -200_000, token0Price: 0, token1Price: -200_000 },
    ])
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

describe('resolvePositionScanFromBlock', () => {
  const poolInfo = {
    maxPriceDeviation: 100,
    pool: '0x0000000000000000000000000000000000000010',
    token0: '0x0000000000000000000000000000000000000001',
    token1: '0x0000000000000000000000000000000000000002',
  } as const

  it('prefers the pool-specific scan boundary', () => {
    expect(
      resolvePositionScanFromBlock({ ...poolInfo, positionScanFromBlock: 25_631_480n }, 25_302_077),
    ).toBe(25_631_480n)
  })

  it('retains the vault-wide boundary as a compatibility fallback', () => {
    expect(resolvePositionScanFromBlock(poolInfo, 25_302_077)).toBe(25_302_077n)
    expect(resolvePositionScanFromBlock(poolInfo)).toBeUndefined()
  })
})
