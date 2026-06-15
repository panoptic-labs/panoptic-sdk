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

export type ClaimableSharesByEpoch = {
  epoch: bigint
  queuedAssets: bigint
  userAssetsDeposited: bigint
  sharesToMint: bigint
}

export type ClaimableExecutionSharesByEpoch = {
  epoch: bigint
  sharesToMint: bigint
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

  const byEpoch: ClaimableSharesByEpoch[] = []
  const executionSharesByEpoch = new Map<bigint, bigint>()

  for (const deposit of queuedDeposits) {
    if (deposit.amount === 0n || deposit.epoch >= currentDepositEpoch) {
      continue
    }

    let remainingAssets = deposit.amount
    let userAssetsDeposited = 0n
    let sharesToMint = 0n

    for (let epoch = deposit.epoch; epoch < currentDepositEpoch; epoch += 1n) {
      const epochState = epochStatesByEpoch.get(epoch)
      if (
        epochState === undefined ||
        epochState.assetsDeposited <= 0n ||
        epochState.assetsFulfilled <= 0n ||
        remainingAssets <= 0n
      ) {
        continue
      }

      const rawFulfilledPortion = mulDiv({
        value: remainingAssets,
        numerator: epochState.assetsFulfilled,
        denominator: epochState.assetsDeposited,
      })
      if (rawFulfilledPortion <= 0n) {
        continue
      }

      const fulfilledPortion =
        rawFulfilledPortion > remainingAssets ? remainingAssets : rawFulfilledPortion
      userAssetsDeposited += fulfilledPortion
      remainingAssets -= fulfilledPortion

      if (epochState.sharesReceived > 0n) {
        const sharesForEpoch = mulDiv({
          value: fulfilledPortion,
          numerator: epochState.sharesReceived,
          denominator: epochState.assetsFulfilled,
        })
        sharesToMint += sharesForEpoch
        const existingExecutionShares = executionSharesByEpoch.get(epoch) ?? 0n
        executionSharesByEpoch.set(epoch, existingExecutionShares + sharesForEpoch)
      }
    }

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

  const byExecutionEpoch: ClaimableExecutionSharesByEpoch[] = Array.from(
    executionSharesByEpoch.entries(),
  ).map(([epoch, sharesToMint]) => ({ epoch, sharesToMint }))

  const epochsToExecute = byExecutionEpoch
    .map((entry) => entry.epoch)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  const totalShares = byEpoch.reduce((sum, entry) => sum + entry.sharesToMint, 0n)

  return { byEpoch, byExecutionEpoch, epochsToExecute, totalShares }
}

export function selectExecuteDepositEpochs({
  claimableByExecutionEpoch,
  requiredClaimableShares,
  requestAllAvailableShares = false,
}: {
  claimableByExecutionEpoch: ClaimableExecutionSharesByEpoch[]
  requiredClaimableShares: bigint
  requestAllAvailableShares?: boolean
}): bigint[] {
  const claimableSharesByEpoch = new Map<bigint, bigint>()

  for (const entry of claimableByExecutionEpoch) {
    if (entry.sharesToMint <= 0n) {
      continue
    }

    const existing = claimableSharesByEpoch.get(entry.epoch) ?? 0n
    claimableSharesByEpoch.set(entry.epoch, existing + entry.sharesToMint)
  }

  const candidates = Array.from(claimableSharesByEpoch.entries()).map(([epoch, sharesToMint]) => ({
    epoch,
    sharesToMint,
  }))

  if (requestAllAvailableShares) {
    return candidates
      .sort((a, b) => (a.epoch < b.epoch ? -1 : a.epoch > b.epoch ? 1 : 0))
      .map((entry) => entry.epoch)
  }

  if (requiredClaimableShares <= 0n) {
    return []
  }

  const sortedCandidates = [...candidates].sort((a, b) => {
    if (a.sharesToMint === b.sharesToMint) {
      return a.epoch < b.epoch ? -1 : a.epoch > b.epoch ? 1 : 0
    }
    return a.sharesToMint > b.sharesToMint ? -1 : 1
  })

  const selectedEpochs: bigint[] = []
  let accumulatedShares = 0n
  for (const candidate of sortedCandidates) {
    if (accumulatedShares >= requiredClaimableShares) {
      break
    }
    selectedEpochs.push(candidate.epoch)
    accumulatedShares += candidate.sharesToMint
  }

  return selectedEpochs
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
