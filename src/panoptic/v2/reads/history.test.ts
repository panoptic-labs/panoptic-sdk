/**
 * Tests for getAccountHistory.
 * @module v2/reads/history.test
 */

import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getAccountHistory } from './history'

const MOCK_POOL = '0x1111111111111111111111111111111111111111' as const
const MOCK_ACCOUNT = '0x2222222222222222222222222222222222222222' as const
const MOCK_TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const MOCK_BLOCK_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const

/**
 * Encode a PositionBalance value for OptionMinted events.
 * Layout: positionSize(128) | utilization0(16) | utilization1(16) | tickAtMint(24) | timestampAtMint(32) | blockAtMint(39) | swapAtMint(1)
 */
function encodePositionBalance(params: {
  positionSize: bigint
  utilization0?: bigint
  utilization1?: bigint
  tickAtMint?: bigint
  timestampAtMint?: bigint
  blockAtMint?: bigint
  swapAtMint?: boolean
}): bigint {
  let val = params.positionSize & ((1n << 128n) - 1n)
  val |= ((params.utilization0 ?? 0n) & 0xffffn) << 128n
  val |= ((params.utilization1 ?? 0n) & 0xffffn) << 144n

  // tickAtMint is int24 — handle negative values
  let tick = params.tickAtMint ?? 0n
  if (tick < 0n) {
    tick = tick + 0x1000000n
  }
  val |= (tick & 0xffffffn) << 160n

  val |= ((params.timestampAtMint ?? 0n) & 0xffffffffn) << 184n
  val |= ((params.blockAtMint ?? 0n) & ((1n << 39n) - 1n)) << 216n
  if (params.swapAtMint) {
    val |= 1n << 255n
  }
  return val
}

function createMockClient(mintLogs: unknown[] = [], burnLogs: unknown[] = []): PublicClient {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(20000000n),
    getBlock: vi.fn().mockResolvedValue({
      number: 20000000n,
      hash: MOCK_BLOCK_HASH,
      timestamp: 1700000000n,
    }),
    getContractEvents: vi.fn().mockImplementation((params: { eventName: string }) => {
      if (params.eventName === 'OptionMinted') return Promise.resolve(mintLogs)
      if (params.eventName === 'OptionBurnt') return Promise.resolve(burnLogs)
      return Promise.resolve([])
    }),
  } as unknown as PublicClient
}

