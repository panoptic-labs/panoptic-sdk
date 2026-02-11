/**
 * Simple WebSocket event watching for the Panoptic v2 SDK.
 * @module v2/events/watchEvents
 */

import type { Address, Hash, Log, PublicClient } from 'viem'

import {
  collateralTrackerAbi,
  panopticPoolAbi,
  riskEngineAbi,
  semiFungiblePositionManagerAbi,
} from '../../../generated'
import { poolManagerAbi } from '../abis/poolManager'
import type { PanopticEvent, PanopticEventType } from '../types'
import { decodeLeftRightSigned, decodePositionBalance } from '../writes/utils'

/**
 * A decoded contract event log that includes both base Log fields and typed args.
 * viem's getContractEvents/watchContractEvent return logs with `.args`,
 * but the generic `Log` type doesn't include it. We use `unknown` for args
 * and narrow to specific types in each parse function's switch cases.
 */
type DecodedLog = Log & { args: unknown }

/**
 * Parameters for watching events.
 */
export interface WatchEventsParams {
  /** Public client (must have WebSocket transport for real-time watching) */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** CollateralTracker0 address (optional, for Deposit/Withdraw/ProtocolLossRealized events) */
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
}

/**
 * Event name to ABI event mapping for PanopticPool.
 */
const POOL_EVENT_NAMES: Record<string, PanopticEventType> = {
  OptionMinted: 'OptionMinted',
  OptionBurnt: 'OptionBurnt',
  AccountLiquidated: 'AccountLiquidated',
  ForcedExercised: 'ForcedExercised',
  PremiumSettled: 'PremiumSettled',
}

/**
 * Event name to ABI event mapping for CollateralTracker.
 */
const COLLATERAL_EVENT_NAMES: Record<string, PanopticEventType> = {
  Deposit: 'Deposit',
  Withdraw: 'Withdraw',
  ProtocolLossRealized: 'ProtocolLossRealized',
}

/**
 * Event name to ABI event mapping for RiskEngine.
 */
const RISK_ENGINE_EVENT_NAMES: Record<string, PanopticEventType> = {
  BorrowRateUpdated: 'BorrowRateUpdated',
}

/**
 * Event name to ABI event mapping for SFPM.
 */
const SFPM_EVENT_NAMES: Record<string, PanopticEventType> = {
  LiquidityChunkUpdated: 'LiquidityChunkUpdated',
}

/**
 * Event name to ABI event mapping for v4 PoolManager.
 */
const POOL_MANAGER_EVENT_NAMES: Record<string, PanopticEventType> = {
  ModifyLiquidity: 'ModifyLiquidity',
  Swap: 'Swap',
  Donate: 'Donate',
}

/**
 * Parse a decoded log into a typed PanopticEvent.
 */
function parsePoolLog(log: DecodedLog, eventName: string): PanopticEvent | null {
  const baseEvent = {
    transactionHash: log.transactionHash!,
    blockNumber: log.blockNumber!,
    blockHash: log.blockHash!,
    logIndex: BigInt(log.logIndex!),
  }

  // Type narrowing based on event name
  switch (eventName) {
    case 'OptionMinted': {
      const args = log.args as { recipient: Address; tokenId: bigint; balanceData: bigint }
      const balanceData = decodePositionBalance(args.balanceData)
      return {
        type: 'OptionMinted',
        ...baseEvent,
        recipient: args.recipient,
        tokenId: args.tokenId,
        positionSize: balanceData.positionSize,
        poolUtilization0: balanceData.poolUtilization0,
        poolUtilization1: balanceData.poolUtilization1,
        tickAtMint: balanceData.tickAtMint,
        timestampAtMint: balanceData.timestampAtMint,
        blockAtMint: balanceData.blockAtMint,
        swapAtMint: balanceData.swapAtMint,
      }
    }

    case 'OptionBurnt': {
      const args = log.args as {
        recipient: Address
        positionSize: bigint
        tokenId: bigint
        premiaByLeg: readonly [bigint, bigint, bigint, bigint]
      }
      return {
        type: 'OptionBurnt',
        ...baseEvent,
        recipient: args.recipient,
        tokenId: args.tokenId,
        positionSize: args.positionSize,
        premiaByLeg: args.premiaByLeg,
      }
    }

    case 'AccountLiquidated': {
      const args = log.args as { liquidator: Address; liquidatee: Address; bonusAmounts: bigint }
      const bonus = decodeLeftRightSigned(args.bonusAmounts)
      return {
        type: 'AccountLiquidated',
        ...baseEvent,
        liquidator: args.liquidator,
        liquidatee: args.liquidatee,
        bonusAmount0: bonus.right,
        bonusAmount1: bonus.left,
      }
    }

    case 'ForcedExercised': {
      const args = log.args as {
        exercisor: Address
        user: Address
        tokenId: bigint
        exerciseFee: bigint
      }
      const fee = decodeLeftRightSigned(args.exerciseFee)
      return {
        type: 'ForcedExercised',
        ...baseEvent,
        exercisor: args.exercisor,
        user: args.user,
        tokenId: args.tokenId,
        exerciseFee0: fee.right,
        exerciseFee1: fee.left,
      }
    }

    case 'PremiumSettled': {
      const args = log.args as {
        user: Address
        tokenId: bigint
        legIndex: bigint
        settledAmounts: bigint
      }
      const settled = decodeLeftRightSigned(args.settledAmounts)
      return {
        type: 'PremiumSettled',
        ...baseEvent,
        user: args.user,
        tokenId: args.tokenId,
        legIndex: args.legIndex,
        settledAmount0: settled.right,
        settledAmount1: settled.left,
      }
    }

    default:
      return null
  }
}

