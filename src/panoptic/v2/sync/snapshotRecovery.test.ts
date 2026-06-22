import type { Address, Hash, PublicClient } from 'viem'
import { encodeFunctionData } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { recoverSnapshot } from './snapshotRecovery'

type SnapshotEventLog = Awaited<ReturnType<PublicClient['getLogs']>>[number]
type TransactionResult = Awaited<ReturnType<PublicClient['getTransaction']>>
type BlockResult = Awaited<ReturnType<PublicClient['getBlock']>>

interface GetLogsCall {
  address: Address
  event: { name: string }
  args: Record<string, Address>
  fromBlock?: bigint
  toBlock?: bigint
}

interface HashCall {
  hash: Hash
}

interface BlockCall {
  blockNumber: bigint
}

interface SnapshotRecoveryClient {
  getBlockNumber: () => Promise<bigint>
  getLogs: (params: GetLogsCall) => Promise<SnapshotEventLog[]>
  getTransaction: (params: HashCall) => Promise<TransactionResult>
  getBlock: (params: BlockCall) => Promise<BlockResult>
}

const POOL = '0x00000000563b70d704f4c6675a5f6ac989fbae13' as Address
const ACCOUNT = '0x236d0558f06cd60780b232d4Ec4c92d2cb7e4D18' as Address
const TX_HASH = `0x${'1'.repeat(64)}` as Hash
const BLOCK_HASH = `0x${'2'.repeat(64)}` as Hash

function encodeDispatchSnapshot(positionIds: bigint[]) {
  return encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [[], positionIds, [], [], false, 0n],
  })
}

function snapshotLog(): SnapshotEventLog {
  return {
    transactionHash: TX_HASH,
    blockNumber: 19_500n,
    logIndex: 3,
  } as SnapshotEventLog
}

function createClient(params: {
  getBlockNumber?: () => Promise<bigint>
  getLogs: (params: GetLogsCall) => Promise<SnapshotEventLog[]>
  getTransaction?: (params: HashCall) => Promise<TransactionResult>
  getBlock?: (params: BlockCall) => Promise<BlockResult>
}): SnapshotRecoveryClient {
  return {
    getBlockNumber: vi.fn(params.getBlockNumber ?? (async () => 30_000n)),
    getLogs: vi.fn(params.getLogs),
    getTransaction: vi.fn(
      params.getTransaction ??
        (async (_params: HashCall): Promise<TransactionResult> => {
          return {
            blockNumber: 19_500n,
            from: ACCOUNT,
            to: POOL,
            input: encodeDispatchSnapshot([11n, 22n]),
          } as TransactionResult
        }),
    ),
    getBlock: vi.fn(
      params.getBlock ??
        (async (_params: BlockCall): Promise<BlockResult> => {
          return { hash: BLOCK_HASH } as BlockResult
        }),
    ),
  }
}

describe('recoverSnapshot', () => {
  it('scans logs in newest-to-oldest 10,000 block chunks and stops after a valid snapshot', async () => {
    const getLogsMock = vi.fn(async (params: GetLogsCall): Promise<SnapshotEventLog[]> => {
      if (
        params.event.name === 'OptionMinted' &&
        params.fromBlock === 10_001n &&
        params.toBlock === 20_000n
      ) {
        return [snapshotLog()]
      }
      return []
    })
    const client = createClient({ getLogs: getLogsMock })

    const snapshot = await recoverSnapshot({
      client: client as PublicClient,
      poolAddress: POOL,
      account: ACCOUNT,
      fromBlock: 1n,
      toBlock: 30_000n,
    })

    expect(snapshot?.positionIds).toEqual([11n, 22n])
    expect(snapshot?.transactionHash).toBe(TX_HASH)

    const logCalls = getLogsMock.mock.calls.map(([call]) => call)
    expect(logCalls.some((call) => call.fromBlock === 1n && call.toBlock === 30_000n)).toBe(false)
    expect(
      new Set(logCalls.map((call) => `${call.fromBlock?.toString()}-${call.toBlock?.toString()}`)),
    ).toEqual(new Set(['20001-30000', '10001-20000']))
    expect(client.getTransaction).toHaveBeenCalledTimes(1)
  })

  it('returns null when latest block is before fromBlock', async () => {
    const getLogsMock = vi.fn(async (_params: GetLogsCall): Promise<SnapshotEventLog[]> => [])
    const client = createClient({
      getBlockNumber: async () => 30_000n,
      getLogs: getLogsMock,
    })

    const snapshot = await recoverSnapshot({
      client: client as PublicClient,
      poolAddress: POOL,
      account: ACCOUNT,
      fromBlock: 30_001n,
      toBlock: 30_000n,
    })

    expect(snapshot).toBeNull()
    expect(getLogsMock).not.toHaveBeenCalled()
  })

  it('returns null after exhausting all 10,000 block chunks without a valid snapshot', async () => {
    const getLogsMock = vi.fn(async (_params: GetLogsCall): Promise<SnapshotEventLog[]> => [])
    const client = createClient({ getLogs: getLogsMock })

    const snapshot = await recoverSnapshot({
      client: client as PublicClient,
      poolAddress: POOL,
      account: ACCOUNT,
      fromBlock: 1n,
      toBlock: 30_000n,
    })

    expect(snapshot).toBeNull()
    expect(client.getTransaction).not.toHaveBeenCalled()

    const logCalls = getLogsMock.mock.calls.map(([call]) => call)
    expect(
      new Set(logCalls.map((call) => `${call.fromBlock?.toString()}-${call.toBlock?.toString()}`)),
    ).toEqual(new Set(['20001-30000', '10001-20000', '1-10000']))
  })

  it('skips candidate transactions that fail to load', async () => {
    const getLogsMock = vi.fn(async (params: GetLogsCall): Promise<SnapshotEventLog[]> => {
      if (params.event.name === 'OptionMinted') return [snapshotLog()]
      return []
    })
    const client = createClient({
      getLogs: getLogsMock,
      getTransaction: async (_params: HashCall): Promise<TransactionResult> => {
        throw new Error('transaction unavailable')
      },
    })

    const snapshot = await recoverSnapshot({
      client: client as PublicClient,
      poolAddress: POOL,
      account: ACCOUNT,
      fromBlock: 10_001n,
      toBlock: 20_000n,
    })

    expect(snapshot).toBeNull()
    expect(client.getTransaction).toHaveBeenCalledTimes(1)
    expect(client.getBlock).toHaveBeenCalledTimes(1)
  })
})
