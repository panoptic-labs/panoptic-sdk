import type { Address, Hash, Hex } from 'viem'

import { decodeSnapshotTransaction } from './snapshotRecovery'

/** Applies a confirmed pool event to the account's transaction-final position set. */
export function updatePositionSnapshot({
  previous,
  poolAddress,
  account,
  transaction,
  change,
}: {
  previous?: { positionIds: readonly bigint[]; transactionHash: Hash; fromDispatch: boolean }
  poolAddress: Address
  account: Address
  transaction: { hash: Hash; input: Hex; from: Address; to: Address | null }
  change: { type: 'mint' | 'burn'; tokenId: bigint }
}): { positionIds: bigint[]; transactionHash: Hash; fromDispatch: boolean } {
  if (previous?.fromDispatch && previous.transactionHash === transaction.hash) {
    return { ...previous, positionIds: [...previous.positionIds] }
  }
  // Indexing proxies can expose fields through getters without enumerable property descriptors.
  const decoded = decodeSnapshotTransaction({
    input: transaction.input,
    from: transaction.from,
    to: transaction.to,
    account,
    pool: poolAddress,
  })
  if (decoded !== null) {
    return {
      positionIds: [...decoded.positionIds],
      transactionHash: transaction.hash,
      fromDispatch: true,
    }
  }

  // V2 burns close the entire position; manager-generated internal calls are covered by these events.
  const positions = new Set(previous?.positionIds ?? [])
  if (change.type === 'mint') positions.add(change.tokenId)
  else positions.delete(change.tokenId)
  return {
    positionIds: [...positions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    transactionHash: transaction.hash,
    fromDispatch: false,
  }
}
