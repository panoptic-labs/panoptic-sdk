/**
 * Tests for position storage auto-tracking in write functions.
 * @module v2/writes/positionStorage.test
 */

import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { MissingPositionIdsError } from '../errors'
import { createMemoryStorage, getPositionsKey, jsonSerializer } from '../storage'
import { getTrackedPositionIds } from '../sync/getTrackedPositionIds'
import {
  closePosition,
  closePositionAndWait,
  openPosition,
  openPositionAndWait,
  rollPosition,
  rollPositionAndWait,
} from './position'

// --- Test helpers ---

const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as Address
const ACCOUNT = '0x2222222222222222222222222222222222222222' as Address
const CHAIN_ID = 11155111n
const TOKEN_ID_A = 100n
const TOKEN_ID_B = 200n
const TOKEN_ID_C = 300n
const MOCK_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hash

const MOCK_RECEIPT = {
  transactionHash: MOCK_HASH,
  blockNumber: 1000n,
  blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hash,
  gasUsed: 100000n,
  status: 'success' as const,
  logs: [],
}

function createMockPublicClient(): PublicClient {
  return {
    waitForTransactionReceipt: vi.fn().mockResolvedValue(MOCK_RECEIPT),
    getTransactionCount: vi.fn().mockResolvedValue(0n),
  } as unknown as PublicClient
}

function createMockWalletClient(): WalletClient {
  return {
    chain: { id: 1 },
    writeContract: vi.fn().mockResolvedValue(MOCK_HASH),
    account: { address: ACCOUNT },
  } as unknown as WalletClient
}

/** Extract the `args` passed to writeContract (which is the dispatch args array) */
function getDispatchArgs(walletClient: WalletClient) {
  return (walletClient.writeContract as ReturnType<typeof vi.fn>).mock.calls[0][0].args
}

async function seedStorage(storage: ReturnType<typeof createMemoryStorage>, positionIds: bigint[]) {
  const key = getPositionsKey(CHAIN_ID, POOL_ADDRESS, ACCOUNT)
  await storage.set(key, jsonSerializer.stringify(positionIds))
}

const BASE_TICK_PARAMS = {
  tickLimitLow: -887272n,
  tickLimitHigh: 887272n,
}

// --- Tests ---

describe('resolvePositionIds', () => {
  it('throws MissingPositionIdsError when neither positionIds nor storage is provided', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    await expect(
      openPosition({
        client,
        walletClient,
        account: ACCOUNT,
        poolAddress: POOL_ADDRESS,
        tokenId: TOKEN_ID_A,
        positionSize: 1n,
        ...BASE_TICK_PARAMS,
      }),
    ).rejects.toThrow(MissingPositionIdsError)
  })

  it('throws MissingPositionIdsError when storage is provided without chainId', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()

    await expect(
      openPosition({
        client,
        walletClient,
        account: ACCOUNT,
        poolAddress: POOL_ADDRESS,
        tokenId: TOKEN_ID_A,
        positionSize: 1n,
        storage,
        ...BASE_TICK_PARAMS,
      }),
    ).rejects.toThrow(MissingPositionIdsError)
  })

  it('uses explicit positionIds when both explicit and storage are provided', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_B, TOKEN_ID_C])

    // Should use explicit [], not storage [B, C]
    await openPosition({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      existingPositionIds: [],
      tokenId: TOKEN_ID_A,
      positionSize: 1n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    // dispatch args: [positionIdList, finalPositionIdList, ...]
    const args = getDispatchArgs(walletClient)
    const finalPositionIdList = args[1]
    expect(finalPositionIdList).toEqual([TOKEN_ID_A])
  })

  it('reads from storage when positionIds not provided (openPosition)', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_B])

    await openPosition({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      tokenId: TOKEN_ID_A,
      positionSize: 1n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    // finalPositionIdList should be [B, A] (from storage [B] + new A)
    const args = getDispatchArgs(walletClient)
    const finalPositionIdList = args[1]
    expect(finalPositionIdList).toEqual([TOKEN_ID_B, TOKEN_ID_A])
  })

  it('reads from storage when positionIdList not provided (closePosition)', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_A, TOKEN_ID_B])

    await closePosition({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      tokenId: TOKEN_ID_A,
      positionSize: 0n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    // finalPositionIdList should be [B] (storage [A, B] minus A)
    const args = getDispatchArgs(walletClient)
    const finalPositionIdList = args[1]
    expect(finalPositionIdList).toEqual([TOKEN_ID_B])
  })

  it('reads from storage when positionIdList not provided (rollPosition)', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_A, TOKEN_ID_B])

    await rollPosition({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      oldTokenId: TOKEN_ID_A,
      oldPositionSize: 1n,
      newTokenId: TOKEN_ID_C,
      newPositionSize: 1n,
      storage,
      chainId: CHAIN_ID,
      closeTickLimitLow: -887272n,
      closeTickLimitHigh: 887272n,
      openTickLimitLow: -887272n,
      openTickLimitHigh: 887272n,
    })

    // finalPositionIdList should be [B, C] (storage [A, B] minus A plus C)
    const args = getDispatchArgs(walletClient)
    const finalPositionIdList = args[1]
    expect(finalPositionIdList).toEqual([TOKEN_ID_B, TOKEN_ID_C])
  })

  it('returns empty array from storage when no positions tracked', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()

    await openPosition({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      tokenId: TOKEN_ID_A,
      positionSize: 1n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    const args = getDispatchArgs(walletClient)
    const finalPositionIdList = args[1]
    expect(finalPositionIdList).toEqual([TOKEN_ID_A])
  })
})

