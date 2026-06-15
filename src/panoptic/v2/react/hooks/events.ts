/**
 * TanStack Query v5 event hooks for the Panoptic v2 SDK.
 * @module v2/react/hooks/events
 */

import { useEffect, useRef, useState } from 'react'
import type { Address, Hash } from 'viem'
import { zeroAddress } from 'viem'

import { watchEvents } from '../../events'
import {
  type EventPoller,
  type EventSubscriptionHandle,
  createEventPoller,
  createEventSubscription,
} from '../../events'
import type { PanopticEvent, PanopticEventType } from '../../types'
import { usePanopticContext } from '../provider'

/**
 * Watch events via WebSocket. Returns cleanup automatically on unmount.
 */
export function useWatchEvents(
  poolAddress: Address,
  eventTypes: PanopticEventType[] | undefined,
  onEvent: (events: PanopticEvent[]) => void,
  options?: {
    enabled?: boolean
    collateralTracker0?: Address
    collateralTracker1?: Address
    riskEngineAddress?: Address
    sfpmAddress?: Address
    poolManagerAddress?: Address
    onError?: (error: Error) => void
  },
) {
  const { publicClient } = usePanopticContext()
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onErrorRef = useRef(options?.onError)
  onErrorRef.current = options?.onError

  const eventTypesKey = eventTypes?.join(',')

  useEffect(() => {
    if (options?.enabled === false) return

    const unwatch = watchEvents({
      client: publicClient,
      poolAddress,
      eventTypes,
      collateralTracker0: options?.collateralTracker0,
      collateralTracker1: options?.collateralTracker1,
      riskEngineAddress: options?.riskEngineAddress,
      sfpmAddress: options?.sfpmAddress,
      poolManagerAddress: options?.poolManagerAddress,
      onLogs: (events) => onEventRef.current(events),
      onError: (error) => onErrorRef.current?.(error),
    })

    return unwatch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    publicClient,
    poolAddress,
    options?.enabled,
    options?.collateralTracker0,
    options?.collateralTracker1,
    options?.riskEngineAddress,
    options?.sfpmAddress,
    options?.poolManagerAddress,
    eventTypesKey,
  ])
}

/**
 * Create a resilient event subscription with auto-reconnect.
 */
export function useEventSubscription(
  poolAddress: Address,
  eventTypes: PanopticEventType[] | undefined,
  onEvent: (events: PanopticEvent[]) => void,
  options?: {
    enabled?: boolean
    collateralTracker0?: Address
    collateralTracker1?: Address
    riskEngineAddress?: Address
    sfpmAddress?: Address
    poolManagerAddress?: Address
    onError?: (error: Error) => void
    onReconnect?: (attempt: bigint, nextDelayMs: bigint) => void
    onConnected?: () => void
  },
) {
  const { publicClient } = usePanopticContext()
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onErrorRef = useRef(options?.onError)
  onErrorRef.current = options?.onError
  const onReconnectRef = useRef(options?.onReconnect)
  onReconnectRef.current = options?.onReconnect
  const onConnectedRef = useRef(options?.onConnected)
  onConnectedRef.current = options?.onConnected

  const eventTypesKey = eventTypes?.join(',')

  useEffect(() => {
    if (options?.enabled === false) return

    const handle: EventSubscriptionHandle = createEventSubscription({
      client: publicClient,
      poolAddress,
      eventTypes,
      collateralTracker0: options?.collateralTracker0,
      collateralTracker1: options?.collateralTracker1,
      riskEngineAddress: options?.riskEngineAddress,
      sfpmAddress: options?.sfpmAddress,
      poolManagerAddress: options?.poolManagerAddress,
      onLogs: (events) => onEventRef.current(events),
      onError: (error) => onErrorRef.current?.(error),
      onReconnect: (attempt, delay) => onReconnectRef.current?.(attempt, delay),
      onConnected: () => onConnectedRef.current?.(),
    })

    handle.start()
    return () => handle.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    publicClient,
    poolAddress,
    options?.enabled,
    options?.collateralTracker0,
    options?.collateralTracker1,
    options?.riskEngineAddress,
    options?.sfpmAddress,
    options?.poolManagerAddress,
    eventTypesKey,
  ])
}

/**
 * Create an HTTP polling event fetcher.
 */
