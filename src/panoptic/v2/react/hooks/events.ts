/**
 * TanStack Query v5 event hooks for the Panoptic v2 SDK.
 * @module v2/react/hooks/events
 */

import { useEffect, useRef } from 'react'
import type { Address } from 'viem'

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
