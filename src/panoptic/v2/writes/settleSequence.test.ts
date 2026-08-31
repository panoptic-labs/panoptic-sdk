import type { PublicClient, WalletClient } from 'viem'
import { decodeFunctionData } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import type { TxResult } from '../types'
import { buildSettleSequenceCalls, executeSettleSequence } from './settleSequence'
import { submitWrite } from './utils'

vi.mock('./utils', () => ({
  submitWrite: vi.fn(),
}))

const USER_A = '0x3333333333333333333333333333333333333333' as const
const USER_B = '0x4444444444444444444444444444444444444444' as const

const decode = (data: `0x${string}`) => decodeFunctionData({ abi: panopticPoolV2Abi, data })

describe('buildSettleSequenceCalls', () => {
  it('encodes one settle-mode dispatchFrom per target, settled tokenId last', () => {
    const calls = buildSettleSequenceCalls({
      positionIdListFrom: [9n],
      targets: [
        { user: USER_A, positionIdList: [1n, 2n], tokenId: 1n },
        { user: USER_B, positionIdList: [3n], tokenId: 3n },
      ],
    })

    expect(calls).toHaveLength(2)
    const first = decode(calls[0])
    expect(first.functionName).toBe('dispatchFrom')
    expect(first.args).toEqual([[9n], USER_A, [2n, 1n], [2n, 1n], 0n])
    const second = decode(calls[1])
    expect(second.args).toEqual([[9n], USER_B, [3n], [3n], 0n])
  })

  it('appends the close dispatch with swap-ordered tick limits', () => {
    const calls = buildSettleSequenceCalls({
      positionIdListFrom: [9n, 5n],
      targets: [{ user: USER_A, positionIdList: [1n], tokenId: 1n }],
      close: {
        tokenId: 5n,
        finalPositionIdList: [9n],
        tickLimitLow: -100n,
        tickLimitHigh: 200n,
        swapAtMint: true,
        builderCode: 7n,
      },
    })

    expect(calls).toHaveLength(2)
    const close = decode(calls[1])
    expect(close.functionName).toBe('dispatch')
    expect(close.args).toEqual([[5n], [9n], [0n], [[200, -100, 0]], false, 7n])
  })

  it('appends an arbitrary dispatch intent (reduce-size / batch shape)', () => {
    const calls = buildSettleSequenceCalls({
      positionIdListFrom: [9n],
      targets: [{ user: USER_A, positionIdList: [1n], tokenId: 1n }],
      dispatch: {
        positionIdList: [5n, 6n],
        finalPositionIdList: [9n, 6n],
        positionSizes: [0n, 100n],
        tickAndSpreadLimits: [
          [-10n, 10n, 0n],
          [-10n, 10n, 0n],
        ],
        usePremiaAsCollateral: true,
        builderCode: 3n,
      },
    })

    expect(calls).toHaveLength(2)
    const d = decode(calls[1])
    expect(d.functionName).toBe('dispatch')
    expect(d.args).toEqual([
      [5n, 6n],
      [9n, 6n],
      [0n, 100n],
      [
        [-10, 10, 0],
        [-10, 10, 0],
      ],
      true,
      3n,
    ])
  })

  it('rejects providing both close and dispatch', () => {
    expect(() =>
      buildSettleSequenceCalls({
        positionIdListFrom: [],
        targets: [],
        close: { tokenId: 1n, finalPositionIdList: [], tickLimitLow: 0n, tickLimitHigh: 1n },
        dispatch: {
          positionIdList: [],
          finalPositionIdList: [],
          positionSizes: [],
          tickAndSpreadLimits: [],
          usePremiaAsCollateral: false,
          builderCode: 0n,
        },
      }),
    ).toThrow('not both')
  })

  it('uses ascending tick limits when swapAtMint is false', () => {
    const calls = buildSettleSequenceCalls({
      positionIdListFrom: [5n],
      targets: [],
      close: {
        tokenId: 5n,
        finalPositionIdList: [],
        tickLimitLow: -100n,
        tickLimitHigh: 200n,
      },
    })

    const close = decode(calls[0])
    expect(close.args).toEqual([[5n], [], [0n], [[-100, 200, 0]], false, 0n])
  })
})

describe('executeSettleSequence', () => {
  it('submits the calls as one PanopticPool.multicall', async () => {
    const txResult: TxResult = { hash: '0x1234', wait: vi.fn() }
    vi.mocked(submitWrite).mockResolvedValue(txResult)

    await executeSettleSequence({
      client: {} as PublicClient,
      walletClient: {} as WalletClient,
      account: '0x1111111111111111111111111111111111111111',
      poolAddress: '0x2222222222222222222222222222222222222222',
      positionIdListFrom: [9n],
      targets: [{ user: USER_A, positionIdList: [1n], tokenId: 1n }],
    })

    expect(submitWrite).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: '0x2222222222222222222222222222222222222222',
        functionName: 'multicall',
        args: [expect.arrayContaining([expect.stringMatching(/^0x/)])],
      }),
    )
  })
})