export function useEventPoller(
  poolAddress: Address,
  eventTypes: PanopticEventType[] | undefined,
  onEvent: (events: PanopticEvent[]) => void,
  options?: {
    enabled?: boolean
    intervalMs?: bigint
    collateralTracker0?: Address
    collateralTracker1?: Address
    riskEngineAddress?: Address
    sfpmAddress?: Address
    poolManagerAddress?: Address
    onError?: (error: Error) => void
  },
) {
  const { publicClient } = usePanopticContext()
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onErrorRef = useRef(options?.onError)
  onErrorRef.current = options?.onError

  const eventTypesKey = eventTypes?.join(',')

  useEffect(() => {
    if (options?.enabled === false) return

    const poller: EventPoller = createEventPoller({
      client: publicClient,
      poolAddress,
      eventTypes,
      collateralTracker0: options?.collateralTracker0,
      collateralTracker1: options?.collateralTracker1,
      riskEngineAddress: options?.riskEngineAddress,
      sfpmAddress: options?.sfpmAddress,
      poolManagerAddress: options?.poolManagerAddress,
      intervalMs: options?.intervalMs,
      onLogs: (events) => onEventRef.current(events),
      onError: (error) => onErrorRef.current?.(error),
    })

    poller.start()
    return () => poller.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    publicClient,
    poolAddress,
    options?.enabled,
    options?.intervalMs,
    options?.collateralTracker0,
    options?.collateralTracker1,
    options?.riskEngineAddress,
    options?.sfpmAddress,
    options?.poolManagerAddress,
    eventTypesKey,
  ])
}

/**
 * Confirms a transaction by watching for its corresponding on-chain event.
 *
 * An event log only exists in a confirmed (non-reverted) transaction, so
 * matching on `transactionHash` is sufficient proof of 1-block inclusion.
 * This bypasses the N-block confirmation wait of `useWaitForTransactionReceipt`,
 * making it faster on chains with high confirmation counts (e.g. Base = 150 blocks).
 *
 * Use alongside `useWaitForTransactionReceipt` (confirmations: 1) for revert
 * detection — reverted transactions emit no events.
 *
 * @example
 * ```tsx
 * const confirmation = useTxEventConfirmation({
 *   txHash: write.data,
 *   poolAddress,
 *   eventType: 'OptionMinted',
 *   enabled: write.data !== undefined,
 * })
 *
 * useEffect(() => {
 *   if (confirmation.isSuccess) onSuccess?.()
 * }, [confirmation.isSuccess])
 * ```
 */
export function useTxEventConfirmation({
  txHash,
  poolAddress = zeroAddress,
  collateralTrackerAddress,
  eventType,
  enabled = true,
  intervalMs = 3000n,
}: {
  /** Transaction hash to confirm. Polling starts when this is defined. */
  txHash: Hash | undefined
  /** PanopticPool address to watch for the event. Optional when watching collateral events only. */
  poolAddress?: Address
  /** CollateralTracker address to watch for Deposit/Withdraw events. */
  collateralTrackerAddress?: Address
  /** The event type expected from this transaction. */
  eventType: PanopticEventType
  /** Set to false to disable polling entirely. Default: true. */
  enabled?: boolean
  /** Polling interval in ms. Default: 3000 (~1 block on L2s). */
  intervalMs?: bigint
}): {
  /** The matched event, set once the tx is confirmed. */
  data: PanopticEvent | undefined
  /** True while polling and not yet confirmed. */
  isLoading: boolean
  /** True once the matching event has been observed. */
  isSuccess: boolean
} {
  const { publicClient } = usePanopticContext()
  const [data, setData] = useState<PanopticEvent | undefined>()
  const [isLoading, setIsLoading] = useState(false)

  // Refs to avoid stale closures inside the async poller callback
  const txHashRef = useRef(txHash)
  txHashRef.current = txHash
  const confirmedRef = useRef(false)
  const pollerRef = useRef<EventPoller | null>(null)

  useEffect(() => {
    // Reset for new tx
    confirmedRef.current = false
    setData(undefined)

    if (!txHash || !enabled) {
      pollerRef.current?.stop()
      pollerRef.current = null
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    let cancelled = false

    // Capture current block before starting so we don't miss an event that
    // lands in the same block as poller initialisation.
    publicClient
      .getBlockNumber()
      .then((currentBlock) => {
        if (cancelled) return

        const fromBlock = currentBlock > 0n ? currentBlock - 1n : 0n

        const poller = createEventPoller({
          client: publicClient,
          poolAddress,
          collateralTracker0: collateralTrackerAddress,
          eventTypes: [eventType],
          intervalMs,
          fromBlock,
          onLogs: (events) => {
            const hash = txHashRef.current
            if (!hash || confirmedRef.current) return
            const match = events.find((e) => e.transactionHash === hash)
            if (match) {
              confirmedRef.current = true
              pollerRef.current?.stop()
              pollerRef.current = null
              setIsLoading(false)
              setData(match)
            }
          },
        })

        pollerRef.current = poller
        poller.start()
      })
      .catch(() => {
        if (cancelled || confirmedRef.current) return
        pollerRef.current?.stop()
        pollerRef.current = null
        setIsLoading(false)
      })

    return () => {
      cancelled = true
      pollerRef.current?.stop()
      pollerRef.current = null
    }
  }, [txHash, enabled, publicClient, poolAddress, collateralTrackerAddress, eventType, intervalMs])

  return {
    data,
    isLoading: isLoading && data === undefined,
    isSuccess: data !== undefined,
  }
}
