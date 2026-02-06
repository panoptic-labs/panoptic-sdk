export type QueuedWithdrawalSnapshot = {
  amount: bigint
  epoch: bigint
}

export type WithdrawalEpochStateSnapshot = {
  epoch: bigint
  sharesWithdrawn: bigint
  assetsReceived: bigint
  sharesFulfilled: bigint
}

function mulDiv({
  value,
  numerator,
  denominator,
}: {
  value: bigint
  numerator: bigint
  denominator: bigint
}): bigint {
  if (denominator === 0n) {
    return 0n
  }
  return (value * numerator) / denominator
}

export function calculateClaimableAssetsFromQueuedWithdrawals({
  queuedWithdrawals,
  withdrawalEpochStates,
  currentWithdrawalEpoch,
}: {
  queuedWithdrawals: QueuedWithdrawalSnapshot[]
  withdrawalEpochStates: WithdrawalEpochStateSnapshot[]
  currentWithdrawalEpoch: bigint
}) {
  const epochStatesByEpoch = new Map(withdrawalEpochStates.map((state) => [state.epoch, state]))

  const byEpoch: {
    epoch: bigint
    queuedShares: bigint
    userSharesFulfilled: bigint
    assetsToReceive: bigint
  }[] = []

  for (const withdrawal of queuedWithdrawals) {
    if (withdrawal.amount === 0n || withdrawal.epoch >= currentWithdrawalEpoch) {
      continue
    }

    const epochState = epochStatesByEpoch.get(withdrawal.epoch)
    if (!epochState) {
      continue
    }

    if (
      epochState.sharesWithdrawn === 0n ||
      epochState.sharesFulfilled === 0n ||
      epochState.assetsReceived === 0n
    ) {
      continue
    }

    const userSharesFulfilled = mulDiv({
      value: withdrawal.amount,
      numerator: epochState.sharesFulfilled,
      denominator: epochState.sharesWithdrawn,
    })

    if (userSharesFulfilled === 0n) {
      continue
    }

    const assetsToReceive = mulDiv({
      value: userSharesFulfilled,
      numerator: epochState.assetsReceived,
      denominator: epochState.sharesFulfilled,
    })

    if (assetsToReceive === 0n) {
      continue
    }

    byEpoch.push({
      epoch: withdrawal.epoch,
      queuedShares: withdrawal.amount,
      userSharesFulfilled,
      assetsToReceive,
    })
  }

  const epochsToExecute = byEpoch.map((entry) => entry.epoch).sort((a, b) => (a < b ? -1 : 1))

  const totalAssets = byEpoch.reduce((sum, entry) => sum + entry.assetsToReceive, 0n)

  return { byEpoch, epochsToExecute, totalAssets }
}
