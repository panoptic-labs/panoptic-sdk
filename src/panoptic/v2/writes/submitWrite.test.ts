/**
 * Tests for submitWrite helper.
 * @module v2/writes/submitWrite.test
 */

import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { encodeFunctionData, erc20Abi } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import type { TxBroadcaster, TxOverrides } from '../types'
import { submitWrite } from './utils'

const MOCK_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash
const MOCK_ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const MOCK_TOKEN = '0x2222222222222222222222222222222222222222' as Address

function createMockPublicClient(): PublicClient {
  return {
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: MOCK_HASH,
      blockNumber: 12345678n,
      blockHash: '0xabcd' as Hash,
      gasUsed: 100000n,
      status: 'success',
      logs: [],
    }),
  } as unknown as PublicClient
}

function createMockWalletClient(): WalletClient {
  return {
    chain: { id: 1 },
    writeContract: vi.fn().mockResolvedValue(MOCK_HASH),
    prepareTransactionRequest: vi
      .fn()
      .mockImplementation(
        async (request: {
          to?: Address
          data?: `0x${string}`
          nonce?: number
          gas?: bigint
          maxFeePerGas?: bigint
          maxPriorityFeePerGas?: bigint
          chain?: { id: number } | null
        }) => ({
          to: request.to ?? MOCK_TOKEN,
          data: request.data ?? '0x',
          value: 0n,
          nonce: request.nonce ?? 0,
          gas: request.gas ?? 50000n,
          maxFeePerGas: request.maxFeePerGas,
          maxPriorityFeePerGas: request.maxPriorityFeePerGas,
          chainId: request.chain?.id ?? 1,
        }),
      ),
    signTransaction: vi.fn().mockResolvedValue('0xsignedtx'),
  } as unknown as WalletClient
}

describe('submitWrite', () => {
  it('should call writeContract directly with no overrides', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    const result = await submitWrite({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      address: MOCK_TOKEN,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MOCK_ACCOUNT, 1000n],
    })

    expect(result.hash).toBe(MOCK_HASH)
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_TOKEN,
        functionName: 'approve',
        args: [MOCK_ACCOUNT, 1000n],
        account: MOCK_ACCOUNT,
      }),
    )
  })

  it('should apply gas overrides to writeContract', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    const txOverrides: TxOverrides = {
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 3_000_000_000n,
      gas: 100000n,
      nonce: 42n,
    }

    await submitWrite({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      address: MOCK_TOKEN,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MOCK_ACCOUNT, 1000n],
      txOverrides,
    })

    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 3_000_000_000n,
        gas: 100000n,
        nonce: 42,
      }),
    )
  })

  it('should use broadcaster path when broadcaster is provided', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const broadcaster: TxBroadcaster = {
      broadcast: vi.fn().mockResolvedValue(MOCK_HASH),
    }

    const txOverrides: TxOverrides = {
      broadcaster,
    }
    const expectedData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [MOCK_ACCOUNT, 1000n],
    })

    const result = await submitWrite({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      address: MOCK_TOKEN,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MOCK_ACCOUNT, 1000n],
      txOverrides,
    })

    expect(result.hash).toBe(MOCK_HASH)
    // Should use prepare → sign → broadcast path
    expect(walletClient.prepareTransactionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expectedData,
      }),
    )
    expect(walletClient.signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expectedData,
      }),
    )
    expect(broadcaster.broadcast).toHaveBeenCalledWith('0xsignedtx')
    // Should NOT call writeContract
    expect(walletClient.writeContract).not.toHaveBeenCalled()
  })

  it('should apply gas overrides with broadcaster', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()
    const broadcaster: TxBroadcaster = {
      broadcast: vi.fn().mockResolvedValue(MOCK_HASH),
    }

    const txOverrides: TxOverrides = {
      broadcaster,
      maxFeePerGas: 50_000_000_000n,
      nonce: 10n,
    }
    const expectedData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [MOCK_ACCOUNT, 1000n],
    })

    await submitWrite({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      address: MOCK_TOKEN,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MOCK_ACCOUNT, 1000n],
      txOverrides,
    })

    expect(walletClient.prepareTransactionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expectedData,
        maxFeePerGas: 50_000_000_000n,
        nonce: 10,
      }),
    )
  })

  it('should return TxResult with working wait function', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    const result = await submitWrite({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      address: MOCK_TOKEN,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MOCK_ACCOUNT, 1000n],
    })

    expect(typeof result.wait).toBe('function')
    const receipt = await result.wait()
    expect(receipt.status).toBe('success')
    expect(receipt.blockNumber).toBe(12345678n)
  })

  it('should not spread gas overrides when none provided', async () => {
    const client = createMockPublicClient()
    const walletClient = createMockWalletClient()

    await submitWrite({
      client,
      walletClient,
      account: MOCK_ACCOUNT,
      address: MOCK_TOKEN,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MOCK_ACCOUNT, 1000n],
      txOverrides: {}, // Empty overrides
    })

    const callArgs = (walletClient.writeContract as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callArgs).not.toHaveProperty('maxFeePerGas')
    expect(callArgs).not.toHaveProperty('maxPriorityFeePerGas')
    expect(callArgs).not.toHaveProperty('gas')
    expect(callArgs).not.toHaveProperty('nonce')
  })
})
