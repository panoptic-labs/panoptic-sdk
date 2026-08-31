import { decodeFunctionData, encodeFunctionResult } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { simulateDispatch } from './simulateDispatch'

vi.mock('../clients', () => ({
  getBlockMeta: vi
    .fn()
    .mockResolvedValue({ blockNumber: 1n, blockTimestamp: 0n, blockHash: '0x0' }),
}))

const simulateWithTokenFlow = vi.hoisted(() => vi.fn())
vi.mock('./tokenFlow', () => ({ simulateWithTokenFlow }))

const account = '0x0000000000000000000000000000000000000001' as const
const poolAddress = '0x0000000000000000000000000000000000000002' as const
const client = { getBlockNumber: vi.fn().mockResolvedValue(1n) } as never
const packLeftRight = (left: bigint, right: bigint): bigint => (left << 128n) | right

const encodeFullPositions = ({
  short0,
  short1,
  long0,
  long1,
}: {
  short0: bigint
  short1: bigint
  long0: bigint
  long1: bigint
}) =>
  encodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    result: [packLeftRight(short1, short0), packLeftRight(long1, long0), [], [], []],
  })

describe('simulateDispatch', () => {
  beforeEach(() => {
    simulateWithTokenFlow.mockReset()
  })

  it('reports validated premia independently from the transaction token flow', async () => {
    simulateWithTokenFlow.mockResolvedValue({
      success: true,
      tokenFlow: {
        delta0: -1_000n,
        delta1: 2_000n,
        balanceBefore0: 10_000n,
        balanceBefore1: 20_000n,
        balanceAfter0: 9_000n,
        balanceAfter1: 22_000n,
        tickBefore: 0n,
        tickAfter: 0n,
      },
      gasEstimate: 100_000n,
      preCallResults: [
        encodeFullPositions({ short0: 0n, short1: 0n, long0: 0n, long1: 0n }),
        encodeFullPositions({ short0: 100n, short1: 300n, long0: 30n, long1: 500n }),
      ],
      postCallResults: [
        encodeFullPositions({ short0: 0n, short1: 0n, long0: 0n, long1: 0n }),
        encodeFullPositions({ short0: 0n, short1: 0n, long0: 0n, long1: 0n }),
      ],
    })

    const result = await simulateDispatch({
      client,
      poolAddress,
      account,
      positionIdList: [1n],
      finalPositionIdList: [1n],
      existingPositionIdList: [1n],
      measurePremia: true,
      positionSizes: [1n],
      tickAndSpreadLimits: [[-887272n, 887272n, 0n]],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.premiaReceived0).toBe(70n)
    expect(result.data.premiaReceived1).toBe(-200n)
    expect(result.data.netAmount0).toBe(-1_000n)
    expect(result.data.netAmount1).toBe(2_000n)

    const premiaCall = simulateWithTokenFlow.mock.calls[0]?.[0].preCallData?.[1]
    expect(premiaCall).toBeDefined()
    if (premiaCall === undefined) return
    const decodedPremiaCall = decodeFunctionData({ abi: panopticPoolV2Abi, data: premiaCall })
    expect(decodedPremiaCall.args?.[1]).toBe(true)
  })
})
