import type { PublicClient } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preparePositionGamma } from '../greeks/positionVolatility'
import { encodeLeg, encodePoolId } from '../tokenId/encoding'
import { getPositionVolatilityHistory } from './positionVolatilityHistory'
import { getStreamiaHistory } from './streamiaHistory'
import type * as FeeHistory from './uniswapFeeHistory'
import { fetchUniswapFeeData } from './uniswapFeeHistory'

vi.mock('./streamiaHistory', () => ({ getStreamiaHistory: vi.fn() }))
vi.mock('./uniswapFeeHistory', async (original) => ({
  ...(await original<typeof FeeHistory>()),
  fetchUniswapFeeData: vi.fn(),
}))

const ADDRESS = '0x1111111111111111111111111111111111111111' as const
const HASH = `0x${'11'.repeat(32)}` as const
const tokenId =
  encodePoolId(ADDRESS, 10n) |
  encodeLeg({
    index: 0n,
    asset: 0n,
    optionRatio: 1n,
    isLong: 0n,
    tokenType: 1n,
    riskPartner: 0n,
    strike: 0n,
    width: 20n,
  })
const packed = (amount0: bigint, amount1 = 0n) =>
  BigInt.asIntN(256, BigInt.asUintN(128, amount0) | (BigInt.asUintN(128, amount1) << 128n))

function setup({ closed = false, ambiguous = false } = {}) {
  const mint = {
    args: { balanceData: 1000000n, tokenId, recipient: ADDRESS },
    blockNumber: 100n,
    logIndex: 1,
    transactionHash: HASH,
  }
  const burn = {
    args: { tokenId, positionSize: 1000000n, premiaByLeg: [packed(7n, -3n), 0n, 0n, 0n] },
    blockNumber: 200n,
    logIndex: 3,
    transactionHash: HASH,
  }
  const settlement = {
    args: { user: ADDRESS, tokenId, legIndex: 0n, settledAmounts: packed(5n, -2n) },
    blockNumber: 150n,
    logIndex: 2,
    transactionHash: HASH,
  }
  const getContractEvents = vi.fn(async ({ eventName }: { eventName: string }) => {
    if (eventName === 'OptionMinted') return ambiguous ? [mint, mint] : [mint]
    if (eventName === 'OptionBurnt') return closed ? [burn, { ...burn, blockNumber: 250n }] : []
    return [settlement, settlement]
  })
  const client = {
    getContractEvents,
    getBlock: vi.fn(async ({ blockNumber = 300n }: { blockNumber?: bigint }) => ({
      number: blockNumber,
      timestamp: blockNumber * 100n,
      hash: HASH,
    })),
    readContract: vi.fn().mockResolvedValue([1n << 96n, 0, 0, 0, 0, 0, true]),
    getTransactionReceipt: vi.fn().mockResolvedValue({ logs: [] }),
  } as unknown as PublicClient
  return {
    client,
    params: {
      client,
      poolAddress: ADDRESS,
      account: ADDRESS,
      tokenId,
      mintBlock: 100n,
      endBlock: 300n,
      poolConfig: { version: 'v3' as const, poolAddress: ADDRESS },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStreamiaHistory).mockImplementation(async (params) => ({
    _meta: { blockNumber: 300n, blockTimestamp: 30000n, blockHash: HASH },
    snapshots: params.blockNumbers.map((blockNumber) => ({
      blockNumber,
      panopticPremia: { token0: 2n, token1: 0n },
      cumulativePanopticPremia: { token0: 2n, token1: 0n },
      uniswapFees: { token0: 0n, token1: 0n },
    })),
  }))
})

