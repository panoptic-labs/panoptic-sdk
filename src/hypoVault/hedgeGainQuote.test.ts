import type { PublicClient } from 'viem'
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../generated'
import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import { createTokenIdBuilder } from '../panoptic/v2/tokenId/builder'
import {
  type VaultHedgeBookSnapshot,
  quoteProtectedVaultHedge,
  readVaultHedgeBook,
} from './hedgeGainQuote'

const mocks = vi.hoisted(() => ({
  simulateWithTokenFlow: vi.fn(),
  getPositionValueCurve: vi.fn(),
  getOpenPositionIds: vi.fn(),
}))
vi.mock('../panoptic/v2/sync/getTrackedPositionIds', () => ({
  getOpenPositionIds: mocks.getOpenPositionIds,
}))
vi.mock('../panoptic/v2/simulations/tokenFlow', () => ({
  simulateWithTokenFlow: mocks.simulateWithTokenFlow,
}))
vi.mock('../panoptic/v2/reads/positionValueCurve', () => ({
  getPositionValueCurve: mocks.getPositionValueCurve,
}))
const client = {} as PublicClient
const address = '0x1111111111111111111111111111111111111111'
const option = createTokenIdBuilder(10n << 48n)
  .addCall({ asset: 1n, isLong: true, strike: 200000n, width: 100n, optionRatio: 1n })
  .build()
const loan = createTokenIdBuilder(10n << 48n)
  .addLoan({ asset: 1n, tokenType: 1n, strike: 200000n })
  .build()
const size = 10n ** 18n
const curve = [
  { tick: 190000n, value0: 0n, value1: 0n },
  { tick: 210000n, value0: 0n, value1: 0n },
]
const snapshot = {
  book: {
    curve,
    balances: [10n ** 12n, 10n ** 18n],
    numeraireIndex: 0n,
    sqrtPriceX96: tickToSqrtPriceX96(200000n),
  },
  blockNumber: 100n,
  blockHash: `0x${'11'.repeat(32)}`,
  metadata: { tickSpacing: 10n, fee: 500n, token0Decimals: 6n, token1Decimals: 18n },
  account: address,
  poolAddress: address,
  queryAddress: address,
  positions: [{ tokenId: option, positionSize: size }],
  collateral: [10n ** 12n, 10n ** 18n],
  wallet: [0n, 0n],
  fullCall: '0x1234',
} as unknown as VaultHedgeBookSnapshot
const full = (ids: bigint[]) =>
  encodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    result: [0n, 0n, ids.map(() => size), ids.map(() => 0n), ids.map(() => 0n)],
  })
const dispatch = (
  operations = [loan],
  final = [option, loan],
  sizes = [size],
  limits: readonly (readonly [number, number, number])[] = [[200030, 199970, 0]],
) =>
  encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [operations, final, sizes, limits, false, 0n],
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getPositionValueCurve.mockResolvedValue(curve)
  mocks.simulateWithTokenFlow.mockResolvedValue({
    success: true,
    tokenFlow: {
      balanceBefore0: snapshot.collateral[0],
      balanceBefore1: snapshot.collateral[1],
      balanceAfter0: snapshot.collateral[0],
      balanceAfter1: snapshot.collateral[1],
    },
    preCallResults: [full([option])],
    postCallResults: [full([option, loan])],
  })
})

