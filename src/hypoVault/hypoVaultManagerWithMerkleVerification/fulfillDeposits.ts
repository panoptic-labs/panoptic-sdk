import { type Hex, encodeFunctionData } from 'viem'

import { HypoVaultManagerWithMerkleVerificationAbi } from '../../abis/HypoVaultManagerWithMerkleVerification'

export function encodeFulfillDepositsFunctionData({
  assetsToFulfill,
  managerInput,
}: {
  assetsToFulfill: bigint
  managerInput: Hex
}) {
  return encodeFunctionData({
    abi: HypoVaultManagerWithMerkleVerificationAbi,
    functionName: 'fulfillDeposits',
    args: [assetsToFulfill, managerInput],
  })
}
