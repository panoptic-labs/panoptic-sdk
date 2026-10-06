import type { PublicClient } from 'viem'
import { ContractFunctionRevertedError } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getPriceHistory } from '../panoptic/v2/reads/priceHistory'
import { getUniswapV3LpPositionState } from '../panoptic/v2/reads/uniswapLpPosition'
import { getV3LpHistoryAccounting } from './lpAccounting'

vi.mock('../panoptic/v2/reads/priceHistory', () => ({ getPriceHistory: vi.fn() }))
vi.mock('../panoptic/v2/reads/uniswapLpPosition', () => ({ getUniswapV3LpPositionState: vi.fn() }))
const address = '0x1111111111111111111111111111111111111111'
const blockHash = `0x${'ab'.repeat(32)}` as const
const meta = { blockNumber: 10n, blockHash, blockTimestamp: 1000n }
const readContract = vi.fn().mockResolvedValue(address)
const client = {
  getBlock: vi.fn().mockResolvedValue({ number: 10n, hash: blockHash, timestamp: 1000n }),
  readContract,
} as unknown as PublicClient
const event = {
  id: 'mint',
  hash: blockHash,
  blockNumber: 1n,
  logIndex: 0n,
  timestamp: 100n,
  eventType: 'Mint' as const,
  liquidity: 100n,
  amount0: 1n,
  amount1: 1n,
  amountSource: 'ExactEvent',
}
const history = {
  events: [event],
  version: 3 as const,
  positionId: 'v3-1',
  blockNumber: 10n,
  blockHash,
}
const input = {
  client,
  history,
  nfpmAddress: address,
  poolAddress: address,
  tickLower: -100n,
  tickUpper: 100n,
  token0Decimals: 0,
  token1Decimals: 0,
} as const
beforeEach(() => {
  vi.clearAllMocks()
  readContract.mockResolvedValue(address)
  vi.mocked(getPriceHistory).mockImplementation(async ({ blockNumbers }) => ({
    snapshots: blockNumbers.map((blockNumber) => ({
      blockNumber,
      tick: 0,
      sqrtPriceX96: 1n << 96n,
    })),
    _meta: meta,
  }))
  vi.mocked(getUniswapV3LpPositionState).mockResolvedValue({
    token0: address,
    token1: address,
    fee: 500,
    tickLower: -100,
    tickUpper: 100,
    liquidity: 100n,
    fees0: 5n,
    fees1: 6n,
    _meta: meta,
  })
})

describe('LP accounting checkpoint reads', () => {
  it('pins owner, claimable amounts, and price reads to indexed blocks', async () => {
    const result = await getV3LpHistoryAccounting(input)
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'ownerOf', blockNumber: 10n }),
    )
    expect(getUniswapV3LpPositionState).toHaveBeenCalledWith(
      expect.objectContaining({ owner: address, blockNumber: 10n }),
    )
    expect(getPriceHistory).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumbers: [10n, 1n], _meta: meta }),
    )
    expect(result.fees0).toBe(5n)
    expect(result.fees1).toBe(6n)
  })

  it('retains reconciled fees when historical cash-flow prices are unavailable', async () => {
    vi.mocked(getPriceHistory).mockRejectedValueOnce(new Error('Archive unavailable'))
    const result = await getV3LpHistoryAccounting(input)
    expect(result.fees0).toBe(5n)
    expect(result.fees1).toBe(6n)
    expect(result.quote0).toBeNull()
    expect(result.quote1).toBeNull()
  })

  it('refuses mismatched indexed state and missing v4 collections', async () => {
    await expect(
      getV3LpHistoryAccounting({
        ...input,
        history: { ...history, blockHash: `0x${'cd'.repeat(32)}` },
      }),
    ).rejects.toThrow('checkpoint changed')
    await expect(
      getV3LpHistoryAccounting({ ...input, history: { ...history, version: 4 } }),
    ).rejects.toThrow('V4 fee collections')
    vi.mocked(getUniswapV3LpPositionState).mockResolvedValueOnce({
      token0: address,
      token1: address,
      fee: 500,
      tickLower: -100,
      tickUpper: 100,
      liquidity: 200n,
      fees0: 0n,
      fees1: 0n,
      _meta: meta,
    })
    await expect(getV3LpHistoryAccounting(input)).rejects.toThrow(
      'liquidity history does not reconcile',
    )
  })

  it('allows a burned NFT but never treats an RPC failure as a burned NFT', async () => {
    const closed = {
      ...input,
      history: {
        ...history,
        events: [
          event,
          { ...event, id: 'burn', blockNumber: 2n, eventType: 'Burn' as const },
          {
            ...event,
            id: 'collect',
            blockNumber: 3n,
            eventType: 'Collect' as const,
            amountSource: 'ExactEvent' as const,
            recipient: address,
            amount0: 2n,
            amount1: 3n,
          },
        ],
      },
    }
    readContract.mockRejectedValueOnce(
      new ContractFunctionRevertedError({ abi: [], functionName: 'ownerOf' }),
    )
    const result = await getV3LpHistoryAccounting(closed)
    expect(result.fees0).toBe(1n)
    expect(result.fees1).toBe(2n)
    expect(getUniswapV3LpPositionState).not.toHaveBeenCalled()
    readContract.mockRejectedValueOnce(new Error('RPC unavailable'))
    await expect(getV3LpHistoryAccounting(closed)).rejects.toThrow('RPC unavailable')
  })
})
