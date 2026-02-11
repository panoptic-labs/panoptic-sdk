/**
 * Tests for event watching module.
 * @module v2/events/events.test
 */

import type { Hash, PublicClient } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PanopticEvent } from '../types'
import {
  createEventPoller,
  createEventSubscription,
  DEFAULT_RECONNECT_CONFIG,
  parseCollateralLog,
  parsePoolLog,
  parsePoolManagerLog,
  parseRiskEngineLog,
  parseSfpmLog,
  watchEvents,
} from './index'
import type { DecodedLog } from './watchEvents'

// Mock addresses
const MOCK_POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const MOCK_CT0_ADDRESS = '0x2222222222222222222222222222222222222222' as const
const MOCK_CT1_ADDRESS = '0x3333333333333333333333333333333333333333' as const
const MOCK_RECIPIENT = '0x4444444444444444444444444444444444444444' as const
const MOCK_RISK_ENGINE_ADDRESS = '0x5555555555555555555555555555555555555555' as const
const MOCK_SFPM_ADDRESS = '0x6666666666666666666666666666666666666666' as const
const MOCK_POOL_MANAGER_ADDRESS = '0x7777777777777777777777777777777777777777' as const
const MOCK_TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash
const MOCK_BLOCK_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash
const MOCK_POOL_ID = '0xaabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344' as Hash

// Helper to create mock log
function createMockLog(
  eventName: string,
  args: Record<string, unknown>,
  blockNumber = 12345678n,
  logIndex = 0,
): DecodedLog {
  return {
    address: MOCK_POOL_ADDRESS,
    topics: [],
    data: '0x',
    blockNumber,
    blockHash: MOCK_BLOCK_HASH,
    transactionHash: MOCK_TX_HASH,
    transactionIndex: 0,
    logIndex,
    removed: false,
    args,
  } as DecodedLog
}

// Helper to create mock client
function createMockClient(overrides: Partial<PublicClient> = {}): PublicClient {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(12345678n),
    getContractEvents: vi.fn().mockResolvedValue([]),
    watchContractEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as unknown as PublicClient
}

describe('parsePoolLog', () => {
  it('should parse OptionMinted event', () => {
    // balanceData encodes: positionSize (128 bits), utilization0 (16 bits), utilization1 (16 bits), tickAtMint (24 bits), timestamp (32 bits), block (40 bits)
    // For simplicity, use a value that gives us known decoded values
    const balanceData = (1000n << 128n) | (5000n << 112n) | (6000n << 96n) | (100n << 72n)
    const log = createMockLog('OptionMinted', {
      recipient: MOCK_RECIPIENT,
      tokenId: 123456789n,
      balanceData,
    })

    const result = parsePoolLog(log, 'OptionMinted')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('OptionMinted')
    if (result?.type === 'OptionMinted') {
      expect(result.recipient).toBe(MOCK_RECIPIENT)
      expect(result.tokenId).toBe(123456789n)
    }
    expect(result?.transactionHash).toBe(MOCK_TX_HASH)
    expect(result?.blockNumber).toBe(12345678n)
  })

  it('should parse OptionBurnt event', () => {
    const log = createMockLog('OptionBurnt', {
      recipient: MOCK_RECIPIENT,
      positionSize: 1000n,
      tokenId: 123456789n,
      premiaByLeg: [100n, 200n, 0n, 0n] as const,
    })

    const result = parsePoolLog(log, 'OptionBurnt')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('OptionBurnt')
    if (result?.type === 'OptionBurnt') {
      expect(result.recipient).toBe(MOCK_RECIPIENT)
      expect(result.tokenId).toBe(123456789n)
      expect(result.positionSize).toBe(1000n)
      expect(result.premiaByLeg).toEqual([100n, 200n, 0n, 0n])
    }
  })

  it('should parse AccountLiquidated event', () => {
    // bonusAmounts is LeftRightSigned: left (128-255) = token1, right (0-127) = token0
    const bonusAmounts = (500n << 128n) | 300n
    const log = createMockLog('AccountLiquidated', {
      liquidator: MOCK_RECIPIENT,
      liquidatee: '0x5555555555555555555555555555555555555555',
      bonusAmounts,
    })

    const result = parsePoolLog(log, 'AccountLiquidated')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('AccountLiquidated')
    if (result?.type === 'AccountLiquidated') {
      expect(result.liquidator).toBe(MOCK_RECIPIENT)
      expect(result.bonusAmount0).toBe(300n)
      expect(result.bonusAmount1).toBe(500n)
    }
  })

  it('should parse ForcedExercised event', () => {
    // exerciseFee is LeftRightSigned
    const exerciseFee = (200n << 128n) | 100n
    const log = createMockLog('ForcedExercised', {
      exercisor: MOCK_RECIPIENT,
      user: '0x5555555555555555555555555555555555555555',
      tokenId: 123456789n,
      exerciseFee,
    })

    const result = parsePoolLog(log, 'ForcedExercised')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('ForcedExercised')
    if (result?.type === 'ForcedExercised') {
      expect(result.exercisor).toBe(MOCK_RECIPIENT)
      expect(result.tokenId).toBe(123456789n)
      expect(result.exerciseFee0).toBe(100n)
      expect(result.exerciseFee1).toBe(200n)
    }
  })

  it('should parse PremiumSettled event', () => {
    const settledAmounts = (300n << 128n) | 150n
    const log = createMockLog('PremiumSettled', {
      user: MOCK_RECIPIENT,
      tokenId: 123456789n,
      legIndex: 2n,
      settledAmounts,
    })

    const result = parsePoolLog(log, 'PremiumSettled')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('PremiumSettled')
    if (result?.type === 'PremiumSettled') {
      expect(result.user).toBe(MOCK_RECIPIENT)
      expect(result.tokenId).toBe(123456789n)
      expect(result.legIndex).toBe(2n)
      expect(result.settledAmount0).toBe(150n)
      expect(result.settledAmount1).toBe(300n)
    }
  })

  it('should return null for unknown event', () => {
    const log = createMockLog('UnknownEvent', {})
    const result = parsePoolLog(log, 'UnknownEvent')
    expect(result).toBeNull()
  })
})

