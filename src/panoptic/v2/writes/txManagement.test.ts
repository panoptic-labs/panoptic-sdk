/**
 * Tests for transaction management (speedUp, cancel).
 * @module v2/writes/txManagement.test
 */

import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import type { TxBroadcaster } from '../types'
import { cancelTransaction, speedUpTransaction } from './txManagement'

const MOCK_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash
const MOCK_REPLACEMENT_HASH =
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash
const MOCK_ACCOUNT = '0x1111111111111111111111111111111111111111' as Address

function createMockPublicClient(overrides: Record<string, unknown> = {}): PublicClient {
  return {
    getTransaction: vi.fn().mockResolvedValue({
      from: MOCK_ACCOUNT,
      to: '0x2222222222222222222222222222222222222222',
      input: '0xdeadbeef',
      value: 0n,
      nonce: 5,
      gas: 200000n,
      maxFeePerGas: 20_000_000_000n, // 20 gwei
      maxPriorityFeePerGas: 2_000_000_000n, // 2 gwei
    }),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: MOCK_REPLACEMENT_HASH,
      blockNumber: 12345678n,
      blockHash: '0xabcd' as Hash,
      gasUsed: 100000n,
      status: 'success',
      logs: [],
    }),
    ...overrides,
  } as unknown as PublicClient
}

function createMockWalletClient(overrides: Record<string, unknown> = {}): WalletClient {
  return {
    chain: { id: 1 },
    sendTransaction: vi.fn().mockResolvedValue(MOCK_REPLACEMENT_HASH),
    prepareTransactionRequest: vi.fn().mockResolvedValue({
      to: '0x2222222222222222222222222222222222222222',
      data: '0xdeadbeef',
      value: 0n,
      nonce: 5,
      gas: 200000n,
      maxFeePerGas: 22_500_000_000n,
      maxPriorityFeePerGas: 2_250_000_000n,
      chainId: 1,
    }),
    signTransaction: vi.fn().mockResolvedValue('0xsignedtx'),
    ...overrides,
  } as unknown as WalletClient
}

describe('speedUpTransaction', () => {
  it('should fetch original tx and resubmit with bumped gas', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    const result = await speedUpTransaction({
      client,
      walletClient,
      hash: MOCK_HASH,
    })

    expect(result.hash).toBe(MOCK_REPLACEMENT_HASH)
    expect(client.getTransaction).toHaveBeenCalledWith({ hash: MOCK_HASH })
    expect(walletClient.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: 5,
        // Default 12.5% bump: 20 gwei * 1.125 = 22.5 gwei
        maxFeePerGas: 22_500_000_000n,
        maxPriorityFeePerGas: 2_250_000_000n,
      }),
    )
  })

  it('should use explicit gas prices when provided', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    await speedUpTransaction({
      client,
      walletClient,
      hash: MOCK_HASH,
      maxFeePerGas: 50_000_000_000n,
      maxPriorityFeePerGas: 5_000_000_000n,
    })

    expect(walletClient.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFeePerGas: 50_000_000_000n,
        maxPriorityFeePerGas: 5_000_000_000n,
      }),
    )
  })

  it('should use custom gasPriceMultiplier', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    await speedUpTransaction({
      client,
      walletClient,
      hash: MOCK_HASH,
      gasPriceMultiplier: 1.5, // 50% bump
    })

    expect(walletClient.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        // 20 gwei * 1.5 = 30 gwei
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 3_000_000_000n,
      }),
    )
  })

  it('should use broadcaster when provided', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const broadcaster: TxBroadcaster = {
      broadcast: vi.fn().mockResolvedValue(MOCK_REPLACEMENT_HASH),
    }

    const result = await speedUpTransaction({
      client,
      walletClient,
      hash: MOCK_HASH,
      broadcaster,
    })

    expect(result.hash).toBe(MOCK_REPLACEMENT_HASH)
    expect(walletClient.prepareTransactionRequest).toHaveBeenCalled()
    expect(walletClient.signTransaction).toHaveBeenCalled()
    expect(broadcaster.broadcast).toHaveBeenCalledWith('0xsignedtx')
    // Should NOT call sendTransaction directly
    expect(walletClient.sendTransaction).not.toHaveBeenCalled()
  })

  it('should return a TxResult with wait function', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    const result = await speedUpTransaction({
      client,
      walletClient,
      hash: MOCK_HASH,
    })

    expect(typeof result.wait).toBe('function')
    const receipt = await result.wait()
    expect(receipt.status).toBe('success')
  })
})

describe('cancelTransaction', () => {
  it('should send self-transfer with same nonce and bumped gas', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    const result = await cancelTransaction({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      hash: MOCK_HASH,
    })

    expect(result.hash).toBe(MOCK_REPLACEMENT_HASH)
    expect(walletClient.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        account: MOCK_ACCOUNT,
        to: MOCK_ACCOUNT, // Self-transfer
        value: 0n,
        nonce: 5,
        gas: 21000n, // Minimal gas for transfer
        maxFeePerGas: 22_500_000_000n,
        maxPriorityFeePerGas: 2_250_000_000n,
      }),
    )
  })

  it('should use explicit gas prices when provided', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    await cancelTransaction({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      hash: MOCK_HASH,
      maxFeePerGas: 100_000_000_000n,
      maxPriorityFeePerGas: 10_000_000_000n,
    })

    expect(walletClient.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFeePerGas: 100_000_000_000n,
        maxPriorityFeePerGas: 10_000_000_000n,
      }),
    )
  })

  it('should use broadcaster when provided', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const broadcaster: TxBroadcaster = {
      broadcast: vi.fn().mockResolvedValue(MOCK_REPLACEMENT_HASH),
    }

    const result = await cancelTransaction({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      hash: MOCK_HASH,
      broadcaster,
    })

    expect(result.hash).toBe(MOCK_REPLACEMENT_HASH)
    expect(walletClient.prepareTransactionRequest).toHaveBeenCalled()
    expect(walletClient.signTransaction).toHaveBeenCalled()
    expect(broadcaster.broadcast).toHaveBeenCalledWith('0xsignedtx')
    expect(walletClient.sendTransaction).not.toHaveBeenCalled()
  })

  it('should return a TxResult with wait function', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    const result = await cancelTransaction({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      hash: MOCK_HASH,
    })

    expect(typeof result.wait).toBe('function')
  })
})
