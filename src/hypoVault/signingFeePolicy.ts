import type { Account, Address, Hex, LocalAccount, SignedAuthorizationList } from 'viem'
import { parseTransaction } from 'viem'

import {
  type VaultTransactionFeePolicy,
  validateVaultSignedTransactionFeeCaps,
} from './transactionFees'

export type VaultTransactionIntent = {
  chainId: number
  to: Address
  data: Hex
  value: bigint
  gasLimit: bigint
  nonce?: number
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  authorizationList?: SignedAuthorizationList
}

function authorizationIdentity(list: SignedAuthorizationList = []) {
  return list
    .map((authorization) =>
      [
        authorization.address.toLowerCase(),
        authorization.chainId,
        authorization.nonce,
        authorization.yParity ??
          (authorization.v === 27n ? 0 : authorization.v === 28n ? 1 : undefined),
        authorization.r.toLowerCase(),
        authorization.s.toLowerCase(),
      ].join(':'),
    )
    .join('|')
}

/** Enforce an immutable intent budget on the actual serialized transaction before broadcast. */
export function withVaultTransactionFeePolicy(
  account: Account,
  policy: VaultTransactionFeePolicy,
  intent?: VaultTransactionIntent,
): LocalAccount {
  if (account.type !== 'local')
    throw new Error('Adaptive vault fees require a local transaction signer')
  const authority = Object.freeze({ ...policy })
  const expected =
    intent === undefined
      ? undefined
      : Object.freeze({ ...intent, authorization: authorizationIdentity(intent.authorizationList) })
  const signTransaction: LocalAccount['signTransaction'] = async (transaction, options) => {
    const serialized = await account.signTransaction(transaction, options)
    const signed = parseTransaction(serialized)
    if (signed.gas === undefined || signed.gas <= 0n) {
      throw new Error('Vault signed transaction is missing a positive gas limit')
    }
    if (
      expected !== undefined &&
      (signed.chainId !== expected.chainId ||
        signed.to?.toLowerCase() !== expected.to.toLowerCase() ||
        (signed.data ?? '0x').toLowerCase() !== expected.data.toLowerCase() ||
        (signed.value ?? 0n) !== expected.value ||
        signed.gas !== expected.gasLimit ||
        (expected.nonce !== undefined && signed.nonce !== expected.nonce) ||
        (expected.maxFeePerGas !== undefined && signed.maxFeePerGas !== expected.maxFeePerGas) ||
        (expected.maxPriorityFeePerGas !== undefined &&
          signed.maxPriorityFeePerGas !== expected.maxPriorityFeePerGas) ||
        authorizationIdentity(signed.authorizationList) !== expected.authorization)
    )
      throw new Error('Vault signed transaction does not match its gas-budget intent')
    const validation = validateVaultSignedTransactionFeeCaps(
      {
        chainId: signed.chainId,
        gasLimit: signed.gas,
        maxFeePerGas: signed.maxFeePerGas ?? null,
        maxPriorityFeePerGas: signed.maxPriorityFeePerGas ?? null,
      },
      undefined,
      authority,
    )
    if (!validation.valid) throw new Error(validation.reason)
    return serialized
  }
  return { ...account, signTransaction }
}
