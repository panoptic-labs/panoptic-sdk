/**
 * Resilient event subscription with auto-reconnect for the Panoptic v2 SDK.
 * @module v2/events/subscription
 */

import type { Address, PublicClient } from 'viem'

import {
  collateralTrackerAbi,
  panopticPoolAbi,
  riskEngineAbi,
  semiFungiblePositionManagerAbi,
} from '../../../generated'
import { poolManagerAbi } from '../abis/poolManager'
import type { EventSubscription, PanopticEvent, PanopticEventType } from '../types'
import type { DecodedLog } from './watchEvents'
import {
  parseCollateralLog,
  parsePoolLog,
  parsePoolManagerLog,
  parseRiskEngineLog,
  parseSfpmLog,
} from './watchEvents'

/**
 * Reconnection strategy configuration.
 */
export interface ReconnectConfig {
  /** Maximum reconnection attempts (0n = infinite) */
  maxAttempts: bigint
  /** Initial delay before first retry (ms) */
  initialDelayMs: bigint
  /** Maximum delay between retries (ms) */
  maxDelayMs: bigint
  /** Backoff multiplier */
  backoffMultiplier: bigint
}

/**
 * Default reconnection configuration.
 */
export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxAttempts: 10n,
  initialDelayMs: 1000n,
  maxDelayMs: 30000n,
  backoffMultiplier: 2n,
}

/**
 * Parameters for creating an event subscription.
 */
export interface CreateEventSubscriptionParams {
  /** Public client (must have WebSocket transport) */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** CollateralTracker0 address (optional, for Deposit/Withdraw events) */
  collateralTracker0?: Address
  /** CollateralTracker1 address (optional, for Deposit/Withdraw/ProtocolLossRealized events) */
  collateralTracker1?: Address
  /** RiskEngine address (optional, for BorrowRateUpdated events) */
  riskEngineAddress?: Address
  /** SemiFungiblePositionManager address (optional, for LiquidityChunkUpdated events) */
  sfpmAddress?: Address
  /** v4 PoolManager address (optional, for ModifyLiquidity/Swap/Donate events) */
  poolManagerAddress?: Address
  /** Event types to filter (omit for all events) */
  eventTypes?: PanopticEventType[]
  /** Callback for received events */
  onLogs: (events: PanopticEvent[]) => void
  /** Callback for errors (subscription will auto-reconnect) */
  onError?: (error: Error) => void
  /** Callback for reconnection attempts */
  onReconnect?: (attempt: bigint, nextDelayMs: bigint) => void
  /** Callback when connected */
  onConnected?: () => void
  /** Reconnection strategy configuration */
  reconnect?: Partial<ReconnectConfig>
}

/**
 * Event subscription handle with additional state.
 */
export interface EventSubscriptionHandle extends EventSubscription {
  /** Start watching */
  start: () => void
  /** Stop watching (cleans up, no more reconnects) */
  stop: () => void
  /** Number of reconnection attempts */
  reconnectAttempts: bigint
  /** Last processed block number */
  lastProcessedBlock: bigint
}

/**
 * Create a resilient event subscription with auto-reconnect and gap filling.
 *
 * Unlike `watchEvents()`, this subscription automatically reconnects on
 * disconnection and fills gaps by fetching missed events.
 *
 * @param params - Subscription parameters
 * @returns Event subscription handle
 *
 * @example
 * ```typescript
 * const subscription = createEventSubscription({
 *   client,
 *   poolAddress,
 *   eventTypes: ['OptionMinted', 'OptionBurnt', 'AccountLiquidated'],
 *   onLogs: (events) => {
 *     for (const event of events) {
 *       console.log(event.type, event)
 *     }
 *   },
 *   onError: (error) => console.error('Subscription error:', error),
 *   onReconnect: (attempt, nextDelay) => {
 *     console.log(`Reconnecting (attempt ${attempt}, next in ${nextDelay}ms)`)
 *   },
 *   onConnected: () => console.log('Subscription connected'),
 * })
 *
 * // Start watching
 * subscription.start()
 *
 * // Check state
 * console.log('Connected:', subscription.isConnected())
 * console.log('Reconnect attempts:', subscription.reconnectAttempts)
 * console.log('Last processed block:', subscription.lastProcessedBlock)
 *
 * // Stop (cleans up, no more reconnects)
 * subscription.stop()
 * ```
 */
