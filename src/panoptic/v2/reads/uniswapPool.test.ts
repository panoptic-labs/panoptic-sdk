import type { Address, Hex, PublicClient } from 'viem'
import { zeroAddress } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getUniswapV4PoolBasicState, getUniswapV4PoolInfo } from './uniswapPool'

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
