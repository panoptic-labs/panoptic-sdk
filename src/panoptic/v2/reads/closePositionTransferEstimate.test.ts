import type { PublicClient } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { encodeLeg, encodePoolId } from '../tokenId/encoding'
import {
  estimateCloseZapSwap,
  getClosePositionTransferEstimate,
} from './closePositionTransferEstimate'

const mocks = vi.hoisted(() => ({ value: vi.fn(), itm: vi.fn(), sizes: vi.fn() }))
vi.mock('./account', () => ({ getNetLiquidationValue: mocks.value }))
vi.mock('./collateralEstimate', () => ({ getItmAmounts: mocks.itm }))
vi.mock('./positionSizes', () => ({ getCurrentPositionSizes: mocks.sizes }))
const q96 = 1n << 96n
const meta = { blockNumber: 123n, blockHash: '0x123', blockTimestamp: 100n }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sizes.mockResolvedValue([10n])
  mocks.value.mockResolvedValue({ value0: 50n, value1: -100n, atTick: 0n, _meta: meta })
  mocks.itm.mockResolvedValue({ itm0: 50n, itm1: 0n, _meta: meta })
})

function tokenId(asset: bigint) {
  return (
    encodePoolId('0x0000000000000000000000000000000000000001', 10n) |
    encodeLeg({
      index: 0n,
      asset,
      optionRatio: 1n,
      isLong: 0n,
      tokenType: 1n,
      riskPartner: 1n,
      strike: 0n,
      width: 10n,
    }) |
    encodeLeg({
      index: 1n,
      asset: 1n - asset,
      optionRatio: 2n,
      isLong: 1n,
      tokenType: 0n,
      riskPartner: 0n,
      strike: 20n,
      width: 10n,
    })
  )
}

function params(asset = 0n) {
  return {
    client: { getBlockNumber: vi.fn().mockResolvedValue(123n) } as unknown as PublicClient,
    poolAddress: '0x1111111111111111111111111111111111111111' as const,
    account: '0x2222222222222222222222222222222222222222' as const,
    queryAddress: '0x3333333333333333333333333333333333333333' as const,
    tokenId: tokenId(asset),
  }
}

describe('close transfer estimates', () => {
  it.each([
    [50n, 0n, 0n, -50n, 200n],
    [-50n, 0n, 1n, 50n, -200n],
    [0n, 100n, 0n, 25n, -100n],
    [0n, -100n, 1n, -25n, 100n],
    [50n, -100n, 0n, -50n, 200n],
    [50n, -100n, 1n, -25n, 100n],
    [-50n, 100n, 0n, 50n, -200n],
    [-50n, 100n, 1n, 25n, -100n],
    [0n, 0n, 0n, 0n, 0n],
  ])(
    'projects SFPM netting for ITM %s/%s with first-leg asset %s',
    (itm0, itm1, asset, amount0, amount1) => {
      expect(estimateCloseZapSwap({ itm0, itm1, asset, sqrtPriceX96: q96 * 2n })).toEqual({
        amount0,
        amount1,
      })
    },
  )

  it('keeps raw token denomination for 6/18-decimal pools in both swap directions', () => {
    const sqrtPriceX96 = q96 * 1000000n
    expect(estimateCloseZapSwap({ itm0: 1000000n, itm1: 0n, asset: 0n, sqrtPriceX96 })).toEqual({
      amount0: -1000000n,
      amount1: 10n ** 18n,
    })
    expect(estimateCloseZapSwap({ itm0: 0n, itm1: 10n ** 18n, asset: 1n, sqrtPriceX96 })).toEqual({
      amount0: 1000000n,
      amount1: -(10n ** 18n),
    })
  })

  it.each([0n, 1n])(
    'pins reads and estimates a mixed-asset multi-leg close (asset %s)',
    async (asset) => {
      mocks.itm.mockResolvedValue({ itm0: 50n, itm1: -100n, _meta: meta })
      const input = params(asset)
      const result = await getClosePositionTransferEstimate(input)
      expect(mocks.sizes).toHaveBeenCalledWith(
        expect.objectContaining({
          account: input.account,
          positionIdList: [input.tokenId],
          blockNumber: 123n,
        }),
      )
      expect(mocks.value).toHaveBeenCalledWith(
        expect.objectContaining({
          account: input.account,
          tokenIds: [input.tokenId],
          includePendingPremium: false,
          blockNumber: 123n,
        }),
      )
      expect(mocks.itm).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenId: input.tokenId,
          positionSize: 10n,
          blockNumber: 123n,
          _meta: meta,
        }),
      )
      expect(result.exercise).toEqual({ amount0: 50n, amount1: -100n })
      expect(result.zap).toEqual(
        asset === 0n ? { amount0: 0n, amount1: -50n } : { amount0: -50n, amount1: 0n },
      )
    },
  )

  it('rejects a closed position before calculating transfers', async () => {
    mocks.sizes.mockResolvedValue([0n])
    await expect(getClosePositionTransferEstimate(params())).rejects.toThrow('no longer open')
    expect(mocks.value).not.toHaveBeenCalled()
    expect(mocks.itm).not.toHaveBeenCalled()
  })
})