export function createEventSubscription(
  params: CreateEventSubscriptionParams,
): EventSubscriptionHandle {
  const {
    client,
    poolAddress,
    collateralTracker0,
    collateralTracker1,
    riskEngineAddress,
    sfpmAddress,
    poolManagerAddress,
    eventTypes,
    onLogs,
    onError,
    onReconnect,
    onConnected,
    reconnect: reconnectConfig,
  } = params

  const config: ReconnectConfig = {
    ...DEFAULT_RECONNECT_CONFIG,
    ...reconnectConfig,
  }

  // State
  let isRunning = false
  let connected = false
  let reconnectAttempts = 0n
  let lastProcessedBlock = 0n
  let lastProcessedLogIndex = -1n
  let currentDelay = config.initialDelayMs
  let unwatchFns: (() => void)[] = []
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

  const compareEvents = (a: PanopticEvent, b: PanopticEvent): number => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1
    }
    if (a.logIndex !== b.logIndex) {
      return a.logIndex < b.logIndex ? -1 : 1
    }
    return 0
  }

  const isAfterCursor = (event: PanopticEvent): boolean => {
    if (event.blockNumber > lastProcessedBlock) {
      return true
    }
    if (event.blockNumber < lastProcessedBlock) {
      return false
    }
    return event.logIndex > lastProcessedLogIndex
  }

  const advanceCursor = (event: PanopticEvent): void => {
    lastProcessedBlock = event.blockNumber
    lastProcessedLogIndex = event.logIndex
  }

  // Pool event types
  const poolEventTypes: PanopticEventType[] = eventTypes
    ? eventTypes.filter((t) =>
        [
          'OptionMinted',
          'OptionBurnt',
          'AccountLiquidated',
          'ForcedExercised',
          'PremiumSettled',
        ].includes(t),
      )
    : ['OptionMinted', 'OptionBurnt', 'AccountLiquidated', 'ForcedExercised', 'PremiumSettled']

  // Collateral event types
  const collateralEventTypes: PanopticEventType[] = eventTypes
    ? eventTypes.filter((t) => ['Deposit', 'Withdraw', 'ProtocolLossRealized'].includes(t))
    : ['Deposit', 'Withdraw', 'ProtocolLossRealized']

  // RiskEngine event types
  const riskEngineEventTypes: PanopticEventType[] = eventTypes
    ? eventTypes.filter((t) => ['BorrowRateUpdated'].includes(t))
    : ['BorrowRateUpdated']

  // SFPM event types
  const sfpmEventTypes: PanopticEventType[] = eventTypes
    ? eventTypes.filter((t) => ['LiquidityChunkUpdated'].includes(t))
    : ['LiquidityChunkUpdated']

  // PoolManager event types
  const poolManagerEventTypes: PanopticEventType[] = eventTypes
    ? eventTypes.filter((t) => ['ModifyLiquidity', 'Swap', 'Donate'].includes(t))
    : ['ModifyLiquidity', 'Swap', 'Donate']

  /**
   * Fetch missed events between lastProcessedBlock and currentBlock.
   */
  async function fillGap(fromBlock: bigint, toBlock: bigint): Promise<void> {
    if (fromBlock >= toBlock) return

    const allEvents: PanopticEvent[] = []

    // Fetch pool events
    for (const eventType of poolEventTypes) {
      try {
        const logs = await client.getContractEvents({
          address: poolAddress,
          abi: panopticPoolAbi,
          eventName: eventType as
            | 'OptionMinted'
            | 'OptionBurnt'
            | 'AccountLiquidated'
            | 'ForcedExercised'
            | 'PremiumSettled',
          fromBlock,
          toBlock,
        })
        for (const log of logs) {
          const parsed = parsePoolLog(log as DecodedLog, eventType)
          if (parsed) {
            allEvents.push(parsed)
          }
        }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(`Failed to fetch ${eventType} events`))
      }
    }

    // Fetch collateral events
    const collateralTrackers = [collateralTracker0, collateralTracker1].filter(Boolean) as Address[]
    for (const trackerAddress of collateralTrackers) {
      for (const eventType of collateralEventTypes) {
        try {
          const logs = await client.getContractEvents({
            address: trackerAddress,
            abi: collateralTrackerAbi,
            eventName: eventType as 'Deposit' | 'Withdraw' | 'ProtocolLossRealized',
            fromBlock,
            toBlock,
          })
          for (const log of logs) {
            const parsed = parseCollateralLog(log as DecodedLog, eventType)
            if (parsed) {
              allEvents.push(parsed)
            }
          }
        } catch (error) {
          onError?.(
            error instanceof Error ? error : new Error(`Failed to fetch ${eventType} events`),
          )
        }
      }
    }

    // Fetch RiskEngine events
    if (riskEngineAddress) {
      for (const eventType of riskEngineEventTypes) {
        try {
          const logs = await client.getContractEvents({
            address: riskEngineAddress,
            abi: riskEngineAbi,
            eventName: eventType as 'BorrowRateUpdated',
            fromBlock,
            toBlock,
          })
          for (const log of logs) {
            const parsed = parseRiskEngineLog(log as DecodedLog, eventType)
            if (parsed) {
              allEvents.push(parsed)
            }
          }
        } catch (error) {
          onError?.(
            error instanceof Error ? error : new Error(`Failed to fetch ${eventType} events`),
          )
        }
      }
    }

    // Fetch SFPM events
    if (sfpmAddress) {
      for (const eventType of sfpmEventTypes) {
        try {
          const logs = await client.getContractEvents({
            address: sfpmAddress,
            abi: semiFungiblePositionManagerAbi,
            eventName: eventType as 'LiquidityChunkUpdated',
            fromBlock,
            toBlock,
          })
          for (const log of logs) {
            const parsed = parseSfpmLog(log as DecodedLog, eventType)
            if (parsed) {
              allEvents.push(parsed)
            }
          }
        } catch (error) {
          onError?.(
            error instanceof Error ? error : new Error(`Failed to fetch ${eventType} events`),
          )
        }
      }
    }

    // Fetch PoolManager events
    if (poolManagerAddress) {
      for (const eventType of poolManagerEventTypes) {
        try {
          const logs = await client.getContractEvents({
            address: poolManagerAddress,
            abi: poolManagerAbi,
            eventName: eventType as 'ModifyLiquidity' | 'Swap' | 'Donate',
            fromBlock,
            toBlock,
          })
          for (const log of logs) {
            const parsed = parsePoolManagerLog(log as DecodedLog, eventType)
            if (parsed) {
              allEvents.push(parsed)
            }
          }
        } catch (error) {
          onError?.(
            error instanceof Error ? error : new Error(`Failed to fetch ${eventType} events`),
          )
        }
      }
    }

    // Sort by block number and log index, then drop anything at/before cursor.
    const newEvents = allEvents.sort(compareEvents).filter(isAfterCursor)

    if (newEvents.length > 0) {
      onLogs(newEvents)
      advanceCursor(newEvents[newEvents.length - 1])
    }
  }

  /**
   * Start watching events.
   */
  async function setupWatchers(): Promise<void> {
    // Clean up any existing watchers
    cleanup()

    try {
      // Get current block for gap detection
      const currentBlock = await client.getBlockNumber()

      // Fill gap if we have a previous position
      if (lastProcessedBlock > 0n && lastProcessedBlock < currentBlock) {
        await fillGap(lastProcessedBlock, currentBlock)
      }

      // Set baseline for this subscription start (from "head"), unless fillGap
      // already advanced us into this block with a concrete log index.
      if (currentBlock > lastProcessedBlock) {
        lastProcessedBlock = currentBlock
        lastProcessedLogIndex = -1n
      }

      const createOnLogsHandler = (
        parseLog: (log: DecodedLog) => PanopticEvent | null,
      ): ((logs: readonly unknown[]) => void) => {
        return (logs) => {
          const events: PanopticEvent[] = []
          for (const log of logs) {
            const parsed = parseLog(log as DecodedLog)
            if (parsed && isAfterCursor(parsed)) {
              events.push(parsed)
            }
          }
          if (events.length > 0) {
            events.sort(compareEvents)
            onLogs(events)
            advanceCursor(events[events.length - 1])
          }
        }
      }

      const createPoolOnLogs = (eventType: PanopticEventType) =>
        createOnLogsHandler((log) => parsePoolLog(log, eventType))
      const createCollateralOnLogs = (eventType: PanopticEventType) =>
        createOnLogsHandler((log) => parseCollateralLog(log, eventType))
      const createRiskEngineOnLogs = (eventType: PanopticEventType) =>
        createOnLogsHandler((log) => parseRiskEngineLog(log, eventType))
      const createSfpmOnLogs = (eventType: PanopticEventType) =>
        createOnLogsHandler((log) => parseSfpmLog(log, eventType))
      const createPoolManagerOnLogs = (eventType: PanopticEventType) =>
        createOnLogsHandler((log) => parsePoolManagerLog(log, eventType))

      // Watch pool events
      for (const eventType of poolEventTypes) {
        const unwatch = client.watchContractEvent({
          address: poolAddress,
          abi: panopticPoolAbi,
          eventName: eventType as
            | 'OptionMinted'
            | 'OptionBurnt'
            | 'AccountLiquidated'
            | 'ForcedExercised'
            | 'PremiumSettled',
          onLogs: createPoolOnLogs(eventType),
          onError: handleError,
        })
        unwatchFns.push(unwatch)
      }

      // Watch collateral events
      const collateralTrackers = [collateralTracker0, collateralTracker1].filter(
        Boolean,
      ) as Address[]
      for (const trackerAddress of collateralTrackers) {
        for (const eventType of collateralEventTypes) {
          const unwatch = client.watchContractEvent({
            address: trackerAddress,
            abi: collateralTrackerAbi,
            eventName: eventType as 'Deposit' | 'Withdraw' | 'ProtocolLossRealized',
            onLogs: createCollateralOnLogs(eventType),
            onError: handleError,
          })
          unwatchFns.push(unwatch)
        }
      }

      // Watch RiskEngine events
      if (riskEngineAddress) {
        for (const eventType of riskEngineEventTypes) {
          const unwatch = client.watchContractEvent({
            address: riskEngineAddress,
            abi: riskEngineAbi,
            eventName: eventType as 'BorrowRateUpdated',
            onLogs: createRiskEngineOnLogs(eventType),
            onError: handleError,
          })
          unwatchFns.push(unwatch)
        }
      }

      // Watch SFPM events
      if (sfpmAddress) {
        for (const eventType of sfpmEventTypes) {
          const unwatch = client.watchContractEvent({
            address: sfpmAddress,
            abi: semiFungiblePositionManagerAbi,
            eventName: eventType as 'LiquidityChunkUpdated',
            onLogs: createSfpmOnLogs(eventType),
            onError: handleError,
          })
          unwatchFns.push(unwatch)
        }
      }

      // Watch PoolManager events
      if (poolManagerAddress) {
        for (const eventType of poolManagerEventTypes) {
          const unwatch = client.watchContractEvent({
            address: poolManagerAddress,
            abi: poolManagerAbi,
            eventName: eventType as 'ModifyLiquidity' | 'Swap' | 'Donate',
            onLogs: createPoolManagerOnLogs(eventType),
            onError: handleError,
          })
          unwatchFns.push(unwatch)
        }
      }

      // Mark as connected
      connected = true
      reconnectAttempts = 0n
      currentDelay = config.initialDelayMs
      onConnected?.()
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Clean up watchers.
   */
  function cleanup(): void {
    for (const unwatch of unwatchFns) {
      try {
        unwatch()
      } catch {
        // Ignore cleanup errors
      }
    }
    unwatchFns = []
    connected = false
  }

  /**
   * Handle errors and schedule reconnection.
   */
  function handleError(error: Error): void {
    connected = false
    onError?.(error)

    if (!isRunning) return

    // Reconnect already scheduled; avoid duplicate timers.
    if (reconnectTimeout) return

    // Check if we've exceeded max attempts
    if (config.maxAttempts > 0n && reconnectAttempts >= config.maxAttempts) {
      onError?.(new Error(`Max reconnection attempts (${config.maxAttempts}) exceeded`))
      return
    }

    // Schedule reconnection
    reconnectAttempts++
    onReconnect?.(reconnectAttempts, currentDelay)

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null
      if (isRunning) {
        setupWatchers()
      }
    }, Number(currentDelay))

    // Increase delay for next attempt (exponential backoff)
    currentDelay = currentDelay * config.backoffMultiplier
    if (currentDelay > config.maxDelayMs) {
      currentDelay = config.maxDelayMs
    }
  }

  /**
   * Start the subscription.
   */
  function start(): void {
    if (isRunning) return
    isRunning = true
    setupWatchers()
  }

  /**
   * Stop the subscription.
   */
  function stop(): void {
    isRunning = false
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
    }
    reconnectTimeout = null
    cleanup()
  }

  return {
    start,
    stop,
    unsubscribe: stop,
    isConnected: () => connected,
    get reconnectAttempts() {
      return reconnectAttempts
    },
    get lastProcessedBlock() {
      return lastProcessedBlock
    },
  }
}
