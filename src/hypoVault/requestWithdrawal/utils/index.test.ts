import { describe, expect, it } from 'vitest'

import { calculateClaimableSharesFromQueuedDeposits, selectExecuteDepositEpochs } from './index'

describe('calculateClaimableSharesFromQueuedDeposits', () => {
  it('accumulates claimable assets and shares across rollover epochs', () => {
    const claimable = calculateClaimableSharesFromQueuedDeposits({
      queuedDeposits: [{ amount: 500_000_000n, epoch: 0n }],
      depositEpochStates: [
        {
          epoch: 0n,
          assetsDeposited: 525_000_000n,
          assetsFulfilled: 149_999_999n,
          sharesReceived: 149_999_999_000_000n,
        },
        {
          epoch: 1n,
          assetsDeposited: 375_000_001n,
          assetsFulfilled: 149_999_391n,
          sharesReceived: 149_998_782_004_945n,
        },
      ],
      currentDepositEpoch: 2n,
    })

    expect(claimable.totalShares).toBe(285_713_124_004_708n)
    expect(claimable.byEpoch).toEqual([
      {
        epoch: 0n,
        queuedAssets: 500_000_000n,
        userAssetsDeposited: 285_713_704n,
        sharesToMint: 285_713_124_004_708n,
      },
    ])
    expect(claimable.byExecutionEpoch).toEqual([
      { epoch: 0n, sharesToMint: 142_857_141_000_000n },
      { epoch: 1n, sharesToMint: 142_855_983_004_708n },
    ])
    expect(claimable.epochsToExecute).toEqual([0n, 1n])
  })
})

describe('selectExecuteDepositEpochs', () => {
  it('returns no epochs when no claimable shares are required', () => {
    const selected = selectExecuteDepositEpochs({
      claimableByExecutionEpoch: [{ epoch: 0n, sharesToMint: 100n }],
      requiredClaimableShares: 0n,
    })

    expect(selected).toEqual([])
  })

  it('selects the minimal number of epochs by highest claimable shares first', () => {
    const selected = selectExecuteDepositEpochs({
      claimableByExecutionEpoch: [
        { epoch: 0n, sharesToMint: 25n },
        { epoch: 1n, sharesToMint: 25n },
        { epoch: 2n, sharesToMint: 40n },
      ],
      requiredClaimableShares: 50n,
    })

    expect(selected).toEqual([2n, 0n])
  })

  it('uses epoch asc as deterministic tie-breaker for equal claimable shares', () => {
    const selected = selectExecuteDepositEpochs({
      claimableByExecutionEpoch: [
        { epoch: 1n, sharesToMint: 25n },
        { epoch: 0n, sharesToMint: 25n },
        { epoch: 2n, sharesToMint: 10n },
      ],
      requiredClaimableShares: 30n,
    })

    expect(selected).toEqual([0n, 1n])
  })

  it('includes all claimable epochs when requesting all available shares', () => {
    const selected = selectExecuteDepositEpochs({
      claimableByExecutionEpoch: [
        { epoch: 2n, sharesToMint: 40n },
        { epoch: 0n, sharesToMint: 25n },
        { epoch: 2n, sharesToMint: 5n },
        { epoch: 1n, sharesToMint: 0n },
      ],
      requiredClaimableShares: 1n,
      requestAllAvailableShares: true,
    })

    expect(selected).toEqual([0n, 2n])
  })
})
