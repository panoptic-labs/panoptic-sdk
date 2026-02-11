/**
 * Tests for read functions.
 * @module v2/reads/reads.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getAccountCollateral, getLiquidationPrices, getNetLiquidationValue } from './account'
import { getCollateralData, getCurrentRates } from './collateral'
import { getDeltaHedgeParams } from './hedge'
import { getOracleState, getRiskParameters, getUtilization } from './pool'
import { getPosition, getPositionGreeks, getPositions } from './position'
import { getAccountPremia, getPositionsWithPremia } from './premia'
import { getSafeMode } from './safeMode'
// 1e18 - used as a convenient position size representing 1 token in 18-decimal units
const WAD = 10n ** 18n

// Common mock addresses
const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const ACCOUNT_ADDRESS = '0x2222222222222222222222222222222222222222' as const
const COLLATERAL_TOKEN_0 = '0x3333333333333333333333333333333333333333' as const
const COLLATERAL_TOKEN_1 = '0x4444444444444444444444444444444444444444' as const
const RISK_ENGINE_ADDRESS = '0x5555555555555555555555555555555555555555' as const
const TOKEN_0_ASSET = '0x6666666666666666666666666666666666666666' as const
const TOKEN_1_ASSET = '0x7777777777777777777777777777777777777777' as const

// Common mock block
const MOCK_BLOCK = {
  number: 12345678n,
  hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
  timestamp: 1700000000n,
}

// Mock PublicClient factory
function createMockClient(): PublicClient {
  return {
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK.number),
    multicall: vi.fn(),
    readContract: vi.fn(),
  } as unknown as PublicClient
}

describe('Pool Read Functions', () => {
  describe('getUtilization', () => {
    it('should return utilization for both tokens', async () => {
      const client = createMockClient()

      // First multicall: get collateral tracker addresses
      vi.mocked(client.multicall)
        .mockResolvedValueOnce([COLLATERAL_TOKEN_0, COLLATERAL_TOKEN_1])
        // Second multicall: get pool data
        .mockResolvedValueOnce([
          [1000000n, 100000n, 900000n, 1000n], // token0 pool data
          [2000000n, 200000n, 1800000n, 2000n], // token1 pool data
        ])

      const result = await getUtilization({
        client,
        poolAddress: POOL_ADDRESS,
      })

      expect(result.utilization0).toBe(1000n)
      expect(result.utilization1).toBe(2000n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should use provided block number', async () => {
      const mockBlockAt10M = {
        number: 10000000n,
        hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as const,
        timestamp: 1600000000n,
      }

      const client = createMockClient()
      vi.mocked(client.getBlock).mockResolvedValue(mockBlockAt10M as never)

      vi.mocked(client.multicall)
        .mockResolvedValueOnce([COLLATERAL_TOKEN_0, COLLATERAL_TOKEN_1])
        .mockResolvedValueOnce([
          [1000000n, 100000n, 900000n, 500n],
          [2000000n, 200000n, 1800000n, 500n],
        ])

      const result = await getUtilization({
        client,
        poolAddress: POOL_ADDRESS,
        blockNumber: 10000000n,
      })

      expect(result._meta.blockNumber).toBe(10000000n)
    })
  })

  describe('getOracleState', () => {
    it('should return oracle state with ticks', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValue([
        100, // currentTick
        101, // spotTick
        102, // medianTick
        103, // latestTick
        (1n << 208n) | (1700000000n << 176n), // oraclePack with epoch and timestamp
      ])

      const result = await getOracleState({
        client,
        poolAddress: POOL_ADDRESS,
      })

      expect(result.referenceTick).toBe(100n)
      expect(result.spotEMA).toBe(101n)
      expect(result.medianTick).toBe(102n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })
  })

  describe('getRiskParameters', () => {
    it('should return risk parameters from RiskEngine', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValue(RISK_ENGINE_ADDRESS)

      vi.mocked(client.multicall).mockResolvedValue([
        2000n, // SELLER_COLLATERAL_RATIO
        1000n, // BUYER_COLLATERAL_RATIO
        500n, // MAINT_MARGIN_RATE
        10, // NOTIONAL_FEE
        5000n, // TARGET_POOL_UTIL
        9000n, // SATURATED_POOL_UTIL
        [0n, 0], // getRiskParameters result
      ])

      const result = await getRiskParameters({
        client,
        poolAddress: POOL_ADDRESS,
      })

      expect(result.collateralRequirement).toBe(2000n)
      expect(result.maintenanceMargin).toBe(500n)
      expect(result.commissionRate).toBe(10n)
      expect(result.targetUtilization).toBe(5000n)
      expect(result.saturatedUtilization).toBe(9000n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })
  })

  describe('getSafeMode', () => {
    it('should map normal status to normal mode', async () => {
      const client = createMockClient()
      vi.mocked(client.readContract).mockResolvedValue(0)

      const result = await getSafeMode({
        client,
        poolAddress: POOL_ADDRESS,
      })

      expect(result.mode).toBe('normal')
      expect(result.canMint).toBe(true)
      expect(result.canBurn).toBe(true)
      expect(result.canForceExercise).toBe(true)
      expect(result.canLiquidate).toBe(true)
      expect(result.reason).toBeUndefined()
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should map close-only status to emergency mode', async () => {
      const client = createMockClient()
      vi.mocked(client.readContract).mockResolvedValue(3)

      const result = await getSafeMode({
        client,
        poolAddress: POOL_ADDRESS,
      })

      expect(result.mode).toBe('emergency')
      expect(result.canMint).toBe(false)
      expect(result.canBurn).toBe(true)
      expect(result.canForceExercise).toBe(true)
      expect(result.canLiquidate).toBe(true)
      expect(result.reason).toContain('close-only')
      expect(result._meta.blockNumber).toBe(12345678n)
    })
  })
})

describe('Position Read Functions', () => {
  // Sample tokenId with one leg
  const SAMPLE_TOKEN_ID = 0x0001000100010001n << 64n // Simplified tokenId

  describe('getPosition', () => {
    it('should return position data', async () => {
      const client = createMockClient()

      // positionData returns: [swapAtMint, blockAtMint, timestampAtMint, tickAtMint, utilization0AtMint, utilization1AtMint, positionSize]
      vi.mocked(client.readContract).mockResolvedValue([
        false, // swapAtMint
        12345678n, // blockAtMint
        1700000000n, // timestampAtMint
        100, // tickAtMint
        5000n, // utilization0AtMint
        6000n, // utilization1AtMint
        1000000n, // positionSize
      ])

      const result = await getPosition({
        client,
        poolAddress: POOL_ADDRESS,
        owner: ACCOUNT_ADDRESS,
        tokenId: SAMPLE_TOKEN_ID,
      })

      expect(result.tokenId).toBe(SAMPLE_TOKEN_ID)
      expect(result.positionSize).toBe(1000000n)
      expect(result.owner).toBe(ACCOUNT_ADDRESS)
      expect(result.poolAddress).toBe(POOL_ADDRESS)
      expect(result.tickAtMint).toBe(100n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })
  })

  describe('getPositions', () => {
    it('should return empty array for empty tokenIds', async () => {
      const client = createMockClient()

      const result = await getPositions({
        client,
        poolAddress: POOL_ADDRESS,
        owner: ACCOUNT_ADDRESS,
        tokenIds: [],
      })

      expect(result.positions).toHaveLength(0)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should return multiple positions', async () => {
      const client = createMockClient()
      const tokenId1 = SAMPLE_TOKEN_ID
      const tokenId2 = SAMPLE_TOKEN_ID + 1n

      // positionData returns: [swapAtMint, blockAtMint, timestampAtMint, tickAtMint, utilization0AtMint, utilization1AtMint, positionSize]
      vi.mocked(client.multicall).mockResolvedValue([
        {
          status: 'success',
          result: [false, 12345678n, 1700000000n, 100, 5000n, 6000n, 1000000n],
        },
        {
          status: 'success',
          result: [true, 12345679n, 1700000001n, 200, 5500n, 6500n, 2000000n],
        },
      ])

      const result = await getPositions({
        client,
        poolAddress: POOL_ADDRESS,
        owner: ACCOUNT_ADDRESS,
        tokenIds: [tokenId1, tokenId2],
      })

      expect(result.positions).toHaveLength(2)
      expect(result.positions[0].positionSize).toBe(1000000n)
      expect(result.positions[1].positionSize).toBe(2000000n)
    })

    it('should skip failed calls', async () => {
      const client = createMockClient()

      // positionData returns: [swapAtMint, blockAtMint, timestampAtMint, tickAtMint, utilization0AtMint, utilization1AtMint, positionSize]
      vi.mocked(client.multicall).mockResolvedValue([
        {
          status: 'success',
          result: [false, 12345678n, 1700000000n, 100, 5000n, 6000n, 1000000n],
        },
        {
          status: 'failure',
          error: new Error('Position not found'),
        },
      ])

      const result = await getPositions({
        client,
        poolAddress: POOL_ADDRESS,
        owner: ACCOUNT_ADDRESS,
        tokenIds: [SAMPLE_TOKEN_ID, SAMPLE_TOKEN_ID + 1n],
      })

      expect(result.positions).toHaveLength(1)
    })

    it('should skip positions with zero size', async () => {
      const client = createMockClient()

      // positionData returns: [swapAtMint, blockAtMint, timestampAtMint, tickAtMint, utilization0AtMint, utilization1AtMint, positionSize]
      vi.mocked(client.multicall).mockResolvedValue([
        {
          status: 'success',
          result: [false, 12345678n, 1700000000n, 100, 5000n, 6000n, 0n], // zero size
        },
      ])

      const result = await getPositions({
        client,
        poolAddress: POOL_ADDRESS,
        owner: ACCOUNT_ADDRESS,
        tokenIds: [SAMPLE_TOKEN_ID],
      })

      expect(result.positions).toHaveLength(0)
    })
  })

  describe('getPositionGreeks', () => {
    it('should calculate greeks using client-side implementation', async () => {
      const client = createMockClient()

      // Mock positionData (swapAtMint, blockAtMint, timestampAtMint, tickAtMint, util0, util1, positionSize)
      vi.mocked(client.readContract)
        .mockResolvedValueOnce([false, 1000n, 1700000000n, 0, 5000n, 5000n, 1000n]) // positionData
        .mockResolvedValueOnce(0) // getCurrentTick

      const result = await getPositionGreeks({
        client,
        poolAddress: POOL_ADDRESS,
        owner: ACCOUNT_ADDRESS,
        tokenId: SAMPLE_TOKEN_ID,
      })

      // Client-side greeks return WAD-scaled bigint values
      expect(typeof result.value).toBe('bigint')
      expect(typeof result.delta).toBe('bigint')
      expect(typeof result.gamma).toBe('bigint')
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should use provided atTick instead of fetching current tick', async () => {
      const client = createMockClient()

      // Mock positionData only (no getCurrentTick call needed)
      vi.mocked(client.readContract).mockResolvedValueOnce([
        false,
        1000n,
        1700000000n,
        0,
        5000n,
        5000n,
        1000n,
      ]) // positionData

      const result = await getPositionGreeks({
        client,
        poolAddress: POOL_ADDRESS,
        owner: ACCOUNT_ADDRESS,
        tokenId: SAMPLE_TOKEN_ID,
        atTick: 100n,
      })

      expect(typeof result.value).toBe('bigint')
      expect(result._meta.blockNumber).toBe(12345678n)
    })
  })
})

describe('Account Read Functions', () => {
  describe('getAccountCollateral', () => {
    it('should return collateral data for account', async () => {
      const client = createMockClient()

      // First multicall: get collateral tracker addresses
      vi.mocked(client.multicall)
        .mockResolvedValueOnce([COLLATERAL_TOKEN_0, COLLATERAL_TOKEN_1])
        // Second multicall: get account collateral data INCLUDING legCount (same-block guarantee)
        .mockResolvedValueOnce([
          1000n, // shares0
          10000n, // assets0
          8000n, // maxWithdraw0
          2000n, // shares1
          20000n, // assets1
          15000n, // maxWithdraw1
          4n, // legCount (now part of same multicall for same-block guarantee)
        ])

      const result = await getAccountCollateral({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
      })

      expect(result.account).toBe(ACCOUNT_ADDRESS)
      expect(result.poolAddress).toBe(POOL_ADDRESS)
      expect(result.token0.assets).toBe(10000n)
      expect(result.token0.shares).toBe(1000n)
      expect(result.token0.availableAssets).toBe(8000n)
      expect(result.token0.lockedAssets).toBe(2000n)
      expect(result.token1.assets).toBe(20000n)
      expect(result.token1.availableAssets).toBe(15000n)
      expect(result.legCount).toBe(4n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should handle zero locked assets', async () => {
      const client = createMockClient()

      vi.mocked(client.multicall)
        .mockResolvedValueOnce([COLLATERAL_TOKEN_0, COLLATERAL_TOKEN_1])
        .mockResolvedValueOnce([
          1000n, // shares0
          10000n, // assets0
          10000n, // maxWithdraw0 = assets0 (nothing locked)
          2000n, // shares1
          20000n, // assets1
          20000n, // maxWithdraw1 = assets1 (nothing locked)
          0n, // legCount (included in same multicall)
        ])

      const result = await getAccountCollateral({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
      })

      expect(result.token0.lockedAssets).toBe(0n)
      expect(result.token1.lockedAssets).toBe(0n)
    })
  })

  describe('getNetLiquidationValue', () => {
    it('should use provided atTick', async () => {
      const client = createMockClient()
      const queryAddress = '0x7777777777777777777777777777777777777777' as const

      vi.mocked(client.readContract).mockResolvedValueOnce([123n, 456n])

      const result = await getNetLiquidationValue({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [],
        atTick: 500n,
        queryAddress,
      })

      expect(result.atTick).toBe(500n)
      expect(vi.mocked(client.readContract)).toHaveBeenCalledTimes(1)
    })
  })

  describe('getLiquidationPrices', () => {
    // Note: queryAddress is now required by TypeScript, so we can't easily test the runtime error
    // The type system enforces that queryAddress must be provided

    it('should return liquidation prices with queryAddress', async () => {
      const client = createMockClient()
      const queryAddress = '0x7777777777777777777777777777777777777777' as const

      vi.mocked(client.readContract).mockResolvedValueOnce([-50000, 50000]) // getLiquidationPrices returns numbers

      const result = await getLiquidationPrices({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [],
        queryAddress,
      })

      expect(result.lowerTick).toBe(-50000n)
      expect(result.upperTick).toBe(50000n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should return null for MIN/MAX tick boundaries', async () => {
      const client = createMockClient()
      const queryAddress = '0x7777777777777777777777777777777777777777' as const

      vi.mocked(client.readContract).mockResolvedValueOnce([-887272, 887272]) // MIN_TICK, MAX_TICK

      const result = await getLiquidationPrices({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [],
        queryAddress,
      })

      expect(result.lowerTick).toBeNull()
      expect(result.upperTick).toBeNull()
    })

    it('should use PanopticQuery when queryAddress provided', async () => {
      const client = createMockClient()
      const queryAddress = '0x7777777777777777777777777777777777777777' as const

      vi.mocked(client.readContract).mockResolvedValueOnce([-50000n, 50000n]) // getLiquidationPrices

      const result = await getLiquidationPrices({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n, 456n],
        queryAddress,
      })

      expect(result.lowerTick).toBe(-50000n)
      expect(result.upperTick).toBe(50000n)
      expect(result.isLiquidatable).toBe(true) // Has liquidation prices
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should correctly identify not liquidatable with PanopticQuery', async () => {
      const client = createMockClient()
      const queryAddress = '0x7777777777777777777777777777777777777777' as const

      // MIN_TICK and MAX_TICK indicate no liquidation
      vi.mocked(client.readContract).mockResolvedValueOnce([-887272n, 887272n])

      const result = await getLiquidationPrices({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        queryAddress,
      })

      expect(result.lowerTick).toBeNull()
      expect(result.upperTick).toBeNull()
      expect(result.isLiquidatable).toBe(false)
    })
  })

  describe('getNetLiquidationValue with PanopticQuery', () => {
    it('should use PanopticQuery when queryAddress provided', async () => {
      const client = createMockClient()
      const queryAddress = '0x7777777777777777777777777777777777777777' as const

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100n) // getCurrentTick
        .mockResolvedValueOnce([5000n, 10000n]) // getNetLiquidationValue

      const result = await getNetLiquidationValue({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        queryAddress,
      })

      expect(result.value0).toBe(5000n)
      expect(result.value1).toBe(10000n)
      expect(result.atTick).toBe(100n)
      expect(result.includedPendingPremium).toBe(true)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should respect includePendingPremium parameter', async () => {
      const client = createMockClient()
      const queryAddress = '0x7777777777777777777777777777777777777777' as const

      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100) // getCurrentTick
        .mockResolvedValueOnce([3000n, 6000n]) // getNetLiquidationValue

      const result = await getNetLiquidationValue({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [123n],
        includePendingPremium: false,
        queryAddress,
      })

      expect(result.includedPendingPremium).toBe(false)
    })
  })
})

describe('Collateral Read Functions', () => {
  describe('getCollateralData', () => {
    it('should return collateral tracker data for token 0', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValue(COLLATERAL_TOKEN_0)

      vi.mocked(client.multicall)
        .mockResolvedValueOnce([
          TOKEN_0_ASSET, // asset
          [1000000n, 100000n, 900000n, 1000n], // getPoolData
          900000n, // totalSupply
          5000n, // interestRate
        ])
        .mockResolvedValueOnce([
          'USDC', // symbol
          6, // decimals
        ])

      const result = await getCollateralData({
        client,
        poolAddress: POOL_ADDRESS,
        tokenIndex: 0,
      })

      expect(result.address).toBe(COLLATERAL_TOKEN_0)
      expect(result.token).toBe(TOKEN_0_ASSET)
      expect(result.symbol).toBe('USDC')
      expect(result.decimals).toBe(6n)
      expect(result.totalAssets).toBe(1000000n)
      expect(result.totalShares).toBe(900000n)
      expect(result.utilization).toBe(1000n)
      expect(result.borrowRate).toBe(5000n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should return collateral tracker data for token 1', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValue(COLLATERAL_TOKEN_1)

      vi.mocked(client.multicall)
        .mockResolvedValueOnce([
          TOKEN_1_ASSET,
          [2000000n, 200000n, 1800000n, 2000n],
          1800000n,
          6000n,
        ])
        .mockResolvedValueOnce(['WETH', 18])

      const result = await getCollateralData({
        client,
        poolAddress: POOL_ADDRESS,
        tokenIndex: 1,
      })

      expect(result.address).toBe(COLLATERAL_TOKEN_1)
      expect(result.symbol).toBe('WETH')
      expect(result.decimals).toBe(18n)
    })
  })

  describe('getCurrentRates', () => {
    it('should return interest rates for both tokens', async () => {
      const client = createMockClient()

      vi.mocked(client.multicall)
        .mockResolvedValueOnce([COLLATERAL_TOKEN_0, COLLATERAL_TOKEN_1])
        .mockResolvedValueOnce([
          5000n, // interestRate0
          [1000000n, 100000n, 900000n, 1000n], // poolData0
          6000n, // interestRate1
          [2000000n, 200000n, 1800000n, 2000n], // poolData1
        ])

      const result = await getCurrentRates({
        client,
        poolAddress: POOL_ADDRESS,
      })

      expect(result.borrowRate0).toBe(5000n)
      expect(result.borrowRate1).toBe(6000n)
      // supplyRate = borrowRate * utilization / 10000
      expect(result.supplyRate0).toBe((5000n * 1000n) / 10000n)
      expect(result.supplyRate1).toBe((6000n * 2000n) / 10000n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })
  })
})

describe('Premia Read Functions', () => {
  // Sample tokenId with one leg
  const SAMPLE_TOKEN_ID = 0x0001000100010001n << 64n

  describe('getAccountPremia', () => {
    it('should return zero premia for empty position list', async () => {
      const client = createMockClient()

      const result = await getAccountPremia({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [],
      })

      expect(result.shortPremium0).toBe(0n)
      expect(result.shortPremium1).toBe(0n)
      expect(result.longPremium0).toBe(0n)
      expect(result.longPremium1).toBe(0n)
      expect(result.includePendingPremium).toBe(true)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should return premia from contract', async () => {
      const client = createMockClient()

      // getAccumulatedFeesAndPositionsData returns:
      // [shortPremiumPacked, longPremiumPacked, balances[]]
      // LeftRightUnsigned: right (bits 0-127) = token0, left (bits 128-255) = token1
      const shortPremium = (2000n << 128n) | 1000n // token1=2000, token0=1000
      const longPremium = (400n << 128n) | 300n // token1=400, token0=300
      const balances = [0n] // dummy balance

      vi.mocked(client.readContract).mockResolvedValue([shortPremium, longPremium, balances])

      const result = await getAccountPremia({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [SAMPLE_TOKEN_ID],
        includePendingPremium: true,
      })

      expect(result.shortPremium0).toBe(1000n)
      expect(result.shortPremium1).toBe(2000n)
      expect(result.longPremium0).toBe(300n)
      expect(result.longPremium1).toBe(400n)
      expect(result.includePendingPremium).toBe(true)
    })

    it('should pass includePendingPremium=false to contract', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValue([0n, 0n, []])

      const result = await getAccountPremia({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [SAMPLE_TOKEN_ID],
        includePendingPremium: false,
      })

      expect(result.includePendingPremium).toBe(false)

      // Verify includePendingPremium=false was passed
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getAccumulatedFeesAndPositionsData',
          args: [ACCOUNT_ADDRESS, false, [SAMPLE_TOKEN_ID]],
        }),
      )
    })
  })

  describe('getPositionsWithPremia', () => {
    it('should return empty result for empty position list', async () => {
      const client = createMockClient()

      const result = await getPositionsWithPremia({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [],
      })

      expect(result.positions).toHaveLength(0)
      expect(result.shortPremium0).toBe(0n)
      expect(result.shortPremium1).toBe(0n)
      expect(result.longPremium0).toBe(0n)
      expect(result.longPremium1).toBe(0n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should return positions with per-position premia via multicall', async () => {
      const client = createMockClient()

      // Build a PositionBalance packed value:
      // positionSize (bits 0-127), util0 (128-143), util1 (144-159), tickAtMint (160-183),
      // timestampAtMint (184-215), blockAtMint (216-254), swapAtMint (255)
      const positionSize = 1000000n
      const util0 = 5000n
      const util1 = 6000n
      const tickAtMint = 100n
      const timestampAtMint = 1700000000n
      const blockAtMint = 12345678n
      const swapAtMint = 0n

      const balanceData =
        positionSize |
        (util0 << 128n) |
        (util1 << 144n) |
        (tickAtMint << 160n) |
        (timestampAtMint << 184n) |
        (blockAtMint << 216n) |
        (swapAtMint << 255n)

      // Per-position premia: shortPremium=1000/2000, longPremium=300/400
      const shortPremium = (2000n << 128n) | 1000n
      const longPremium = (400n << 128n) | 300n

      // Mock multicall - one call per tokenId
      vi.mocked(client.multicall).mockResolvedValue([
        {
          status: 'success',
          result: [shortPremium, longPremium, [balanceData]],
        },
      ])

      const result = await getPositionsWithPremia({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [SAMPLE_TOKEN_ID],
      })

      expect(result.positions).toHaveLength(1)
      expect(result.positions[0].positionSize).toBe(1000000n)
      expect(result.positions[0].poolUtilization0AtMint).toBe(5000n)
      expect(result.positions[0].poolUtilization1AtMint).toBe(6000n)
      expect(result.positions[0].tickAtMint).toBe(100n)
      expect(result.positions[0].swapAtMint).toBe(false)
      // Per-position premia: net = short - long
      expect(result.positions[0].premiaOwed0).toBe(700n) // 1000 - 300
      expect(result.positions[0].premiaOwed1).toBe(1600n) // 2000 - 400
      // Totals
      expect(result.shortPremium0).toBe(1000n)
      expect(result.shortPremium1).toBe(2000n)
      expect(result.longPremium0).toBe(300n)
      expect(result.longPremium1).toBe(400n)
    })

    it('should handle multiple positions with individual premia', async () => {
      const client = createMockClient()
      const tokenId1 = SAMPLE_TOKEN_ID
      const tokenId2 = SAMPLE_TOKEN_ID + 1n

      // Position 1 balance
      const balance1 =
        1000000n | // positionSize
        (5000n << 128n) | // util0
        (6000n << 144n) | // util1
        (100n << 160n) | // tickAtMint
        (1700000000n << 184n) | // timestampAtMint
        (12345678n << 216n) // blockAtMint

      // Position 2 balance
      const balance2 =
        2000000n | // positionSize
        (5500n << 128n) | // util0
        (6500n << 144n) | // util1
        (200n << 160n) | // tickAtMint
        (1700000001n << 184n) | // timestampAtMint
        (12345679n << 216n) // blockAtMint

      // Position 1 premia
      const short1 = (1000n << 128n) | 500n
      const long1 = (200n << 128n) | 100n

      // Position 2 premia
      const short2 = (2000n << 128n) | 1000n
      const long2 = (400n << 128n) | 200n

      vi.mocked(client.multicall).mockResolvedValue([
        { status: 'success', result: [short1, long1, [balance1]] },
        { status: 'success', result: [short2, long2, [balance2]] },
      ])

      const result = await getPositionsWithPremia({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [tokenId1, tokenId2],
      })

      expect(result.positions).toHaveLength(2)

      // Position 1 premia
      expect(result.positions[0].premiaOwed0).toBe(400n) // 500 - 100
      expect(result.positions[0].premiaOwed1).toBe(800n) // 1000 - 200

      // Position 2 premia
      expect(result.positions[1].premiaOwed0).toBe(800n) // 1000 - 200
      expect(result.positions[1].premiaOwed1).toBe(1600n) // 2000 - 400

      // Totals (sum of all positions)
      expect(result.shortPremium0).toBe(1500n) // 500 + 1000
      expect(result.shortPremium1).toBe(3000n) // 1000 + 2000
      expect(result.longPremium0).toBe(300n) // 100 + 200
      expect(result.longPremium1).toBe(600n) // 200 + 400
    })

    it('should skip positions with zero size', async () => {
      const client = createMockClient()

      // Balance with zero position size
      const balanceData = 0n // positionSize = 0

      vi.mocked(client.multicall).mockResolvedValue([
        { status: 'success', result: [0n, 0n, [balanceData]] },
      ])

      const result = await getPositionsWithPremia({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [SAMPLE_TOKEN_ID],
      })

      expect(result.positions).toHaveLength(0)
    })

    it('should skip failed multicall results', async () => {
      const client = createMockClient()

      const balance =
        1000000n |
        (5000n << 128n) |
        (6000n << 144n) |
        (100n << 160n) |
        (1700000000n << 184n) |
        (12345678n << 216n)

      const shortPremium = (2000n << 128n) | 1000n
      const longPremium = 0n

      vi.mocked(client.multicall).mockResolvedValue([
        { status: 'success', result: [shortPremium, longPremium, [balance]] },
        { status: 'failure', error: new Error('Position not found') },
      ])

      const result = await getPositionsWithPremia({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenIds: [SAMPLE_TOKEN_ID, SAMPLE_TOKEN_ID + 1n],
      })

      // Only first position should be included
      expect(result.positions).toHaveLength(1)
      expect(result.positions[0].premiaOwed0).toBe(1000n)
      expect(result.positions[0].premiaOwed1).toBe(2000n)
    })
  })
})

describe('Delta Hedge Functions', () => {
  // Build a sample tokenId with a short put
  // PoolId in lower 64 bits + one leg
  const POOL_ID = 0x123456789abcdef0n // 64-bit poolId

  // Leg encoding: optionRatio=1, asset=0, isLong=0, tokenType=1 (put), strike=-1200, width=10
  const buildShortPutTokenId = (): bigint => {
    const optionRatio = 1n
    const asset = 0n
    const isLong = 0n
    const tokenType = 1n // put
    const riskPartner = 0n
    const strike = BigInt(-1200 & 0xffffff) // Mask to 24 bits
    const width = 10n

    // Leg encoding (48 bits total starting at bit 64)
    const leg =
      (optionRatio << 0n) | // bits 0-6
      (asset << 7n) | // bit 7
      (isLong << 8n) | // bit 8
      (tokenType << 9n) | // bit 9
      (riskPartner << 10n) | // bits 10-11
      (strike << 12n) | // bits 12-35
      (width << 36n) // bits 36-47

    return POOL_ID | (leg << 64n)
  }

  const HEDGE_TOKEN_ID = buildShortPutTokenId()

  // Helper to mock getPool multicalls (4 multicalls total)
  // getPoolMetadata: 3 multicalls, getPool: 1 multicall
  const mockGetPoolCalls = (client: PublicClient, currentTick = 0) => {
    // poolKeyBytes: 256-bit hex with currency0, currency1, fee, tickSpacing, hooks
    // Format: [currency0:160][currency1:160][fee:24][tickSpacing:24][hooks:160] = 528 bits
    // Simplified: just make it long enough for parsePoolKey
    const mockPoolKeyBytes =
      '0x' +
      '0000000000000000000000006666666666666666666666666666666666666666' + // currency0 (padded)
      '0000000000000000000000007777777777777777777777777777777777777777' + // currency1 (padded)
      '00000000000000000000000000000000000000000000000000000000000001f4' + // fee = 500
      '000000000000000000000000000000000000000000000000000000000000003c' + // tickSpacing = 60
      '0000000000000000000000000000000000000000000000000000000000000000' // hooks

    vi.mocked(client.multicall)
      // 1. getPoolMetadata: basic results (poolKey, poolId, collateral trackers, riskEngine)
      .mockResolvedValueOnce([
        mockPoolKeyBytes, // poolKeyBytes
        POOL_ID,
        COLLATERAL_TOKEN_0,
        COLLATERAL_TOKEN_1,
        RISK_ENGINE_ADDRESS,
      ])
      // 2. getPoolMetadata: asset addresses from collateral trackers
      .mockResolvedValueOnce([TOKEN_0_ASSET, TOKEN_1_ASSET])
      // 3. getPoolMetadata: token symbols/decimals
      .mockResolvedValueOnce([
        'WETH', // token0Symbol
        18, // token0Decimals
        'USDC', // token1Symbol
        6, // token1Decimals
      ])
      // 4. getPool: dynamic data (11 values)
      .mockResolvedValueOnce([
        currentTick, // getCurrentTick
        0, // isSafeMode (0 = active)
        [1000000n, 100000n, 900000n, 1000n], // token0 poolData
        1000000n, // token0TotalSupply
        100n, // token0InterestRate
        [2000000n, 200000n, 1800000n, 2000n], // token1 poolData
        2000000n, // token1TotalSupply
        200n, // token1InterestRate
        2000n, // sellerCollateralRatio
        1000n, // maintMarginRate
        10n, // notionalFee
      ])
  }

  describe('getDeltaHedgeParams', () => {
    it('should always return a loan with swapAtMint', async () => {
      const client = createMockClient()
      mockGetPoolCalls(client, 0)

      const result = await getDeltaHedgeParams({
        client,
        poolAddress: POOL_ADDRESS,
        chainId: 1n,
        tokenId: HEDGE_TOKEN_ID,
        positionSize: WAD, // 1e18
        targetDelta: 0n, // Delta neutral
      })

      // Always returns a loan + swapAtMint; tokenType controls delta direction
      expect(result.hedgeType).toBe('loan')
      expect(result.swapAtMint).toBe(true)
      expect(result.hedgeLeg).toBeDefined()
      expect(result.hedgeLeg.isLong).toBe(false) // Loan = isLong: false
      expect(result.hedgeLeg.width).toBe(0n) // width 0 for loan
      expect(typeof result.hedgeAmount).toBe('bigint')
      expect(typeof result.currentDelta).toBe('bigint')
      expect(result.targetDelta).toBe(0n)
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should return loan of numeraire when position has negative delta', async () => {
      const client = createMockClient()
      mockGetPoolCalls(client, 0)

      // Provide a negative currentDelta to simulate short call
      const result = await getDeltaHedgeParams({
        client,
        poolAddress: POOL_ADDRESS,
        chainId: 1n,
        tokenId: HEDGE_TOKEN_ID,
        positionSize: WAD,
        targetDelta: 0n,
        currentDelta: -WAD / 2n, // -0.5 delta
      })

      // Negative delta needs loan of numeraire + swapAtMint to add positive delta
      expect(result.hedgeType).toBe('loan')
      expect(result.swapAtMint).toBe(true)
      expect(result.hedgeLeg.isLong).toBe(false) // Loan = isLong: false
      expect(result.hedgeLeg.width).toBe(0n)
      expect(result.deltaAdjustment).toBeGreaterThan(0n) // Needs positive adjustment
    })

    it('should return zero hedge amount when already at target', async () => {
      const client = createMockClient()
      mockGetPoolCalls(client, 0)

      const result = await getDeltaHedgeParams({
        client,
        poolAddress: POOL_ADDRESS,
        chainId: 1n,
        tokenId: HEDGE_TOKEN_ID,
        positionSize: WAD,
        targetDelta: 0n,
        currentDelta: 0n, // Already delta-neutral
      })

      expect(result.hedgeAmount).toBe(0n)
      expect(result.deltaAdjustment).toBe(0n)
    })

    it('should use mintTick for ITM calculations when provided', async () => {
      const client = createMockClient()
      mockGetPoolCalls(client, 100) // currentTick = 100

      const result = await getDeltaHedgeParams({
        client,
        poolAddress: POOL_ADDRESS,
        chainId: 1n,
        tokenId: HEDGE_TOKEN_ID,
        positionSize: WAD,
        targetDelta: 0n,
        mintTick: -100n, // Minted when tick was -100
      })

      expect(result._meta).toBeDefined()
      // Function should complete without error
    })

    it('should handle non-zero target delta', async () => {
      const client = createMockClient()
      mockGetPoolCalls(client, 0)

      // Target +0.3 delta instead of delta-neutral
      const targetDelta = (WAD * 3n) / 10n

      const result = await getDeltaHedgeParams({
        client,
        poolAddress: POOL_ADDRESS,
        chainId: 1n,
        tokenId: HEDGE_TOKEN_ID,
        positionSize: WAD,
        targetDelta,
        currentDelta: WAD / 2n, // +0.5 delta
      })

      // currentDelta (0.5) > targetDelta (0.3), so need to reduce
      expect(result.targetDelta).toBe(targetDelta)
      // deltaAdjustment = 0.3 - 0.5 = -0.2 (negative = need loan)
      expect(result.deltaAdjustment).toBe(targetDelta - WAD / 2n)
      expect(result.hedgeType).toBe('loan')
    })
  })
})
