import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTokenIdBuilder } from '../tokenId'
import { settleAccumulatedPremia } from './settle'
import { submitWrite } from './utils'

const mockTxResult = vi.hoisted(() => ({
  hash: '0xabc' as `0x${string}`,
  wait: vi.fn(),
}))

vi.mock('./utils', () => ({
  submitWrite: vi.fn().mockResolvedValue(mockTxResult),
}))

const getCurrentPositionSizes = vi.hoisted(() => vi.fn())
vi.mock('../reads/positionSizes', () => ({ getCurrentPositionSizes }))

const simulateSettle = vi.hoisted(() => vi.fn())
vi.mock('../simulations/simulateSettle', () => ({ simulateSettle }))

const executeSettleSequence = vi.hoisted(() => vi.fn())
vi.mock('./settleSequence', () => ({ executeSettleSequence }))

const client = {} as never
const walletClient = {} as never
const account = '0x0000000000000000000000000000000000000001' as `0x${string}`
const poolAddress = '0x0000000000000000000000000000000000000002' as `0x${string}`
const shortTokenId = createTokenIdBuilder(10n << 48n)
  .addPut({ strike: 0n, width: 10n, optionRatio: 1n, isLong: false })
  .build()

beforeEach(() => {
  vi.mocked(submitWrite).mockClear()
  getCurrentPositionSizes.mockReset()
  simulateSettle.mockReset()
  simulateSettle.mockResolvedValue({ success: true })
  executeSettleSequence.mockReset()
  executeSettleSequence.mockResolvedValue(mockTxResult)
})

describe('settleAccumulatedPremia', () => {
  it('reads current stored sizes when positionSizes omitted', async () => {
    getCurrentPositionSizes.mockResolvedValue([100n, 250n])
    const positionIdList = [11n, 22n]

    await settleAccumulatedPremia({
      client,
      walletClient,
      account,
      poolAddress,
      positionIdList,
    })

    expect(getCurrentPositionSizes).toHaveBeenCalledWith({
      client,
      poolAddress,
      account,
      positionIdList,
    })
    const call = vi.mocked(submitWrite).mock.calls[0][0]
    expect(call.args?.[2]).toEqual([100n, 250n])
  })

  it('uses explicit positionSizes without an extra RPC', async () => {
    const positionIdList = [11n, 22n]
    await settleAccumulatedPremia({
      client,
      walletClient,
      account,
      poolAddress,
      positionIdList,
      positionSizes: [7n, 9n],
    })

    expect(getCurrentPositionSizes).not.toHaveBeenCalled()
    const call = vi.mocked(submitWrite).mock.calls[0][0]
    expect(call.args?.[2]).toEqual([7n, 9n])
    // Without an explicit finalPositionIdList, defaults to positionIdList (whole-account settle).
    expect(call.args?.[0]).toEqual(positionIdList)
    expect(call.args?.[1]).toEqual(positionIdList)
  })

  it('passes finalPositionIdList through for per-position settle', async () => {
    await settleAccumulatedPremia({
      client,
      walletClient,
      account,
      poolAddress,
      positionIdList: [11n],
      finalPositionIdList: [11n, 22n, 33n],
      positionSizes: [100n],
    })
    const call = vi.mocked(submitWrite).mock.calls[0][0]
    expect(call.args?.[0]).toEqual([11n])
    expect(call.args?.[1]).toEqual([11n, 22n, 33n])
  })

  it('throws when positionSizes length mismatches', async () => {
    await expect(
      settleAccumulatedPremia({
        client,
        walletClient,
        account,
        poolAddress,
        positionIdList: [1n, 2n],
        positionSizes: [1n],
      }),
    ).rejects.toThrow(/length must match/)
    expect(getCurrentPositionSizes).not.toHaveBeenCalled()
    expect(submitWrite).not.toHaveBeenCalled()
  })

  it('submits buyer settlements before the protected self-dispatch', async () => {
    const target = {
      user: '0x0000000000000000000000000000000000000003' as const,
      positionIdList: [33n],
      tokenId: 33n,
    }
    await settleAccumulatedPremia({
      client,
      walletClient,
      account,
      poolAddress,
      positionIdList: [shortTokenId],
      finalPositionIdList: [shortTokenId, 22n],
      positionSizes: [7n],
      targets: [target],
    })

    expect(executeSettleSequence).toHaveBeenCalledWith(
      expect.objectContaining({
        positionIdListFrom: [shortTokenId, 22n],
        targets: [target],
        dispatch: expect.objectContaining({
          positionIdList: [expect.any(BigInt), shortTokenId, expect.any(BigInt)],
          positionSizes: [expect.any(BigInt), 7n, 0n],
        }),
      }),
    )
    const dispatch = executeSettleSequence.mock.calls[0][0].dispatch
    expect(dispatch.positionIdList[0]).toBe(dispatch.positionIdList[2])
    expect(submitWrite).not.toHaveBeenCalled()
  })

  it('can skip the SDK preflight when the caller already simulated', async () => {
    await settleAccumulatedPremia({
      client,
      walletClient,
      account,
      poolAddress,
      positionIdList: [11n],
      positionSizes: [7n],
      skipPreflight: true,
    })

    expect(simulateSettle).not.toHaveBeenCalled()
    expect(submitWrite).toHaveBeenCalled()
  })
})
