import { decodeFunctionData } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { simulateSettle } from './simulateSettle'

vi.mock('../clients', () => ({
  getBlockMeta: vi
    .fn()
    .mockResolvedValue({ blockNumber: 1n, blockTimestamp: 0n, blockHash: '0x0' }),
}))

const getCurrentPositionSizes = vi.hoisted(() => vi.fn())
vi.mock('../reads/positionSizes', () => ({ getCurrentPositionSizes }))

const simulateWithTokenFlow = vi.hoisted(() => vi.fn())
vi.mock('./tokenFlow', () => ({ simulateWithTokenFlow }))

const account = '0x0000000000000000000000000000000000000001' as `0x${string}`
const poolAddress = '0x0000000000000000000000000000000000000002' as `0x${string}`

const client = { getBlockNumber: vi.fn().mockResolvedValue(1n) } as never

beforeEach(() => {
  getCurrentPositionSizes.mockReset()
  simulateWithTokenFlow.mockReset()
  simulateWithTokenFlow.mockResolvedValue({
    success: true,
    tokenFlow: { delta0: -50n, delta1: 200n, balanceAfter0: 0n, balanceAfter1: 0n },
    gasEstimate: 100000n,
  })
})

function decodeDispatchArgs(callData: `0x${string}`) {
  return decodeFunctionData({ abi: panopticPoolV2Abi, data: callData })
}

describe('simulateSettle', () => {
  it('passes current stored sizes to dispatch when not provided', async () => {
    getCurrentPositionSizes.mockResolvedValue([100n, 250n])

    await simulateSettle({
      client,
      poolAddress,
      account,
      positionIdList: [11n, 22n],
    })

    expect(getCurrentPositionSizes).toHaveBeenCalled()
    const callData = simulateWithTokenFlow.mock.calls[0][0].callData
    const { args } = decodeDispatchArgs(callData)
    expect(args?.[2]).toEqual([100n, 250n])
  })

  it('uses explicit positionSizes without an extra RPC', async () => {
    await simulateSettle({
      client,
      poolAddress,
      account,
      positionIdList: [11n, 22n],
      positionSizes: [7n, 9n],
    })

    expect(getCurrentPositionSizes).not.toHaveBeenCalled()
    const callData = simulateWithTokenFlow.mock.calls[0][0].callData
    const { args } = decodeDispatchArgs(callData)
    expect(args?.[2]).toEqual([7n, 9n])
  })

  it('returns signed premiaReceived (negative = paid)', async () => {
    const result = await simulateSettle({
      client,
      poolAddress,
      account,
      positionIdList: [11n],
      positionSizes: [100n],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.premiaReceived0).toBe(-50n)
    expect(result.data.premiaReceived1).toBe(200n)
  })

  it('threads finalPositionIdList through to dispatch', async () => {
    await simulateSettle({
      client,
      poolAddress,
      account,
      positionIdList: [11n],
      finalPositionIdList: [11n, 22n],
      positionSizes: [100n],
    })
    const callData = simulateWithTokenFlow.mock.calls[0][0].callData
    const { args } = decodeDispatchArgs(callData)
    expect(args?.[0]).toEqual([11n])
    expect(args?.[1]).toEqual([11n, 22n])
  })

  it('fails when positionSizes length mismatches', async () => {
    const result = await simulateSettle({
      client,
      poolAddress,
      account,
      positionIdList: [1n, 2n],
      positionSizes: [1n],
    })
    expect(result.success).toBe(false)
  })
})