describe('openPositionAndWait storage auto-sync', () => {
  it('appends tokenId to storage after successful tx', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_B])

    await openPositionAndWait({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      tokenId: TOKEN_ID_A,
      positionSize: 1n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    const tracked = await getTrackedPositionIds({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      storage,
    })
    expect(tracked).toEqual([TOKEN_ID_B, TOKEN_ID_A])
  })

  it('uses explicit existingPositionIds as base for storage save', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    // Storage has [B], but we pass explicit [B, C]
    await seedStorage(storage, [TOKEN_ID_B])

    await openPositionAndWait({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      existingPositionIds: [TOKEN_ID_B, TOKEN_ID_C],
      tokenId: TOKEN_ID_A,
      positionSize: 1n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    const tracked = await getTrackedPositionIds({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      storage,
    })
    // Should use explicit [B, C] as base, not storage [B]
    expect(tracked).toEqual([TOKEN_ID_B, TOKEN_ID_C, TOKEN_ID_A])
  })

  it('does not update storage when storage is not provided', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    await openPositionAndWait({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      existingPositionIds: [],
      tokenId: TOKEN_ID_A,
      positionSize: 1n,
      ...BASE_TICK_PARAMS,
    })

    // No assertion on storage — just verifying it doesn't throw
  })

  it('seeds storage from empty on first open', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()

    await openPositionAndWait({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      tokenId: TOKEN_ID_A,
      positionSize: 1n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    const tracked = await getTrackedPositionIds({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      storage,
    })
    expect(tracked).toEqual([TOKEN_ID_A])
  })
})

describe('closePositionAndWait storage auto-sync', () => {
  it('removes tokenId from storage after successful close', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_A, TOKEN_ID_B])

    await closePositionAndWait({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      tokenId: TOKEN_ID_A,
      positionSize: 0n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    const tracked = await getTrackedPositionIds({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      storage,
    })
    expect(tracked).toEqual([TOKEN_ID_B])
  })

  it('uses explicit positionIdList as base for storage save', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_A])

    await closePositionAndWait({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      positionIdList: [TOKEN_ID_A, TOKEN_ID_B],
      tokenId: TOKEN_ID_A,
      positionSize: 0n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    const tracked = await getTrackedPositionIds({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      storage,
    })
    // Should use explicit [A, B] as base, remove A → [B]
    expect(tracked).toEqual([TOKEN_ID_B])
  })

  it('results in empty storage when closing last position', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_A])

    await closePositionAndWait({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      tokenId: TOKEN_ID_A,
      positionSize: 0n,
      storage,
      chainId: CHAIN_ID,
      ...BASE_TICK_PARAMS,
    })

    const tracked = await getTrackedPositionIds({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      storage,
    })
    expect(tracked).toEqual([])
  })
})

describe('rollPositionAndWait storage auto-sync', () => {
  it('removes old and adds new tokenId in storage', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_A, TOKEN_ID_B])

    await rollPositionAndWait({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      oldTokenId: TOKEN_ID_A,
      oldPositionSize: 1n,
      newTokenId: TOKEN_ID_C,
      newPositionSize: 1n,
      storage,
      chainId: CHAIN_ID,
      closeTickLimitLow: -887272n,
      closeTickLimitHigh: 887272n,
      openTickLimitLow: -887272n,
      openTickLimitHigh: 887272n,
    })

    const tracked = await getTrackedPositionIds({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      storage,
    })
    expect(tracked).toEqual([TOKEN_ID_B, TOKEN_ID_C])
  })

  it('uses explicit positionIdList as base for storage save', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const storage = createMemoryStorage()
    await seedStorage(storage, [TOKEN_ID_A])

    await rollPositionAndWait({
      client,
      walletClient,
      account: ACCOUNT,
      poolAddress: POOL_ADDRESS,
      positionIdList: [TOKEN_ID_A, TOKEN_ID_B],
      oldTokenId: TOKEN_ID_A,
      oldPositionSize: 1n,
      newTokenId: TOKEN_ID_C,
      newPositionSize: 1n,
      storage,
      chainId: CHAIN_ID,
      closeTickLimitLow: -887272n,
      closeTickLimitHigh: 887272n,
      openTickLimitLow: -887272n,
      openTickLimitHigh: 887272n,
    })

    const tracked = await getTrackedPositionIds({
      chainId: CHAIN_ID,
      poolAddress: POOL_ADDRESS,
      account: ACCOUNT,
      storage,
    })
    // Should use explicit [A, B] as base, remove A, add C → [B, C]
    expect(tracked).toEqual([TOKEN_ID_B, TOKEN_ID_C])
  })
})
