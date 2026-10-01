import type { Address, Hex, PublicClient } from 'viem'
import { stringToHex, zeroAddress } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import {
  getUniswapV3PoolInfo,
  getUniswapV3PoolLiquidities,
  getUniswapV4PoolBasicState,
  getUniswapV4PoolInfo,
} from './uniswapPool'

const STATE_VIEW = '0x1111111111111111111111111111111111111111' as Address
const POOL_ID = `0x${'22'.repeat(32)}` as Hex
const TOKEN0 = '0x3333333333333333333333333333333333333333' as Address
const TOKEN1 = '0x4444444444444444444444444444444444444444' as Address
const MOCK_BLOCK = {
  number: 1_000n,
  hash: `0x${'aa'.repeat(32)}`,
  timestamp: 1_700_000_000n,
}

type MockPoolReadClient = Pick<PublicClient, 'getBlock' | 'multicall'>

function createMockClient(multicallResults: unknown[] = []): MockPoolReadClient {
  return {
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    multicall: vi.fn().mockImplementation(() => Promise.resolve(multicallResults.shift())),
  }
}

const poolKey = {
  currency0: TOKEN0,
  currency1: TOKEN1,
  fee: 3_000,
  tickSpacing: 60,
  hooks: zeroAddress,
} as const

describe('Uniswap v4 pool reads', () => {
  it('exposes the packed slot0 protocol fee in basic state', async () => {
    const packedProtocolFee = (500 << 12) | 750
    const client = createMockClient([[[123n, 42, packedProtocolFee, 3_000], 456n]])

    const result = await getUniswapV4PoolBasicState({
      client,
      stateViewAddress: STATE_VIEW,
      poolId: POOL_ID,
    })

    expect(result.protocolFee).toBe(BigInt(packedProtocolFee))
    expect(result.lpFee).toBe(3_000)
  })

  it('preserves a zero packed protocol fee in basic state', async () => {
    const client = createMockClient([[[123n, 42, 0, 3_000], 456n]])

    const result = await getUniswapV4PoolBasicState({
      client,
      stateViewAddress: STATE_VIEW,
      poolId: POOL_ID,
    })

    expect(result.protocolFee).toBe(0n)
  })

  it('exposes the packed slot0 protocol fee in full pool info', async () => {
    const packedProtocolFee = (750 << 12) | 500
    const client = createMockClient([
      [[123n, -42, packedProtocolFee, 3_000], 456n],
      ['USDC', 'USD Coin', 6],
      ['WETH', 'Wrapped Ether', 18],
    ])

    const result = await getUniswapV4PoolInfo({
      client,
      stateViewAddress: STATE_VIEW,
      poolKey,
    })

    expect(result.protocolFee).toBe(BigInt(packedProtocolFee))
    expect(result.currentTick).toBe(-42)
  })

  it('uses synthetic metadata for native currency and preserves a zero fee', async () => {
    const client = createMockClient([
      [[123n, 42, 0, 3_000], 456n],
      ['WETH', 'Wrapped Ether', 18],
    ])

    const result = await getUniswapV4PoolInfo({
      client,
      stateViewAddress: STATE_VIEW,
      poolKey: { ...poolKey, currency0: zeroAddress },
    })

    expect(result.protocolFee).toBe(0n)
    expect(result.token0).toEqual({
      address: zeroAddress,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
    })
    expect(result.token1).toEqual({
      address: TOKEN1,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    })
    expect(client.multicall).toHaveBeenCalledTimes(2)
  })

  it('propagates getBlock failures from basic state reads', async () => {
    const error = new Error('getBlock failed')
    const client = createMockClient()
    vi.mocked(client.getBlock).mockRejectedValueOnce(error)

    await expect(
      getUniswapV4PoolBasicState({
        client,
        stateViewAddress: STATE_VIEW,
        poolId: POOL_ID,
      }),
    ).rejects.toBe(error)
    expect(client.multicall).not.toHaveBeenCalled()
  })

  it('propagates getBlock failures from full pool info reads', async () => {
    const error = new Error('getBlock failed')
    const client = createMockClient()
    vi.mocked(client.getBlock).mockRejectedValueOnce(error)

    await expect(
      getUniswapV4PoolInfo({
        client,
        stateViewAddress: STATE_VIEW,
        poolKey,
      }),
    ).rejects.toBe(error)
    expect(client.multicall).not.toHaveBeenCalled()
  })

  it('propagates multicall failures from basic state reads', async () => {
    const error = new Error('multicall failed')
    const client = createMockClient()
    vi.mocked(client.multicall).mockRejectedValueOnce(error)

    await expect(
      getUniswapV4PoolBasicState({
        client,
        stateViewAddress: STATE_VIEW,
        poolId: POOL_ID,
      }),
    ).rejects.toBe(error)
  })

  it('propagates multicall failures from full pool info reads', async () => {
    const error = new Error('multicall failed')
    const client = createMockClient()
    vi.mocked(client.multicall).mockRejectedValueOnce(error)

    await expect(
      getUniswapV4PoolInfo({
        client,
        stateViewAddress: STATE_VIEW,
        poolKey,
      }),
    ).rejects.toBe(error)
  })
})