describe('parseCollateralLog', () => {
  it('should parse Deposit event', () => {
    const log = createMockLog('Deposit', {
      sender: MOCK_RECIPIENT,
      owner: '0x5555555555555555555555555555555555555555',
      assets: 1000n,
      shares: 950n,
    })

    const result = parseCollateralLog(log, 'Deposit')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('Deposit')
    if (result?.type === 'Deposit') {
      expect(result.sender).toBe(MOCK_RECIPIENT)
      expect(result.assets).toBe(1000n)
      expect(result.shares).toBe(950n)
    }
  })

  it('should parse Withdraw event', () => {
    const log = createMockLog('Withdraw', {
      sender: MOCK_RECIPIENT,
      receiver: '0x5555555555555555555555555555555555555555',
      owner: '0x6666666666666666666666666666666666666666',
      assets: 1000n,
      shares: 950n,
    })

    const result = parseCollateralLog(log, 'Withdraw')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('Withdraw')
    if (result?.type === 'Withdraw') {
      expect(result.sender).toBe(MOCK_RECIPIENT)
      expect(result.assets).toBe(1000n)
      expect(result.shares).toBe(950n)
    }
  })

  it('should parse ProtocolLossRealized event', () => {
    const log = createMockLog('ProtocolLossRealized', {
      liquidatee: MOCK_RECIPIENT,
      liquidator: '0x5555555555555555555555555555555555555555',
      protocolLossAssets: 5000n,
      protocolLossShares: 4800n,
    })

    const result = parseCollateralLog(log, 'ProtocolLossRealized')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('ProtocolLossRealized')
    if (result?.type === 'ProtocolLossRealized') {
      expect(result.liquidatee).toBe(MOCK_RECIPIENT)
      expect(result.protocolLossAssets).toBe(5000n)
      expect(result.protocolLossShares).toBe(4800n)
    }
  })

  it('should return null for unknown event', () => {
    const log = createMockLog('UnknownEvent', {})
    const result = parseCollateralLog(log, 'UnknownEvent')
    expect(result).toBeNull()
  })
})

describe('parseRiskEngineLog', () => {
  it('should parse BorrowRateUpdated event', () => {
    const log = createMockLog('BorrowRateUpdated', {
      collateralToken: MOCK_RECIPIENT,
      avgBorrowRate: 1000000n,
      rateAtTarget: 500000n,
    })

    const result = parseRiskEngineLog(log, 'BorrowRateUpdated')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('BorrowRateUpdated')
    if (result?.type === 'BorrowRateUpdated') {
      expect(result.collateralToken).toBe(MOCK_RECIPIENT)
      expect(result.avgBorrowRate).toBe(1000000n)
      expect(result.rateAtTarget).toBe(500000n)
    }
  })

  it('should return null for unknown event', () => {
    const log = createMockLog('UnknownEvent', {})
    const result = parseRiskEngineLog(log, 'UnknownEvent')
    expect(result).toBeNull()
  })
})