/**
 * Parse a CollateralTracker log into a typed PanopticEvent.
 */
function parseCollateralLog(log: DecodedLog, eventName: string): PanopticEvent | null {
  const baseEvent = {
    transactionHash: log.transactionHash!,
    blockNumber: log.blockNumber!,
    blockHash: log.blockHash!,
    logIndex: BigInt(log.logIndex!),
  }

  switch (eventName) {
    case 'Deposit': {
      const args = log.args as { sender: Address; owner: Address; assets: bigint; shares: bigint }
      return {
        type: 'Deposit',
        ...baseEvent,
        sender: args.sender,
        owner: args.owner,
        assets: args.assets,
        shares: args.shares,
      }
    }

    case 'Withdraw': {
      const args = log.args as {
        sender: Address
        receiver: Address
        owner: Address
        assets: bigint
        shares: bigint
      }
      return {
        type: 'Withdraw',
        ...baseEvent,
        sender: args.sender,
        receiver: args.receiver,
        owner: args.owner,
        assets: args.assets,
        shares: args.shares,
      }
    }

    case 'ProtocolLossRealized': {
      const args = log.args as {
        liquidatee: Address
        liquidator: Address
        protocolLossAssets: bigint
        protocolLossShares: bigint
      }
      return {
        type: 'ProtocolLossRealized',
        ...baseEvent,
        liquidatee: args.liquidatee,
        liquidator: args.liquidator,
        protocolLossAssets: args.protocolLossAssets,
        protocolLossShares: args.protocolLossShares,
      }
    }

    default:
      return null
  }
}

/**
 * Parse a RiskEngine log into a typed PanopticEvent.
 */
function parseRiskEngineLog(log: DecodedLog, eventName: string): PanopticEvent | null {
  const baseEvent = {
    transactionHash: log.transactionHash!,
    blockNumber: log.blockNumber!,
    blockHash: log.blockHash!,
    logIndex: BigInt(log.logIndex!),
  }

  switch (eventName) {
    case 'BorrowRateUpdated': {
      const args = log.args as {
        collateralToken: Address
        avgBorrowRate: bigint
        rateAtTarget: bigint
      }
      return {
        type: 'BorrowRateUpdated',
        ...baseEvent,
        collateralToken: args.collateralToken,
        avgBorrowRate: args.avgBorrowRate,
        rateAtTarget: args.rateAtTarget,
      }
    }

    default:
      return null
  }
}

/**
 * Parse an SFPM log into a typed PanopticEvent.
 */
