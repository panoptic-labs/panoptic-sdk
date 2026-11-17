import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { lockPoolAsBuilder } from './lockPoolAsBuilder'
import { submitWrite } from './utils'

vi.mock('./utils', () => ({
  submitWrite: vi.fn(),
}))

describe('lockPoolAsBuilder', () => {
  it('calls lockPoolAsBuilder on the guardian with the pool and builder code', async () => {
    vi.mocked(submitWrite).mockResolvedValue({ hash: '0x1234', wait: vi.fn() })
    const broadcaster = { broadcast: vi.fn() }

    await lockPoolAsBuilder({
      client: {} as PublicClient,
      walletClient: {} as WalletClient,
      account: '0x1111111111111111111111111111111111111111',
      guardianAddress: '0x3333333333333333333333333333333333333333',
      poolAddress: '0x2222222222222222222222222222222222222222',
      builderCode: 42n,
      txOverrides: { nonce: 7n, broadcaster },
    })

    expect(submitWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        account: '0x1111111111111111111111111111111111111111',
        address: '0x3333333333333333333333333333333333333333',
        functionName: 'lockPoolAsBuilder',
        args: ['0x2222222222222222222222222222222222222222', 42n],
        txOverrides: { nonce: 7n, broadcaster },
      }),
    )
  })
})
