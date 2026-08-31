/**
 * Tests for getForfeitablePremium.
 * @module v2/reads/forfeitablePremium.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getForfeitablePremium } from './premia'

const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const ACCOUNT_ADDRESS = '0x2222222222222222222222222222222222222222' as const

const MOCK_BLOCK = {
  number: 12345678n,
  hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
  timestamp: 1700000000n,
}

function createMockClient(): PublicClient {
  return {
    getBlock: vi.fn().mockResolvedValue(MOCK_BLOCK),
    getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK.number),
    multicall: vi.fn(),
  } as unknown as PublicClient
}

// LeftRightUnsigned packing: left slot in upper 128 bits, right slot in lower 128 bits
const packLR = (right: bigint, left: bigint) => (left << 128n) | right

// getFullPositionsData returns [shortPremium, longPremium, balances, collateralReqs, netPremia]
const fullPositionsData = (shortPremium: bigint) => [shortPremium, 0n, [], [], []]

describe('getForfeitablePremium', () => {
  it('returns owed minus available as the forfeit', async () => {
    const client = createMockClient()
    vi.mocked(client.multicall).mockResolvedValueOnce([
      fullPositionsData(packLR(1000n, 500n)), // includePendingPremium = true (owed)
      fullPositionsData(packLR(600n, 500n)), // includePendingPremium = false (available)
    ])

    const result = await getForfeitablePremium({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [1n],
    })

    expect(result.owed0).toBe(1000n)
    expect(result.owed1).toBe(500n)
    expect(result.available0).toBe(600n)
    expect(result.available1).toBe(500n)
    expect(result.forfeit0).toBe(400n)
    expect(result.forfeit1).toBe(0n)
    expect(result._meta.blockNumber).toBe(MOCK_BLOCK.number)
  })

  it('queries pending=true then pending=false for the same account and tokenIds', async () => {
    const client = createMockClient()
    vi.mocked(client.multicall).mockResolvedValueOnce([
      fullPositionsData(0n),
      fullPositionsData(0n),
    ])

    await getForfeitablePremium({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [7n, 9n],
    })

    const { contracts } = vi.mocked(client.multicall).mock.calls[0][0] as {
      contracts: Array<{ functionName: string; args: readonly unknown[] }>
    }
    expect(contracts).toHaveLength(2)
    expect(contracts[0].functionName).toBe('getFullPositionsData')
    expect(contracts[0].args).toEqual([ACCOUNT_ADDRESS, true, [7n, 9n]])
    expect(contracts[1].args).toEqual([ACCOUNT_ADDRESS, false, [7n, 9n]])
  })

  it('clamps forfeit at zero if available exceeds owed', async () => {
    const client = createMockClient()
    vi.mocked(client.multicall).mockResolvedValueOnce([
      fullPositionsData(packLR(100n, 100n)),
      fullPositionsData(packLR(150n, 150n)),
    ])

    const result = await getForfeitablePremium({
      client,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT_ADDRESS,
      tokenIds: [1n],
    })

    expect(result.forfeit0).toBe(0n)
    expect(result.forfeit1).toBe(0n)
  })
})
