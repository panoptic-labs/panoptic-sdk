import type { PublicClient } from 'viem'
import { multicall } from 'viem/actions'
import { describe, expect, it, vi } from 'vitest'

import {
  collateralCurveTicks,
  getCollateralCurve,
  getCollateralCurveInputs,
} from './collateralCurve'

vi.mock('viem/actions', () => ({ multicall: vi.fn() }))

describe('collateral curve', () => {
  it('captures premiums, packed position balances, assets and interest in canonical order at one block', async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce([10n, 20n, [30n, 40n], [], []])
      .mockResolvedValueOnce([100n, 5n])
      .mockResolvedValueOnce([200n, 6n])
    const client = { readContract } as unknown as PublicClient
    const address = '0x0000000000000000000000000000000000000001'
    const inputs = await getCollateralCurveInputs({
      client,
      poolAddress: address,
      account: address,
      collateral0: address,
      collateral1: address,
      tokenIds: [2n, 1n],
      blockNumber: 42n,
    })
    expect(inputs).toEqual([10n, 20n, 30n, 40n, 100n, 5n, 200n, 6n])
    expect(readContract.mock.calls[0][0].args).toEqual([address, false, [1n, 2n]])
    expect(readContract.mock.calls.every(([params]) => params.blockNumber === 42n)).toBe(true)
  })

  it('uses the requested block rather than fetching a newer one', async () => {
    const getBlockNumber = vi.fn()
    const client = {
      getBlockNumber,
      readContract: vi.fn().mockResolvedValue([-8388608, 8388607]),
    } as unknown as PublicClient
    vi.mocked(multicall).mockImplementation(async (_client, options) =>
      options.contracts.map(() => [10n, 2n, 20n, 3n]),
    )
    const address = '0x0000000000000000000000000000000000000001'
    expect(
      (
        await getCollateralCurve({
          client,
          poolAddress: address,
          account: address,
          queryAddress: address,
          tokenIds: [],
          blockNumber: 99n,
        })
      ).blockNumber,
    ).toBe(99n)
    expect(getBlockNumber).not.toHaveBeenCalled()
    vi.mocked(multicall).mockClear()
  })
  it('clips extremes and includes liquidation boundaries exactly', () => {
    const ticks = collateralCurveTicks([], [-887272n, 123n, 887272n])
    expect(ticks).toContain(122n)
    expect(ticks).toContain(123n)
    expect(ticks).toContain(124n)
    expect(ticks[0]).toBe(-887272n)
    expect(ticks.at(-1)).toBe(887272n)
    expect(new Set(ticks).size).toBe(ticks.length)
  })

  it('pins every batch and liquidation read to one block, omitting sentinel boundaries', async () => {
    const readContract = vi.fn().mockResolvedValue([-8388608, 123])
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(42n),
      readContract,
    } as unknown as PublicClient
    vi.mocked(multicall).mockImplementation(async (_client, options) =>
      options.contracts.map(() => [10n, 2n, 20n, 3n]),
    )
    const address = '0x0000000000000000000000000000000000000001'
    const result = await getCollateralCurve({
      client,
      poolAddress: address,
      account: address,
      queryAddress: address,
      tokenIds: [],
    })
    expect(result.liquidationTicks).toEqual([123n])
    expect(result.blockNumber).toBe(42n)
    expect(readContract.mock.calls[0][0].blockNumber).toBe(42n)
    for (const [, options] of vi.mocked(multicall).mock.calls) {
      expect(options.blockNumber).toBe(42n)
      expect(options.contracts.length).toBeLessThanOrEqual(100)
      expect(options.allowFailure).toBe(false)
    }
    expect(result.points[0].collateral0).toBe(10n)
  })
})
