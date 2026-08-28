import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import type { TxResult } from '../types'
import { liquidate } from './liquidate'
import { submitWrite } from './utils'

vi.mock('./utils', () => ({
  submitWrite: vi.fn(),
}))

describe('liquidate', () => {
  const txResult: TxResult = {
    hash: '0x1234',
    wait: vi.fn(async () => ({
      hash: '0x1234' as const,
      blockNumber: 1n,
      blockHash: '0x5678' as const,
      gasUsed: 1n,
      status: 'success' as const,
      events: [],
    })),
  }

  it('forwards native funding value to dispatchFrom', async () => {
    vi.mocked(submitWrite).mockResolvedValue(txResult)

    const client = {} as PublicClient
    const walletClient = {} as WalletClient
    const account = '0x1111111111111111111111111111111111111111'
    const poolAddress = '0x2222222222222222222222222222222222222222'
    const liquidatee = '0x3333333333333333333333333333333333333333'
    const value = 10_000_000_000_000_000_000n

    await liquidate({
      client,
      walletClient,
      account,
      poolAddress,
      liquidatee,
      positionIdListFrom: [],
      positionIdListTo: [1n, 2n],
      positionIdListToFinal: [],
      value,
    })

    expect(submitWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        client,
        walletClient,
        account,
        address: poolAddress,
        functionName: 'dispatchFrom',
        args: [[], liquidatee, [1n, 2n], [], 0n],
        value,
      }),
    )
  })

  it('omits native funding when no value is provided', async () => {
    vi.mocked(submitWrite).mockResolvedValue(txResult)

    await liquidate({
      client: {} as PublicClient,
      walletClient: {} as WalletClient,
      account: '0x1111111111111111111111111111111111111111',
      poolAddress: '0x2222222222222222222222222222222222222222',
      liquidatee: '0x3333333333333333333333333333333333333333',
      positionIdListFrom: [],
      positionIdListTo: [1n],
      positionIdListToFinal: [],
    })

    expect(submitWrite).toHaveBeenLastCalledWith(expect.objectContaining({ value: undefined }))
  })

  it('forwards a non-default premia-as-collateral value', async () => {
    vi.mocked(submitWrite).mockResolvedValue(txResult)
    const usePremiaAsCollateral = 3n

    await liquidate({
      client: {} as PublicClient,
      walletClient: {} as WalletClient,
      account: '0x1111111111111111111111111111111111111111',
      poolAddress: '0x2222222222222222222222222222222222222222',
      liquidatee: '0x3333333333333333333333333333333333333333',
      positionIdListFrom: [],
      positionIdListTo: [1n],
      positionIdListToFinal: [],
      usePremiaAsCollateral,
    })

    expect(submitWrite).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: [[], '0x3333333333333333333333333333333333333333', [1n], [], 3n],
      }),
    )
  })

  it('propagates a rejected write', async () => {
    const writeError = new Error('write rejected')
    vi.mocked(submitWrite).mockRejectedValue(writeError)

    const result = liquidate({
      client: {} as PublicClient,
      walletClient: {} as WalletClient,
      account: '0x1111111111111111111111111111111111111111',
      poolAddress: '0x2222222222222222222222222222222222222222',
      liquidatee: '0x3333333333333333333333333333333333333333',
      positionIdListFrom: [],
      positionIdListTo: [1n],
      positionIdListToFinal: [],
    })

    await expect(result).rejects.toBe(writeError)
  })
})
