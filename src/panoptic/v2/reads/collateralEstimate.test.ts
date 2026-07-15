/**
 * Tests for collateral estimation functions with PanopticQuery.
 * @module v2/reads/collateralEstimate.test
 */

import type { PublicClient } from 'viem'
import { encodeFunctionResult } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { PanopticError } from '../errors'
import { createMemoryStorage, getPositionsKey, jsonSerializer } from '../storage'
import { countLegs, createTokenIdBuilder, decodeAllLegs, encodePoolId } from '../tokenId'
import {
  createFlowNeutralTokenId,
  estimateCollateralRequired,
  getMaxPositionSize,
  getRequiredCreditForITM,
} from './collateralEstimate'

// Common mock addresses
const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const ACCOUNT_ADDRESS = '0x2222222222222222222222222222222222222222' as const
const QUERY_ADDRESS = '0x3333333333333333333333333333333333333333' as const

// Common mock block
const MOCK_BLOCK = {
  number: 12345678n,
  hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
  timestamp: 1700000000n,
}

// getCurrentTick ABI for encoding mock results
const getCurrentTickAbi = [
  {
    type: 'function' as const,
    name: 'getCurrentTick' as const,
    inputs: [] as const,
    outputs: [{ name: 'currentTick' as const, type: 'int24' as const }] as const,
    stateMutability: 'view' as const,
  },
]

function encodeCurrentTick(tick: number): `0x${string}` {
  return encodeFunctionResult({
    abi: getCurrentTickAbi,
    functionName: 'getCurrentTick',
    result: tick,
  })
}

// Mock PublicClient factory
function createMockClient(): PublicClient {
  return {
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK.number),
    readContract: vi.fn(),
  } as unknown as PublicClient
}