describe('parseSfpmLog', () => {
  it('should parse LiquidityChunkUpdated event', () => {
    const log = createMockLog('LiquidityChunkUpdated', {
      poolId: MOCK_POOL_ID,
      owner: MOCK_RECIPIENT,
      tokenType: 1n,
      tickLower: -100,
      tickUpper: 100,
      liquidityDelta: 50000n,
    })

    const result = parseSfpmLog(log, 'LiquidityChunkUpdated')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('LiquidityChunkUpdated')
    if (result?.type === 'LiquidityChunkUpdated') {
      expect(result.poolId).toBe(MOCK_POOL_ID)
      expect(result.owner).toBe(MOCK_RECIPIENT)
      expect(result.tokenType).toBe(1n)
      expect(result.tickLower).toBe(-100)
      expect(result.tickUpper).toBe(100)
      expect(result.liquidityDelta).toBe(50000n)
    }
  })

  it('should return null for unknown event', () => {
    const log = createMockLog('UnknownEvent', {})
    const result = parseSfpmLog(log, 'UnknownEvent')
    expect(result).toBeNull()
  })
})

describe('parsePoolManagerLog', () => {
  it('should parse ModifyLiquidity event', () => {
    const salt = '0x0000000000000000000000000000000000000000000000000000000000000001' as Hash
    const log = createMockLog('ModifyLiquidity', {
      id: MOCK_POOL_ID,
      sender: MOCK_RECIPIENT,
      tickLower: -200,
      tickUpper: 200,
      liquidityDelta: 100000n,
      salt,
    })

    const result = parsePoolManagerLog(log, 'ModifyLiquidity')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('ModifyLiquidity')
    if (result?.type === 'ModifyLiquidity') {
      expect(result.id).toBe(MOCK_POOL_ID)
      expect(result.sender).toBe(MOCK_RECIPIENT)
      expect(result.tickLower).toBe(-200)
      expect(result.tickUpper).toBe(200)
      expect(result.liquidityDelta).toBe(100000n)
      expect(result.salt).toBe(salt)
    }
  })

  it('should parse Swap event', () => {
    const log = createMockLog('Swap', {
      id: MOCK_POOL_ID,
      sender: MOCK_RECIPIENT,
      amount0: -500n,
      amount1: 1000n,
      sqrtPriceX96: 79228162514264337593543950336n,
      liquidity: 1000000n,
      tick: 0,
      fee: 500,
    })

    const result = parsePoolManagerLog(log, 'Swap')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('Swap')
    if (result?.type === 'Swap') {
      expect(result.id).toBe(MOCK_POOL_ID)
      expect(result.amount0).toBe(-500n)
      expect(result.amount1).toBe(1000n)
      expect(result.sqrtPriceX96).toBe(79228162514264337593543950336n)
      expect(result.liquidity).toBe(1000000n)
      expect(result.tick).toBe(0)
      expect(result.fee).toBe(500)
    }
  })

  it('should parse Donate event', () => {
    const log = createMockLog('Donate', {
      id: MOCK_POOL_ID,
      sender: MOCK_RECIPIENT,
      amount0: 1000n,
      amount1: 2000n,
    })

    const result = parsePoolManagerLog(log, 'Donate')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('Donate')
    if (result?.type === 'Donate') {
      expect(result.id).toBe(MOCK_POOL_ID)
      expect(result.sender).toBe(MOCK_RECIPIENT)
      expect(result.amount0).toBe(1000n)
      expect(result.amount1).toBe(2000n)
    }
  })

  it('should return null for unknown event', () => {
    const log = createMockLog('UnknownEvent', {})
    const result = parsePoolManagerLog(log, 'UnknownEvent')
    expect(result).toBeNull()
  })
})

