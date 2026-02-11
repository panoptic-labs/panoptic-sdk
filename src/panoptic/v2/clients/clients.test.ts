/**
 * Tests for client utilities.
 * @module v2/clients/clients.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getBlockMeta } from './blockMeta'
import { multicallRead } from './multicall'

// Mock PublicClient factory
function createMockClient(overrides: Partial<PublicClient> = {}): PublicClient {
  return {
    getBlock: vi.fn(),
    getBlockNumber: vi.fn(),
    multicall: vi.fn(),
    ...overrides,
  } as unknown as PublicClient
}

describe('getBlockMeta', () => {
  it('should fetch block metadata for latest block', async () => {
    const mockBlock = {
      number: 12345678n,
      hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
      timestamp: 1700000000n,
    }

    const client = createMockClient({
      getBlock: vi.fn().mockResolvedValue(mockBlock),
    })

    const result = await getBlockMeta({ client })

    expect(result).toEqual({
      blockNumber: 12345678n,
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      blockTimestamp: 1700000000n,
    })

    expect(client.getBlock).toHaveBeenCalledWith({
      blockNumber: undefined,
      includeTransactions: false,
    })
  })

  it('should fetch block metadata for specific block number', async () => {
    const mockBlock = {
      number: 10000000n,
      hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as const,
      timestamp: 1600000000n,
    }

    const client = createMockClient({
      getBlock: vi.fn().mockResolvedValue(mockBlock),
    })

    const result = await getBlockMeta({ client, blockNumber: 10000000n })

    expect(result.blockNumber).toBe(10000000n)
    expect(result.blockTimestamp).toBe(1600000000n)

    expect(client.getBlock).toHaveBeenCalledWith({
      blockNumber: 10000000n,
      includeTransactions: false,
    })
  })

  it('should return correct BlockMeta structure', async () => {
    const mockBlock = {
      number: 99999n,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000001' as const,
      timestamp: 1234567890n,
    }

    const client = createMockClient({
      getBlock: vi.fn().mockResolvedValue(mockBlock),
    })

    const result = await getBlockMeta({ client })

    expect(typeof result.blockNumber).toBe('bigint')
    expect(typeof result.blockTimestamp).toBe('bigint')
    expect(result.blockHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
  })
})

describe('multicallRead', () => {
  const mockAbi = [
    {
      type: 'function',
      name: 'getValue',
      inputs: [],
      outputs: [{ type: 'uint256' }],
      stateMutability: 'view',
    },
  ] as const

  it('should execute multicall and return results with block metadata', async () => {
    const mockBlock = {
      number: 12345678n,
      hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
      timestamp: 1700000000n,
    }

    const client = createMockClient({
      getBlockNumber: vi.fn().mockResolvedValue(12345678n),
      getBlock: vi.fn().mockResolvedValue(mockBlock),
      multicall: vi.fn().mockResolvedValue([
        { status: 'success', result: 100n },
        { status: 'success', result: 200n },
      ]),
    })

    const contracts = [
      {
        address: '0x1111111111111111111111111111111111111111' as const,
        abi: mockAbi,
        functionName: 'getValue' as const,
      },
      {
        address: '0x2222222222222222222222222222222222222222' as const,
        abi: mockAbi,
        functionName: 'getValue' as const,
      },
    ]

    const { results, _meta } = await multicallRead({ client, contracts })

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ status: 'success', result: 100n })
    expect(results[1]).toEqual({ status: 'success', result: 200n })
    expect(_meta.blockNumber).toBe(12345678n)
  })

  it('should use provided block number', async () => {
    const mockBlock = {
      number: 10000000n,
      hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as const,
      timestamp: 1600000000n,
    }

    const client = createMockClient({
      getBlock: vi.fn().mockResolvedValue(mockBlock),
      multicall: vi.fn().mockResolvedValue([{ status: 'success', result: 42n }]),
    })

    const contracts = [
      {
        address: '0x1111111111111111111111111111111111111111' as const,
        abi: mockAbi,
        functionName: 'getValue' as const,
      },
    ]

    const { _meta } = await multicallRead({
      client,
      contracts,
      blockNumber: 10000000n,
    })

    expect(_meta.blockNumber).toBe(10000000n)
    expect(client.multicall).toHaveBeenCalledWith(
      expect.objectContaining({
        blockNumber: 10000000n,
      }),
    )
  })

  it('should handle failures with allowFailure=true', async () => {
    const mockBlock = {
      number: 12345678n,
      hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
      timestamp: 1700000000n,
    }

    const mockError = new Error('Call reverted')

    const client = createMockClient({
      getBlockNumber: vi.fn().mockResolvedValue(12345678n),
      getBlock: vi.fn().mockResolvedValue(mockBlock),
      multicall: vi.fn().mockResolvedValue([
        { status: 'success', result: 100n },
        { status: 'failure', error: mockError },
      ]),
    })

    const contracts = [
      {
        address: '0x1111111111111111111111111111111111111111' as const,
        abi: mockAbi,
        functionName: 'getValue' as const,
      },
      {
        address: '0x2222222222222222222222222222222222222222' as const,
        abi: mockAbi,
        functionName: 'getValue' as const,
      },
    ]

    const { results } = await multicallRead({
      client,
      contracts,
      allowFailure: true,
    })

    expect(results[0]).toEqual({ status: 'success', result: 100n })
    expect(results[1]).toEqual({ status: 'failure', error: mockError })
  })

  it('should throw on failure when allowFailure=false', async () => {
    const mockBlock = {
      number: 12345678n,
      hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
      timestamp: 1700000000n,
    }

    const mockError = new Error('Call reverted')

    const client = createMockClient({
      getBlockNumber: vi.fn().mockResolvedValue(12345678n),
      getBlock: vi.fn().mockResolvedValue(mockBlock),
      multicall: vi.fn().mockResolvedValue([{ status: 'failure', error: mockError }]),
    })

    const contracts = [
      {
        address: '0x1111111111111111111111111111111111111111' as const,
        abi: mockAbi,
        functionName: 'getValue' as const,
      },
    ]

    await expect(multicallRead({ client, contracts, allowFailure: false })).rejects.toThrow(
      'Call reverted',
    )
  })

  it('should return empty results for empty contracts array', async () => {
    const mockBlock = {
      number: 12345678n,
      hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
      timestamp: 1700000000n,
    }

    const client = createMockClient({
      getBlockNumber: vi.fn().mockResolvedValue(12345678n),
      getBlock: vi.fn().mockResolvedValue(mockBlock),
      multicall: vi.fn().mockResolvedValue([]),
    })

    const { results, _meta } = await multicallRead({
      client,
      contracts: [],
    })

    expect(results).toHaveLength(0)
    expect(_meta.blockNumber).toBe(12345678n)
  })
})