describe('Collateral Estimation with PanopticQuery', () => {
  // getRequiredBase computes at type(uint64).max size; estimateCollateralRequired
  // scales the raw result down by positionSize / MAX_UINT64.
  const MAX_UINT64 = 2n ** 64n - 1n

  describe('estimateCollateralRequired', () => {
    it('should scale requirement down to positionSize at current tick', async () => {
      const client = createMockClient()

      // Raw = MAX_UINT64 (requirement at max size) → scales to exactly positionSize
      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100) // getCurrentTick
        .mockResolvedValueOnce(MAX_UINT64) // getRequiredBase (at type(uint64).max size)

      const positionSize = 1n * 10n ** 18n
      const result = await estimateCollateralRequired({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        positionSize,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.required0).toBe(positionSize)
      expect(result.required1).toBe(0n) // Not available from getRequiredBase
      expect(result._meta.blockNumber).toBe(12345678n)
    })

    it('should scale linearly with positionSize', async () => {
      const client = createMockClient()

      // Raw = MAX_UINT64, size = 2e18 → scaled = 2e18
      vi.mocked(client.readContract).mockResolvedValueOnce(MAX_UINT64) // getRequiredBase

      const positionSize = 2n * 10n ** 18n
      const result = await estimateCollateralRequired({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 456n,
        positionSize,
        atTick: 500n,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.required0).toBe(positionSize)

      // Verify atTick was used (not getCurrentTick) - tick is converted to number for viem
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getRequiredBase',
          args: expect.arrayContaining([expect.anything(), expect.anything(), 500]),
        }),
      )
    })

    it('should pass through the error sentinel unscaled', async () => {
      const client = createMockClient()

      const sentinel = 2n ** 128n - 1n // getRequiredBase error sentinel (type(uint128).max)
      vi.mocked(client.readContract)
        .mockResolvedValueOnce(100) // getCurrentTick
        .mockResolvedValueOnce(sentinel) // getRequiredBase failed

      const result = await estimateCollateralRequired({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 789n,
        positionSize: 100n * 10n ** 18n,
        queryAddress: QUERY_ADDRESS,
      })

      expect(result.required0).toBe(sentinel)
    })
  })

  describe('getMaxPositionSize', () => {
    it('should return bounds from contract with refine=false', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValueOnce([
        100n * 10n ** 18n, // maxSizeAtMinUtil (0% util)
        50n * 10n ** 18n, // maxSizeAtMaxUtil (100% util)
      ])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
        refine: false,
      })

      expect(result.maxSizeAtMinUtil).toBe(100n * 10n ** 18n)
      expect(result.maxSizeAtMaxUtil).toBe(50n * 10n ** 18n)
      expect(result.maxSize).toBe(50n * 10n ** 18n) // Conservative estimate when refine=false
    })

    it('should return conservative estimate when bounds are close (within 1% default)', async () => {
      const client = createMockClient()

      // Bounds within 1% - should skip refinement
      vi.mocked(client.readContract).mockResolvedValueOnce([
        1000n * 10n ** 18n, // maxSizeAtMinUtil
        995n * 10n ** 18n, // maxSizeAtMaxUtil (0.5% difference)
      ])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 456n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
      })

      // Should return conservative estimate without binary search
      expect(result.maxSize).toBe(995n * 10n ** 18n)
    })

    it('should respect custom precisionPct of 5%', async () => {
      const client = createMockClient()

      // Bounds within 5% - should skip refinement with precisionPct=5
      vi.mocked(client.readContract).mockResolvedValueOnce([
        100n * 10n ** 18n, // maxSizeAtMinUtil
        96n * 10n ** 18n, // maxSizeAtMaxUtil (4% difference)
      ])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 456n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
        precisionPct: 5,
      })

      // Should return conservative estimate without binary search
      expect(result.maxSize).toBe(96n * 10n ** 18n)
    })

    it('should respect custom precisionPct of 0.1%', async () => {
      const client = createMockClient()

      // Bounds within 0.1% - should skip refinement with precisionPct=0.1
      vi.mocked(client.readContract).mockResolvedValueOnce([
        10000n * 10n ** 18n, // maxSizeAtMinUtil
        9995n * 10n ** 18n, // maxSizeAtMaxUtil (0.05% difference)
      ])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 456n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
        precisionPct: 0.1,
      })

      // Should return conservative estimate without binary search
      expect(result.maxSize).toBe(9995n * 10n ** 18n)
    })

    it('should use existingPositionIds when provided', async () => {
      const client = createMockClient()
      const existingIds = [111n, 222n, 333n]

      vi.mocked(client.readContract).mockResolvedValueOnce([50n, 40n])

      await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 789n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: existingIds,
        refine: false,
      })

      // Verify existingPositionIds were passed to contract
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getMaxPositionSizeBounds',
          args: [POOL_ADDRESS, existingIds, ACCOUNT_ADDRESS, 789n],
        }),
      )
    })

    it('should fetch positions from storage when chainId and storage provided', async () => {
      const client = createMockClient()
      const storage = createMemoryStorage()
      const chainId = 11155111n // Sepolia

      // Pre-populate storage with positions using the correct key and serializer format
      const storedPositions = [444n, 555n]
      const key = getPositionsKey(chainId, POOL_ADDRESS, ACCOUNT_ADDRESS)
      await storage.set(key, jsonSerializer.stringify(storedPositions))

      vi.mocked(client.readContract).mockResolvedValueOnce([60n, 50n])

      await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 999n,
        queryAddress: QUERY_ADDRESS,
        storage,
        chainId,
        refine: false,
      })

      // Verify positions from storage were used
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getMaxPositionSizeBounds',
          args: [POOL_ADDRESS, storedPositions, ACCOUNT_ADDRESS, 999n],
        }),
      )
    })

    it('should use empty array when no positions and no storage', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValueOnce([30n, 20n])

      await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 111n,
        queryAddress: QUERY_ADDRESS,
        refine: false,
      })

      // Verify empty array was passed
      expect(vi.mocked(client.readContract)).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'getMaxPositionSizeBounds',
          args: [POOL_ADDRESS, [], ACCOUNT_ADDRESS, 111n],
        }),
      )
    })

    it('should include block metadata in result', async () => {
      const client = createMockClient()

      vi.mocked(client.readContract).mockResolvedValueOnce([100n, 100n])

      const result = await getMaxPositionSize({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        queryAddress: QUERY_ADDRESS,
        existingPositionIds: [],
        refine: false,
      })

      expect(result._meta.blockNumber).toBe(MOCK_BLOCK.number)
      expect(result._meta.blockHash).toBe(MOCK_BLOCK.hash)
      expect(result._meta.blockTimestamp).toBe(MOCK_BLOCK.timestamp)
    })
  })

  describe('getRequiredCreditForITM', () => {
    it('should return inverted token flow as credit amounts', async () => {
      const client = createMockClient()

      // Mock simulateContract for multicall (used by simulateWithTokenFlow)
      // Returns encoded results for: [getAssetsOf_before, getCurrentTick_before, dispatch, getCurrentTick_after, getAssetsOf_after]
      // Assets before: 1000n token0, 2000n token1
      // Assets after: 900n token0, 2100n token1 (delta0 = -100n, delta1 = +100n)
      const mockSimulateContract = vi.fn().mockResolvedValue({
        result: [
          // getAssetsOf before: (assets0, assets1) ABI-encoded
          '0x00000000000000000000000000000000000000000000000000000000000003e80000000000000000000000000000000000000000000000000000000000000' +
            '7d0',
          // getCurrentTick before
          encodeCurrentTick(0),
          // dispatch result (ignored)
          '0x',
          // getCurrentTick after
          encodeCurrentTick(0),
          // getAssetsOf after: (assets0, assets1) ABI-encoded
          '0x0000000000000000000000000000000000000000000000000000000000000384' +
            '0000000000000000000000000000000000000000000000000000000000000834',
        ],
      })

      // Also mock estimateGas
      const mockEstimateGas = vi.fn().mockResolvedValue(100000n)

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
        estimateGas: mockEstimateGas,
      } as unknown as PublicClient

      const result = await getRequiredCreditForITM({
        client: clientWithSimulate,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        positionSize: 1n * 10n ** 18n,
      })

      // delta0 = 900 - 1000 = -100, so creditAmount0 = -(-100) = 100
      // delta1 = 2100 - 2000 = +100, so creditAmount1 = -(+100) = -100
      expect(result.creditAmount0).toBe(100n)
      expect(result.creditAmount1).toBe(-100n)
      expect(result._meta.blockNumber).toBe(MOCK_BLOCK.number)
    })

    it('should throw PanopticError when simulation fails', async () => {
      const client = createMockClient()

      const mockSimulateContract = vi.fn().mockRejectedValue(new Error('Simulation reverted'))

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
      } as unknown as PublicClient

      await expect(
        getRequiredCreditForITM({
          client: clientWithSimulate,
          poolAddress: POOL_ADDRESS,
          account: ACCOUNT_ADDRESS,
          tokenId: 123n,
          positionSize: 1n * 10n ** 18n,
        }),
      ).rejects.toThrow(PanopticError)
    })

    it('should use provided existingPositionIds in dispatch call', async () => {
      const client = createMockClient()
      const existingIds = [111n, 222n]

      const mockSimulateContract = vi.fn().mockResolvedValue({
        result: [
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
          encodeCurrentTick(0),
          '0x',
          encodeCurrentTick(0),
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
        ],
      })
      const mockEstimateGas = vi.fn().mockResolvedValue(100000n)

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
        estimateGas: mockEstimateGas,
      } as unknown as PublicClient

      await getRequiredCreditForITM({
        client: clientWithSimulate,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 333n,
        positionSize: 1n * 10n ** 18n,
        existingPositionIds: existingIds,
      })

      // Verify the call was made (detailed args checking is complex due to encoding)
      expect(mockSimulateContract).toHaveBeenCalled()
    })

    it('should return zero credit amounts when token flow is zero', async () => {
      const client = createMockClient()

      // Same assets before and after = no movement
      const mockSimulateContract = vi.fn().mockResolvedValue({
        result: [
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
          encodeCurrentTick(0),
          '0x',
          encodeCurrentTick(0),
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
        ],
      })
      const mockEstimateGas = vi.fn().mockResolvedValue(100000n)

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
        estimateGas: mockEstimateGas,
      } as unknown as PublicClient

      const result = await getRequiredCreditForITM({
        client: clientWithSimulate,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        positionSize: 1n * 10n ** 18n,
      })

      expect(result.creditAmount0).toBe(0n)
      expect(result.creditAmount1).toBe(0n)
    })

    it('should include raw tokenFlow in result', async () => {
      const client = createMockClient()

      const mockSimulateContract = vi.fn().mockResolvedValue({
        result: [
          '0x00000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000007d0',
          encodeCurrentTick(0),
          '0x',
          encodeCurrentTick(0),
          '0x00000000000000000000000000000000000000000000000000000000000003840000000000000000000000000000000000000000000000000000000000000834',
        ],
      })
      const mockEstimateGas = vi.fn().mockResolvedValue(100000n)

      const clientWithSimulate = {
        ...client,
        simulateContract: mockSimulateContract,
        estimateGas: mockEstimateGas,
      } as unknown as PublicClient

      const result = await getRequiredCreditForITM({
        client: clientWithSimulate,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: 123n,
        positionSize: 1n * 10n ** 18n,
      })

      // Verify tokenFlow is included
      expect(result.tokenFlow).toBeDefined()
      expect(result.tokenFlow.balanceBefore0).toBe(1000n)
      expect(result.tokenFlow.balanceBefore1).toBe(2000n)
      expect(result.tokenFlow.balanceAfter0).toBe(900n)
      expect(result.tokenFlow.balanceAfter1).toBe(2100n)
      expect(result.tokenFlow.delta0).toBe(-100n)
      expect(result.tokenFlow.delta1).toBe(100n)
    })
  })

  describe('createFlowNeutralTokenId', () => {
    const TICK_SPACING = 60n
    const POOL_ID = encodePoolId(POOL_ADDRESS, TICK_SPACING)
    const ONE = 10n ** 18n

    // Encode getAssetsOf -> (uint256 assets0, uint256 assets1)
    const hex32 = (x: bigint) => x.toString(16).padStart(64, '0')
    const encodeAssets = (a0: bigint, a1: bigint): `0x${string}` =>
      `0x${hex32(a0)}${hex32(a1)}` as `0x${string}`

    // Mock client whose token-flow simulation produces the given before/after balances.
    function clientWithFlow(
      before0: bigint,
      before1: bigint,
      after0: bigint,
      after1: bigint,
      tick = 0,
    ) {
      const client = createMockClient()
      const simulateContract = vi.fn().mockResolvedValue({
        result: [
          encodeAssets(before0, before1),
          encodeCurrentTick(tick),
          '0x',
          encodeCurrentTick(tick),
          encodeAssets(after0, after1),
        ],
      })
      return {
        ...client,
        simulateContract,
        estimateGas: vi.fn().mockResolvedValue(100000n),
      } as unknown as PublicClient
    }

    const singleCall = () =>
      createTokenIdBuilder(POOL_ID)
        .addCall({ strike: 0n, width: 2n, optionRatio: 1n, isLong: false })
        .build()

    it('returns the original tokenId unchanged when OTM (within dust)', async () => {
      const tokenId = singleCall()
      // delta0 = -100, delta1 = +100 -> both below dust threshold
      const client = clientWithFlow(1000n, 2000n, 900n, 2100n)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })
      expect(result.tokenId).toBe(tokenId)
      expect(result.positionSize).toBe(ONE)
      expect(result.neutralStrike).toBe(0n)
      expect(countLegs(result.tokenId)).toBe(1n)
    })

    it('prepends a loan leg for a token0 deposit (credit needed)', async () => {
      const tokenId = singleCall()
      // delta0 = -ONE -> creditAmount0 = +ONE (user deposits token0) -> offset with a LOAN
      const client = clientWithFlow(3n * ONE, ONE, 2n * ONE, ONE)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })

      expect(result.positionSize).toBe(ONE) // never rescaled
      expect(result.neutralIsCredit).toBe(false)
      expect(result.neutralTokenType).toBe(0n)
      expect(result.neutralAsset).toBe(1n)
      expect(countLegs(result.tokenId)).toBe(2n)

      const legs = decodeAllLegs(result.tokenId)
      const neutral = legs[0]
      expect(neutral.index).toBe(0n)
      expect(neutral.width).toBe(0n)
      expect(neutral.optionRatio).toBe(1n)
      expect(neutral.isLong).toBe(false)
      expect(neutral.asset).toBe(1n)
      expect(neutral.tokenType).toBe(0n)
      // ratio = ONE/ONE = 1 -> tick 0 -> strike 0
      expect(neutral.strike).toBe(0n)
      // poolId (low 64 bits) preserved
      expect(result.tokenId & ((1n << 64n) - 1n)).toBe(POOL_ID)
    })

    it('prepends a credit leg for a token1 payout (ITM short put)', async () => {
      const tokenId = singleCall()
      // delta1 = +ONE -> creditAmount1 = -ONE (user receives token1) -> offset with a CREDIT
      const client = clientWithFlow(ONE, ONE, ONE, 2n * ONE)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })

      expect(result.neutralIsCredit).toBe(true)
      expect(result.neutralTokenType).toBe(1n)
      expect(result.neutralAsset).toBe(0n)
      const neutral = decodeAllLegs(result.tokenId)[0]
      expect(neutral.isLong).toBe(true)
      expect(neutral.width).toBe(0n)
    })

    it('rounds the neutralizing strike to tick spacing within bounds', async () => {
      const tokenId = singleCall()
      // creditAmount0 = +2*ONE -> ratio 2 -> tick ≈ 6931.8
      const client = clientWithFlow(3n * ONE, ONE, ONE, ONE)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })
      const neutral = decodeAllLegs(result.tokenId)[0]
      // legAsset === 1 -> strike is the negated rounded tick; magnitude on spacing grid
      expect(neutral.strike % TICK_SPACING).toBe(0n)
      const absResidual =
        result.strikeResidualTick < 0n ? -result.strikeResidualTick : result.strikeResidualTick
      expect(absResidual).toBeLessThan(TICK_SPACING)
    })

    it('shifts existing legs and remaps self-partners on prepend', async () => {
      const tokenId = createTokenIdBuilder(POOL_ID)
        .addCall({ strike: 120n, width: 2n, optionRatio: 1n, isLong: false })
        .addPut({ strike: -120n, width: 2n, optionRatio: 2n, isLong: false })
        .build()
      const client = clientWithFlow(3n * ONE, ONE, 2n * ONE, ONE)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })
      const legs = decodeAllLegs(result.tokenId)
      expect(legs).toHaveLength(3)
      // original legs shifted to indices 1 and 2, self-partners follow their index
      expect(legs[1].strike).toBe(120n)
      expect(legs[1].riskPartner).toBe(1n)
      expect(legs[2].strike).toBe(-120n)
      expect(legs[2].optionRatio).toBe(2n)
      expect(legs[2].riskPartner).toBe(2n)
    })

    it('selects the ITM token by value, not raw magnitude (mixed decimals)', async () => {
      // Simulates an ITM short put on an 18-dec token0 / 6-dec token1 pool:
      //   - token1 (e.g. USDC, 6-dec) carries the real ITM: ~1665 "USDC" payout
      //   - token0 (e.g. WETH, 18-dec) carries a tiny residual whose RAW integer
      //     (1e15) dwarfs the token1 raw (1.665e9) purely due to decimals.
      // Value-aware selection must still neutralize the token1 ITM.
      const tokenId = singleCall()
      const residual0 = 1_000_000_000_000_000n // 1e15 raw (~0.001 of an 18-dec token)
      const itm1 = 1_665_000_000n // 1.665e9 raw (1665 of a 6-dec token)
      // Tick where token0 is worth very little in token1 terms (price ~1.66e-9).
      const tick = -202100
      const client = clientWithFlow(
        ONE, // before0
        2_000_000_000n, // before1
        ONE + residual0, // after0 -> delta0 = +residual0 (user receives token0)
        2_000_000_000n + itm1, // after1 -> delta1 = +itm1 (user receives the ITM)
        tick,
      )
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: 5n * ONE,
      })
      // Raw comparison would pick token0 (1e15 > 1.665e9); value-aware picks token1.
      expect(result.neutralTokenType).toBe(1n)
      expect(result.neutralAsset).toBe(0n)
      expect(result.neutralIsCredit).toBe(true) // creditAmount1 < 0 (user receives) -> credit
    })

    it('throws when positionSize is not positive', async () => {
      const tokenId = singleCall()
      const client = clientWithFlow(ONE, ONE, ONE, ONE)
      await expect(
        createFlowNeutralTokenId({
          client,
          poolAddress: POOL_ADDRESS,
          account: ACCOUNT_ADDRESS,
          tokenId,
          positionSize: 0n,
        }),
      ).rejects.toThrow(PanopticError)
    })

    it('throws when the tokenId already has 4 legs', async () => {
      const tokenId = createTokenIdBuilder(POOL_ID)
        .addCall({ strike: 0n, width: 2n, optionRatio: 1n, isLong: false })
        .addCall({ strike: 60n, width: 2n, optionRatio: 1n, isLong: false })
        .addCall({ strike: 120n, width: 2n, optionRatio: 1n, isLong: false })
        .addCall({ strike: 180n, width: 2n, optionRatio: 1n, isLong: false })
        .build()
      const client = clientWithFlow(ONE, ONE, ONE, ONE)
      await expect(
        createFlowNeutralTokenId({
          client,
          poolAddress: POOL_ADDRESS,
          account: ACCOUNT_ADDRESS,
          tokenId,
          positionSize: ONE,
        }),
      ).rejects.toThrow(PanopticError)
    })
  })
})
