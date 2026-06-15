import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import {
  BORROW_INDEX_BITS,
  deriveSupplyRatePerSecWad,
  getIrmCurve,
  MARKET_EPOCH_BITS,
  packMarketState,
  RATE_AT_TARGET_BITS,
  ratePerSecWadToAprPct,
  SECONDS_PER_YEAR,
  UNREALIZED_INTEREST_BITS,
  WAD,
} from './irm'

const COLLATERAL_TRACKER = '0x1111111111111111111111111111111111111111' as const
const RISK_ENGINE = '0x2222222222222222222222222222222222222222' as const

type MockIrmClient = Pick<PublicClient, 'multicall' | 'readContract'>

function createMockClient(): MockIrmClient {
  return {
    multicall: vi.fn(),
    readContract: vi.fn(),
  }
}

describe('IRM helpers', () => {
  it('packs market state with correct bit layout', () => {
    const borrowIndex = 123n
    const lastInteractionTimestamp = 400n
    const rateAtTarget = 456n
    const unrealizedGlobalInterest = 789n
    const marketEpoch = lastInteractionTimestamp >> 2n

    const packed = packMarketState({
      borrowIndex,
      lastInteractionTimestamp,
      rateAtTarget,
      unrealizedGlobalInterest,
    })

    const expected =
      borrowIndex +
      (marketEpoch << BORROW_INDEX_BITS) +
      (rateAtTarget << (BORROW_INDEX_BITS + MARKET_EPOCH_BITS)) +
      (unrealizedGlobalInterest << (BORROW_INDEX_BITS + MARKET_EPOCH_BITS + RATE_AT_TARGET_BITS))

    expect(packed).toBe(expected)
  })

  it('throws on field overflows', () => {
    expect(() =>
      packMarketState({
        borrowIndex: 1n << BORROW_INDEX_BITS,
        lastInteractionTimestamp: 0n,
        rateAtTarget: 0n,
        unrealizedGlobalInterest: 0n,
      }),
    ).toThrow()

    // marketEpoch = lastInteractionTimestamp >> 2
    expect(() =>
      packMarketState({
        borrowIndex: 0n,
        lastInteractionTimestamp: (1n << MARKET_EPOCH_BITS) << 2n,
        rateAtTarget: 0n,
        unrealizedGlobalInterest: 0n,
      }),
    ).toThrow()

    expect(() =>
      packMarketState({
        borrowIndex: 0n,
        lastInteractionTimestamp: 0n,
        rateAtTarget: 1n << RATE_AT_TARGET_BITS,
        unrealizedGlobalInterest: 0n,
      }),
    ).toThrow()

    expect(() =>
      packMarketState({
        borrowIndex: 0n,
        lastInteractionTimestamp: 0n,
        rateAtTarget: 0n,
        unrealizedGlobalInterest: 1n << UNREALIZED_INTEREST_BITS,
      }),
    ).toThrow()
  })

  it('converts per-second WAD to APR percent around 4%', () => {
    const perSecondRateWad = 40_000_000_000_000_000n / SECONDS_PER_YEAR
    const aprPct = ratePerSecWadToAprPct(perSecondRateWad)
    expect(aprPct).toBeCloseTo(4, 2)
  })

  it('derives supply from borrow and utilization', () => {
    const borrow = 999_999n
    expect(deriveSupplyRatePerSecWad(borrow, 0n)).toBe(0n)
    expect(deriveSupplyRatePerSecWad(borrow, WAD)).toBe(borrow)
  })
})

describe('getIrmCurve', () => {
  it('returns sampled curve points and multicalls interestRate with packed state', async () => {
    const client = createMockClient()
    const borrowIndex = 100n
    const lastInteractionTimestamp = 40n
    const rateAtTarget = 200n
    const unrealizedGlobalInterest = 300n
    const poolData = [1n, 2n, 3n, 5_000n] as const

    vi.mocked(client.multicall)
      .mockResolvedValueOnce([
        borrowIndex,
        lastInteractionTimestamp,
        rateAtTarget,
        unrealizedGlobalInterest,
        poolData,
        RISK_ENGINE,
      ])
      .mockResolvedValueOnce([10n, 20n, 30n, 40n, 50n])

    vi.mocked(client.readContract).mockResolvedValue(25n)

    const result = await getIrmCurve({
      client: client as PublicClient,
      collateralTrackerAddress: COLLATERAL_TRACKER,
      points: 5,
    })

    expect(result.current.collateralTrackerAddress).toBe(COLLATERAL_TRACKER)
    expect(result.current.riskEngineAddress).toBe(RISK_ENGINE)
    expect(result.current.currentUtilizationBps).toBe(5_000n)
    expect(result.points).toHaveLength(5)
    expect(result.points[0].utilizationPct).toBe(0)
    expect(result.points[4].utilizationPct).toBe(100)
    expect(result.points[0].utilizationWad).toBe(0n)
    expect(result.points[4].utilizationWad).toBe(WAD)

    const packed = packMarketState({
      borrowIndex,
      lastInteractionTimestamp,
      rateAtTarget,
      unrealizedGlobalInterest,
    })

    const secondMulticallArgs = vi.mocked(client.multicall).mock.calls[1]?.[0] as
      | { contracts: Array<{ args: readonly [bigint, bigint] }> }
      | undefined
    expect(secondMulticallArgs).toBeDefined()
    const contracts = secondMulticallArgs?.contracts
    expect(contracts).toHaveLength(5)
    expect(contracts?.[0]?.args).toEqual([0n, packed])
    expect(contracts?.[4]?.args).toEqual([WAD, packed])
  })

  it('rejects when points is below the lower bound', async () => {
    const client = createMockClient()

    await expect(
      getIrmCurve({
        client: client as PublicClient,
        collateralTrackerAddress: COLLATERAL_TRACKER,
        points: 1,
      }),
    ).rejects.toThrow('points must be an integer >= 2')
  })

  it('rejects when points is non-integer', async () => {
    const client = createMockClient()

    await expect(
      getIrmCurve({
        client: client as PublicClient,
        collateralTrackerAddress: COLLATERAL_TRACKER,
        points: 2.5,
      }),
    ).rejects.toThrow('points must be an integer >= 2')
  })

  it('rejects when points exceeds the maximum', async () => {
    const client = createMockClient()

    await expect(
      getIrmCurve({
        client: client as PublicClient,
        collateralTrackerAddress: COLLATERAL_TRACKER,
        points: 501,
      }),
    ).rejects.toThrow('points must be <= 500')
  })
})
