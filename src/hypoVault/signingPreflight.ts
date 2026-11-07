import type { Account, LocalAccount } from 'viem'

/** Validate execution after signing, before the signed bytes can be broadcast. */
export function withVaultTransactionPreflight(
  account: Account,
  preflight: () => Promise<void>,
): LocalAccount {
  if (account.type !== 'local')
    throw new Error('Post-sign vault preflight requires a local transaction signer')
  const signTransaction: LocalAccount['signTransaction'] = async (transaction, options) => {
    const serialized = await account.signTransaction(transaction, options)
    await preflight()
    return serialized
  }
  return { ...account, signTransaction }
}