function parseSfpmLog(log: DecodedLog, eventName: string): PanopticEvent | null {
  const baseEvent = {
    transactionHash: log.transactionHash!,
    blockNumber: log.blockNumber!,
    blockHash: log.blockHash!,
    logIndex: BigInt(log.logIndex!),
  }

  switch (eventName) {
    case 'LiquidityChunkUpdated': {
      const args = log.args as {
        poolId: Hash
        owner: Address
        tokenType: bigint
        tickLower: number
        tickUpper: number
        liquidityDelta: bigint
      }
      return {
        type: 'LiquidityChunkUpdated',
        ...baseEvent,
        poolId: args.poolId,
        owner: args.owner,
        tokenType: args.tokenType,
        tickLower: args.tickLower,
        tickUpper: args.tickUpper,
        liquidityDelta: args.liquidityDelta,
      }
    }

    default:
      return null
  }
}

/**
 * Parse a v4 PoolManager log into a typed PanopticEvent.
 */
function parsePoolManagerLog(log: DecodedLog, eventName: string): PanopticEvent | null {
  const baseEvent = {
    transactionHash: log.transactionHash!,
    blockNumber: log.blockNumber!,
    blockHash: log.blockHash!,
    logIndex: BigInt(log.logIndex!),
  }

  switch (eventName) {
    case 'ModifyLiquidity': {
      const args = log.args as {
        id: Hash
        sender: Address
        tickLower: number
        tickUpper: number
        liquidityDelta: bigint
        salt: Hash
      }
      return {
        type: 'ModifyLiquidity',
        ...baseEvent,
        id: args.id,
        sender: args.sender,
        tickLower: args.tickLower,
        tickUpper: args.tickUpper,
        liquidityDelta: args.liquidityDelta,
        salt: args.salt,
      }
    }

    case 'Swap': {
      const args = log.args as {
        id: Hash
        sender: Address
        amount0: bigint
        amount1: bigint
        sqrtPriceX96: bigint
        liquidity: bigint
        tick: number
        fee: number
      }
      return {
        type: 'Swap',
        ...baseEvent,
        id: args.id,
        sender: args.sender,
        amount0: args.amount0,
        amount1: args.amount1,
        sqrtPriceX96: args.sqrtPriceX96,
        liquidity: args.liquidity,
        tick: args.tick,
        fee: args.fee,
      }
    }

    case 'Donate': {
      const args = log.args as { id: Hash; sender: Address; amount0: bigint; amount1: bigint }
      return {
        type: 'Donate',
        ...baseEvent,
        id: args.id,
        sender: args.sender,
        amount0: args.amount0,
        amount1: args.amount1,
      }
    }

    default:
      return null
  }
}

/**
 * Watch for Panoptic events in real-time using WebSocket.
 *
 * This is a one-shot watcher - if the WebSocket disconnects, it stops.
 * For production bots that need automatic reconnection, use `createEventSubscription()`.
 *
 * @param params - Watch parameters
 * @returns Unwatch function to stop watching
 *
 * @example
 * ```typescript
 * const unwatch = watchEvents({
 *   client,
 *   poolAddress,
 *   eventTypes: ['OptionMinted', 'OptionBurnt'],
 *   onLogs: (events) => {
 *     for (const event of events) {
 *       console.log(event.type, event)
 *     }
 *   },
 *   onError: (error) => console.error(error),
 * })
 *
 * // Later: stop watching
 * unwatch()
 * ```
 */
