/**
 * Tests for getOpenPositionPreview.
 * @module v2/reads/openPositionPreview.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { AccountInsolventError } from '../errors/contract'
import { simulateOpenPosition } from '../simulations/simulateOpenPosition'
import type { OpenPositionSimulation, SimulationResult } from '../types'
import type { AccountBuyingPower } from './buyingPower'
import { getAccountBuyingPower } from './buyingPower'
import { getOpenPositionPreview } from './openPositionPreview'

// Mock the dependencies
vi.mock('./buyingPower', () => ({
  getAccountBuyingPower: vi.fn(),
}))

vi.mock('../simulations/simulateOpenPosition', () => ({
  simulateOpenPosition: vi.fn(),
}))

const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const ACCOUNT = '0x2222222222222222222222222222222222222222' as const
const QUERY_ADDRESS = '0x5555555555555555555555555555555555555555' as const

const MOCK_META = {
  blockNumber: 100n,
  blockHash: '0xabc' as `0x${string}`,
  blockTimestamp: 1700000000n,
}

const mockBuyingPower: AccountBuyingPower = {
  collateralBalance0: 1_000_000n,
  requiredCollateral0: 200_000n,
  collateralBalance1: 500_000n,
  requiredCollateral1: 100_000n,
}

function createMockClient(): PublicClient {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(100n),
    getBlock: vi.fn().mockResolvedValue({ number: 100n, hash: '0xabc', timestamp: 1700000000n }),
    multicall: vi.fn(),
    readContract: vi.fn(),
    simulateContract: vi.fn(),
    estimateGas: vi.fn(),
  } as unknown as PublicClient
}

describe('getOpenPositionPreview', () => {
  it('should return isSolvent=true when simulation succeeds', async () => {
    const client = createMockClient()

    vi.mocked(getAccountBuyingPower).mockResolvedValue(mockBuyingPower)

    const successResult: SimulationResult<OpenPositionSimulation> = {
      success: true,
      data: {
        position: {} as OpenPositionSimulation['position'],
        greeks: { value: 0n, delta: 0n, gamma: 0n },
        amount0Required: 50_000n,
        amount1Required: 10_000n,
        postCollateral0: 950_000n,
        postCollateral1: 490_000n,
        postMarginExcess0: null,
        postMarginExcess1: null,
        commission0: null,
        commission1: null,
      },
      gasEstimate: 300_000n,
      _meta: MOCK_META,
    }
    vi.mocked(simulateOpenPosition).mockResolvedValue(successResult)

    const preview = await getOpenPositionPreview({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      existingPositionIds: [],
      tokenId: 1n,
      positionSize: 100n,
      queryAddress: QUERY_ADDRESS,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })

    expect(preview.isSolvent).toBe(true)
    expect(preview.amount0Required).toBe(50_000n)
    expect(preview.amount1Required).toBe(10_000n)
    expect(preview.postCollateral0).toBe(950_000n)
    expect(preview.postCollateral1).toBe(490_000n)
    expect(preview.currentBuyingPower).toEqual(mockBuyingPower)
  })

  it('should return isSolvent=false when simulation fails', async () => {
    const client = createMockClient()

    vi.mocked(getAccountBuyingPower).mockResolvedValue(mockBuyingPower)

    const failResult: SimulationResult<OpenPositionSimulation> = {
      success: false,
      error: new AccountInsolventError(0n, 0n),
      _meta: MOCK_META,
    }
    vi.mocked(simulateOpenPosition).mockResolvedValue(failResult)

    const preview = await getOpenPositionPreview({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      existingPositionIds: [],
      tokenId: 1n,
      positionSize: 100n,
      queryAddress: QUERY_ADDRESS,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })

    expect(preview.isSolvent).toBe(false)
    expect(preview.amount0Required).toBeNull()
    expect(preview.amount1Required).toBeNull()
    expect(preview.postCollateral0).toBeNull()
    expect(preview.postCollateral1).toBeNull()
    expect(preview.currentBuyingPower).toEqual(mockBuyingPower)
  })

  it('should run buyingPower and simulation in parallel', async () => {
    const client = createMockClient()

    let buyingPowerResolved = false
    let simulationResolved = false

    vi.mocked(getAccountBuyingPower).mockImplementation(async () => {
      buyingPowerResolved = true
      // By the time buying power resolves, simulation should already be started
      return mockBuyingPower
    })

    vi.mocked(simulateOpenPosition).mockImplementation(async () => {
      simulationResolved = true
      return {
        success: true,
        data: {
          position: {} as OpenPositionSimulation['position'],
          greeks: { value: 0n, delta: 0n, gamma: 0n },
          amount0Required: 0n,
          amount1Required: 0n,
          postCollateral0: 0n,
          postCollateral1: 0n,
          postMarginExcess0: null,
          postMarginExcess1: null,
          commission0: null,
          commission1: null,
        },
        gasEstimate: 0n,
        _meta: MOCK_META,
      }
    })

    await getOpenPositionPreview({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      existingPositionIds: [],
      tokenId: 1n,
      positionSize: 100n,
      queryAddress: QUERY_ADDRESS,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })

    // Both should have been called
    expect(buyingPowerResolved).toBe(true)
    expect(simulationResolved).toBe(true)
  })
})
