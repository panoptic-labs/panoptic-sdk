import { type Hex, encodeFunctionData } from 'viem'

import { HypoVaultManagerWithMerkleVerificationAbi } from '../../abis/HypoVaultManagerWithMerkleVerification'

export function encodeFulfillWithdrawalsFunctionData({
  sharesToFulfill,
  maxAssetsReceived,
  managerInput,
}: {
  sharesToFulfill: bigint
  maxAssetsReceived: bigint
  managerInput: Hex
}) {
  return encodeFunctionData({
    abi: HypoVaultManagerWithMerkleVerificationAbi,
    functionName: 'fulfillWithdrawals',
    args: [sharesToFulfill, maxAssetsReceived, managerInput],
  })
}
