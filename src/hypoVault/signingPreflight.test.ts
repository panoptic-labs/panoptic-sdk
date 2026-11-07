import type { LocalAccount } from 'viem'
import { parseTransaction } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'

import { withVaultTransactionPreflight } from './signingPreflight'

const account = privateKeyToAccount(`0x${'19'.repeat(32)}`)
const transaction = {
  chainId: 1,
  nonce: 7,
  to: account.address,
  data: '0x1234' as const,
  value: 0n,
  gas: 100_000n,
  maxFeePerGas: 5_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
}

describe('post-sign vault preflight', () => {
  it.each(['eip1559', 'eip7702'] as const)(
    'withholds signed %s bytes when execution changes during signing',
    async (type) => {
      let executable = true
      const slowSigner: LocalAccount = {
        ...account,
        signTransaction: async (parameters, options) => {
          const serialized = await account.signTransaction(parameters, options)
          executable = false
          return serialized
        },
      }
      const preflight = vi.fn(async () => {
        if (!executable) throw new Error('PriceBoundFail')
      })
      const signer = withVaultTransactionPreflight(slowSigner, preflight)
      const parameters =
        type === 'eip7702'
          ? { ...transaction, type, authorizationList: [] }
          : { ...transaction, type }
      await expect(signer.signTransaction(parameters)).rejects.toThrow('PriceBoundFail')
      expect(preflight).toHaveBeenCalledOnce()
    },
  )

  it('preserves the signed intent and checks execution after signing', async () => {
    const events: string[] = []
    const original: LocalAccount = {
      ...account,
      signTransaction: async (parameters, options) => {
        const serialized = await account.signTransaction(parameters, options)
        events.push('signed')
        return serialized
      },
    }
    const signer = withVaultTransactionPreflight(original, async () => {
      events.push('preflight')
    })
    const serialized = await signer.signTransaction({ ...transaction, type: 'eip1559' })
    expect(events).toEqual(['signed', 'preflight'])
    const { to, value, ...fields } = transaction
    const decoded = parseTransaction(serialized)
    expect(decoded).toMatchObject({ ...fields, to: to.toLowerCase() })
    expect(decoded.value ?? 0n).toBe(value)
    expect(signer.address).toBe(account.address)
    expect(signer.signAuthorization).toBe(account.signAuthorization)
  })

  it('withholds signed bytes when the final execution read fails', async () => {
    const signer = withVaultTransactionPreflight(account, async () => {
      throw new Error('RPC timeout')
    })
    await expect(signer.signTransaction({ ...transaction, type: 'eip1559' })).rejects.toThrow(
      'RPC timeout',
    )
  })

  it('requires control of the signing boundary', () => {
    expect(() =>
      withVaultTransactionPreflight(
        { address: account.address, type: 'json-rpc' },
        async () => undefined,
      ),
    ).toThrow('local transaction signer')
  })
})