describe('getAccountHistory', () => {
  it('should return empty trades for an account with no history', async () => {
    const client = createMockClient()

    const result = await getAccountHistory({
      client,
      poolAddress: MOCK_POOL,
      account: MOCK_ACCOUNT,
    })

    expect(result.trades).toEqual([])
    expect(result._meta.blockNumber).toBe(20000000n)
  })

  it('should parse OptionMinted events', async () => {
    const balanceData = encodePositionBalance({
      positionSize: 5n,
      utilization0: 3000n,
      utilization1: 4000n,
      tickAtMint: 100n,
      timestampAtMint: 1700000000n,
      blockAtMint: 18000000n,
    })

    const mintLogs = [
      {
        args: {
          recipient: MOCK_ACCOUNT,
          tokenId: 999n,
          balanceData,
        },
        blockNumber: 18000000n,
        transactionHash: MOCK_TX_HASH,
        blockHash: MOCK_BLOCK_HASH,
        logIndex: 5,
      },
    ]

    const client = createMockClient(mintLogs)

    const result = await getAccountHistory({
      client,
      poolAddress: MOCK_POOL,
      account: MOCK_ACCOUNT,
    })

    expect(result.trades).toHaveLength(1)
    const trade = result.trades[0]
    expect(trade.action).toBe('mint')
    expect(trade.tokenId).toBe(999n)
    expect(trade.positionSize).toBe(5n)
    expect(trade.blockNumber).toBe(18000000n)
    expect(trade.transactionHash).toBe(MOCK_TX_HASH)
    expect(trade.logIndex).toBe(5n)
    expect(trade.tickAtMint).toBe(100n)
    expect(trade.timestampAtMint).toBe(1700000000n)
    expect(trade.poolUtilization0).toBe(3000n)
    expect(trade.poolUtilization1).toBe(4000n)
  })

  it('should parse OptionBurnt events', async () => {
    const burnLogs = [
      {
        args: {
          recipient: MOCK_ACCOUNT,
          tokenId: 888n,
          positionSize: 3n,
          premiaByLeg: [10n, 20n, 0n, 0n] as const,
        },
        blockNumber: 19000000n,
        transactionHash: MOCK_TX_HASH,
        blockHash: MOCK_BLOCK_HASH,
        logIndex: 2,
      },
    ]

    const client = createMockClient([], burnLogs)

    const result = await getAccountHistory({
      client,
      poolAddress: MOCK_POOL,
      account: MOCK_ACCOUNT,
    })

    expect(result.trades).toHaveLength(1)
    const trade = result.trades[0]
    expect(trade.action).toBe('burn')
    expect(trade.tokenId).toBe(888n)
    expect(trade.positionSize).toBe(3n)
    expect(trade.premiaByLeg).toEqual([10n, 20n, 0n, 0n])
    expect(trade.tickAtMint).toBeUndefined()
  })

  it('should sort trades chronologically by block then logIndex', async () => {
    const balanceData1 = encodePositionBalance({ positionSize: 1n })
    const balanceData2 = encodePositionBalance({ positionSize: 2n })

    const mintLogs = [
      {
        args: { recipient: MOCK_ACCOUNT, tokenId: 1n, balanceData: balanceData1 },
        blockNumber: 18000000n,
        transactionHash: MOCK_TX_HASH,
        blockHash: MOCK_BLOCK_HASH,
        logIndex: 10,
      },
      {
        args: { recipient: MOCK_ACCOUNT, tokenId: 3n, balanceData: balanceData2 },
        blockNumber: 19000000n,
        transactionHash: MOCK_TX_HASH,
        blockHash: MOCK_BLOCK_HASH,
        logIndex: 1,
      },
    ]

    const burnLogs = [
      {
        args: {
          recipient: MOCK_ACCOUNT,
          tokenId: 2n,
          positionSize: 1n,
          premiaByLeg: [0n, 0n, 0n, 0n] as const,
        },
        blockNumber: 18000000n,
        transactionHash: MOCK_TX_HASH,
        blockHash: MOCK_BLOCK_HASH,
        logIndex: 15,
      },
    ]

    const client = createMockClient(mintLogs, burnLogs)

    const result = await getAccountHistory({
      client,
      poolAddress: MOCK_POOL,
      account: MOCK_ACCOUNT,
    })

    expect(result.trades).toHaveLength(3)
    // Block 18000000, logIndex 10 (mint tokenId=1)
    expect(result.trades[0].tokenId).toBe(1n)
    expect(result.trades[0].action).toBe('mint')
    // Block 18000000, logIndex 15 (burn tokenId=2)
    expect(result.trades[1].tokenId).toBe(2n)
    expect(result.trades[1].action).toBe('burn')
    // Block 19000000, logIndex 1 (mint tokenId=3)
    expect(result.trades[2].tokenId).toBe(3n)
    expect(result.trades[2].action).toBe('mint')
  })

  it('should pass account as indexed filter arg', async () => {
    const client = createMockClient()

    await getAccountHistory({
      client,
      poolAddress: MOCK_POOL,
      account: MOCK_ACCOUNT,
      fromBlock: 10000000n,
      toBlock: 20000000n,
    })

    const calls = (client.getContractEvents as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)

    // Both calls should filter by recipient = account
    for (const call of calls) {
      expect(call[0].args).toEqual({ recipient: MOCK_ACCOUNT })
      expect(call[0].fromBlock).toBe(10000000n)
      expect(call[0].toBlock).toBe(20000000n)
    }
  })

  it('should handle negative tickAtMint', async () => {
    const balanceData = encodePositionBalance({
      positionSize: 1n,
      tickAtMint: -100n,
    })

    const mintLogs = [
      {
        args: { recipient: MOCK_ACCOUNT, tokenId: 1n, balanceData },
        blockNumber: 18000000n,
        transactionHash: MOCK_TX_HASH,
        blockHash: MOCK_BLOCK_HASH,
        logIndex: 0,
      },
    ]

    const client = createMockClient(mintLogs)
    const result = await getAccountHistory({
      client,
      poolAddress: MOCK_POOL,
      account: MOCK_ACCOUNT,
    })

    expect(result.trades[0].tickAtMint).toBe(-100n)
  })
})
