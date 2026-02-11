/**
 * Tests for write functions.
 * @module v2/writes/writes.test
 */

import type { Hash, PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { createNonceManager, createTxResult, parsePanopticEvents } from './index'

// Mock clients
function createMockPublicClient(overrides: Partial<PublicClient> = {}): PublicClient {
  return {
    getTransactionCount: vi.fn().mockResolvedValue(0n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: '0x1234' as Hash,
      blockNumber: 12345678n,
      blockHash: '0xabcd' as Hash,
      gasUsed: 100000n,
      status: 'success',
      logs: [],
    }),
    ...overrides,
  } as unknown as PublicClient
}

describe('createNonceManager', () => {
  it('should return sequential nonces', async () => {
    const client = createMockPublicClient({
      getTransactionCount: vi.fn().mockResolvedValue(5n),
    })

    const manager = createNonceManager(client)
    const account = '0x1111111111111111111111111111111111111111' as const

    const nonce1 = await manager.getNextNonce(account)
    const nonce2 = await manager.getNextNonce(account)
    const nonce3 = await manager.getNextNonce(account)

    expect(nonce1).toBe(5n)
    expect(nonce2).toBe(6n)
    expect(nonce3).toBe(7n)
  })

  it('should use max of local and chain nonce', async () => {
    const getTransactionCount = vi
      .fn()
      .mockResolvedValueOnce(5n) // first call
      .mockResolvedValueOnce(5n) // second call
      .mockResolvedValueOnce(8n) // third call - chain jumped ahead

    const client = createMockPublicClient({ getTransactionCount })

    const manager = createNonceManager(client)
    const account = '0x1111111111111111111111111111111111111111' as const

    const nonce1 = await manager.getNextNonce(account)
    expect(nonce1).toBe(5n)

    const nonce2 = await manager.getNextNonce(account)
    expect(nonce2).toBe(6n)

    // Chain nonce jumped to 8, should use chain nonce since it's higher
    const nonce3 = await manager.getNextNonce(account)
    expect(nonce3).toBe(8n)
  })

  it('should reset nonces', async () => {
    const client = createMockPublicClient({
      getTransactionCount: vi.fn().mockResolvedValue(10n),
    })

    const manager = createNonceManager(client)
    const account = '0x1111111111111111111111111111111111111111' as const

    await manager.getNextNonce(account)
    await manager.getNextNonce(account)

    manager.reset(account)

    // After reset, should fetch fresh from chain
    const nonce = await manager.getNextNonce(account)
    expect(nonce).toBe(10n)
  })
})

describe('parsePanopticEvents', () => {
  it('should return empty array for empty logs', () => {
    const events = parsePanopticEvents([])
    expect(events).toEqual([])
  })

  it('should skip unknown events', () => {
    const logs = [
      {
        address: '0x1111111111111111111111111111111111111111' as const,
        data: '0x1234' as const,
        topics: ['0x5678567856785678567856785678567856785678567856785678567856785678'] as [
          `0x${string}`,
        ],
        blockNumber: 100n,
        blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash,
        transactionHash:
          '0xdef01234567890abcdef1234567890abcdef1234567890abcdef1234567890ab' as Hash,
        logIndex: 0,
        transactionIndex: 0,
        removed: false,
      },
    ]

    const events = parsePanopticEvents(logs)
    expect(events).toEqual([])
  })
})

describe('createTxResult', () => {
  it('should create a TxResult with hash', () => {
    const client = createMockPublicClient()
    const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash

    const result = createTxResult(client, hash)

    expect(result.hash).toBe(hash)
    expect(typeof result.wait).toBe('function')
  })

  it('should wait for transaction receipt', async () => {
    const mockReceipt = {
      transactionHash: '0x1234' as Hash,
      blockNumber: 12345678n,
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash,
      gasUsed: 100000n,
      status: 'success' as const,
      logs: [],
    }

    const client = createMockPublicClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue(mockReceipt),
    })

    const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash
    const result = createTxResult(client, hash)

    const receipt = await result.wait()

    expect(receipt.hash).toBe('0x1234')
    expect(receipt.blockNumber).toBe(12345678n)
    expect(receipt.status).toBe('success')
    expect(receipt.events).toEqual([])
    expect(client.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash,
      confirmations: undefined,
    })
  })

  it('should pass confirmations to wait', async () => {
    const mockReceipt = {
      transactionHash: '0x1234' as Hash,
      blockNumber: 12345678n,
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash,
      gasUsed: 100000n,
      status: 'success' as const,
      logs: [],
    }

    const client = createMockPublicClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue(mockReceipt),
    })

    const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash
    const result = createTxResult(client, hash)

    await result.wait(3n)

    expect(client.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash,
      confirmations: 3,
    })
  })

  it('should handle reverted transactions', async () => {
    const mockReceipt = {
      transactionHash: '0x1234' as Hash,
      blockNumber: 12345678n,
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash,
      gasUsed: 50000n,
      status: 'reverted' as const,
      logs: [],
    }

    const client = createMockPublicClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue(mockReceipt),
    })

    const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash
    const result = createTxResult(client, hash)

    const receipt = await result.wait()

    expect(receipt.status).toBe('reverted')
  })
})
