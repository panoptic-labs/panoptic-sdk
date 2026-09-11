import type { PublicClient } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addLegToTokenId } from '../tokenId'
import { assertLpPositionFunded, readLpFundingSnapshot } from './lpFunding'
import { prepareMarginBufferRead } from './margin'

const state = vi.hoisted(() => ({
  margin: {
    currentTick: 0n,
    denominatedInToken: 1,
    mintableMarginBinding: 2000000n as bigint | null,
    currentMargin0: 2000000n,
    currentMargin1: 2000000n,
  },
  metadata: {
    isV4: false,
    underlyingPoolId: '0x1111111111111111111111111111111111111111',
    tickSpacing: 60n,
    collateralToken0Address: '0x4444444444444444444444444444444444444444',
    collateralToken1Address: '0x5555555555555555555555555555555555555555',
  },
}))
vi.mock('./margin', () => ({
  prepareMarginBufferRead: vi.fn(() => ({
    contracts: [
      {
        address: '0x4444444444444444444444444444444444444444',
        abi: [],
        functionName: 'margin',
      },
    ],
    decode: (_results: unknown, _meta: unknown) => state.margin,
  })),
}))
vi.mock('./pool', () => ({ getPoolMetadata: vi.fn(async () => state.metadata) }))

const poolAddress = '0x1111111111111111111111111111111111111111' as const
const account = '0x2222222222222222222222222222222222222222' as const
const queryAddress = '0x3333333333333333333333333333333333333333' as const
const multicall = vi.fn(async () => [
  { status: 'success' as const, result: [1n << 96n, 0, 0, 0, 0, 0, true] },
  { status: 'success' as const, result: 0n },
])
const client = {} as PublicClient
Object.assign(client, {
  multicall,
  getBlockNumber: vi.fn(async () => 123n),
  getBlock: vi.fn(async () => ({ number: 123n, timestamp: 456n, hash: '0x01' as const })),
})
const tokenId = addLegToTokenId(1n, {
  index: 0n,
  asset: 0n,
  optionRatio: 1n,
  isLong: 0n,
  tokenType: 0n,
  riskPartner: 0n,
  strike: 0n,
  width: 20n,
})
const params = {
  client,
  poolAddress,
  account,
  queryAddress,
  existingPositionIds: [99n],
  tokenId,
  positionSize: 1000000n,
  quoteTokenIndex: 1 as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  state.margin.mintableMarginBinding = 2000000n
  state.margin.currentMargin0 = 2000000n
  state.margin.currentMargin1 = 2000000n
  state.metadata.isV4 = false
  multicall.mockResolvedValue([
    { status: 'success', result: [1n << 96n, 0, 0, 0, 0, 0, true] },
    { status: 'success', result: 0n },
  ])
})

describe('fresh LP funding check', () => {
  it('pins range price and existing obligations to the same block', async () => {
    const funding = await assertLpPositionFunded(params)
    expect(funding.totalInQuote).toBeGreaterThan(1000000n)
    expect(multicall).toHaveBeenCalledWith(
      expect.objectContaining({
        contracts: expect.arrayContaining([expect.objectContaining({ functionName: 'slot0' })]),
        blockNumber: 123n,
      }),
    )
    expect(prepareMarginBufferRead).toHaveBeenCalledWith(
      expect.objectContaining({ tokenIds: [99n] }),
    )
    await expect(readLpFundingSnapshot(params)).resolves.toMatchObject({
      _meta: { blockNumber: 123n, blockTimestamp: 456n, blockHash: '0x01' },
    })
  })

  it('blocks margin-funded leverage even with a large gross balance', async () => {
    state.margin.mintableMarginBinding = 250000n
    state.margin.currentMargin0 = 1000000000n
    state.margin.currentMargin1 = 1000000000n
    await expect(assertLpPositionFunded(params)).rejects.toThrow('full LP principal and 5%')
  })

  it('rechecks funding after a previous successful check', async () => {
    await assertLpPositionFunded(params)
    state.margin.mintableMarginBinding = 0n
    await expect(assertLpPositionFunded(params)).rejects.toThrow('Insufficient collateral')
  })

  it('supports a first position with no binding margin requirement', async () => {
    state.margin.mintableMarginBinding = null
    await expect(
      assertLpPositionFunded({ ...params, existingPositionIds: [] }),
    ).resolves.toHaveProperty('totalInQuote')
  })

  it('uses V4 StateView and fails closed when its address is missing', async () => {
    state.metadata.isV4 = true
    await expect(assertLpPositionFunded(params)).rejects.toThrow('Missing V4 StateView')
    await assertLpPositionFunded({ ...params, stateViewAddress: queryAddress })
    expect(multicall).toHaveBeenCalledWith(
      expect.objectContaining({
        contracts: expect.arrayContaining([
          expect.objectContaining({ functionName: 'getSlot0', address: queryAddress }),
        ]),
        blockNumber: 123n,
      }),
    )
  })

  it('fails closed when the price read fails', async () => {
    multicall.mockRejectedValue(new Error('RPC unavailable'))
    await expect(assertLpPositionFunded(params)).rejects.toThrow('RPC unavailable')
  })
})