describe('Uniswap v3 pool reads', () => {
  const POOL = '0x5555555555555555555555555555555555555555' as Address
  const poolResults = [[123n, -42, 0, 0, 0, 0, true], 3_000, 60, TOKEN0, TOKEN1, 456n]
  const ok = (result: unknown) => ({ status: 'success', result })
  const reverted = { status: 'failure', error: new Error('decode failed') }

  it('reads string token metadata in one pass', async () => {
    const client = createMockClient([
      poolResults,
      [ok('USDC'), ok('USD Coin'), ok('WETH'), ok('Wrapped Ether')],
      [6, 18],
    ])

    const result = await getUniswapV3PoolInfo({ client, poolAddress: POOL })

    expect(result.token0).toEqual({
      address: TOKEN0,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    })
    expect(result.token1.symbol).toBe('WETH')
    expect(result.currentTick).toBe(-42)
    expect(client.multicall).toHaveBeenCalledTimes(3)
  })

  it('falls back to bytes32 metadata for legacy tokens like MKR', async () => {
    const client = createMockClient([
      poolResults,
      [reverted, reverted, ok('WETH'), ok('Wrapped Ether')],
      [18, 18],
      [
        ok(stringToHex('MKR', { size: 32 })),
        ok(stringToHex('Maker', { size: 32 })),
        reverted,
        reverted,
      ],
    ])

    const result = await getUniswapV3PoolInfo({ client, poolAddress: POOL })

    expect(result.token0).toEqual({ address: TOKEN0, symbol: 'MKR', name: 'Maker', decimals: 18 })
    expect(result.token1).toEqual({
      address: TOKEN1,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    })
  })

  it('propagates a token whose metadata fits neither encoding', async () => {
    const client = createMockClient([
      poolResults,
      [reverted, ok('Maker'), ok('WETH'), ok('Wrapped Ether')],
      [18, 18],
      [reverted, ok(stringToHex('Maker', { size: 32 })), reverted, reverted],
    ])

    await expect(getUniswapV3PoolInfo({ client, poolAddress: POOL })).rejects.toThrow(
      'decode failed',
    )
  })
})

describe('Uniswap v3 liquidity window bounds', () => {
  it.each([
    { startTick: 887_000, tickSpacing: 60, nTicks: 100n, expected: 4n },
    { startTick: -887_000, tickSpacing: 60, nTicks: 100n, expected: 4n },
    { startTick: 0, tickSpacing: 60, nTicks: 100n, expected: 100n },
    { startTick: 887_270, tickSpacing: undefined, nTicks: 100n, expected: 2n },
    { startTick: -887_270, tickSpacing: undefined, nTicks: 100n, expected: 2n },
  ])('clamps the main window for $startTick with spacing $tickSpacing', async (params) => {
    const readContract = vi.fn().mockResolvedValue([[], []])
    const client = {
      getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
      readContract,
    } as unknown as PublicClient

    await getUniswapV3PoolLiquidities({
      client,
      poolAddress: TOKEN0,
      queryAddress: STATE_VIEW,
      startTick: params.startTick,
      tickSpacing: params.tickSpacing,
      nTicks: params.nTicks,
    })

    expect(readContract).toHaveBeenCalledTimes(1)
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'getTickNetsV3',
        args: [TOKEN0, params.startTick, params.expected],
        blockNumber: MOCK_BLOCK.number,
      }),
    )
  })
})
