/**
 * Tests for getMarginBuffer.
 *
 * The function now sources current margin from `CollateralTracker.assetsOf`
 * (gross deposits + borrowed shares) and required margin from
 * `PanopticPool.getFullPositionsData.collateralRequirements[]`, replacing
 * the prior `PanopticQuery.checkCollateral` call that netted the loan's
 * debt out of currentMargin.
 *
 * Tests use currentTick=0 so that `sqrtPriceX96 = 2^96` and the
 * token0↔token1 cross-conversion is identity (1:1), keeping the
 * arithmetic readable.
 *
 * @module v2/reads/margin.test
 */

import { type Address, type Hex, type PublicClient, encodeFunctionResult } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { Multicall3Abi } from '../../../abis/multicall3'
import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getMarginBuffer } from './margin'

const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const ACCOUNT_ADDRESS = '0x2222222222222222222222222222222222222222' as const
const QUERY_ADDRESS = '0x3333333333333333333333333333333333333333' as const
const CT0_ADDRESS = '0x4444444444444444444444444444444444444444' as const
const CT1_ADDRESS = '0x5555555555555555555555555555555555555555' as const
const COLLATERAL_ADDRESSES = {
  collateralToken0: CT0_ADDRESS as Address,
  collateralToken1: CT1_ADDRESS as Address,
}

const MOCK_BLOCK = {
  number: 12345678n,
  hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
  timestamp: 1700000000n,
}

const MIN_TICK_INT24 = -887272
const MAX_TICK_INT24 = 887272

function packLeftRightUnsigned(right: bigint, left: bigint): bigint {
  return right + (left << 128n)
}

/**
 * Build a getFullPositionsData mock result.
 * Outputs: [shortPremium, longPremium, balances[], collateralRequirements[], netPremia[]]
 */
type FullPositionsData = readonly [bigint, bigint, bigint[], bigint[], bigint[]]

function mockFullPositionsData(reqs: Array<{ token0: bigint; token1: bigint }>): FullPositionsData {
  return [
    0n, // shortPremium packed
    0n, // longPremium packed
    new Array(reqs.length).fill(0n) as bigint[],
    reqs.map((r) => packLeftRightUnsigned(r.token0, r.token1)),
    new Array(reqs.length).fill(0n) as bigint[],
  ]
}

function createMockClient(): PublicClient {
  return {
    call: vi.fn(),
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK.number),
    readContract: vi.fn(),
    multicall: vi.fn(),
  } as unknown as PublicClient
}

function success(returnData: Hex) {
  return { success: true, returnData }
}

function encodeBlockAndAggregate(results: ReturnType<typeof success>[]): Hex {
  return encodeFunctionResult({
    abi: Multicall3Abi,
    functionName: 'blockAndAggregate',
    result: [MOCK_BLOCK.number, MOCK_BLOCK.hash, results],
  })
}

function timestampResult() {
  return success(
    encodeFunctionResult({
      abi: Multicall3Abi,
      functionName: 'getCurrentBlockTimestamp',
      result: MOCK_BLOCK.timestamp,
    }),
  )
}

function mockMarginMulticall(
  client: PublicClient,
  input: {
    tick: number
    assets0: bigint
    assets1: bigint
    positionData?: FullPositionsData
    liquidationPrices?: readonly [number, number]
  },
) {
  const results = [
    success(
      encodeFunctionResult({
        abi: panopticPoolV2Abi,
        functionName: 'getCurrentTick',
        result: input.tick,
      }),
    ),
    success(
      encodeFunctionResult({
        abi: collateralTrackerV2Abi,
        functionName: 'assetsOf',
        result: input.assets0,
      }),
    ),
    success(
      encodeFunctionResult({
        abi: collateralTrackerV2Abi,
        functionName: 'assetsOf',
        result: input.assets1,
      }),
    ),
  ]

  if (input.positionData !== undefined) {
    results.push(
      success(
        encodeFunctionResult({
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          result: input.positionData,
        }),
      ),
    )
  }
  if (input.liquidationPrices !== undefined) {
    results.push(
      success(
        encodeFunctionResult({
          abi: panopticQueryAbi,
          functionName: 'getLiquidationPrices',
          result: input.liquidationPrices,
        }),
      ),
    )
  }
  results.push(timestampResult())
  vi.mocked(client.call).mockResolvedValueOnce({ data: encodeBlockAndAggregate(results) } as never)
}

