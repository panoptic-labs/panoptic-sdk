/**
 * Stable cache-scope helpers for React query keys.
 * @module v2/react/cacheScopes
 */

const DEFAULT_CLIENT_CACHE_SCOPE = 'default-client'
const DEFAULT_STORAGE_CACHE_SCOPE = 'default-storage'

export function getClientCacheScope(scope?: string): string {
  return scope ?? DEFAULT_CLIENT_CACHE_SCOPE
}

export function getStorageCacheScope(scope?: string): string {
  return scope ?? DEFAULT_STORAGE_CACHE_SCOPE
}

export function getClientCacheScopeKey(client: unknown, scope?: string): string {
  // Keep client in the queryKey expression for exhaustive-deps while keying by stable scope.
  void client
  return getClientCacheScope(scope)
}

export function getStorageCacheScopeKey(storage: unknown, scope?: string): string {
  // Keep storage in the queryKey expression for exhaustive-deps while keying by stable scope.
  void storage
  return getStorageCacheScope(scope)
}

export function getAtTickCacheKey(atTick?: bigint): string {
  return atTick === undefined ? 'latest' : atTick.toString()
}
