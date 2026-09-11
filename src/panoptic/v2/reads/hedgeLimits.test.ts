import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { decodeTokenId } from '../tokenId'
import { addLegToTokenId } from '../tokenId/encoding'
import { getHedgeLimits } from './hedgeLimits'
import type * as PoolReads from './pool'

const address = '0x1111111111111111111111111111111111111111' as const
vi.mock('./pool', async (importOriginal) => ({
  ...(await importOriginal<typeof PoolReads>()),
  getPoolMetadata: vi.fn(async () => ({
    collateralToken0Address: address,
    collateralToken1Address: address,
    riskEngineAddress: address,
    poolId: 1n,
    fee: 500n,
    tickSpacing: 10n,
  })),
}))
const tokenId = addLegToTokenId(1n, {
  index: 0n,
  asset: 0n,
  tokenType: 0n,
  width: 0n,
  strike: 0n,
  optionRatio: 1n,
  isLong: 0n,
  riskPartner: 0n,
})
const SCALE = 10_000_000n
const pack = (balance: bigint, required: bigint) => balance | (required << 128n)

function fixture({
  missingLegs = false,
  failMargin = false,
  affordable = false,
  positionIds = [tokenId],
  marginBalance = 2_000n,
} = {}) {
  const multicall = vi.fn(
    async ({ contracts }: { contracts: { functionName: string; args?: readonly unknown[] }[] }) => {
      if (contracts[0].functionName === 'getFullPositionsData')
        return [
          [0n, 0n, positionIds.map(() => 1_000n), [], []],
          0,
          [1_000_000n, 0n, 0n, 0n],
          [1_000_000n, 0n, 0n, 0n],
          1_000_000n,
          1_000_000n,
          [0n, 0n],
          [2_000n, 0n],
          10_666_667,
          3,
          SCALE,
          SCALE,
          26n,
          BigInt(positionIds.reduce((sum, id) => sum + decodeTokenId(id).legs.length, 0)) +
            (missingLegs ? 1n : 0n),
          1_000_000n,
          1_000_000n,
        ]
      if (contracts[0].functionName === 'crossBufferRatio') return [SCALE, SCALE]
      if (failMargin) throw new Error('RPC failure')
      const tick = Number(contracts[0].args?.[1])
      const failed = !affordable || tick <= -125 || tick >= 225
      return [
        [pack(0n, 1_100n), pack(marginBalance, 0n), 0n],
        [pack(0n, 1_100n), pack(marginBalance, failed ? 10_000n : 1_100n), 0n],
        SCALE,
        SCALE,
      ]
    },
  )
  const client = { multicall, getBlockNumber: vi.fn(async () => 100n) } as unknown as PublicClient
  return {
    client,
    multicall,
    params: {
      client,
      account: address,
      poolAddress: address,
      positionIds,
      assetIndex: 0n as const,
    },
  }
}

describe('getHedgeLimits', () => {
  it('pins all dynamic reads to one block and evaluates the actual combined requirements', async () => {
    const { params, multicall } = fixture()
    const result = await getHedgeLimits(params)
    expect(result.current.affordable).toBe(false)
    expect(result.current.reason).toBe('margin')
    expect(result.lowerTick).toBe(0)
    expect(result.upperTick).toBe(0)
    for (const [args] of multicall.mock.calls)
      expect(args).toMatchObject({ blockNumber: 100n, allowFailure: false })
    const finalCalls = multicall.mock.calls[2][0].contracts
    const syntheticIds = finalCalls[1].args?.[3]
    expect(syntheticIds).toEqual([tokenId, expect.any(BigInt)])
    expect(finalCalls[0].args?.[3]).toEqual([tokenId])
  })

  it('refines the first failed scenarios on both sides', async () => {
    const { params } = fixture({ affordable: true })
    const result = await getHedgeLimits(params)
    expect(result.current.affordable).toBe(true)
    expect(result.lowerTick).toBe(-125)
    expect(result.upperTick).toBe(225)
  })

  it.each([0n, 1n] as const)(
    'retains every transition and samples spot once for asset %s',
    async (assetIndex) => {
      let multiLegId = 1n
      const strikes = [-1230n, -610n, 730n, 1190n]
      for (const [index, strike] of strikes.entries()) {
        multiLegId = addLegToTokenId(multiLegId, {
          index: BigInt(index),
          asset: BigInt(index % 2),
          tokenType: BigInt(index % 2),
          width: 10n,
          strike,
          optionRatio: 1n,
          isLong: 0n,
          riskPartner: BigInt(index),
        })
      }
      const { params, multicall } = fixture({
        affordable: true,
        positionIds: [multiLegId],
        marginBalance: 1_000_000n,
      })
      const result = await getHedgeLimits({ ...params, assetIndex })
      expect(result.current.affordable).toBe(true)
      const ticks = multicall.mock.calls
        .filter(([call]) => call.contracts[0].functionName === 'getMargin')
        .map(([call]) => Number(call.contracts[0].args?.[1]))
      expect(ticks.filter((tick) => tick === 0)).toHaveLength(1)
      expect(ticks).toEqual(expect.arrayContaining([result.minTick, result.maxTick]))
      for (const strike of strikes) {
        for (const transition of [strike - 50n, strike, strike + 50n]) {
          expect(ticks).toEqual(
            expect.arrayContaining([-1, 0, 1].map((offset) => Number(transition) + offset)),
          )
        }
      }
    },
  )

  it('rejects incomplete account data', async () => {
    const { params } = fixture({ missingLegs: true })
    await expect(getHedgeLimits(params)).rejects.toThrow('position list is incomplete')
  })

  it('does not report a capacity boundary when the RPC fails', async () => {
    const { params } = fixture({ failMargin: true })
    await expect(getHedgeLimits(params)).rejects.toThrow('RPC failure')
  })
})
