/**
 * Tests for check functions.
 *
 * `isLiquidatable` now sources gross collateral from
 * `CollateralTracker.assetsOf` and required margin from
 * `PanopticPool.getFullPositionsData.collateralRequirements[]`, replacing
 * the prior `PanopticQuery.checkCollateral` call. Tests use `atTick=0` so
 * `sqrtPriceX96 = 2^96` and the token0↔token1 cross-conversion is identity.
 *
 * @module v2/reads/checks.test
 */

import { type Address, type Hex, type PublicClient, encodeFunctionResult } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { Multicall3Abi } from '../../../abis/multicall3'
import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { isLiquidatable } from './checks'

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

function packLeftRightUnsigned(right: bigint, left: bigint): bigint {
  return right + (left << 128n)
}

type FullPositionsData = readonly [bigint, bigint, bigint[], bigint[], bigint[]]

function mockFullPositionsData(reqs: Array<{ token0: bigint; token1: bigint }>): FullPositionsData {
  return [
    0n,
    0n,
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

function mockLiquidationMulticall(
  client: PublicClient,
  input: {
    tick?: number
    assets0: bigint
    assets1: bigint
    positionData?: FullPositionsData
  },
) {
  const results = []
  if (input.tick !== undefined) {
    results.push(
      success(
        encodeFunctionResult({
          abi: panopticPoolV2Abi,
          functionName: 'getCurrentTick',
          result: input.tick,
        }),
      ),
    )
  }
  results.push(
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
  )
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
  results.push(timestampResult())
  vi.mocked(client.call).mockResolvedValueOnce({ data: encodeBlockAndAggregate(results) } as never)
}

describe('isLiquidatable', () => {
  it('returns isLiquidatable=true when required margin exceeds gross collateral', async () => {
    const client = createMockClient()

    // assets: 100 token0, 200 token1 → gross in token1 = 300, in token0 = 300
    // required: 150 + 180 = 330 in either denom
    // shortfall = 30  → liquidatable
    mockLiquidationMulticall(client, {
      tick: 0,
      assets0: 100n,
      assets1: 200n,
      positionData: mockFullPositionsData([{ token0: 150n, token1: 180n }]),
    })

    const result = await isLiquidatable({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n, 456n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    expect(result.isLiquidatable).toBe(true)
    expect(result.currentMargin0).toBe(300n)
    expect(result.currentMargin1).toBe(300n)
    expect(result.requiredMargin0).toBe(330n)
    expect(result.requiredMargin1).toBe(330n)
    expect(result.marginShortfall1).toBe(30n)
    expect(result.atTick).toBe(0n)
    expect(result.denominatedInToken).toBe(1n)
    expect(result._meta.blockNumber).toBe(12345678n)
  })

  it('returns isLiquidatable=false when gross collateral covers requirement', async () => {
    const client = createMockClient()

    mockLiquidationMulticall(client, {
      tick: 0,
      assets0: 200n,
      assets1: 300n,
      positionData: mockFullPositionsData([{ token0: 100n, token1: 150n }]),
    })

    const result = await isLiquidatable({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    // gross = 500, required = 250 → safely covered
    expect(result.isLiquidatable).toBe(false)
    expect(result.currentMargin1).toBe(500n)
    expect(result.requiredMargin1).toBe(250n)
    expect(result.marginShortfall1).toBe(-250n)
  })

  it('reflects a loan as required margin (not as netted balance)', async () => {
    // Models the repro: 2,200 deposit + 10,000 borrow → assetsOf 12,200 in token1.
    // Loan tokenId contributes ~10,000 to collateralRequirements; option ~810.
    // gross 12,200 > required 10,810 → not liquidatable, but tight.
    const client = createMockClient()
    const ONE = 1_000_000n
    const grossUSDC = 12_200n * ONE
    const loanReq = 10_000n * ONE
    const optionReq = 810n * ONE

    mockLiquidationMulticall(client, {
      tick: 0,
      assets0: 0n,
      assets1: grossUSDC,
      positionData: mockFullPositionsData([
        { token0: 0n, token1: loanReq },
        { token0: 0n, token1: optionReq },
      ]),
    })

    const result = await isLiquidatable({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [111n, 222n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    expect(result.isLiquidatable).toBe(false)
    expect(result.currentMargin1).toBe(grossUSDC)
    expect(result.requiredMargin1).toBe(loanReq + optionReq)
    expect(result.marginShortfall1).toBe(loanReq + optionReq - grossUSDC)
  })

  it('uses provided atTick parameter and skips getCurrentTick', async () => {
    const client = createMockClient()

    mockLiquidationMulticall(client, {
      assets0: 100n,
      assets1: 100n,
      positionData: mockFullPositionsData([{ token0: 50n, token1: 50n }]),
    })

    const result = await isLiquidatable({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      atTick: 500n,
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    expect(result.atTick).toBe(500n)
    expect(result.isLiquidatable).toBe(false)

    const callData = vi.mocked(client.call).mock.calls[0]?.[0]?.data
    expect(callData).toBeDefined()
    expect(client.readContract).not.toHaveBeenCalled()
  })

  it('handles zero margin case (no collateral, some required)', async () => {
    const client = createMockClient()

    mockLiquidationMulticall(client, {
      tick: 0,
      assets0: 0n,
      assets1: 0n,
      positionData: mockFullPositionsData([{ token0: 100n, token1: 100n }]),
    })

    const result = await isLiquidatable({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [123n],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    expect(result.isLiquidatable).toBe(true)
    expect(result.currentMargin1).toBe(0n)
    expect(result.marginShortfall1).toBe(200n)
  })

  it('handles no positions (zero required margin, with live collateral)', async () => {
    const client = createMockClient()

    mockLiquidationMulticall(client, {
      tick: 0,
      assets0: 1000n,
      assets1: 2000n,
    })

    const result = await isLiquidatable({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [],
      queryAddress: QUERY_ADDRESS,
      collateralAddresses: COLLATERAL_ADDRESSES,
    })

    expect(result.isLiquidatable).toBe(false)
    expect(result.requiredMargin0).toBe(0n)
    expect(result.requiredMargin1).toBe(0n)
    expect(result.currentMargin1).toBe(3000n)
    expect(result.marginShortfall1).toBe(-3000n)
  })
})
