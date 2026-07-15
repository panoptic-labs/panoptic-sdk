import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  buildClaimVaultShareCalldatas,
  buildRequestWithdrawalCalldatas,
  encodeExecuteDepositFunctionData,
  encodeRequestWithdrawalFunctionData,
} from './requestWithdrawal'

const USER = '0x1111111111111111111111111111111111111111' as Address

describe('buildRequestWithdrawalCalldatas', () => {
  it('skips executeDeposit calls when wallet shares are already sufficient', () => {
    const result = buildRequestWithdrawalCalldatas({
      user: USER,
      desiredAssets: 80n,
      sharePrice: { numerator: 1n, denominator: 1n },
      walletShares: 100n,
      queuedDeposits: [{ amount: 50n, epoch: 0n }],
      depositEpochStates: [
        {
          epoch: 0n,
          assetsDeposited: 50n,
          assetsFulfilled: 50n,
          sharesReceived: 50n,
        },
      ],
      currentDepositEpoch: 1n,
    })

    expect(result.selectedExecuteDepositEpochs).toEqual([])
    expect(result.sharesToRequest).toBe(80n)
    expect(result.multicallCalldatas).toEqual([
      encodeRequestWithdrawalFunctionData({ shares: 80n }),
    ])
  })

  it('executes one epoch when one claimable epoch is enough', () => {
    const result = buildRequestWithdrawalCalldatas({
      user: USER,
      desiredAssets: 60n,
      sharePrice: { numerator: 1n, denominator: 1n },
      walletShares: 10n,
      queuedDeposits: [{ amount: 50n, epoch: 0n }],
      depositEpochStates: [
        {
          epoch: 0n,
          assetsDeposited: 50n,
          assetsFulfilled: 50n,
          sharesReceived: 50n,
        },
      ],
      currentDepositEpoch: 1n,
    })

    expect(result.selectedExecuteDepositEpochs).toEqual([0n])
    expect(result.multicallCalldatas).toEqual([
      encodeExecuteDepositFunctionData({ user: USER, epoch: 0n }),
      encodeRequestWithdrawalFunctionData({ shares: 60n }),
    ])
  })

  it('chooses the fewest epochs by highest claimable shares first', () => {
    const result = buildRequestWithdrawalCalldatas({
      user: USER,
      desiredAssets: 55n,
      sharePrice: { numerator: 1n, denominator: 1n },
      walletShares: 5n,
      queuedDeposits: [
        { amount: 20n, epoch: 0n },
        { amount: 40n, epoch: 1n },
        { amount: 30n, epoch: 2n },
      ],
      depositEpochStates: [
        {
          epoch: 0n,
          assetsDeposited: 20n,
          assetsFulfilled: 20n,
          sharesReceived: 20n,
        },
        {
          epoch: 1n,
          assetsDeposited: 40n,
          assetsFulfilled: 40n,
          sharesReceived: 40n,
        },
        {
          epoch: 2n,
          assetsDeposited: 30n,
          assetsFulfilled: 30n,
          sharesReceived: 30n,
        },
      ],
      currentDepositEpoch: 3n,
    })

    expect(result.selectedExecuteDepositEpochs).toEqual([1n, 2n])
    expect(result.multicallCalldatas).toEqual([
      encodeExecuteDepositFunctionData({ user: USER, epoch: 1n }),
      encodeExecuteDepositFunctionData({ user: USER, epoch: 2n }),
      encodeRequestWithdrawalFunctionData({ shares: 55n }),
    ])
  })

  it('includes all claimable epochs when requesting all available shares', () => {
    const result = buildRequestWithdrawalCalldatas({
      user: USER,
      desiredAssets: 1n,
      requestAllAvailableShares: true,
      sharePrice: { numerator: 1n, denominator: 1n },
      walletShares: 5n,
      queuedDeposits: [
        { amount: 20n, epoch: 0n },
        { amount: 40n, epoch: 1n },
        { amount: 30n, epoch: 2n },
      ],
      depositEpochStates: [
        {
          epoch: 0n,
          assetsDeposited: 20n,
          assetsFulfilled: 20n,
          sharesReceived: 20n,
        },
        {
          epoch: 1n,
          assetsDeposited: 40n,
          assetsFulfilled: 40n,
          sharesReceived: 40n,
        },
        {
          epoch: 2n,
          assetsDeposited: 30n,
          assetsFulfilled: 30n,
          sharesReceived: 30n,
        },
      ],
      currentDepositEpoch: 3n,
    })

    expect(result.selectedExecuteDepositEpochs).toEqual([0n, 1n, 2n])
    expect(result.sharesToRequest).toBe(95n)
    expect(result.multicallCalldatas).toEqual([
      encodeExecuteDepositFunctionData({ user: USER, epoch: 0n }),
      encodeExecuteDepositFunctionData({ user: USER, epoch: 1n }),
      encodeExecuteDepositFunctionData({ user: USER, epoch: 2n }),
      encodeRequestWithdrawalFunctionData({ shares: 95n }),
    ])
  })

  it('handles split partial fulfillments when requesting more than half of max', () => {
    const result = buildRequestWithdrawalCalldatas({
      user: USER,
      desiredAssets: 200_000_000_000_000n,
      sharePrice: { numerator: 1n, denominator: 1n },
      walletShares: 0n,
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

    expect(result.claimableDepositShares.totalShares).toBe(285_713_124_004_708n)
    expect(result.sharesToRequest).toBe(200_000_000_000_000n)
    expect(result.selectedExecuteDepositEpochs).toEqual([0n, 1n])
    expect(result.multicallCalldatas).toEqual([
      encodeExecuteDepositFunctionData({ user: USER, epoch: 0n }),
      encodeExecuteDepositFunctionData({ user: USER, epoch: 1n }),
      encodeRequestWithdrawalFunctionData({ shares: 200_000_000_000_000n }),
    ])
  })
})

describe('buildClaimVaultShareCalldatas', () => {
  it('executes every fulfilled deposit epoch without requesting a withdrawal', () => {
    const result = buildClaimVaultShareCalldatas({
      user: USER,
      queuedDeposits: [
        { amount: 20n, epoch: 0n },
        { amount: 40n, epoch: 1n },
        { amount: 30n, epoch: 2n },
      ],
      depositEpochStates: [
        {
          epoch: 0n,
          assetsDeposited: 20n,
          assetsFulfilled: 20n,
          sharesReceived: 20n,
        },
        {
          epoch: 1n,
          assetsDeposited: 40n,
          assetsFulfilled: 40n,
          sharesReceived: 40n,
        },
        {
          epoch: 2n,
          assetsDeposited: 30n,
          assetsFulfilled: 30n,
          sharesReceived: 30n,
        },
      ],
      currentDepositEpoch: 3n,
    })

    expect(result.selectedExecuteDepositEpochs).toEqual([0n, 1n, 2n])
    expect(result.multicallCalldatas).toEqual([
      encodeExecuteDepositFunctionData({ user: USER, epoch: 0n }),
      encodeExecuteDepositFunctionData({ user: USER, epoch: 1n }),
      encodeExecuteDepositFunctionData({ user: USER, epoch: 2n }),
    ])
  })

  it('has no calldata when there are no claimable shares', () => {
    const result = buildClaimVaultShareCalldatas({
      user: USER,
      queuedDeposits: [{ amount: 20n, epoch: 0n }],
      depositEpochStates: [],
      currentDepositEpoch: 1n,
    })

    expect(result.selectedExecuteDepositEpochs).toEqual([])
    expect(result.multicallCalldatas).toEqual([])
  })
})
