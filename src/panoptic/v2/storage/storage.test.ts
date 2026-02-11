import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { StorageAdapter } from './adapter'
import { createFileStorage } from './fileStorage'
import {
  getClosedPositionsKey,
  getPendingPositionsKey,
  getPoolPrefix,
  getPositionMetaKey,
  getPositionsKey,
  getSchemaVersionKey,
  getSyncCheckpointKey,
  getTrackedChunksKey,
} from './keys'
import { createMemoryStorage } from './memoryStorage'

describe('createMemoryStorage', () => {
  let storage: StorageAdapter

  beforeEach(() => {
    storage = createMemoryStorage()
  })

  it('returns null for non-existent key', async () => {
    const result = await storage.get('non-existent')
    expect(result).toBeNull()
  })

  it('stores and retrieves values', async () => {
    await storage.set('key1', 'value1')
    const result = await storage.get('key1')
    expect(result).toBe('value1')
  })

  it('overwrites existing values', async () => {
    await storage.set('key1', 'value1')
    await storage.set('key1', 'value2')
    const result = await storage.get('key1')
    expect(result).toBe('value2')
  })

  it('deletes values', async () => {
    await storage.set('key1', 'value1')
    await storage.delete('key1')
    const result = await storage.get('key1')
    expect(result).toBeNull()
  })

  it('deleting non-existent key does not throw', async () => {
    await expect(storage.delete('non-existent')).resolves.toBeUndefined()
  })

  it('checks key existence with has()', async () => {
    expect(await storage.has('key1')).toBe(false)
    await storage.set('key1', 'value1')
    expect(await storage.has('key1')).toBe(true)
    await storage.delete('key1')
    expect(await storage.has('key1')).toBe(false)
  })

  it('returns keys matching prefix', async () => {
    await storage.set('prefix:a', '1')
    await storage.set('prefix:b', '2')
    await storage.set('other:c', '3')

    const keys = await storage.keys('prefix:')
    expect(keys).toHaveLength(2)
    expect(keys).toContain('prefix:a')
    expect(keys).toContain('prefix:b')
    expect(keys).not.toContain('other:c')
  })

  it('returns empty array when no keys match prefix', async () => {
    await storage.set('other:a', '1')
    const keys = await storage.keys('prefix:')
    expect(keys).toHaveLength(0)
  })

  it('clears keys matching prefix', async () => {
    await storage.set('prefix:a', '1')
    await storage.set('prefix:b', '2')
    await storage.set('other:c', '3')

    await storage.clear('prefix:')

    expect(await storage.has('prefix:a')).toBe(false)
    expect(await storage.has('prefix:b')).toBe(false)
    expect(await storage.has('other:c')).toBe(true)
  })

  it('handles empty strings as values', async () => {
    await storage.set('key1', '')
    expect(await storage.get('key1')).toBe('')
    expect(await storage.has('key1')).toBe(true)
  })

  it('handles JSON strings as values', async () => {
    const jsonValue = JSON.stringify({ amount: 100, nested: { value: true } })
    await storage.set('key1', jsonValue)
    const result = await storage.get('key1')
    expect(result).toBe(jsonValue)
    expect(JSON.parse(result!)).toEqual({ amount: 100, nested: { value: true } })
  })
})

describe('createFileStorage', () => {
  const testDir = path.join(process.cwd(), '.test-storage')
  let storage: StorageAdapter

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true })
    } catch {
      // Directory doesn't exist, that's fine
    }
    storage = createFileStorage(testDir)
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true })
    } catch {
      // Directory doesn't exist, that's fine
    }
  })

  it('returns null for non-existent key', async () => {
    const result = await storage.get('non-existent')
    expect(result).toBeNull()
  })

  it('creates directory if it does not exist', async () => {
    await storage.set('key1', 'value1')
    const stat = await fs.stat(testDir)
    expect(stat.isDirectory()).toBe(true)
  })

  it('stores and retrieves values', async () => {
    await storage.set('key1', 'value1')
    const result = await storage.get('key1')
    expect(result).toBe('value1')
  })

  it('overwrites existing values', async () => {
    await storage.set('key1', 'value1')
    await storage.set('key1', 'value2')
    const result = await storage.get('key1')
    expect(result).toBe('value2')
  })

  it('deletes values', async () => {
    await storage.set('key1', 'value1')
    await storage.delete('key1')
    const result = await storage.get('key1')
    expect(result).toBeNull()
  })

  it('deleting non-existent key does not throw', async () => {
    await expect(storage.delete('non-existent')).resolves.toBeUndefined()
  })

  it('checks key existence with has()', async () => {
    expect(await storage.has('key1')).toBe(false)
    await storage.set('key1', 'value1')
    expect(await storage.has('key1')).toBe(true)
    await storage.delete('key1')
    expect(await storage.has('key1')).toBe(false)
  })

  it('returns keys matching prefix', async () => {
    await storage.set('prefix:a', '1')
    await storage.set('prefix:b', '2')
    await storage.set('other:c', '3')

    const keys = await storage.keys('prefix:')
    expect(keys).toHaveLength(2)
    expect(keys).toContain('prefix:a')
    expect(keys).toContain('prefix:b')
    expect(keys).not.toContain('other:c')
  })

  it('clears keys matching prefix', async () => {
    await storage.set('prefix:a', '1')
    await storage.set('prefix:b', '2')
    await storage.set('other:c', '3')

    await storage.clear('prefix:')

    expect(await storage.has('prefix:a')).toBe(false)
    expect(await storage.has('prefix:b')).toBe(false)
    expect(await storage.has('other:c')).toBe(true)
  })

  it('handles keys with special characters', async () => {
    const key = 'panoptic-v2-sdk:v1:chain1:pool0x1234:positions:0xabcd'
    await storage.set(key, 'test-value')
    expect(await storage.get(key)).toBe('test-value')
  })

  it('handles large JSON values', async () => {
    const largeValue = JSON.stringify({
      positions: Array.from({ length: 100 }, (_, i) => ({
        tokenId: `${i}`.repeat(50),
        size: i * 1000,
      })),
    })
    await storage.set('large-key', largeValue)
    expect(await storage.get('large-key')).toBe(largeValue)
  })
})