describe('watchEvents', () => {
  it('should call watchContractEvent for each event type', () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    // Should call for 5 pool event types
    expect(mockWatchContractEvent).toHaveBeenCalledTimes(5)

    // Cleanup
    unwatch()
  })

  it('should filter event types when specified', () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      eventTypes: ['OptionMinted', 'OptionBurnt'],
      onLogs,
    })

    // Should only call for 2 event types
    expect(mockWatchContractEvent).toHaveBeenCalledTimes(2)

    unwatch()
  })

  it('should watch collateral tracker events when addresses provided', () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      collateralTracker0: MOCK_CT0_ADDRESS,
      collateralTracker1: MOCK_CT1_ADDRESS,
      onLogs,
    })

    // 5 pool events + 2 collateral trackers * 3 events each (Deposit, Withdraw, ProtocolLossRealized) = 11
    expect(mockWatchContractEvent).toHaveBeenCalledTimes(11)

    unwatch()
  })

  it('should return unwatch function that stops all watchers', () => {
    const unwatchFn = vi.fn()
    const mockWatchContractEvent = vi.fn().mockReturnValue(unwatchFn)
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    unwatch()

    // Should call unwatch for each watcher
    expect(unwatchFn).toHaveBeenCalledTimes(5)
  })

  it('should watch risk engine events when address provided', () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      riskEngineAddress: MOCK_RISK_ENGINE_ADDRESS,
      onLogs,
    })

    // 5 pool events + 1 risk engine event = 6
    expect(mockWatchContractEvent).toHaveBeenCalledTimes(6)

    unwatch()
  })

  it('should watch sfpm events when address provided', () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      sfpmAddress: MOCK_SFPM_ADDRESS,
      onLogs,
    })

    // 5 pool events + 1 sfpm event = 6
    expect(mockWatchContractEvent).toHaveBeenCalledTimes(6)

    unwatch()
  })

  it('should watch pool manager events when address provided', () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      poolManagerAddress: MOCK_POOL_MANAGER_ADDRESS,
      onLogs,
    })

    // 5 pool events + 3 pool manager events = 8
    expect(mockWatchContractEvent).toHaveBeenCalledTimes(8)

    unwatch()
  })

  it('should watch all contracts when all addresses provided', () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      collateralTracker0: MOCK_CT0_ADDRESS,
      collateralTracker1: MOCK_CT1_ADDRESS,
      riskEngineAddress: MOCK_RISK_ENGINE_ADDRESS,
      sfpmAddress: MOCK_SFPM_ADDRESS,
      poolManagerAddress: MOCK_POOL_MANAGER_ADDRESS,
      onLogs,
    })

    // 5 pool + 2 trackers * 3 collateral events + 1 risk engine + 1 sfpm + 3 pool manager = 16
    expect(mockWatchContractEvent).toHaveBeenCalledTimes(16)

    unwatch()
  })

  it('should filter new event types correctly', () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      riskEngineAddress: MOCK_RISK_ENGINE_ADDRESS,
      poolManagerAddress: MOCK_POOL_MANAGER_ADDRESS,
      eventTypes: ['BorrowRateUpdated', 'Swap'],
      onLogs,
    })

    // 1 risk engine + 1 pool manager = 2
    expect(mockWatchContractEvent).toHaveBeenCalledTimes(2)

    unwatch()
  })

  it('should call onError when error occurs', () => {
    const mockWatchContractEvent = vi.fn().mockImplementation(() => {
      throw new Error('WebSocket error')
    })
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const onError = vi.fn()
    const unwatch = watchEvents({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
      onError,
    })

    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0].message).toBe('WebSocket error')

    unwatch()
  })
})

