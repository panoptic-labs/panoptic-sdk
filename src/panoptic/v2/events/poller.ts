/**
 * HTTP polling-based event fetching for the Panoptic v2 SDK.
 * @module v2/events/poller
 */

import type { Address, PublicClient } from 'viem'

import {
  collateralTrackerAbi,
  panopticPoolAbi,
  riskEngineAbi,
  semiFungiblePositionManagerAbi,
} from '../../../generated'
import { poolManagerAbi } from '../abis/poolManager'
import type { PanopticEvent, PanopticEventType } from '../types'
import type { DecodedLog } from './watchEvents'
import {
  parseCollateralLog,
  parsePoolLog,
  parsePoolManagerLog,
  parseRiskEngineLog,
  parseSfpmLog,
} from './watchEvents'

/**
 * Event poller handle.
 */
export interface EventPoller {
  /** Start polling */
  start: () => void
  /** Stop polling */
  stop: () => void
  /** Check if polling is active */
  isPolling: () => boolean
  /** Get last polled block */
  lastPolledBlock: bigint
}

/**
 * Parameters for creating an event poller.
 */
export interface CreateEventPollerParams {
  /** Public client (works with HTTP transport) */
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
  /** Callback for errors */
  onError?: (error: Error) => void
  /** Polling interval in milliseconds (default: 12000 = 1 block on mainnet) */
  intervalMs?: bigint
  /** Maximum blocks to query per poll (default: 1000) */
  maxBlockRange?: bigint
  /** Starting block number (default: current block) */
  fromBlock?: bigint
}

/**
 * Default polling interval (12 seconds = ~1 mainnet block).
 */
const DEFAULT_INTERVAL_MS = 12000n

/**
 * Default maximum block range per poll.
 */
const DEFAULT_MAX_BLOCK_RANGE = 1000n

/**
 * Create an HTTP polling-based event fetcher.
 *
 * Use this for environments where WebSocket connections are unreliable or unavailable.
 * It polls `eth_getLogs` at regular intervals to fetch new events.
 *
 * @param params - Poller parameters
 * @returns Event poller handle
 *
 * @example
 * ```typescript
 * const poller = createEventPoller({
 *   client,
 *   poolAddress,
 *   onLogs: (events) => {
 *     for (const event of events) {
 *       console.log(event.type, event)
 *     }
 *   },
 *   onError: (error) => console.error('Polling error:', error),
 *   intervalMs: 12000n, // 12 seconds
 *   maxBlockRange: 1000n,
 * })
 *
 * // Start polling
 * poller.start()
 *
 * // Check state
 * console.log('Polling:', poller.isPolling())
 * console.log('Last polled block:', poller.lastPolledBlock)
 *
 * // Stop polling
 * poller.stop()
 * ```
 */
export function createEventPoller(params: CreateEventPollerParams): EventPoller {
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
    intervalMs = DEFAULT_INTERVAL_MS,
    maxBlockRange = DEFAULT_MAX_BLOCK_RANGE,
    fromBlock,
  } = params

  // State
  let isRunning = false
  let lastPolledBlock = fromBlock ?? 0n
  let pollTimeout: ReturnType<typeof setTimeout> | null = null

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
   * Fetch events for a block range.
   */
  async function fetchEvents(from: bigint, to: bigint): Promise<PanopticEvent[]> {
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
          fromBlock: from,
          toBlock: to,
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
            fromBlock: from,
            toBlock: to,
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
            fromBlock: from,
            toBlock: to,
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
            fromBlock: from,
            toBlock: to,
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
            fromBlock: from,
            toBlock: to,
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

    // Sort by block number and log index
    allEvents.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber < b.blockNumber ? -1 : 1
      }
      return a.logIndex < b.logIndex ? -1 : 1
    })

    return allEvents
  }

  /**
   * Perform a single poll iteration.
   */
  async function poll(): Promise<void> {
    if (!isRunning) return

    try {
      // Get current block
      const currentBlock = await client.getBlockNumber()

      // Initialize lastPolledBlock if not set
      if (lastPolledBlock === 0n) {
        lastPolledBlock = currentBlock
        schedulePoll()
        return
      }

      // Check if there are new blocks
      if (currentBlock <= lastPolledBlock) {
        schedulePoll()
        return
      }

      // Calculate range to query (respect maxBlockRange)
      let toBlock = currentBlock
      const range = toBlock - lastPolledBlock
      if (range > maxBlockRange) {
        toBlock = lastPolledBlock + maxBlockRange
      }

      // Fetch events
      const events = await fetchEvents(lastPolledBlock + 1n, toBlock)

      // Update last polled block
      lastPolledBlock = toBlock

      // Deliver events
      if (events.length > 0) {
        onLogs(events)
      }

      // If we didn't catch up to current block, poll again immediately
      if (toBlock < currentBlock && isRunning) {
        // Use setImmediate-like behavior with 0ms timeout
        pollTimeout = setTimeout(poll, 0)
      } else {
        schedulePoll()
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)))
      schedulePoll()
    }
  }

  /**
   * Schedule next poll.
   */
  function schedulePoll(): void {
    if (!isRunning) return
    pollTimeout = setTimeout(poll, Number(intervalMs))
  }

  /**
   * Start polling.
   */
  function start(): void {
    if (isRunning) return
    isRunning = true
    poll()
  }

  /**
   * Stop polling.
   */
  function stop(): void {
    isRunning = false
    if (pollTimeout) {
      clearTimeout(pollTimeout)
      pollTimeout = null
    }
  }

  return {
    start,
    stop,
    isPolling: () => isRunning,
    get lastPolledBlock() {
      return lastPolledBlock
    },
  }
}
