import type { PublicClient, WalletClient } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotEnoughTokensError } from '../errors'
import { getPool } from '../reads/pool'
import { simulateDispatch } from '../simulations/simulateDispatch'
import { createTokenIdBuilder } from '../tokenId/builder'
import { decodeAllLegs } from '../tokenId/encoding'
import { type PreviewRepayParams, previewRepay, smartRepay } from './lending'
import { submitWrite } from './utils'

vi.mock('../reads/pool', () => ({ getPool: vi.fn() }))
vi.mock('../simulations/simulateDispatch', () => ({ simulateDispatch: vi.fn() }))
vi.mock('./utils', () => ({ submitWrite: vi.fn() }))

const token0 = '0x0000000000000000000000000000000000000010'
const token1 = '0x0000000000000000000000000000000000000011'
const account = '0x0000000000000000000000000000000000000020'
const poolAddress = '0x0000000000000000000000000000000000000030'
const tracker = '0x0000000000000000000000000000000000000040'
const shortfall = new NotEnoughTokensError(tracker, 30_000_000n, 29_990_994n)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getPool).mockResolvedValue({
    poolId: 1n,
    currentTick: 0n,
    tickSpacing: 10n,
    collateralTracker0: { token: token0 },
    collateralTracker1: { token: token1 },
  } as unknown as Awaited<ReturnType<typeof getPool>>)
  vi.mocked(simulateDispatch).mockResolvedValue({
    success: false,
    error: shortfall,
    _meta: { blockNumber: 1n, blockTimestamp: 1n, blockHash: '0x01' },
  })
})

describe.each([0n, 1n])('repay preview for token %s', (tokenIndex) => {
  const otherIndex = 1n - tokenIndex
  const loan = createTokenIdBuilder(1n)
    .addLoan({ asset: tokenIndex, tokenType: tokenIndex, strike: 0n })
    .build()
  const secondLoan = createTokenIdBuilder(1n)
    .addLoan({ asset: tokenIndex, tokenType: tokenIndex, strike: 10n, optionRatio: 2n })
    .build()
  const otherLoan = createTokenIdBuilder(1n)
    .addLoan({ asset: otherIndex, tokenType: otherIndex, strike: 0n })
    .build()
  const mixedPosition = createTokenIdBuilder(1n)
    .addLoan({ asset: tokenIndex, tokenType: tokenIndex, strike: 0n })
    .addLeg({
      asset: otherIndex,
      tokenType: otherIndex,
      strike: 0n,
      width: 10n,
      isLong: false,
      optionRatio: 1n,
    })
    .build()

  const params = (amount: bigint): PreviewRepayParams => ({
    client: {
      readContract: vi.fn().mockResolvedValue([[], [], [100n, 50n]]),
    } as unknown as PublicClient,
    account,
    poolAddress,
    chainId: 1n,
    token: tokenIndex === 0n ? token0 : token1,
    amount,
    slippageBps: 50n,
    existingPositionIds: [loan, otherLoan, secondLoan, mixedPosition],
    builderCode: 17n,
  })

  it('previews and sends identical full repayment, preserving other-token and mixed-leg positions', async () => {
    const input = params(200n)
    const result = await previewRepay(input)
    expect(result.simulation).toMatchObject({ success: false, error: shortfall })
    expect(result.dispatch).toMatchObject({
      positionIdList: [loan, secondLoan],
      positionSizes: [0n, 0n],
      finalPositionIdList: [otherLoan, mixedPosition],
      builderCode: 17n,
    })
    await smartRepay({ ...input, walletClient: {} as WalletClient })
    const args = vi.mocked(submitWrite).mock.calls[0]?.[0].args
    expect(args).toEqual([
      result.dispatch.positionIdList,
      result.dispatch.finalPositionIdList,
      result.dispatch.positionSizes,
      result.dispatch.tickAndSpreadLimits.map((limits) => limits.map(Number)),
      false,
      17n,
    ])
    expect(simulateDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ existingPositionIdList: input.existingPositionIds }),
    )
  })

  it('uses option ratios when rebuilding the remainder for a partial repayment', async () => {
    const result = await previewRepay(params(75n))
    const newLoan = result.dispatch.positionIdList.at(-1)
    expect(newLoan).toBeDefined()
    if (newLoan === undefined) return
    const [leg] = decodeAllLegs(newLoan)
    expect(leg.tokenType).toBe(tokenIndex)
    expect((result.dispatch.positionSizes.at(-1) ?? 0n) * leg.optionRatio).toBe(125n)
    expect(result.dispatch.finalPositionIdList).toEqual([otherLoan, mixedPosition, newLoan])
  })

  it.each([0n, -1n])('rejects invalid amount %s before reading or simulating', async (amount) => {
    const input = params(amount)
    await expect(previewRepay(input)).rejects.toThrow('Repayment amount must be positive')
    expect(input.client.readContract).not.toHaveBeenCalled()
    expect(simulateDispatch).not.toHaveBeenCalled()
  })
})
