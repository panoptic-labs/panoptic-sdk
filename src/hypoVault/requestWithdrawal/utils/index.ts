export type QueuedDepositSnapshot = {
  amount: bigint
  epoch: bigint
}

export type DepositEpochStateSnapshot = {
  assetsDeposited: bigint
  assetsFulfilled: bigint
  epoch: bigint
  sharesReceived: bigint
}

export type SharePrice = {
  numerator: bigint
  denominator: bigint
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

export function getMinQueuedDepositEpoch({
  queuedDeposits,
}: {
  queuedDeposits: QueuedDepositSnapshot[]
}): bigint | null {
  const eligible = queuedDeposits
    .filter((deposit) => deposit.amount > 0n)
    .map((deposit) => deposit.epoch)

  if (eligible.length === 0) {
    return null
  }

  return eligible.reduce((min, epoch) => (epoch < min ? epoch : min))
}

export function calculateClaimableSharesFromQueuedDeposits({
  queuedDeposits,
  depositEpochStates,
  currentDepositEpoch,
}: {
  queuedDeposits: QueuedDepositSnapshot[]
  depositEpochStates: DepositEpochStateSnapshot[]
  currentDepositEpoch: bigint
}) {
  const epochStatesByEpoch = new Map(depositEpochStates.map((state) => [state.epoch, state]))

  const byEpoch: {
    epoch: bigint
    queuedAssets: bigint
    userAssetsDeposited: bigint
    sharesToMint: bigint
  }[] = []

  for (const deposit of queuedDeposits) {
    if (deposit.amount === 0n || deposit.epoch >= currentDepositEpoch) {
      continue
    }

    const epochState = epochStatesByEpoch.get(deposit.epoch)
    if (!epochState) {
      continue
    }

    const userAssetsDeposited = mulDiv({
      value: deposit.amount,
      numerator: epochState.assetsFulfilled,
      denominator: epochState.assetsDeposited,
    })

    const effectiveFulfilled = epochState.assetsFulfilled === 0n ? 1n : epochState.assetsFulfilled
    const sharesToMint = mulDiv({
      value: userAssetsDeposited,
      numerator: epochState.sharesReceived,
      denominator: effectiveFulfilled,
    })

    if (sharesToMint === 0n) {
      continue
    }

    byEpoch.push({
      epoch: deposit.epoch,
      queuedAssets: deposit.amount,
      userAssetsDeposited,
      sharesToMint,
    })
  }

  const epochsToExecute = byEpoch.map((entry) => entry.epoch).sort((a, b) => (a < b ? -1 : 1))

  const totalShares = byEpoch.reduce((sum, entry) => sum + entry.sharesToMint, 0n)

  return { byEpoch, epochsToExecute, totalShares }
}

export function calculateAvailableShares({
  walletShares,
  claimableDepositShares,
}: {
  walletShares: bigint
  claimableDepositShares: bigint
}): bigint {
  return walletShares + claimableDepositShares
}

export function calculateSharesFromAssets({
  assets,
  sharePrice,
}: {
  assets: bigint
  sharePrice: SharePrice
}): bigint {
  return mulDiv({
    value: assets,
    numerator: sharePrice.denominator,
    denominator: sharePrice.numerator,
  })
}

export function calculateAssetsFromShares({
  shares,
  sharePrice,
}: {
  shares: bigint
  sharePrice: SharePrice
}): bigint {
  return mulDiv({
    value: shares,
    numerator: sharePrice.numerator,
    denominator: sharePrice.denominator,
  })
}