export function watchEvents(params: WatchEventsParams): () => void {
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
  } = params

  const unwatchFns: (() => void)[] = []

  // Determine which pool events to watch
  const poolEventTypesToWatch = eventTypes
    ? eventTypes.filter((t) => t in POOL_EVENT_NAMES)
    : (Object.keys(POOL_EVENT_NAMES) as PanopticEventType[])

  // Watch PanopticPool events
  for (const eventType of poolEventTypesToWatch) {
    try {
      const unwatch = client.watchContractEvent({
        address: poolAddress,
        abi: panopticPoolAbi,
        eventName: eventType as
          | 'OptionMinted'
          | 'OptionBurnt'
          | 'AccountLiquidated'
          | 'ForcedExercised'
          | 'PremiumSettled',
        onLogs: (logs) => {
          const events: PanopticEvent[] = []
          for (const log of logs) {
            const parsed = parsePoolLog(log as DecodedLog, eventType)
            if (parsed) {
              events.push(parsed)
            }
          }
          if (events.length > 0) {
            onLogs(events)
          }
        },
        onError: onError,
      })
      unwatchFns.push(unwatch)
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  // Determine which collateral events to watch
  const collateralEventTypesToWatch = eventTypes
    ? eventTypes.filter((t) => t in COLLATERAL_EVENT_NAMES)
    : (Object.keys(COLLATERAL_EVENT_NAMES) as PanopticEventType[])

  // Watch CollateralTracker events (if addresses provided)
  const collateralTrackers = [collateralTracker0, collateralTracker1].filter(Boolean) as Address[]

  for (const trackerAddress of collateralTrackers) {
    for (const eventType of collateralEventTypesToWatch) {
      try {
        const unwatch = client.watchContractEvent({
          address: trackerAddress,
          abi: collateralTrackerAbi,
          eventName: eventType as 'Deposit' | 'Withdraw' | 'ProtocolLossRealized',
          onLogs: (logs) => {
            const events: PanopticEvent[] = []
            for (const log of logs) {
              const parsed = parseCollateralLog(log as DecodedLog, eventType)
              if (parsed) {
                events.push(parsed)
              }
            }
            if (events.length > 0) {
              onLogs(events)
            }
          },
          onError: onError,
        })
        unwatchFns.push(unwatch)
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  // Watch RiskEngine events (if address provided)
  if (riskEngineAddress) {
    const riskEngineEventTypesToWatch = eventTypes
      ? eventTypes.filter((t) => t in RISK_ENGINE_EVENT_NAMES)
      : (Object.keys(RISK_ENGINE_EVENT_NAMES) as PanopticEventType[])

    for (const eventType of riskEngineEventTypesToWatch) {
      try {
        const unwatch = client.watchContractEvent({
          address: riskEngineAddress,
          abi: riskEngineAbi,
          eventName: eventType as 'BorrowRateUpdated',
          onLogs: (logs) => {
            const events: PanopticEvent[] = []
            for (const log of logs) {
              const parsed = parseRiskEngineLog(log as DecodedLog, eventType)
              if (parsed) {
                events.push(parsed)
              }
            }
            if (events.length > 0) {
              onLogs(events)
            }
          },
          onError: onError,
        })
        unwatchFns.push(unwatch)
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  // Watch SFPM events (if address provided)
  if (sfpmAddress) {
    const sfpmEventTypesToWatch = eventTypes
      ? eventTypes.filter((t) => t in SFPM_EVENT_NAMES)
      : (Object.keys(SFPM_EVENT_NAMES) as PanopticEventType[])

    for (const eventType of sfpmEventTypesToWatch) {
      try {
        const unwatch = client.watchContractEvent({
          address: sfpmAddress,
          abi: semiFungiblePositionManagerAbi,
          eventName: eventType as 'LiquidityChunkUpdated',
          onLogs: (logs) => {
            const events: PanopticEvent[] = []
            for (const log of logs) {
              const parsed = parseSfpmLog(log as DecodedLog, eventType)
              if (parsed) {
                events.push(parsed)
              }
            }
            if (events.length > 0) {
              onLogs(events)
            }
          },
          onError: onError,
        })
        unwatchFns.push(unwatch)
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  // Watch PoolManager events (if address provided)
  if (poolManagerAddress) {
    const poolManagerEventTypesToWatch = eventTypes
      ? eventTypes.filter((t) => t in POOL_MANAGER_EVENT_NAMES)
      : (Object.keys(POOL_MANAGER_EVENT_NAMES) as PanopticEventType[])

    for (const eventType of poolManagerEventTypesToWatch) {
      try {
        const unwatch = client.watchContractEvent({
          address: poolManagerAddress,
          abi: poolManagerAbi,
          eventName: eventType as 'ModifyLiquidity' | 'Swap' | 'Donate',
          onLogs: (logs) => {
            const events: PanopticEvent[] = []
            for (const log of logs) {
              const parsed = parsePoolManagerLog(log as DecodedLog, eventType)
              if (parsed) {
                events.push(parsed)
              }
            }
            if (events.length > 0) {
              onLogs(events)
            }
          },
          onError: onError,
        })
        unwatchFns.push(unwatch)
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  // Return combined unwatch function
  return () => {
    for (const unwatch of unwatchFns) {
      unwatch()
    }
  }
}

export type { DecodedLog }
export { parseCollateralLog, parsePoolLog, parsePoolManagerLog, parseRiskEngineLog, parseSfpmLog }
