/**
 * Event watching module for the Panoptic v2 SDK.
 * @module v2/events
 */

// Simple WebSocket watching
export type { WatchEventsParams } from './watchEvents'
export { watchEvents } from './watchEvents'

// Resilient subscription with auto-reconnect
export type {
  CreateEventSubscriptionParams,
  EventSubscriptionHandle,
  ReconnectConfig,
} from './subscription'
export { createEventSubscription, DEFAULT_RECONNECT_CONFIG } from './subscription'

// HTTP polling alternative
export type { CreateEventPollerParams, EventPoller } from './poller'
export { createEventPoller } from './poller'

// Pool-filtered Uniswap Swap polling
export type {
  PoolSwap,
  PoolSwapKey,
  PoolSwapTransport,
  PoolSwapWatcher,
  SubscribePoolSwapsParams,
  SwapPoolRef,
  WatchPoolSwapsParams,
} from './poolSwaps'
export { fetchPoolSwaps, parseSwapLog, subscribePoolSwaps, watchPoolSwaps } from './poolSwaps'
export type {
  PoolSwapStream,
  StreamPoolSwapsParams,
  SwapStreamEventSource,
  SwapStreamEventSourceFactory,
} from './poolSwapStream'
export { parseStreamedKey, parseStreamedSwap, streamPoolSwaps } from './poolSwapStream'

// Internal utilities (for testing)
export {
  parseCollateralLog,
  parsePoolLog,
  parsePoolManagerLog,
  parseRiskEngineLog,
  parseSfpmLog,
} from './watchEvents'
