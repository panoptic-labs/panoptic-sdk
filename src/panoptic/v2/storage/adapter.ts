/**
 * Storage adapter interface for persistent data.
 * @module v2/storage/adapter
 */

/**
 * Async key-value storage adapter interface.
 * Users provide an implementation for position tracking persistence.
 *
 * @example
 * ```typescript
 * // File-based storage (Node.js)
 * const storage = createFileStorage('./cache')
 *
 * // In-memory storage (testing)
 * const storage = createMemoryStorage()
 * ```
 */
export interface StorageAdapter {
  /**
   * Get a value from storage.
   *
   * @param key - The storage key
   * @returns The value, or null if not found
   */
  get(key: string): Promise<string | null>

  /**
   * Set a value in storage.
   *
   * @param key - The storage key
   * @param value - The value to store (already serialized to string)
   */
  set(key: string, value: string): Promise<void>

  /**
   * Delete a value from storage.
   *
   * @param key - The storage key
   */
  delete(key: string): Promise<void>

  /**
   * Check if a key exists in storage.
   *
   * @param key - The storage key
   * @returns true if the key exists
   */
  has(key: string): Promise<boolean>

  /**
   * Get all keys matching a prefix.
   *
   * @param prefix - The key prefix to match
   * @returns Array of matching keys
   */
  keys(prefix: string): Promise<string[]>

  /**
   * Clear all keys matching a prefix.
   *
   * @param prefix - The key prefix to match (clears all matching keys)
   */
  clear(prefix: string): Promise<void>
}
