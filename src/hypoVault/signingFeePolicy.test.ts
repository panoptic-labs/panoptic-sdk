import { parseTransaction } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import { VOLUSDC_HEDGE_FEE_POLICY } from './adaptiveHedgeFees'
import { withVaultTransactionFeePolicy } from './signingFeePolicy'

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const transaction = {
  chainId: 1,
  nonce: 7,
  gas: 2_000_000n,
  maxFeePerGas: 400_000_000_000n,
  maxPriorityFeePerGas: 100_000_000_000n,
  to: account.address,
  value: 0n,
}

describe('intent-scoped serialized fee validation', () => {
  it.each(['eip1559', 'eip7702'] as const)(
    'validates the actual %s bytes without changing the account',
    async (type) => {
      const wrapped = withVaultTransactionFeePolicy(account, VOLUSDC_HEDGE_FEE_POLICY)
      const parameters =
        type === 'eip7702'
          ? { ...transaction, type: 'eip7702' as const, authorizationList: [] }
          : { ...transaction, type: 'eip1559' as const }
      const signed = await wrapped.signTransaction(parameters)
      expect(parseTransaction(signed).maxFeePerGas).toBe(transaction.maxFeePerGas)
      expect(wrapped.address).toBe(account.address)
      expect(account.signTransaction).not.toBe(wrapped.signTransaction)
    },
  )

  it('rejects signed fees above the intent budget before returning bytes to broadcast', async () => {
    const wrapped = withVaultTransactionFeePolicy(account, VOLUSDC_HEDGE_FEE_POLICY)
    await expect(
      wrapped.signTransaction({ ...transaction, type: 'eip1559', maxFeePerGas: 900_000_000_000n }),
    ).rejects.toThrow('maximum gas cost')
  })

  it('binds the fee authority to the exact calldata, destination, chain and gas estimate', async () => {
    const intent = {
      chainId: transaction.chainId,
      to: transaction.to,
      data: '0x1234' as const,
      value: 0n,
      gasLimit: transaction.gas,
    }
    const wrapped = withVaultTransactionFeePolicy(account, VOLUSDC_HEDGE_FEE_POLICY, intent)
    const parameters = { ...transaction, data: intent.data, type: 'eip1559' as const }
    await expect(wrapped.signTransaction(parameters)).resolves.toMatch(/^0x/)
    for (const change of [
      { data: '0x1235' as const },
      { to: '0x1111111111111111111111111111111111111111' as const },
      { chainId: 2 },
      { gas: transaction.gas + 1n },
      { value: 1n },
    ])
      await expect(wrapped.signTransaction({ ...parameters, ...change })).rejects.toThrow(
        'gas-budget intent',
      )
  })

  it('copies the budget and intent before asynchronous signing', async () => {
    const policy = { ...VOLUSDC_HEDGE_FEE_POLICY }
    const intent = {
      chainId: transaction.chainId,
      to: transaction.to,
      data: '0x1234' as const,
      value: 0n,
      gasLimit: transaction.gas,
    }
    const wrapped = withVaultTransactionFeePolicy(account, policy, intent)
    policy.maxTransactionGasCost = 2_000_000_000_000_000_000n
    intent.gasLimit = 3_000_000n
    await expect(
      wrapped.signTransaction({
        ...transaction,
        data: intent.data,
        type: 'eip1559',
        maxFeePerGas: 900_000_000_000n,
      }),
    ).rejects.toThrow('maximum gas cost')
  })

  it.each(['eip1559', 'eip7702'] as const)(
    'binds selected fees and nonce on %s bytes',
    async (type) => {
      const wrapped = withVaultTransactionFeePolicy(account, VOLUSDC_HEDGE_FEE_POLICY, {
        chainId: 1,
        to: account.address,
        data: '0x',
        value: 0n,
        gasLimit: transaction.gas,
        nonce: transaction.nonce,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        ...(type === 'eip7702' ? { authorizationList: [] } : {}),
      })
      const parameters =
        type === 'eip7702'
          ? { ...transaction, type, authorizationList: [] }
          : { ...transaction, type }
      await expect(wrapped.signTransaction(parameters)).resolves.toMatch(/^0x/)
      for (const change of [
        { nonce: 8 },
        { maxFeePerGas: transaction.maxFeePerGas - 1n },
        { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas - 1n },
      ])
        await expect(wrapped.signTransaction({ ...parameters, ...change })).rejects.toThrow(
          'gas-budget intent',
        )
    },
  )

  it('binds the EIP-7702 authorization list as well as the batch', async () => {
    const authorization = {
      address: account.address,
      chainId: 1,
      nonce: 3,
      yParity: 0,
      r: `0x${'11'.repeat(32)}` as const,
      s: `0x${'22'.repeat(32)}` as const,
    }
    const intent = {
      chainId: 1,
      to: account.address,
      data: '0x1234' as const,
      value: 0n,
      gasLimit: transaction.gas,
      authorizationList: [authorization],
    }
    const wrapped = withVaultTransactionFeePolicy(account, VOLUSDC_HEDGE_FEE_POLICY, intent)
    await expect(
      wrapped.signTransaction({
        ...transaction,
        data: intent.data,
        type: 'eip7702',
        authorizationList: [authorization],
      }),
    ).resolves.toMatch(/^0x/)
    await expect(
      wrapped.signTransaction({
        ...transaction,
        data: intent.data,
        type: 'eip7702',
        authorizationList: [{ ...authorization, nonce: 4 }],
      }),
    ).rejects.toThrow('gas-budget intent')
  })
})
