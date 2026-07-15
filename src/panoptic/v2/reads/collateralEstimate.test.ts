/**
 * Tests for collateral estimation functions with PanopticQuery.
 * @module v2/reads/collateralEstimate.test
 */

import type { PublicClient } from 'viem'
import { encodeFunctionResult } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { PanopticError } from '../errors'
import { tickToSqrtPriceX96 } from '../formatters/tick'
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

    const hex32 = (x: bigint) => x.toString(16).padStart(64, '0')
    const encodeAssets = (a0: bigint, a1: bigint): `0x${string}` =>
      `0x${hex32(a0)}${hex32(a1)}` as `0x${string}`

    // Mock client whose token-flow dispatch simulation (getRequiredCreditForITM) yields the
    // given before/after balances. The SAME flow is returned for the base and every verify
    // re-measurement, so the loop returns the first-iteration legs — enough to assert the
    // SDK orchestration (net-flow → dominant token → leg slot/sign, shift, guards). Real
    // convergence-to-dust is validated on-chain, not in this unit mock.
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

    const singlePut = () =>
      createTokenIdBuilder(POOL_ID)
        .addPut({ strike: 0n, width: 2n, optionRatio: 1n, isLong: false })
        .build()

    it('adds NO leg for an OTM position even with non-dust realized flow, when queryAddress gates on getItmAmounts', async () => {
      const tokenId = singlePut()
      // Realized flow is NON-dust (e.g. the open commission), which would otherwise build a
      // spurious leg. getItmAmounts = 0/0 (OTM) must veto it.
      const client = clientWithFlow(2n * ONE, 2n * ONE, ONE, ONE) // delta -ONE / -ONE (deposits)
      ;(client as unknown as { readContract: ReturnType<typeof vi.fn> }).readContract = vi
        .fn()
        .mockResolvedValue([0n, 0n]) // getItmAmounts → OTM
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
        queryAddress: QUERY_ADDRESS,
      })
      expect(result.neutralLegs).toHaveLength(0)
      expect(result.tokenId).toBe(tokenId)
    })

    it('returns the original tokenId unchanged when OTM (net flow within dust)', async () => {
      const tokenId = singleCall()
      const client = clientWithFlow(1000n, 2000n, 900n, 2100n) // delta -100 / +100 → dust
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })
      expect(result.tokenId).toBe(tokenId)
      expect(result.neutralLegs).toHaveLength(0)
      expect(countLegs(result.tokenId)).toBe(1n)
      expect(result.neutralizedTokenFlow).toBeDefined()
    })

    it('appends the neutral leg after the option leg for a PUT (credit, positive delta1)', async () => {
      const tokenId = singlePut()
      // delta1 = +ONE (user receives USDC) → creditAmount1 = -ONE → credit leg tokenType1/asset0
      const client = clientWithFlow(ONE, ONE, ONE, 2n * ONE)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })
      expect(result.neutralLegs).toHaveLength(1)
      expect(result.neutralLegs[0].tokenType).toBe(1n)
      expect(result.neutralLegs[0].asset).toBe(0n)
      expect(result.neutralLegs[0].isCredit).toBe(true)
      expect(countLegs(result.tokenId)).toBe(2n)
      // put: base option leg stays at index 0; neutral leg is appended at index 1
      const legs = decodeAllLegs(result.tokenId)
      expect(legs[0].width).toBe(2n)
      const neutral = legs[1]
      expect(neutral.index).toBe(1n)
      expect(neutral.width).toBe(0n)
      expect(neutral.isLong).toBe(true)
      expect(neutral.riskPartner).toBe(1n)
      expect(result.tokenId & ((1n << 64n) - 1n)).toBe(POOL_ID)
    })

    it('prepends the neutral leg before the option leg for a CALL (credit at index 0)', async () => {
      const tokenId = singleCall()
      const client = clientWithFlow(ONE, ONE, ONE, 2n * ONE)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })
      expect(result.neutralLegs).toHaveLength(1)
      expect(countLegs(result.tokenId)).toBe(2n)
      const legs = decodeAllLegs(result.tokenId)
      // call: neutral leg leads at index 0; option leg (width 2) shifts to index 1
      const neutral = legs[0]
      expect(neutral.index).toBe(0n)
      expect(neutral.width).toBe(0n)
      expect(neutral.riskPartner).toBe(0n)
      expect(legs[1].width).toBe(2n)
      expect(legs[1].riskPartner).toBe(1n)
      expect(result.tokenId & ((1n << 64n) - 1n)).toBe(POOL_ID)
    })

    it('signs the neutral leg as a LOAN when the user would deposit token0 (negative delta0)', async () => {
      const tokenId = singlePut()
      // delta0 = -ONE (user deposits ETH) → creditAmount0 = +ONE → loan leg tokenType0/asset1
      const client = clientWithFlow(2n * ONE, ONE, ONE, ONE)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })
      expect(result.neutralLegs).toHaveLength(1)
      expect(result.neutralLegs[0].tokenType).toBe(0n)
      expect(result.neutralLegs[0].asset).toBe(1n)
      expect(result.neutralLegs[0].isCredit).toBe(false)
      expect(decodeAllLegs(result.tokenId)[1].isLong).toBe(false)
    })

    it('keeps existing legs at their indices and appends the neutral leg last', async () => {
      const tokenId = createTokenIdBuilder(POOL_ID)
        .addCall({ strike: 120n, width: 2n, optionRatio: 1n, isLong: false })
        .addPut({ strike: -120n, width: 2n, optionRatio: 2n, isLong: false })
        .build()
      const client = clientWithFlow(ONE, ONE, ONE, 2n * ONE) // single-sided token1
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
      })
      const legs = decodeAllLegs(result.tokenId)
      expect(legs).toHaveLength(3)
      // original legs keep indices 0 and 1; neutral leg appended at index 2
      expect(legs[0].strike).toBe(120n)
      expect(legs[0].riskPartner).toBe(0n)
      expect(legs[1].strike).toBe(-120n)
      expect(legs[1].riskPartner).toBe(1n)
      expect(legs[2].index).toBe(2n)
      expect(legs[2].width).toBe(0n)
      expect(legs[2].riskPartner).toBe(2n)
    })

    it('reproduces the manually-verified credit leg for a real ITM put (strike -227220)', async () => {
      // Ground truth from a live pool (Guillaume's manual fill):
      //   base put  0x28fcf16c202003c08ae4977f78d  (tokenType1/asset0, width40, strike -200340)
      //   + credit  0xfc886c702028fcf16c202003c08ae4977f78d → residual < 1 USDC
      // The manual credit leg: index 1, tokenType1, asset0, isLong (credit), width0, strike -227220.
      const basePut = 0x28fcf16c202003c08ae4977f78dn
      const positionSize = 10n ** 18n
      const Q192 = 1n << 192n

      // Net token1 flow whose 1:1-sized credit leg lands at strike -227220 (mirrors
      // computeWidth0Notional: notional1 = positionSize · 1.0001^strike, asset0 ⇒ signed=strike).
      const sqrtK = tickToSqrtPriceX96(-227220n)
      const flow1 = (positionSize * sqrtK * sqrtK) / Q192

      // User RECEIVES flow1 USDC (delta1 = +flow1) → creditAmount1 = -flow1 → credit leg. No token0 flow.
      const client = clientWithFlow(ONE, flow1, ONE, 2n * flow1)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId: basePut,
        positionSize,
        swapAtMint: true, // Zap; leg sized 1:1 to the post-swap net flow (mock returns it for both calls)
      })

      expect(result.neutralLegs).toHaveLength(1)
      const leg = result.neutralLegs[0]
      expect(leg.tokenType).toBe(1n)
      expect(leg.asset).toBe(0n)
      expect(leg.isCredit).toBe(true)
      // Reproduces the manual strike within ≤1 tick (integer isqrt/log round-trip).
      expect(leg.strike).toBeGreaterThanOrEqual(-227221n)
      expect(leg.strike).toBeLessThanOrEqual(-227219n)

      // Put ⇒ appended after the option leg: base put stays at index 0, credit at index 1.
      const legs = decodeAllLegs(result.tokenId)
      expect(legs).toHaveLength(2)
      expect(legs[0].width).toBe(40n)
      expect(legs[0].strike).toBe(-200340n)
      expect(legs[1].index).toBe(1n)
      expect(legs[1].width).toBe(0n)
      expect(legs[1].isLong).toBe(true)
      expect(legs[1].riskPartner).toBe(1n)
    })

    it('adds TWO neutral legs (one per token) for a two-sided flow under Cover (swapAtMint=false)', async () => {
      // Two-leg base (call + put). Under Cover there is no swap, so a two-sided flow gets a
      // neutral leg per token; verified on-chain both sides go to dust.
      const tokenId = createTokenIdBuilder(POOL_ID)
        .addCall({ strike: 0n, width: 2n, optionRatio: 1n, isLong: false })
        .addPut({ strike: 0n, width: 2n, optionRatio: 1n, isLong: false })
        .build()
      // delta0 = +ONE and delta1 = +ONE → both sides receive (credit), both above dust.
      const client = clientWithFlow(ONE, ONE, 2n * ONE, 2n * ONE)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
        swapAtMint: false, // Cover at mint
      })
      expect(result.neutralLegs).toHaveLength(2)
      // one leg per token type
      expect(result.neutralLegs.map((l) => l.tokenType).sort()).toEqual([0n, 1n])
      // both credit legs (user receives on both sides)
      expect(result.neutralLegs.every((l) => l.isCredit)).toBe(true)
      // base legs keep indices 0,1; neutral legs appended at 2,3 (self-partnered, width 0)
      const legs = decodeAllLegs(result.tokenId)
      expect(legs).toHaveLength(4)
      expect(legs[2].index).toBe(2n)
      expect(legs[2].width).toBe(0n)
      expect(legs[2].riskPartner).toBe(2n)
      expect(legs[3].index).toBe(3n)
      expect(legs[3].width).toBe(0n)
      expect(legs[3].riskPartner).toBe(3n)
    })

    it('adds only ONE (dominant) neutral leg for a two-sided flow under Zap (swapAtMint=true)', async () => {
      // Same two-sided flow, but under Zap the swap consolidates to one token → single leg.
      const tokenId = createTokenIdBuilder(POOL_ID)
        .addCall({ strike: 0n, width: 2n, optionRatio: 1n, isLong: false })
        .addPut({ strike: 0n, width: 2n, optionRatio: 1n, isLong: false })
        .build()
      const client = clientWithFlow(ONE, ONE, 2n * ONE, 2n * ONE)
      const result = await createFlowNeutralTokenId({
        client,
        poolAddress: POOL_ADDRESS,
        account: ACCOUNT_ADDRESS,
        tokenId,
        positionSize: ONE,
        swapAtMint: true, // Zap
      })
      expect(result.neutralLegs).toHaveLength(1)
    })

    it('throws when positionSize is not positive', async () => {
      const client = clientWithFlow(ONE, ONE, ONE, ONE)
      await expect(
        createFlowNeutralTokenId({
          client,
          poolAddress: POOL_ADDRESS,
          account: ACCOUNT_ADDRESS,
          tokenId: singleCall(),
          positionSize: 0n,
        }),
      ).rejects.toThrow(PanopticError)
    })

    it('throws when the base tokenId already has 4 legs', async () => {
      const tokenId = createTokenIdBuilder(POOL_ID)
        .addCall({ strike: 0n, width: 2n, optionRatio: 1n, isLong: false })
        .addCall({ strike: 60n, width: 2n, optionRatio: 1n, isLong: false })
        .addCall({ strike: 120n, width: 2n, optionRatio: 1n, isLong: false })
        .addCall({ strike: 180n, width: 2n, optionRatio: 1n, isLong: false })
        .build()
      const client = clientWithFlow(ONE, ONE, ONE, 2n * ONE)
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
