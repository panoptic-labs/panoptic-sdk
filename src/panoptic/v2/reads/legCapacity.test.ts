import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { addLegToTokenId } from '../tokenId/encoding'
import { fitsAccountLegCapacity, getAccountLegCapacity } from './legCapacity'

const address = '0x1111111111111111111111111111111111111111' as const
vi.mock('./pool', () => ({ getPoolMetadata: vi.fn(async () => ({ riskEngineAddress: address })) }))
const leg = (index: bigint, asset: bigint) => ({
  index,
  asset,
  tokenType: asset,
  width: 10n,
  strike: 0n,
  optionRatio: 1n,
  isLong: 0n,
  riskPartner: index,
})
const one = addLegToTokenId(1n, leg(0n, 0n))
const other = addLegToTokenId(2n, leg(0n, 1n))
const multi = addLegToTokenId(one, leg(1n, 1n))

describe('ordered account leg capacity', () => {
  it.each([one, other])('allows 25-to-26 legs for either asset ordering', (id) => {
    expect(
      fitsAccountLegCapacity({
        capacity: { currentLegs: 25n, maximumLegs: 26n, positionIds: [] },
        tokenIds: [id],
        positionSizes: [1n],
      }),
    ).toBe(true)
    expect(
      fitsAccountLegCapacity({
        capacity: { currentLegs: 26n, maximumLegs: 26n, positionIds: [] },
        tokenIds: [id],
        positionSizes: [1n],
      }),
    ).toBe(false)
  })
  it('counts all multi-leg positions and rejects a transient mint-first overflow', () => {
    const capacity = { currentLegs: 26n, maximumLegs: 26n, positionIds: [multi] }
    expect(
      fitsAccountLegCapacity({ capacity, tokenIds: [other, multi], positionSizes: [1n, 0n] }),
    ).toBe(false)
    expect(
      fitsAccountLegCapacity({ capacity, tokenIds: [multi, other], positionSizes: [0n, 1n] }),
    ).toBe(true)
    expect(
      fitsAccountLegCapacity({
        capacity: { ...capacity, currentLegs: 25n },
        tokenIds: [multi],
        positionSizes: [2n],
      }),
    ).toBe(true)
  })
  it('pins the live risk limit and account count to one block and rejects an incomplete list', async () => {
    const multicall = vi.fn().mockResolvedValue([26n, 2n, [0n, 0n, [1n], [], []]])
    const client = { multicall } as unknown as PublicClient
    await expect(
      getAccountLegCapacity({
        client,
        poolAddress: address,
        account: address,
        positionIds: [multi],
        blockNumber: 100n,
      }),
    ).resolves.toMatchObject({ maximumLegs: 26n, currentLegs: 2n })
    expect(multicall).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: 100n, allowFailure: false }),
    )
    multicall.mockResolvedValue([26n, 3n, [0n, 0n, [1n], [], []]])
    await expect(
      getAccountLegCapacity({
        client,
        poolAddress: address,
        account: address,
        positionIds: [multi],
        blockNumber: 100n,
      }),
    ).rejects.toThrow('complete open position list')
  })
})
