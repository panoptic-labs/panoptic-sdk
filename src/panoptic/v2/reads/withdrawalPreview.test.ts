import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  isHex,
  zeroHash,
} from 'viem'
import { simulateCalls } from 'viem/actions'
import { beforeEach, expect, it, vi } from 'vitest'

import { collateralTrackerV2Abi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients'
import { getWithdrawalPreview } from './withdrawalPreview'

vi.mock('../clients', () => ({ getBlockMeta: vi.fn() }))
vi.mock(import('viem/actions'), async (original) => ({
  ...(await original()),
  simulateCalls: vi.fn(),
}))
const account = '0x0000000000000000000000000000000000000001'
const poolAddress = '0x0000000000000000000000000000000000000002'
const queryAddress = '0x0000000000000000000000000000000000000003'
const trackers = [
  '0x0000000000000000000000000000000000000004',
  '0x0000000000000000000000000000000000000005',
] as const
const client = createPublicClient({ transport: custom({ request: vi.fn() }) })
const params = {
  client,
  account,
  poolAddress,
  queryAddress,
  collateralTrackerAddress: trackers[0],
  assets: 100n,
  positionIdList: [11n, 22n, 33n],
} satisfies Parameters<typeof getWithdrawalPreview>[0]
function result(balance0: bigint, required0: bigint, balance1: bigint, required1: bigint) {
  const data = encodeFunctionResult({
    abi: panopticQueryAbi,
    functionName: 'checkCollateral',
    result: [
      [balance0, 0n, 0n, 0n],
      [required0, 0n, 0n, 0n],
      [balance1, 0n, 0n, 0n],
      [required1, 0n, 0n, 0n],
    ],
  })
  return {
    assetChanges: [],
    block: {},
    results: [
      { status: 'success', data: '0x', gasUsed: 1n },
      { status: 'success', data, gasUsed: 1n },
    ],
  } as unknown as Awaited<ReturnType<typeof simulateCalls>>
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBlockMeta).mockResolvedValue({
    blockNumber: 123n,
    blockHash: zeroHash,
    blockTimestamp: 456n,
  })
})
it.each([0, 1] as const)(
  'checks BPU after withdrawing the exact amount, with mixed units and all positions (token %s)',
  async (tokenIndex) => {
    const amount = tokenIndex === 0 ? 10n ** 18n : 10n ** 6n
    vi.mocked(simulateCalls).mockResolvedValue(
      result(10n ** 18n, 75n * 10n ** 16n, 10n ** 6n, 800000n),
    )
    const preview = await getWithdrawalPreview({
      ...params,
      collateralTrackerAddress: trackers[tokenIndex],
      assets: amount,
    })
    expect(preview.usageBps).toBe(8000n)
    const request = vi.mocked(simulateCalls).mock.calls[0]?.[1]
    expect(request).toMatchObject({ account, blockNumber: 123n, validation: false })
    expect(request?.calls).toHaveLength(2)
    const first = request?.calls[0]
    const second = request?.calls[1]
    if (
      !first ||
      !second ||
      typeof first !== 'object' ||
      typeof second !== 'object' ||
      !('data' in first) ||
      !('data' in second) ||
      typeof first.data !== 'string' ||
      typeof second.data !== 'string' ||
      !isHex(first.data) ||
      !isHex(second.data)
    )
      throw new Error('Missing simulation calls')
    expect(first).toMatchObject({ to: trackers[tokenIndex] })
    expect(decodeFunctionData({ abi: collateralTrackerV2Abi, data: first.data })).toMatchObject({
      functionName: 'withdraw',
      args: [amount, account, account, params.positionIdList, false],
    })
    expect(decodeFunctionData({ abi: panopticQueryAbi, data: second.data })).toMatchObject({
      functionName: 'checkCollateral',
      args: [poolAddress, account, params.positionIdList],
    })
  },
)
it('uses the binding side and rounds upward so just over 80% cannot pass', async () => {
  vi.mocked(simulateCalls).mockResolvedValue(result(1000000n, 800001n, 100n, 10n))
  expect((await getWithdrawalPreview(params)).usageBps).toBe(8001n)
})
it('handles zero balances and rejects missing margin data', async () => {
  vi.mocked(simulateCalls).mockResolvedValue(result(0n, 1n, 100n, 10n))
  expect((await getWithdrawalPreview(params)).usageBps).toBeGreaterThan(8000n)
  vi.mocked(simulateCalls).mockResolvedValue(result(0n, 0n, 0n, 0n))
  expect((await getWithdrawalPreview(params)).usageBps).toBe(0n)
  const missing = result(1n, 1n, 1n, 1n)
  missing.results.pop()
  vi.mocked(simulateCalls).mockResolvedValue(missing)
  await expect(getWithdrawalPreview(params)).rejects.toThrow('Incomplete')
})
it('fails closed when withdrawal simulation or the RPC fails', async () => {
  vi.mocked(simulateCalls).mockRejectedValue(new Error('RPC unavailable'))
  await expect(getWithdrawalPreview(params)).rejects.toThrow('RPC unavailable')
  const failure = result(100n, 10n, 100n, 10n)
  failure.results[0] = {
    status: 'failure',
    error: new Error('Insufficient collateral'),
    data: '0x',
    gasUsed: 1n,
  }
  vi.mocked(simulateCalls).mockResolvedValue(failure)
  await expect(getWithdrawalPreview(params)).rejects.toThrow('Insufficient collateral')
})