describe('getMarginBuffer', () => {
  it('returns positive buffers for a safe account (gross collateral - sum of requirements)', async () => {
    const client = createMockClient()

    mockMarginMulticall(client, {
      tick: 0,
      assets0: 200n,
      assets1: 300n,
      positionData: mockFullPositionsData([{ token0: 100n, token1: 150n }]),
      liquidationPrices: [MIN_TICK_INT24, MAX_TICK_INT24],
    })

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    // At tick 0, cross-conversion is identity, so:
    //   currentMargin0 = assets0 + assets1 = 500
    //   currentMargin1 = assets1 + assets0 = 500
    //   requiredMargin0 = req0 + req1 = 250
    //   requiredMargin1 = req1 + req0 = 250
    expect(result.currentMargin0).toBe(500n)
    expect(result.currentMargin1).toBe(500n)
    expect(result.requiredMargin0).toBe(250n)
    expect(result.requiredMargin1).toBe(250n)
    expect(result.buffer0).toBe(250n)
    expect(result.buffer1).toBe(250n)
    expect(result.bufferPercent0).toBe(10000n) // 250/250 * 10000 bps = 100%
    expect(result.bufferPercent1).toBe(10000n)
    expect(result.currentTick).toBe(0n)
    expect(result.denominatedInToken).toBe(1) // tick >= 0 → token1
    expect(result.liquidationDistance).toBeNull()
    expect(result.lowerLiquidationTick).toBeNull()
    expect(result.upperLiquidationTick).toBeNull()
    expect(result._meta.blockNumber).toBe(12345678n)
  })

  it('reflects a loan: gross collateral >> non-loan required, but loan adds a big requirement', async () => {
    // Models the repro: 2,200 deposit + 10,000 borrow → assetsOf ≈ 12,200 in CT1 (USDC).
    // The loan tokenId contributes ~10,000 to collateralRequirements; the option ~810.
    // Expected: gross ≈ 12,200, required ≈ 10,810, buffer ≈ 1,390, usage ≈ 88.6%.
    const client = createMockClient()
    const ONE_USDC = 1_000_000n
    const grossUSDC = 12_200n * ONE_USDC
    const loanReq = 10_000n * ONE_USDC
    const optionReq = 810n * ONE_USDC

    mockMarginMulticall(client, {
      tick: 0,
      assets0: 0n,
      assets1: grossUSDC,
      positionData: mockFullPositionsData([
        { token0: 0n, token1: loanReq },
        { token0: 0n, token1: optionReq },
      ]),
      liquidationPrices: [MIN_TICK_INT24, MAX_TICK_INT24],
    })

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [111n, 222n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    expect(result.currentMargin1).toBe(grossUSDC) // 12_200
    expect(result.requiredMargin1).toBe(loanReq + optionReq) // 10_810
    expect(result.buffer1).toBe(grossUSDC - loanReq - optionReq) // 1_390
    // Usage% = (required / current) ≈ 88.6%  →  bufferPercent1 ≈ (1390/10810) * 10000 = 1286 bps
    expect(result.bufferPercent1).toBe(
      ((grossUSDC - loanReq - optionReq) * 10000n) / (loanReq + optionReq),
    )
    expect(result.denominatedInToken).toBe(1)
  })

  it('returns negative buffer when requirements exceed collateral', async () => {
    const client = createMockClient()

    mockMarginMulticall(client, {
      tick: 0,
      assets0: 50n,
      assets1: 300n,
      positionData: mockFullPositionsData([{ token0: 300n, token1: 100n }]),
      liquidationPrices: [-500, 500],
    })

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    // currentMargin1 = 300 + 50 = 350, requiredMargin1 = 100 + 300 = 400, buffer1 = -50
    expect(result.currentMargin1).toBe(350n)
    expect(result.requiredMargin1).toBe(400n)
    expect(result.buffer1).toBe(-50n)
    // Both slots in this case are identical at tick 0
    expect(result.buffer0).toBe(-50n)
  })

  it('returns zero requirements but live collateral when no positions', async () => {
    const client = createMockClient()

    mockMarginMulticall(client, {
      tick: 0,
      assets0: 1000n,
      assets1: 2000n,
    })

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    expect(result.requiredMargin0).toBe(0n)
    expect(result.requiredMargin1).toBe(0n)
    expect(result.currentMargin1).toBe(3000n) // 2000 + 1000 (identity)
    expect(result.buffer1).toBe(3000n)
    expect(result.bufferPercent1).toBeNull()
    expect(result.liquidationDistance).toBeNull()
  })

  it('picks lower distance when only lower liquidation boundary exists', async () => {
    const client = createMockClient()

    mockMarginMulticall(client, {
      tick: 1000,
      assets0: 100n,
      assets1: 100n,
      positionData: mockFullPositionsData([{ token0: 50n, token1: 50n }]),
      liquidationPrices: [800, MAX_TICK_INT24],
    })

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    expect(result.lowerLiquidationTick).toBe(800n)
    expect(result.upperLiquidationTick).toBeNull()
    expect(result.liquidationDistance).toBe(200n)
    expect(result.currentTick).toBe(1000n)
  })

  it('picks nearest boundary when both liquidation boundaries exist', async () => {
    const client = createMockClient()

    mockMarginMulticall(client, {
      tick: 1000,
      assets0: 100n,
      assets1: 100n,
      positionData: mockFullPositionsData([
        { token0: 50n, token1: 50n },
        { token0: 30n, token1: 30n },
      ]),
      liquidationPrices: [700, 1200],
    })

    const result = await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n, 456n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    expect(result.lowerLiquidationTick).toBe(700n)
    expect(result.upperLiquidationTick).toBe(1200n)
    expect(result.liquidationDistance).toBe(200n)
  })

  it('passes custom blockNumber to all RPC calls', async () => {
    const client = createMockClient()
    const customBlock = 99999n

    mockMarginMulticall(client, {
      tick: 0,
      assets0: 100n,
      assets1: 100n,
      positionData: mockFullPositionsData([{ token0: 50n, token1: 50n }]),
      liquidationPrices: [MIN_TICK_INT24, MAX_TICK_INT24],
    })

    await getMarginBuffer({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
      blockNumber: customBlock,
    })

    expect(client.call).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: customBlock }))

    expect(client.getBlockNumber).not.toHaveBeenCalled()
  })
})