describe('position lifecycle accounting', () => {
  it('pins real block timestamps and deduplicates settlements', async () => {
    const { params } = setup()
    const history = await getPositionVolatilityHistory(params)
    expect(history.start.blockTimestamp).toBe(10000n)
    expect(history.end.blockTimestamp).toBe(30000n)
    expect(history.premium?.[0].timestamp).toBe(10000n)
    expect(history.premium?.[0].token0).toBe(0n)
    const settlements = vi.mocked(getStreamiaHistory).mock.calls[0][0].settledEvents
    expect(settlements).toEqual([{ blockNumber: 150n, settled0: 5n, settled1: -2n }])
    expect(history.fees).toBeNull()
  })

  it('includes closing premium exactly once and excludes later lifecycles', async () => {
    const { params } = setup({ closed: true })
    const history = await getPositionVolatilityHistory(params)
    expect(history.closed).toBe(true)
    expect(history.end.blockNumber).toBe(200n)
    expect(history.premium?.at(-1)).toEqual({ timestamp: 20000n, token0: 10n, token1: -5n })
    expect(
      vi
        .mocked(getStreamiaHistory)
        .mock.calls.flatMap(([args]) => args.blockNumbers)
        .every((block) => block !== undefined && block < 200n),
    ).toBe(true)
  })

  it('preserves lifecycle and price anchors when premium archive reads fail', async () => {
    vi.mocked(getStreamiaHistory).mockRejectedValue(new Error('archive unavailable'))
    const history = await getPositionVolatilityHistory(setup().params)
    expect(history.premium).toBeNull()
    expect(history.premiumError).toBe('archive unavailable')
    expect(history.openingTick).toBe(0n)
  })

  it('rejects ambiguous same-block reopenings', async () => {
    await expect(getPositionVolatilityHistory(setup({ ambiguous: true }).params)).rejects.toThrow(
      'ambiguous',
    )
  })

  it('does not represent uninitialized LP fee history as zero', async () => {
    vi.mocked(fetchUniswapFeeData).mockImplementation(async (_client, blocks) =>
      blocks.map(() => ({
        currentTick: 0,
        sqrtPriceX96: 1n << 96n,
        feeGrowthGlobal0: 0n,
        feeGrowthGlobal1: 0n,
        tickData: new Map(),
      })),
    )
    const history = await getPositionVolatilityHistory({ ...setup().params, includeBaseFees: true })
    expect(history.fees).toBeNull()
    expect(history.feeError).toContain('uninitialized')
    expect(history.premium).not.toBeNull()
  })

  it.each([
    { reset: false, closed: false },
    { reset: true, closed: false },
    { reset: false, closed: true },
  ])(
    'reconstructs base fees before cleared burn ticks (reset=$reset, closed=$closed)',
    async ({ reset, closed }) => {
      const unit = 1n << 128n
      vi.mocked(fetchUniswapFeeData).mockImplementation(async (_client, blocks) =>
        blocks.map((block) => ({
          currentTick: 0,
          sqrtPriceX96: 1n << 96n,
          feeGrowthGlobal0: (block ?? 0n) * unit,
          feeGrowthGlobal1: (block ?? 0n) * unit * 2n,
          tickData: new Map(
            [-100, 100].map((tick) => [
              tick,
              {
                liquidityGross: closed && block === 200n ? 0n : 1n,
                feeGrowthOutside0: reset && block === 100n ? 1000n * unit : 0n,
                feeGrowthOutside1: 0n,
              },
            ]),
          ),
        })),
      )
      const history = await getPositionVolatilityHistory({
        ...setup({ closed }).params,
        includeBaseFees: true,
      })
      if (reset) {
        expect(history.fees).toBeNull()
        expect(history.feeError).toContain('inconsistent')
      } else {
        const gamma = preparePositionGamma({
          tokenId,
          positionSize: 1000000n,
          quoteIsToken0: false,
          quoteDecimals: 0,
        })
        const liquidity = gamma.chunks[0].liquidity
        const sampledBlocks = vi
          .mocked(fetchUniswapFeeData)
          .mock.calls.flatMap(([, blocks]) => blocks)
        const lastBlock = sampledBlocks.at(-1) ?? 0n
        if (closed) {
          expect(sampledBlocks.every((block) => block !== undefined && block < 200n)).toBe(true)
          expect(history.end.blockNumber).toBe(200n)
        } else {
          expect(lastBlock).toBe(300n)
        }
        expect(history.feeError).toBeNull()
        expect(history.fees?.map((snapshot) => snapshot.timestamp)).toEqual(
          sampledBlocks.map((block) => (block ?? 0n) * 100n),
        )
        expect(history.fees?.[0].token0).toBe(0n)
        expect(history.fees?.at(-1)?.token0).toBe((lastBlock - 100n) * liquidity)
        expect(history.fees?.at(-1)?.token1).toBe((lastBlock - 100n) * 2n * liquidity)
      }
    },
  )
})
