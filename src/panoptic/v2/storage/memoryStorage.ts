/**
 * In-memory storage adapter for testing.
 * @module v2/storage/memoryStorage
 */

import type { StorageAdapter } from './adapter'

/**
 * Creates an in-memory storage adapter.
 * Useful for testing and development.
 *
 * Data is lost when the process exits.
 *
 * @example
 * ```typescript
 * import { createMemoryStorage, createConfig } from 'panoptic-v2-sdk'
 *
 * const config = createConfig({
 *   chainId: 1n,
 *   transport: http('...'),
 *   poolAddress: '0x...',
 *   storage: createMemoryStorage(),
 * })
 * ```
 */
export function createMemoryStorage(): StorageAdapter {
  const store = new Map<string, string>()

  return {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null
    },

    async set(key: string, value: string): Promise<void> {
      store.set(key, value)
    },

    async delete(key: string): Promise<void> {
      store.delete(key)
    },

    async has(key: string): Promise<boolean> {
      return store.has(key)
    },

    async keys(prefix: string): Promise<string[]> {
      const result: string[] = []
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          result.push(key)
        }
      }
      return result
    },

    async clear(prefix: string): Promise<void> {
      const keysToDelete: string[] = []
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          keysToDelete.push(key)
        }
      }
      for (const key of keysToDelete) {
        store.delete(key)
      }
    },
  }
}
