import { describe, expect, test } from 'vitest'

import { selectExecutableWithdrawalEpochs } from './use-execute-withdrawal'

describe('selectExecutableWithdrawalEpochs', () => {
  test('does not select epochs that would exceed the execution asset cap', () => {
    const result = selectExecutableWithdrawalEpochs({
      desiredAssets: 1_009_969n,
      maxAssetsToExecute: 1_000_998n,
      claimableWithdrawals: [
        {
          epoch: 0n,
          queuedShares: 7_498_852_248n,
          userSharesFulfilled: 7_498_852_248n,
          assetsToReceive: 9_970n,
        },
        {
          epoch: 1n,
          queuedShares: 752_363_377_915n,
          userSharesFulfilled: 752_363_377_915n,
          assetsToReceive: 999_999n,
        },
      ],
    })

    expect(result).toEqual({
      epochsToExecute: [1n],
      assetsToExecute: 999_999n,
    })
  })
})
