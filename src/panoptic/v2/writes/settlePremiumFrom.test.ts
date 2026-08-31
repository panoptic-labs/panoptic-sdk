import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { PanopticError } from '../errors'
import type { TxResult } from '../types'
import { orderListForSettle, settlePremiumFrom } from './settlePremiumFrom'
import { submitWrite } from './utils'

vi.mock('./utils', () => ({
  submitWrite: vi.fn(),
}))

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

const base = {
  client: {} as PublicClient,
  walletClient: {} as WalletClient,
  account: '0x1111111111111111111111111111111111111111',
  poolAddress: '0x2222222222222222222222222222222222222222',
  user: '0x3333333333333333333333333333333333333333',
} as const

describe('orderListForSettle', () => {
  it('moves the target tokenId to the end', () => {
    expect(orderListForSettle([1n, 2n, 3n], 2n)).toEqual([1n, 3n, 2n])
  })

  it('keeps a list already ending with the tokenId unchanged', () => {
    expect(orderListForSettle([1n, 2n], 2n)).toEqual([1n, 2n])
  })

  it('throws when the tokenId is not in the list', () => {
    expect(() => orderListForSettle([1n], 2n)).toThrow(PanopticError)
  })
})

describe('settlePremiumFrom', () => {
  it('passes the target list as both To and ToFinal (settle mode)', async () => {
    vi.mocked(submitWrite).mockResolvedValue(txResult)

    await settlePremiumFrom({
      ...base,
      positionIdListFrom: [9n],
      positionIdList: [1n, 2n],
    })

    expect(submitWrite).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: base.poolAddress,
        functionName: 'dispatchFrom',
        args: [[9n], base.user, [1n, 2n], [1n, 2n], 0n],
      }),
    )
  })

  it('reorders the list so the settled tokenId is last', async () => {
    vi.mocked(submitWrite).mockResolvedValue(txResult)

    await settlePremiumFrom({
      ...base,
      positionIdListFrom: [],
      positionIdList: [1n, 2n, 3n],
      tokenId: 1n,
    })

    expect(submitWrite).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: [[], base.user, [2n, 3n, 1n], [2n, 3n, 1n], 0n],
      }),
    )
  })

  it('forwards a non-default premia-as-collateral value', async () => {
    vi.mocked(submitWrite).mockResolvedValue(txResult)

    await settlePremiumFrom({
      ...base,
      positionIdListFrom: [],
      positionIdList: [1n],
      usePremiaAsCollateral: 3n,
    })

    expect(submitWrite).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: [[], base.user, [1n], [1n], 3n],
      }),
    )
  })

  it('propagates a rejected write', async () => {
    const writeError = new Error('write rejected')
    vi.mocked(submitWrite).mockRejectedValue(writeError)

    await expect(
      settlePremiumFrom({ ...base, positionIdListFrom: [], positionIdList: [1n] }),
    ).rejects.toBe(writeError)
  })
})
