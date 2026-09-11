import type { PublicClient } from 'viem'
import { encodeErrorResult } from 'viem'
import { beforeEach, expect, it, vi } from 'vitest'

import { getMaxLpPositionSize } from '../../../uniswap/lpDeposit'
import { PanopticError } from '../errors'
import { panopticErrorsAbi } from '../errors/errorsAbi'
import { simulateDispatch } from '../simulations/simulateDispatch'
import { readLpFundingSnapshot } from './lpFunding'
import { getExecutableLpMaxSize } from './lpMaxSize'
vi.mock('../../../uniswap/lpDeposit', () => ({ getMaxLpPositionSize: vi.fn() }))
vi.mock('./lpFunding', () => ({ readLpFundingSnapshot: vi.fn() }))
vi.mock('../simulations/simulateDispatch', () => ({ simulateDispatch: vi.fn() }))
const meta = { blockNumber: 123n, blockTimestamp: 1n, blockHash: '0x01' as const }
const params = {
  client: {} as PublicClient,
  poolAddress: '0x0000000000000000000000000000000000000001' as const,
  account: '0x0000000000000000000000000000000000000002' as const,
  queryAddress: '0x0000000000000000000000000000000000000003' as const,
  tokenId: 1n,
  existingPositionIds: [2n, 3n],
  chainId: 1n,
  slippageBps: 50n,
  quoteTokenIndex: 0 as const,
}
const success = {
  success: true as const,
  gasEstimate: 1n,
  _meta: meta,
  data: {
    netAmount0: 0n,
    netAmount1: 0n,
    premiaReceived0: null,
    premiaReceived1: null,
    positionsCreated: [],
    positionsClosed: [],
    postCollateral0: 1n,
    postCollateral1: 1n,
    preMarginExcess0: null,
    preMarginExcess1: null,
    postMarginExcess0: null,
    postMarginExcess1: null,
  },
}
const candidateSizeError = new PanopticError(
  'execution reverted',
  Object.assign(new Error('PriceBoundFail'), {
    data: encodeErrorResult({ abi: panopticErrorsAbi, errorName: 'PriceBoundFail', args: [0] }),
  }),
)
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getMaxLpPositionSize).mockReturnValue(1000n)
  const amounts = { amount0: 0n, amount1: 0n }
  vi.mocked(readLpFundingSnapshot).mockResolvedValue({
    currentTick: 0n,
    blockNumber: 123n,
    _meta: meta,
    availableInQuote: 1000n,
    fundingParams: {
      tokenId: 1n,
      positionSize: 0n,
      tickSpacing: 10n,
      sqrtPriceX96: 1n << 96n,
      valuationSqrtPriceX96: 1n << 96n,
      quoteTokenIndex: 0,
    },
    funding: {
      principal: amounts,
      buffer: amounts,
      total: amounts,
      principalInQuote: 0n,
      bufferInQuote: 0n,
      totalInQuote: 0n,
    },
  })
})
it('verifies the upper bound with all existing positions at the funding block', async () => {
  vi.mocked(simulateDispatch).mockResolvedValue(success)
  expect((await getExecutableLpMaxSize(params)).maxSize).toBe(1000n)
  expect(simulateDispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      blockNumber: 123n,
      existingPositionIdList: [2n, 3n],
      finalPositionIdList: [2n, 3n, 1n],
    }),
  )
})
it('returns a tested lower size when the upper bound reverts', async () => {
  vi.mocked(simulateDispatch).mockImplementation(async (args) =>
    (args.positionSizes[0] ?? 0n) <= 600n
      ? success
      : { success: false, error: candidateSizeError, _meta: meta },
  )
  expect((await getExecutableLpMaxSize(params)).maxSize).toBe(600n)
})
it('does not turn RPC failures into a smaller MAX', async () => {
  vi.mocked(simulateDispatch).mockResolvedValue({
    success: false,
    error: new PanopticError('RPC reverted connection'),
    _meta: meta,
  })
  await expect(getExecutableLpMaxSize(params)).rejects.toThrow('RPC reverted connection')
  expect(simulateDispatch).toHaveBeenCalledTimes(1)
})