describe('Storage keys', () => {
  const chainId = 1n
  const poolAddress = '0x1234567890123456789012345678901234567890' as const
  const account = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01' as const
  const tokenId = 123456789012345678901234567890n

  describe('getSchemaVersionKey', () => {
    it('returns schema version key', () => {
      expect(getSchemaVersionKey()).toBe('panoptic-v2-sdk:schemaVersion')
    })
  })

  describe('getPoolPrefix', () => {
    it('returns pool prefix with lowercase address', () => {
      const prefix = getPoolPrefix(chainId, poolAddress)
      expect(prefix).toBe(
        'panoptic-v2-sdk:v1:chain1:pool0x1234567890123456789012345678901234567890',
      )
    })

    it('lowercases address', () => {
      const prefix = getPoolPrefix(chainId, '0xABCD' as `0x${string}`)
      expect(prefix).toContain('0xabcd')
    })
  })

  describe('getPositionsKey', () => {
    it('returns positions key with lowercase addresses', () => {
      const key = getPositionsKey(chainId, poolAddress, account)
      expect(key).toContain(':positions:')
      expect(key).toContain('0xabcdef0123456789abcdef0123456789abcdef01')
    })
  })

  describe('getPositionMetaKey', () => {
    it('returns position metadata key with tokenId', () => {
      const key = getPositionMetaKey(chainId, poolAddress, tokenId)
      expect(key).toContain(':positionMeta:')
      expect(key).toContain(tokenId.toString())
    })
  })

  describe('getSyncCheckpointKey', () => {
    it('returns sync checkpoint key', () => {
      const key = getSyncCheckpointKey(chainId, poolAddress, account)
      expect(key).toContain(':sync:')
    })
  })

  describe('getClosedPositionsKey', () => {
    it('returns closed positions key', () => {
      const key = getClosedPositionsKey(chainId, poolAddress, account)
      expect(key).toContain(':closed:')
    })
  })

  describe('getTrackedChunksKey', () => {
    it('returns tracked chunks key', () => {
      const key = getTrackedChunksKey(chainId, poolAddress)
      expect(key).toContain(':chunks')
    })
  })

  describe('getPendingPositionsKey', () => {
    it('returns pending positions key', () => {
      const key = getPendingPositionsKey(chainId, poolAddress, account)
      expect(key).toContain(':pending:')
    })
  })

  describe('key format consistency', () => {
    it('all keys include schema version', () => {
      const keys = [
        getPoolPrefix(chainId, poolAddress),
        getPositionsKey(chainId, poolAddress, account),
        getPositionMetaKey(chainId, poolAddress, tokenId),
        getSyncCheckpointKey(chainId, poolAddress, account),
        getClosedPositionsKey(chainId, poolAddress, account),
        getTrackedChunksKey(chainId, poolAddress),
        getPendingPositionsKey(chainId, poolAddress, account),
      ]

      for (const key of keys) {
        expect(key).toContain(':v1:')
      }
    })

    it('all keys include chain ID', () => {
      const keys = [
        getPoolPrefix(chainId, poolAddress),
        getPositionsKey(chainId, poolAddress, account),
      ]

      for (const key of keys) {
        expect(key).toContain(':chain1:')
      }
    })

    it('all keys include pool address', () => {
      const keys = [
        getPoolPrefix(chainId, poolAddress),
        getPositionsKey(chainId, poolAddress, account),
      ]

      for (const key of keys) {
        expect(key).toContain(':pool0x')
      }
    })
  })
})
