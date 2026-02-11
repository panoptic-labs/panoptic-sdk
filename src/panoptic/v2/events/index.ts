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

// Internal utilities (for testing)
export {
  parseCollateralLog,
  parsePoolLog,
  parsePoolManagerLog,
  parseRiskEngineLog,
  parseSfpmLog,
} from './watchEvents'
