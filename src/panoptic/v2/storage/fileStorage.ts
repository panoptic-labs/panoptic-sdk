/**
 * File-based storage adapter for Node.js.
 * @module v2/storage/fileStorage
 */

import type FsPromises from 'node:fs/promises'
import type Path from 'node:path'

import type { StorageAdapter } from './adapter'

/**
 * Creates a file-based storage adapter for Node.js environments.
 * Stores data as JSON files in the specified directory.
 *
 * The directory will be created if it doesn't exist.
 *
 * @param directory - Path to the storage directory
 *
 * @example
 * ```typescript
 * import { createFileStorage, createConfig } from 'panoptic-v2-sdk'
 *
 * // Node.js only
 * const config = createConfig({
 *   chainId: 1n,
 *   transport: http('...'),
 *   poolAddress: '0x...',
 *   storage: createFileStorage('./panoptic-cache'),
 * })
 * ```
 */
export function createFileStorage(directory: string): StorageAdapter {
  // Lazy import fs/promises to avoid issues in browser environments
  // This function should only be called in Node.js
  let fsPromises: typeof FsPromises | null = null
  let pathModule: typeof Path | null = null
  let initialized = false

  const ensureInitialized = async () => {
    if (initialized) return

    // Dynamic import for Node.js modules
    fsPromises = await import('node:fs/promises')
    pathModule = await import('node:path')

    // Ensure directory exists
    await fsPromises.mkdir(directory, { recursive: true })
    initialized = true
  }

  const getFilePath = (key: string): string => {
    if (!pathModule) throw new Error('File storage not initialized')
    // Encode the key to be filesystem-safe
    const safeKey = Buffer.from(key).toString('base64url')
    return pathModule.join(directory, `${safeKey}.json`)
  }

  return {
    async get(key: string): Promise<string | null> {
      await ensureInitialized()
      if (!fsPromises) throw new Error('File storage not initialized')

      try {
        const filePath = getFilePath(key)
        const content = await fsPromises.readFile(filePath, 'utf-8')
        return content
      } catch (error) {
        // File doesn't exist
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        throw error
      }
    },

    async set(key: string, value: string): Promise<void> {
      await ensureInitialized()
      if (!fsPromises) throw new Error('File storage not initialized')

      const filePath = getFilePath(key)
      await fsPromises.writeFile(filePath, value, 'utf-8')
    },

    async delete(key: string): Promise<void> {
      await ensureInitialized()
      if (!fsPromises) throw new Error('File storage not initialized')

      try {
        const filePath = getFilePath(key)
        await fsPromises.unlink(filePath)
      } catch (error) {
        // Ignore if file doesn't exist
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
    },

    async has(key: string): Promise<boolean> {
      await ensureInitialized()
      if (!fsPromises) throw new Error('File storage not initialized')

      try {
        const filePath = getFilePath(key)
        await fsPromises.access(filePath)
        return true
      } catch {
        return false
      }
    },

    async keys(prefix: string): Promise<string[]> {
      await ensureInitialized()
      if (!fsPromises || !pathModule) throw new Error('File storage not initialized')

      const result: string[] = []

      try {
        const files = await fsPromises.readdir(directory)
        for (const file of files) {
          if (file.endsWith('.json')) {
            const safeKey = file.slice(0, -5) // Remove .json
            try {
              const key = Buffer.from(safeKey, 'base64url').toString()
              if (key.startsWith(prefix)) {
                result.push(key)
              }
            } catch {
              // Invalid base64, skip
            }
          }
        }
      } catch (error) {
        // Directory doesn't exist yet
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      return result
    },

    async clear(prefix: string): Promise<void> {
      await ensureInitialized()
      if (!fsPromises) throw new Error('File storage not initialized')

      const keysToDelete = await this.keys(prefix)
      for (const key of keysToDelete) {
        await this.delete(key)
      }
    },
  }
}
