import { createPublicClient, createWalletClient, custom, decodeFunctionData, isHex } from 'viem'
import { simulateCalls } from 'viem/actions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { getPoolMetadata } from '../reads/pool'
import { openPosition } from '../writes/position'
import type { DispatchIntent } from './creditWrap'
import { assertDispatchWithdrawal, WithdrawalShortfallError } from './dispatchWithdrawal'
import { getTokenShortfallAmount } from './tokenShortfallRecovery'

vi.mock('../reads/pool', () => ({ getPoolMetadata: vi.fn() }))
vi.mock(import('viem/actions'), async (original) => ({
  ...(await original()),
  simulateCalls: vi.fn(),
}))
const poolAddress = '0x0000000000000000000000000000000000000001'
const account = '0x0000000000000000000000000000000000000002'
const trackers = [
  '0x0000000000000000000000000000000000000003',
  '0x0000000000000000000000000000000000000004',
] as const
const client = createPublicClient({ transport: custom({ request: vi.fn() }) })
const dispatch = {
  positionIdList: [11n],
  finalPositionIdList: [10n, 11n],
  positionSizes: [100n],
  tickAndSpreadLimits: [[-30n, 30n, 0n]],
  usePremiaAsCollateral: false,
  builderCode: 0n,
} satisfies DispatchIntent
const tokenFlow = {
  delta0: 0n,
  delta1: 0n,
  balanceBefore0: 20n,
  balanceBefore1: 20n,
  balanceAfter0: 20n,
  balanceAfter1: 20n,
  tickBefore: 0n,
  tickAfter: 0n,
}
function simulatedResults(count: number, failed = false) {
  return {
    assetChanges: [],
    block: {},
    results: Array.from({ length: count }, (_, index) =>
      index === count - 1 && failed
        ? { status: 'failure', error: new Error('Unsafe withdrawal'), data: '0x', gasUsed: 1n }
        : { status: 'success', result: undefined, data: '0x', gasUsed: 1n },
    ),
  } as unknown as Awaited<ReturnType<typeof simulateCalls>>
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPoolMetadata).mockResolvedValue({
    collateralToken0Address: trackers[0],
    collateralToken1Address: trackers[1],
  } as unknown as Awaited<ReturnType<typeof getPoolMetadata>>)
  vi.mocked(simulateCalls).mockResolvedValue(simulatedResults(2))
})
describe('full dispatch payment verification', () => {
  it.each([0n, 1n] as const)(
    'checks the exact payment and every final position in token frame %s',
    async (tokenIndex) => {
      await assertDispatchWithdrawal({
        client,
        poolAddress,
        account,
        dispatch,
        tokenFlow,
        requiredWithdrawal: { tokenIndex, assets: 10n },
        blockNumber: 123n,
      })
      const params = vi.mocked(simulateCalls).mock.calls[0]?.[1]
      expect(params).toMatchObject({
        account,
        blockNumber: 123n,
        validation: false,
        calls: [{ to: poolAddress }, { to: trackers[Number(tokenIndex)] }],
      })
      const call = params?.calls[1]
      if (
        !call ||
        typeof call !== 'object' ||
        !('data' in call) ||
        typeof call.data !== 'string' ||
        !isHex(call.data)
      )
        throw new Error('Missing payment simulation')
      const data = call.data
      expect(decodeFunctionData({ abi: collateralTrackerV2Abi, data })).toMatchObject({
        functionName: 'withdraw',
        args: [10n, account, account, [10n, 11n], false],
      })
    },
  )
  it('reports a distinct post-opening funding shortfall without treating the principal as additional costs', async () => {
    try {
      await assertDispatchWithdrawal({
        client,
        poolAddress,
        account,
        dispatch,
        tokenFlow: { ...tokenFlow, balanceAfter1: 2n },
        requiredWithdrawal: { tokenIndex: 1n, assets: 10n },
      })
      throw new Error('Expected a funding shortfall')
    } catch (error) {
      expect(error).toBeInstanceOf(WithdrawalShortfallError)
      expect(getTokenShortfallAmount(error)).toEqual({
        tokenAddress: trackers[1],
        amount: 9n,
        fundingStage: 'withdrawal',
      })
    }
    expect(simulateCalls).not.toHaveBeenCalled()
  })
  it('verifies funding an existing position without adding permanent positions', async () => {
    vi.mocked(simulateCalls).mockResolvedValue(simulatedResults(1))
    await assertDispatchWithdrawal({
      client,
      poolAddress,
      account,
      dispatch: { ...dispatch, positionIdList: [], positionSizes: [], tickAndSpreadLimits: [] },
      requiredWithdrawal: { tokenIndex: 1n, assets: 10n },
    })
    expect(vi.mocked(simulateCalls).mock.calls[0]?.[1].calls).toHaveLength(1)
  })
  it('rejects incomplete simulation results', async () => {
    vi.mocked(simulateCalls).mockResolvedValue(simulatedResults(1))
    await expect(
      assertDispatchWithdrawal({
        client,
        poolAddress,
        account,
        dispatch,
        requiredWithdrawal: { tokenIndex: 1n, assets: 10n },
      }),
    ).rejects.toThrow('incomplete')
  })
  it('includes buyer settlements before the exact opening and payment sequence', async () => {
    await assertDispatchWithdrawal({
      client,
      poolAddress,
      account,
      dispatch,
      requiredWithdrawal: { tokenIndex: 1n, assets: 10n },
      settleSequence: {
        positionIdListFrom: [10n],
        targets: [{ user: trackers[0], positionIdList: [33n], tokenId: 33n }],
      },
    })
    const call = vi.mocked(simulateCalls).mock.calls[0]?.[1].calls[0]
    if (
      !call ||
      typeof call !== 'object' ||
      !('data' in call) ||
      typeof call.data !== 'string' ||
      !isHex(call.data)
    )
      throw new Error('Missing opening sequence')
    const decoded = decodeFunctionData({ abi: panopticPoolV2Abi, data: call.data })
    if (decoded.functionName !== 'multicall') throw new Error('Expected an atomic opening sequence')
    expect(decoded.args[0]).toHaveLength(2)
    expect(
      decodeFunctionData({ abi: panopticPoolV2Abi, data: decoded.args[0][0] ?? '0x' }).functionName,
    ).toBe('dispatchFrom')
    expect(
      decodeFunctionData({ abi: panopticPoolV2Abi, data: decoded.args[0][1] ?? '0x' }).functionName,
    ).toBe('dispatch')
  })
  it('does not request a wallet transaction when the full payment simulation fails', async () => {
    vi.mocked(simulateCalls).mockResolvedValue(simulatedResults(2, true))
    const request = vi.fn()
    const walletClient = createWalletClient({ transport: custom({ request }) })
    await expect(
      openPosition({
        client,
        walletClient,
        account,
        poolAddress,
        existingPositionIds: [10n],
        tokenId: 11n,
        positionSize: 100n,
        tickLimitLow: -30n,
        tickLimitHigh: 30n,
        requiredWithdrawal: { tokenIndex: 1n, assets: 10n },
      }),
    ).rejects.toThrow('full upfront payment')
    expect(request).not.toHaveBeenCalled()
  })
  it('fails closed when sequential simulation is unavailable', async () => {
    vi.mocked(simulateCalls).mockRejectedValue(new Error('Unsupported simulation method'))
    await expect(
      assertDispatchWithdrawal({
        client,
        poolAddress,
        account,
        dispatch,
        requiredWithdrawal: { tokenIndex: 1n, assets: 10n },
      }),
    ).rejects.toThrow('Unsupported simulation method')
  })
})