describe('transaction-bound protected hedge quote', () => {
  it('pins balances and pending premium to a complete confirmed block', async () => {
    const metadata = {
      isV4: false,
      token0Asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      token1Asset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      token0Decimals: 6n,
      token1Decimals: 18n,
    } as unknown as VaultHedgeBookSnapshot['metadata']
    const multicall = vi
      .fn()
      .mockResolvedValue([
        [5n, 9n, [size], [0n], [0n]],
        1n,
        [10_000000n, size],
        [snapshot.book.sqrtPriceX96, 200000],
        1_000000n,
        2n * size,
      ])
    const publicClient = {
      chain: { id: 1 },
      getBlock: vi.fn().mockResolvedValue({ number: 100n, hash: `0x${'11'.repeat(32)}` }),
      multicall,
      getBalance: vi.fn().mockResolvedValue(3n * size),
    } as unknown as PublicClient
    mocks.getOpenPositionIds.mockResolvedValue([option])
    const parameters = {
      client: publicClient,
      poolAddress: address,
      account: address,
      queryAddress: address,
      numeraire: metadata.token0Asset,
      blockNumber: 100n,
      metadata,
    } as const
    const book = await readVaultHedgeBook(parameters)
    expect(book.book.balances).toEqual([10_999996n, 6n * size])
    expect(mocks.getOpenPositionIds).toHaveBeenCalledWith(
      expect.objectContaining({ toBlock: 100n }),
    )
    expect(multicall).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: 100n, allowFailure: false }),
    )
    multicall.mockResolvedValueOnce([
      [5n, 9n, [size], [0n], [0n]],
      2n,
      [10_000000n, size],
      [snapshot.book.sqrtPriceX96, 200000],
      1_000000n,
      2n * size,
    ])
    await expect(readVaultHedgeBook(parameters)).rejects.toThrow('leg count')
  })

  it('measures the exact dispatch at its snapshot block and reserves execution drift in the received token', async () => {
    const data = dispatch()
    const result = await quoteProtectedVaultHedge({
      client,
      snapshot,
      dispatchData: data,
      anchor: { sqrtPriceX96: snapshot.book.sqrtPriceX96, actualValue: 0n },
    })
    expect(mocks.simulateWithTokenFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        callData: data,
        blockNumber: 100n,
        user: address,
        estimateGas: false,
        preCallData: [snapshot.fullCall],
      }),
    )
    const requested = mocks.simulateWithTokenFlow.mock.calls[0][0]
    expect(
      decodeFunctionData({ abi: panopticPoolV2Abi, data: requested.postCallData[0] }).args,
    ).toEqual([address, true, [option, loan]])
    expect(result.executionReserve[0]).toBeGreaterThan(0n)
    expect(result.executionReserve[1]).toBe(0n)
    expect(result.protectedGain).toBe(0n)
  })

  it('rejects missing core positions, option operations and stale bounds before requesting authority', async () => {
    await expect(
      quoteProtectedVaultHedge({ client, snapshot, dispatchData: dispatch([loan], [loan]) }),
    ).rejects.toThrow('Incomplete final')
    await expect(
      quoteProtectedVaultHedge({
        client,
        snapshot,
        dispatchData: dispatch([option], [option], [0n]),
      }),
    ).rejects.toThrow('standalone loan')
    await expect(
      quoteProtectedVaultHedge({
        client,
        snapshot,
        dispatchData: dispatch([loan], [option, loan], [size], [[201000, 200500, 0]]),
      }),
    ).rejects.toThrow('bounds are stale')
    expect(mocks.simulateWithTokenFlow).not.toHaveBeenCalled()
  })

  it('fails closed when the simulation or its before/after accounting cannot be verified', async () => {
    mocks.simulateWithTokenFlow.mockResolvedValueOnce({ success: false, error: 'Margin failure' })
    await expect(
      quoteProtectedVaultHedge({ client, snapshot, dispatchData: dispatch() }),
    ).rejects.toThrow('Margin failure')
    mocks.simulateWithTokenFlow.mockResolvedValueOnce({
      success: true,
      tokenFlow: { balanceBefore0: 1n, balanceBefore1: 0n },
      preCallResults: [full([option])],
      postCallResults: [full([option, loan])],
    })
    await expect(
      quoteProtectedVaultHedge({ client, snapshot, dispatchData: dispatch() }),
    ).rejects.toThrow('confirmed snapshot')
  })

  it('bounds both borrowing directions and swapped burns as well as mints', async () => {
    const otherLoan = createTokenIdBuilder(10n << 48n)
      .addLoan({ asset: 1n, tokenType: 0n, strike: 200000n })
      .build()
    mocks.simulateWithTokenFlow.mockResolvedValueOnce({
      success: true,
      tokenFlow: {
        balanceBefore0: snapshot.collateral[0],
        balanceBefore1: snapshot.collateral[1],
        balanceAfter0: snapshot.collateral[0],
        balanceAfter1: snapshot.collateral[1],
      },
      preCallResults: [full([option])],
      postCallResults: [full([option, otherLoan])],
    })
    const other = await quoteProtectedVaultHedge({
      client,
      snapshot,
      dispatchData: dispatch([otherLoan], [option, otherLoan]),
    })
    expect(other.executionReserve[0]).toBe(0n)
    expect(other.executionReserve[1]).toBeGreaterThan(0n)
    const held = {
      ...snapshot,
      positions: [...snapshot.positions, { tokenId: loan, positionSize: size }],
    }
    mocks.simulateWithTokenFlow.mockResolvedValueOnce({
      success: true,
      tokenFlow: {
        balanceBefore0: snapshot.collateral[0],
        balanceBefore1: snapshot.collateral[1],
        balanceAfter0: snapshot.collateral[0],
        balanceAfter1: snapshot.collateral[1],
      },
      preCallResults: [full([option, loan])],
      postCallResults: [full([option])],
    })
    const burn = await quoteProtectedVaultHedge({
      client,
      snapshot: held,
      dispatchData: dispatch([loan], [option], [0n]),
    })
    expect(burn.executionReserve[0]).toBeGreaterThan(0n)
    expect(burn.executionReserve[1]).toBe(0n)
  })
})
