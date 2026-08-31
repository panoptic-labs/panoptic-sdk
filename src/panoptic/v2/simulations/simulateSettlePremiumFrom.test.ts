import { decodeFunctionData, encodeFunctionResult } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { simulateSettlePremiumFrom } from './simulateSettlePremiumFrom'

vi.mock('../clients', () => ({
  getBlockMeta: vi
    .fn()
    .mockResolvedValue({ blockNumber: 1n, blockTimestamp: 0n, blockHash: '0x0' }),
}))

const simulateWithTokenFlow = vi.hoisted(() => vi.fn())
vi.mock('./tokenFlow', () => ({ simulateWithTokenFlow }))

const account = '0x0000000000000000000000000000000000000001' as `0x${string}`
const user = '0x0000000000000000000000000000000000000003' as `0x${string}`
const poolAddress = '0x0000000000000000000000000000000000000002' as `0x${string}`

const client = { getBlockNumber: vi.fn().mockResolvedValue(1n) } as never

const tokenFlow = {
  delta0: 50n,
  delta1: 200n,
  balanceBefore0: 0n,
  balanceBefore1: 0n,
  balanceAfter0: 50n,
  balanceAfter1: 200n,
  tickBefore: null,
  tickAfter: null,
}

// LeftRightUnsigned packing: left slot in upper 128 bits, right slot in lower 128 bits
const packLR = (right: bigint, left: bigint) => (left << 128n) | right

// getFullPositionsData result with the given packed premia
const encodePremia = (shortPremiumPacked: bigint, longPremiumPacked = 0n) =>
  encodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    result: [shortPremiumPacked, longPremiumPacked, [], [], []],
  })

beforeEach(() => {
  simulateWithTokenFlow.mockReset()
  simulateWithTokenFlow.mockResolvedValue({
    success: true,
    tokenFlow,
    gasEstimate: 100000n,
    // Caller available short premium: 100/300 → 150/500 ⇒ 50/200 unlocked.
    // Buyer owed long premium: 80/250 → 0/0 ⇒ 80/250 settled in total.
    preCallResults: [encodePremia(packLR(100n, 300n)), encodePremia(0n, packLR(80n, 250n))],
    postCallResults: [encodePremia(packLR(150n, 500n)), encodePremia(0n, packLR(0n, 0n))],
  })
})

function decodeDispatchArgs(callData: `0x${string}`) {
  return decodeFunctionData({ abi: panopticPoolV2Abi, data: callData })
}

describe('simulateSettlePremiumFrom', () => {
  it('encodes dispatchFrom with equal To/ToFinal lists (settle mode)', async () => {
    const result = await simulateSettlePremiumFrom({
      client,
      poolAddress,
      account,
      user,
      positionIdListFrom: [9n],
      positionIdList: [1n, 2n],
    })

    const callData = simulateWithTokenFlow.mock.calls[0][0].callData
    const { functionName, args } = decodeDispatchArgs(callData)
    expect(functionName).toBe('dispatchFrom')
    expect(args?.[0]).toEqual([9n])
    expect(args?.[1]).toBe(user)
    expect(args?.[2]).toEqual([1n, 2n])
    expect(args?.[3]).toEqual([1n, 2n])

    // The eth_call runs as the caller
    expect(simulateWithTokenFlow.mock.calls[0][0].user).toBe(account)

    // Premium reads are chained pre/post around the settle: caller's
    // available short premium and the buyer's owed long premium
    const preCall = decodeFunctionData({
      abi: panopticPoolV2Abi,
      data: simulateWithTokenFlow.mock.calls[0][0].preCallData[0],
    })
    expect(preCall.functionName).toBe('getFullPositionsData')
    expect(preCall.args).toEqual([account, false, [9n]])
    const buyerCall = decodeFunctionData({
      abi: panopticPoolV2Abi,
      data: simulateWithTokenFlow.mock.calls[0][0].preCallData[1],
    })
    expect(buyerCall.args).toEqual([user, true, [1n, 2n]])
    expect(simulateWithTokenFlow.mock.calls[0][0].postCallData).toEqual(
      simulateWithTokenFlow.mock.calls[0][0].preCallData,
    )

    expect(result.success).toBe(true)
    if (!result.success) return
    // premium = available short premium unlocked for the caller;
    // settled = total owed long premium the buyer pays into the chunk
    expect(result.data).toEqual({
      premium0: 50n,
      premium1: 200n,
      settled0: 80n,
      settled1: 250n,
      canSettle: true,
    })
  })

  it('reports zero premium when the settle unlocks nothing for the caller', async () => {
    simulateWithTokenFlow.mockResolvedValueOnce({
      success: true,
      tokenFlow,
      gasEstimate: 100000n,
      preCallResults: [encodePremia(packLR(100n, 300n)), encodePremia(0n, 0n)],
      postCallResults: [encodePremia(packLR(100n, 300n)), encodePremia(0n, 0n)],
    })

    const result = await simulateSettlePremiumFrom({
      client,
      poolAddress,
      account,
      user,
      positionIdListFrom: [9n],
      positionIdList: [1n],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.premium0).toBe(0n)
    expect(result.data.premium1).toBe(0n)
  })

  it('reorders the list so the settled tokenId is last', async () => {
    await simulateSettlePremiumFrom({
      client,
      poolAddress,
      account,
      user,
      positionIdListFrom: [],
      positionIdList: [1n, 2n, 3n],
      tokenId: 1n,
    })

    const callData = simulateWithTokenFlow.mock.calls[0][0].callData
    const { args } = decodeDispatchArgs(callData)
    expect(args?.[2]).toEqual([2n, 3n, 1n])
    expect(args?.[3]).toEqual([2n, 3n, 1n])
  })

  it('returns a soft failure when the target account is insolvent', async () => {
    simulateWithTokenFlow.mockResolvedValue({
      success: false,
      error: 'execution reverted: AccountInsolvent(0, 4)',
    })

    const result = await simulateSettlePremiumFrom({
      client,
      poolAddress,
      account,
      user,
      positionIdListFrom: [],
      positionIdList: [1n],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.canSettle).toBe(false)
    expect(result.data.reason).toMatch(/insolvent/i)
    expect(result.data.premium0).toBe(0n)
  })

  it('returns a soft failure when the target position list is stale', async () => {
    simulateWithTokenFlow.mockResolvedValue({
      success: false,
      error: 'execution reverted: InputListFail()',
    })

    const result = await simulateSettlePremiumFrom({
      client,
      poolAddress,
      account,
      user,
      positionIdListFrom: [],
      positionIdList: [1n],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.canSettle).toBe(false)
  })

  it('returns a failed result for unexpected reverts', async () => {
    simulateWithTokenFlow.mockRejectedValue(new Error('boom'))

    const result = await simulateSettlePremiumFrom({
      client,
      poolAddress,
      account,
      user,
      positionIdListFrom: [],
      positionIdList: [1n],
    })

    expect(result.success).toBe(false)
  })
})