describe('createEventSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should have default reconnect config', () => {
    expect(DEFAULT_RECONNECT_CONFIG.maxAttempts).toBe(10n)
    expect(DEFAULT_RECONNECT_CONFIG.initialDelayMs).toBe(1000n)
    expect(DEFAULT_RECONNECT_CONFIG.maxDelayMs).toBe(30000n)
    expect(DEFAULT_RECONNECT_CONFIG.backoffMultiplier).toBe(2n)
  })

  it('should start watching when start() is called', async () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const subscription = createEventSubscription({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    expect(subscription.isConnected()).toBe(false)

    subscription.start()
    await vi.runAllTimersAsync()

    expect(mockWatchContractEvent).toHaveBeenCalled()

    subscription.stop()
  })

  it('should stop watching when stop() is called', async () => {
    const unwatchFn = vi.fn()
    const mockWatchContractEvent = vi.fn().mockReturnValue(unwatchFn)
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const subscription = createEventSubscription({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    subscription.start()
    await vi.runAllTimersAsync()

    subscription.stop()

    expect(unwatchFn).toHaveBeenCalled()
    expect(subscription.isConnected()).toBe(false)
  })

  it('should call onConnected when connected', async () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const onConnected = vi.fn()
    const subscription = createEventSubscription({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
      onConnected,
    })

    subscription.start()
    await vi.runAllTimersAsync()

    expect(onConnected).toHaveBeenCalled()

    subscription.stop()
  })

  it('should track lastProcessedBlock', async () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
      getBlockNumber: vi.fn().mockResolvedValue(12345678n),
    })

    const onLogs = vi.fn()
    const subscription = createEventSubscription({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    expect(subscription.lastProcessedBlock).toBe(0n)

    subscription.start()
    await vi.runAllTimersAsync()

    expect(subscription.lastProcessedBlock).toBe(12345678n)

    subscription.stop()
  })

  it('should provide unsubscribe as alias for stop', async () => {
    const unwatchFn = vi.fn()
    const mockWatchContractEvent = vi.fn().mockReturnValue(unwatchFn)
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
    })

    const onLogs = vi.fn()
    const subscription = createEventSubscription({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    subscription.start()
    await vi.runAllTimersAsync()

    subscription.unsubscribe()

    expect(unwatchFn).toHaveBeenCalled()
  })

  it('should deliver all logs from the same block in order', async () => {
    const mockWatchContractEvent = vi.fn().mockReturnValue(() => {})
    const client = createMockClient({
      watchContractEvent: mockWatchContractEvent,
      getBlockNumber: vi.fn().mockResolvedValue(12345678n),
    })

    const onLogs = vi.fn()
    const subscription = createEventSubscription({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    subscription.start()
    await vi.runAllTimersAsync()

    const optionMintedWatcherConfig = mockWatchContractEvent.mock.calls.find(
      (call) => call[0].eventName === 'OptionMinted',
    )?.[0]

    expect(optionMintedWatcherConfig).toBeDefined()

    optionMintedWatcherConfig?.onLogs([
      createMockLog(
        'OptionMinted',
        {
          recipient: MOCK_RECIPIENT,
          tokenId: 111n,
          balanceData: 0n,
        },
        12345679n,
        0,
      ),
      createMockLog(
        'OptionMinted',
        {
          recipient: MOCK_RECIPIENT,
          tokenId: 222n,
          balanceData: 0n,
        },
        12345679n,
        1,
      ),
    ])

    expect(onLogs).toHaveBeenCalledTimes(1)
    const events = onLogs.mock.calls[0][0] as PanopticEvent[]
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('OptionMinted')
    expect(events[1]?.type).toBe('OptionMinted')
    if (events[0]?.type === 'OptionMinted' && events[1]?.type === 'OptionMinted') {
      expect(events[0].tokenId).toBe(111n)
      expect(events[1].tokenId).toBe(222n)
    }

    subscription.stop()
  })
})

describe('createEventPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start polling when start() is called', async () => {
    const mockGetBlockNumber = vi.fn().mockResolvedValue(12345678n)
    const client = createMockClient({
      getBlockNumber: mockGetBlockNumber,
    })

    const onLogs = vi.fn()
    const poller = createEventPoller({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    expect(poller.isPolling()).toBe(false)

    poller.start()
    expect(poller.isPolling()).toBe(true)

    // Advance enough for first poll
    await vi.advanceTimersByTimeAsync(100)

    expect(mockGetBlockNumber).toHaveBeenCalled()

    poller.stop()
  })

  it('should stop polling when stop() is called', async () => {
    const client = createMockClient()

    const onLogs = vi.fn()
    const poller = createEventPoller({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    poller.start()
    expect(poller.isPolling()).toBe(true)

    poller.stop()
    expect(poller.isPolling()).toBe(false)
  })

  it('should use default interval of 12 seconds', async () => {
    const mockGetBlockNumber = vi.fn().mockResolvedValue(12345678n)
    const client = createMockClient({
      getBlockNumber: mockGetBlockNumber,
    })

    const onLogs = vi.fn()
    const poller = createEventPoller({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    // First call
    expect(mockGetBlockNumber).toHaveBeenCalledTimes(1)

    // Wait for default interval (12000ms)
    await vi.advanceTimersByTimeAsync(12000)

    // Second call
    expect(mockGetBlockNumber).toHaveBeenCalledTimes(2)

    poller.stop()
  })

  it('should use custom interval when provided', async () => {
    const mockGetBlockNumber = vi.fn().mockResolvedValue(12345678n)
    const client = createMockClient({
      getBlockNumber: mockGetBlockNumber,
    })

    const onLogs = vi.fn()
    const poller = createEventPoller({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
      intervalMs: 5000n,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockGetBlockNumber).toHaveBeenCalledTimes(1)

    // Wait for custom interval (5000ms)
    await vi.advanceTimersByTimeAsync(5000)

    expect(mockGetBlockNumber).toHaveBeenCalledTimes(2)

    poller.stop()
  })

  it('should track lastPolledBlock', async () => {
    const mockGetBlockNumber = vi.fn().mockResolvedValue(12345678n)
    const client = createMockClient({
      getBlockNumber: mockGetBlockNumber,
    })

    const onLogs = vi.fn()
    const poller = createEventPoller({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    expect(poller.lastPolledBlock).toBe(0n)

    poller.start()
    await vi.advanceTimersByTimeAsync(100)

    expect(poller.lastPolledBlock).toBe(12345678n)

    poller.stop()
  })

  it('should fetch events when new blocks are available', async () => {
    let blockNumber = 12345678n
    const mockGetBlockNumber = vi.fn().mockImplementation(() => Promise.resolve(blockNumber))
    const mockGetContractEvents = vi.fn().mockResolvedValue([])
    const client = createMockClient({
      getBlockNumber: mockGetBlockNumber,
      getContractEvents: mockGetContractEvents,
    })

    const onLogs = vi.fn()
    const poller = createEventPoller({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    // First poll initializes lastPolledBlock
    expect(mockGetContractEvents).not.toHaveBeenCalled()

    // Advance block
    blockNumber = 12345680n
    await vi.advanceTimersByTimeAsync(12000)

    // Should fetch events for new blocks
    expect(mockGetContractEvents).toHaveBeenCalled()

    poller.stop()
  })

  it('should call onError when error occurs', async () => {
    const mockGetBlockNumber = vi.fn().mockRejectedValue(new Error('RPC error'))
    const client = createMockClient({
      getBlockNumber: mockGetBlockNumber,
    })

    const onLogs = vi.fn()
    const onError = vi.fn()
    const poller = createEventPoller({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
      onError,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(100)

    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0].message).toBe('RPC error')

    poller.stop()
  })

  it('should use fromBlock when provided', async () => {
    const mockGetBlockNumber = vi.fn().mockResolvedValue(12345700n)
    const mockGetContractEvents = vi.fn().mockResolvedValue([])
    const client = createMockClient({
      getBlockNumber: mockGetBlockNumber,
      getContractEvents: mockGetContractEvents,
    })

    const onLogs = vi.fn()
    const poller = createEventPoller({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
      fromBlock: 12345678n,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    // Should fetch events from specified block
    expect(mockGetContractEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 12345679n,
        toBlock: 12345700n,
      }),
    )

    poller.stop()
  })

  it('should deliver events through onLogs callback', async () => {
    let blockNumber = 12345678n
    const mockGetBlockNumber = vi.fn().mockImplementation(() => Promise.resolve(blockNumber))

    // Create a mock log with proper structure
    // balanceData encodes: positionSize at bits 0-127
    const balanceData = 1000n
    const mockLog = {
      address: MOCK_POOL_ADDRESS,
      topics: [],
      data: '0x',
      blockNumber: 12345679n,
      blockHash: MOCK_BLOCK_HASH,
      transactionHash: MOCK_TX_HASH,
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
      args: {
        recipient: MOCK_RECIPIENT,
        tokenId: 123456789n,
        balanceData,
      },
    }

    const mockGetContractEvents = vi.fn().mockImplementation(({ eventName }) => {
      if (eventName === 'OptionMinted') {
        return Promise.resolve([mockLog])
      }
      return Promise.resolve([])
    })

    const client = createMockClient({
      getBlockNumber: mockGetBlockNumber,
      getContractEvents: mockGetContractEvents,
    })

    const onLogs = vi.fn()
    const poller = createEventPoller({
      client,
      poolAddress: MOCK_POOL_ADDRESS,
      onLogs,
      intervalMs: 1000n, // Shorter interval for faster test
    })

    poller.start()
    // First poll initializes lastPolledBlock
    await vi.advanceTimersByTimeAsync(100)

    // Advance block to trigger fetch
    blockNumber = 12345680n
    // Wait for next poll cycle
    await vi.advanceTimersByTimeAsync(1000)

    // Should call onLogs with parsed events
    expect(onLogs).toHaveBeenCalled()
    const events = onLogs.mock.calls[0][0] as PanopticEvent[]
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].type).toBe('OptionMinted')

    poller.stop()
  })
})
